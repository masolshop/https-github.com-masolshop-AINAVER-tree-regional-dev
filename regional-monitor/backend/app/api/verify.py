"""실시간 노출 검증 API."""
import asyncio
import io
import time
from datetime import datetime
from app.core.time_utils import now_kst, to_kst, KST

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.core.rate_limit import limiter
from app.models.place import RegisteredPlace
from app.models.user import User
from app.models.verify_job import VerifyJob
from app.schemas import (
    LiveCheckRequest,
    LiveCheckResponse,
    VerificationResult,
    VerificationDetail,
    VerifyJobCreate,
    VerifyJobOut,
    VerifyJobCancelResponse,
    VerifyProgress,
)
from app.core.config import settings
from app.services import verify_batch, summarize_results
from app.services.persist import persist_results
from app.services.notifier import notify_user_events
from app.services.verify_job_runner import (
    run_job,
    get_plan_limit,
    _ids_to_csv,
)
from .deps import get_current_user

router = APIRouter(prefix="/verify", tags=["verify"])


# ──────────────────────────────────────────────────────────────
# 사용자별 동시 수동 검증 락 — 같은 사용자가 다중 청크/탭/새로고침 후
# 새 검증을 다시 트리거할 때 백엔드에서 동시 실행되는 것을 방지.
# 동시 실행이 일어나면 phone→place_id 추출 단계가 같은 번호에 대해 두 번
# 동시 호출되어 네이버에서 403/429 차단을 받고, false-positive DEAD 판정으로
# 이어진다 (실제 사례: 96건이 한 번에 PAGE_DELETED 로 잘못 판정).
# ──────────────────────────────────────────────────────────────
_user_verify_locks: dict[int, asyncio.Lock] = {}


def _get_user_lock(user_id: int) -> asyncio.Lock:
    lock = _user_verify_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _user_verify_locks[user_id] = lock
    return lock


# ──────────────────────────────────────────────────────────────
# Verify Progress 추적 (Option B — Phase 6 — 2026-05-16)
#
# 프론트(`LiveCheckTab.tsx`)가 청크 단위로 POST /verify/live 를 호출할 때,
# 백엔드는 청크 메타(kind/chunk_index/total_chunks/total_targets)를 메모리에
# 저장한다. GET /verify/progress 가 이 dict 를 읽어 사용자 UI 에 노출한다.
#
# 왜 메모리(in-process) dict 인가:
#   · 단일 uvicorn 워커 환경 (현재 라이트세일 배포는 1 worker) — race 없음.
#   · 진행 상태는 휘발성이라 DB 까지 갈 필요가 없음 (재시작 시 사라져도 OK).
#   · 향후 워커가 늘면 Redis 로 교체 (인터페이스만 동일하게 유지).
#
# Stale 판정 — running 으로 보일지 판단하는 규칙:
#   · 사용자 락이 점유 중이면 → running=True
#   · 락이 풀려 있어도 last_updated_at 이 STALE_THRESHOLD_SEC 이내면 → True
#       (마지막 청크가 막 끝났고 다음 청크 호출이 0.8초 후에 올 거라서,
#        그 사이 빠른 폴링이 'false' 로 깜빡이지 않게 한다)
#   · 그 외 → False (자동으로 None 으로 reset 됨)
#
# Memory leak 방지:
#   · 사용자별 1 entry, 사이즈 작음 (~256 bytes).
#   · 사용자 락도 동일 패턴으로 영구 보관 중이므로 위험 미미.
# ──────────────────────────────────────────────────────────────
_user_verify_progress: dict[int, dict] = {}

# stale 판정 임계치 — last_updated_at 이 이 시간보다 오래되면 running=False 로 본다.
#   · CHUNK_DELAY_MS=800 (프론트) + 청크 처리 ~10초 + 네트워크 지연 여유.
#   · 30초면 정상 청크 간격은 모두 커버하면서, 좀비 락이 영원히 살아남지도 않는다.
_PROGRESS_STALE_SEC = 30


def _now_ms() -> int:
    """현재 epoch ms (UTC 기준)."""
    return int(time.time() * 1000)


def _begin_verify_progress(
    user_id: int,
    *,
    kind: str | None,
    chunk_index: int | None,
    total_chunks: int | None,
    total_targets: int | None,
) -> None:
    """청크 시작 시 호출 — 첫 청크면 started_at 을 설정, 이후 청크는 last_updated_at 만 갱신.

    호출 시점: `_run_live_check_locked` 진입 직후 (락 안에서 호출).
    """
    now = _now_ms()
    cur = _user_verify_progress.get(user_id)
    if (
        cur is None
        # 30분 이상 지난 좀비 진행 상태는 새 세션으로 간주
        or (cur.get("started_at") or 0) < now - 30 * 60 * 1000
        # 청크 인덱스가 줄어들면 새 검증 세션 시작 (이전 세션이 끝나고 새로 누름)
        or (chunk_index is not None and (cur.get("chunk_index") or 99999) > chunk_index)
    ):
        cur = {
            "started_at": now,
            "done": 0,
        }
    cur["kind"] = kind
    cur["chunk_index"] = chunk_index
    cur["total_chunks"] = total_chunks
    cur["total_targets"] = total_targets
    cur["last_updated_at"] = now
    _user_verify_progress[user_id] = cur


def _update_verify_progress_done(user_id: int, *, chunk_size: int) -> None:
    """청크 처리 완료 시 호출 — done 누적 + last_updated_at 갱신.

    호출 시점: `_run_live_check_locked` 의 마지막 부분 (verify_batch 가 끝난 후).
    """
    cur = _user_verify_progress.get(user_id)
    if cur is None:
        return
    cur["done"] = int(cur.get("done") or 0) + chunk_size
    cur["last_updated_at"] = _now_ms()


def _clear_verify_progress(user_id: int) -> None:
    """진행 상태 명시적 제거 (전 청크 완료 시 프론트가 호출 가능)."""
    _user_verify_progress.pop(user_id, None)


def _read_verify_progress(user_id: int) -> VerifyProgress:
    """현재 사용자의 진행 상태 스냅샷.

    락 점유 여부 + stale 임계치를 합쳐 running 을 결정한다.
    오래된 stale entry 는 자동으로 정리 후 빈 응답 반환.
    """
    lock = _user_verify_locks.get(user_id)
    locked = bool(lock and lock.locked())
    cur = _user_verify_progress.get(user_id)
    now = _now_ms()

    if cur is None:
        return VerifyProgress(running=locked)

    last = int(cur.get("last_updated_at") or 0)
    is_recent = (now - last) < _PROGRESS_STALE_SEC * 1000
    running = locked or is_recent

    # 너무 오래되었으면 자동 cleanup
    if not running and (now - last) > 60 * 60 * 1000:
        _user_verify_progress.pop(user_id, None)

    total_chunks = cur.get("total_chunks")
    chunk_index_0based = cur.get("chunk_index")
    # 프론트는 1-based 청크 번호를 기대 — 0-based 입력을 +1 해서 노출
    chunk_index_1based = (chunk_index_0based + 1) if isinstance(chunk_index_0based, int) else None

    return VerifyProgress(
        running=running,
        kind=cur.get("kind"),
        chunk_index=chunk_index_1based,
        total_chunks=total_chunks,
        done=int(cur.get("done") or 0),
        total=int(cur.get("total_targets") or 0),
        started_at=cur.get("started_at"),
        last_updated_at=last or None,
    )

# Verdict 한글 라벨 (XLSX 다운로드용)
_VERDICT_LABEL_KO = {
    "OK": "정상 노출",
    "PHONE_MISMATCH": "전화 불일치",
    "DONG_MISMATCH": "동 불일치",
    "NAME_MISMATCH": "상호 불일치",
    "REGION_MISMATCH": "지역 불일치",
    "DEAD": "네이버 미노출",
    "PENDING": "검증 대기",
    "CHECKING": "검증 중",
}
_MISMATCH_VERDICTS = {
    "PHONE_MISMATCH",
    "DONG_MISMATCH",
    "NAME_MISMATCH",
    "REGION_MISMATCH",
    "DEAD",
}


def _job_to_out(job: VerifyJob) -> VerifyJobOut:
    progress_pct = (
        round(job.processed / job.total * 100, 1) if job.total > 0 else 0.0
    )
    elapsed: int | None = None
    eta: int | None = None
    now = now_kst()
    if job.started_at:
        end_ref = job.finished_at or now
        elapsed = max(0, int((end_ref - job.started_at).total_seconds()))
        if job.processed > 0 and job.status == "running":
            rate = job.processed / max(elapsed, 1)
            remaining = max(job.total - job.processed, 0)
            eta = int(remaining / rate) if rate > 0 else None
    return VerifyJobOut(
        id=job.id,
        user_id=job.user_id,
        status=job.status,                                                              # type: ignore[arg-type]
        cancel_requested=job.cancel_requested,
        total=job.total,
        processed=job.processed,
        ok_count=job.ok_count,
        warning_count=job.warning_count,
        danger_count=job.danger_count,
        chunk_size=job.chunk_size,
        chunks_total=job.chunks_total,
        chunks_done=job.chunks_done,
        started_at=job.started_at,
        finished_at=job.finished_at,
        created_at=job.created_at,
        error=job.error,
        progress_pct=progress_pct,
        eta_seconds=eta,
        elapsed_seconds=elapsed,
        mismatch_count=job.warning_count + job.danger_count,
    )


@router.get("/progress", response_model=VerifyProgress)
async def get_verify_progress(
    user: User = Depends(get_current_user),
) -> VerifyProgress:
    """현재 사용자의 수동 검증(POST /verify/live) 진행 상태.

    프론트(`LiveCheckTab.tsx`)가 3초 간격으로 폴링하여 다음 UX 를 구현:
      · running=True 이면 등록 체크/재체크 버튼을 비활성화
        (페이지 새로고침/다른 탭에서도 일관된 상태 유지)
      · chunk_index/total_chunks 로 진행률 표시
      · done/total 로 누적 완료 건수 표시

    인증된 사용자만 자기 자신의 진행 상태를 조회한다 (관리자라도 다른 사용자
    상태를 조회하려면 별도 엔드포인트가 필요 — 현재는 본인만).

    DB 접근 없음 — 메모리 dict 만 조회하므로 매우 빠름 (~1ms).
    """
    return _read_verify_progress(user.id)


@router.post("/live", response_model=LiveCheckResponse)
@limiter.limit("20/minute")
async def run_live_check(
    request: Request,
    response: Response,
    req: LiveCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LiveCheckResponse:
    """현재 사용자 등록 070들에 대해 즉시 4중 검증 실행.

    프론트의 "지금 검증 시작" 버튼이 호출.
    - place_ids 가 None 이면 전체 등록을 검증.
    - 결과는 DB(daily_health_checks)에 기록되고, registered_places.current_verdict 갱신.

    동시성 보호:
      · 사용자별 asyncio.Lock 으로 같은 user 의 두 번째 요청은 409(Conflict).
        (예: 새로고침 후 재요청 시 이전 검증이 끝날 때까지 대기하지 않고 빠르게 거절)
    """
    # 1) 사용자별 락 — 이미 검증 중이면 즉시 409 반환 (waiting 으로 무한 대기 방지)
    lock = _get_user_lock(user.id)
    if lock.locked():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "이전 검증이 아직 진행 중입니다. 잠시 후 다시 시도하거나 "
                "‘취소’ 후 페이지가 ‘대기’ 상태가 된 뒤 시작해주세요."
            ),
        )

    async with lock:
        return await _run_live_check_locked(req, request, user, db)


async def _run_live_check_locked(
    req: LiveCheckRequest,
    request: Request,
    user: User,
    db: AsyncSession,
) -> LiveCheckResponse:
    """실제 검증 본체. lock 안에서만 호출됨."""
    # ── Option B: 청크 진행 메타 기록 — 클라이언트가 함께 보냈을 때만 ──
    # 누락 시 진행 상태는 partial 로만 채워지지만, 락 상태로 running 은 여전히 True.
    _begin_verify_progress(
        user.id,
        kind=req.kind,
        chunk_index=req.chunk_index,
        total_chunks=req.total_chunks,
        total_targets=req.total_targets,
    )

    query = select(RegisteredPlace).where(RegisteredPlace.user_id == user.id)
    if req.place_ids:
        query = query.where(RegisteredPlace.id.in_(req.place_ids))
    # 2단계 "재체크" — current_verdict='PENDING' 인 항목만 검증
    if req.only_pending:
        query = query.where(RegisteredPlace.current_verdict == "PENDING")
    result = await db.execute(query)
    places = list(result.scalars().all())

    if not places:
        # only_pending 모드일 때는 404 대신 200 + 빈 결과로 응답한다.
        # 이유: 프론트는 902건을 100개 청크로 분할해 9회 호출하는데,
        #   각 청크가 진행되는 동안 다른 청크가 verdict 를 PENDING → OK/DEAD 로
        #   바꿔놓을 수 있다. 그 결과 후속 청크의 ID 들이 모두 더 이상 PENDING 이
        #   아니게 되면 백엔드가 404 를 뱉었고, 프론트의 await fetch 가 throw 해서
        #   남은 청크 전체가 중단되는 버그가 있었다 (사용자 보고: "재체크 902건
        #   중간에 빨간 띠 + 멈춤"). 빈 청크는 정상 케이스로 처리해야 청크 자동
        #   진행이 깨지지 않는다.
        #
        # 전체 등록이 0건인 등록-체크(full) 케이스는 여전히 404. (이건 실제로
        # 등록이 비어있는 상태이므로 사용자에게 명시적으로 알릴 가치가 있음.)
        if req.only_pending:
            return LiveCheckResponse(
                total_ms=0,
                avg_ms=0,
                throughput=0.0,
                results=[],
                summary={"ok": 0, "warning": 0, "danger": 0},
            )
        raise HTTPException(status_code=404, detail="검증할 등록이 없습니다.")

    # 병렬 검증 — 글로벌 세마포어가 실제 한도 결정 (SOLO=3 / MULTI=1)
    #
    # 정책 변경 (2026-04-28, 사용자 결정):
    #   "등록 체크는 정확도 최우선 — 시간이 2배 더 걸려도 좋다.
    #    자동 정기 체크도 서버단이라 시간에 쫓기지 말고 보수적으로."
    #
    # 등록 체크(full 모드): 직렬(concurrency=1) + pace 400ms
    #   → 296건 ≈ (290ms 응답 + 400ms 페이스) × 296 ≈ 약 200초
    #   → 네이버 IP throttle 회피, 캡차 위험 거의 0
    #   → 풀 검증(전화/동/로/리)이라 1회 실행으로 충분
    # 빠른 모드(fast): 직렬 권장이지만 수동 fast 사용 빈도가 낮으므로 concurrency=2 유지.
    mode = (req.mode or "full").lower()
    if mode not in ("full", "fast"):
        mode = "full"
    # 글로벌 세마포어가 다중 사용자 시 자동 1로 떨어뜨려 추가 보호.
    if mode == "full":
        concurrency = 1     # 직렬 — 정확도 최우선 (사용자 명시 결정)
        pace_ms = 400       # 호출 간 400ms 휴식 → 차단 위험 최소화
    else:
        concurrency = 2     # 빠른 모드는 절반 — 정밀도와 속도 절충
        pace_ms = 200
    t0 = time.perf_counter()
    raw_results = await verify_batch(
        places,
        concurrency=concurrency,
        mode=mode,
        pace_ms=pace_ms,
    )
    total_ms = int((time.perf_counter() - t0) * 1000)

    # DB 기록 + verdict 캐시 갱신 + ChangeEvent 자동 생성
    persist_stats = await persist_results(db, raw_results, trigger="manual", mode=mode)

    # 자동 추출 보강 (이전에 비어 있던 full_address 만 채움)
    place_by_id = {p.id: p for p in places}
    for r in raw_results:
        place = place_by_id.get(r["place_id_ref"])
        if place and not place.full_address:
            addr = r["detail"].get("actual_address")
            if addr:
                place.full_address = addr

    # ── 수동 검증 회차 기록 (History 페이지 데이터) ──
    try:
        from app.models.check import VerificationRun
        from app.core.time_utils import now_kst
        ok_n = sum(1 for r in raw_results if str(r["verdict"]).endswith("OK"))
        dead_n = sum(1 for r in raw_results if str(r["verdict"]).endswith("DEAD"))
        pend_n = sum(1 for r in raw_results if str(r["verdict"]).endswith("PENDING"))
        db.add(VerificationRun(
            user_id=user.id,
            trigger="manual",
            mode=mode,
            slot_hour=-1,
            total_count=len(raw_results),
            ok_count=ok_n,
            dead_count=dead_n,
            pending_count=pend_n,
            events_count=len(persist_stats.get("new_events") or [])
                         if isinstance(persist_stats.get("new_events"), list) else 0,
            elapsed_ms=total_ms,
            started_at=now_kst(),
        ))
    except Exception:                                                        # noqa: BLE001
        pass  # 회차 기록 실패해도 검증 응답은 정상 반환

    await db.commit()

    # ── Option B: 청크 완료 — done 누적 갱신 (락 안에서) ──
    _update_verify_progress_done(user.id, chunk_size=len(raw_results))

    # ── 변경 이벤트가 발생했을 때만 알림 발송 (best-effort) ──
    # 즉시 검증에서도 변경이 감지되면 사용자에게 Email/Slack 알림을 즉시 전송.
    new_events = persist_stats.pop("new_events", []) or []
    place_lookup = persist_stats.pop("place_lookup", {}) or place_by_id
    if settings.NOTIFY_ENABLED and new_events:
        try:
            # 회차 요약 (이메일 템플릿용)
            ok_n_summary = sum(1 for r in raw_results if str(r["verdict"]).endswith("OK"))
            dead_n_summary = sum(1 for r in raw_results if str(r["verdict"]).endswith("DEAD"))
            pending_n_summary = sum(1 for r in raw_results if str(r["verdict"]).endswith("PENDING"))
            mismatch_n_summary = sum(
                1 for r in raw_results
                if str(r["verdict"]).endswith(("PHONE_MISMATCH", "DONG_MISMATCH",
                                                "NAME_MISMATCH", "REGION_MISMATCH"))
            )
            run_summary = {
                "total": len(raw_results),
                "ok": ok_n_summary,
                "dead": dead_n_summary,
                "mismatch": mismatch_n_summary,
                "pending": pending_n_summary,
                "elapsed_ms": total_ms,
                "mode": mode,
                "trigger": "manual",
            }
            await notify_user_events(
                db, user, new_events,
                place_lookup=place_lookup,
                run_summary=run_summary,
            )
        except Exception:                                                        # noqa: BLE001
            # 알림 실패가 검증 응답을 망치지 않도록 조용히 무시 (notifier 내부에서 로깅).
            pass

    # 응답 변환
    summary = summarize_results(raw_results)
    avg_ms = summary["avg_ms"]
    throughput = round(len(raw_results) / total_ms * 1000, 1) if total_ms > 0 else 0.0

    items = [
        VerificationResult(
            place_id_ref=r["place_id_ref"],
            phone=r["phone"],
            place_id=r["place_id"],
            registered_dong=r["registered_dong"],
            business_name=r["business_name"],
            detail=VerificationDetail(
                alive=r["detail"]["alive"],
                phone_match=r["detail"]["phone_match"],
                dong_match=r["detail"]["dong_match"],
                name_match=r["detail"]["name_match"],
                actual_phone=r["detail"]["actual_phone"],
                actual_dong=r["detail"]["actual_dong"],
                actual_name=r["detail"]["actual_name"],
                actual_address=r["detail"]["actual_address"],
            ),
            verdict=r["verdict"],
            response_ms=r["response_ms"],
            http_status=r["http_status"],
            error=r["error"],
            checked_at=r["checked_at"],
        )
        for r in raw_results
    ]

    return LiveCheckResponse(
        total_ms=total_ms,
        avg_ms=avg_ms,
        throughput=throughput,
        results=items,
        summary={
            "ok": summary["ok"],
            "warning": summary["warning"],
            "danger": summary["danger"],
        },
    )


# ─────────────────────────── 대용량 작업 (VerifyJob) ───────────────────────────

@router.post("/job", response_model=VerifyJobOut, status_code=status.HTTP_202_ACCEPTED)
async def create_verify_job(
    req: VerifyJobCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifyJobOut:
    """대용량 검증 작업 생성 + 백그라운드 실행 시작.

    - 사용자당 동시 1개 (running/queued 가 있으면 409).
    - place_ids 가 비어있으면 사용자 등록 전체.
    - 500건 청크로 나누어 진행 (concurrency 10).
    """
    # 동시 작업 1개 가드
    existing = await db.execute(
        select(VerifyJob).where(
            VerifyJob.user_id == user.id,
            VerifyJob.status.in_(("queued", "running")),
        )
    )
    running = existing.scalar_one_or_none()
    if running is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"이미 진행 중인 검증 작업(id={running.id})이 있습니다. 완료/취소 후 다시 시작하세요.",
        )

    # 대상 places 카운트 + 한도 적용
    place_ids = req.place_ids or None
    base_q = select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user.id)
    if place_ids:
        base_q = base_q.where(RegisteredPlace.id.in_(place_ids))
    total_count = (await db.execute(base_q)).scalar_one() or 0
    if total_count == 0:
        raise HTTPException(status_code=404, detail="검증할 등록이 없습니다.")

    limit = get_plan_limit(user.plan)
    capped = min(total_count, limit)

    job = VerifyJob(
        user_id=user.id,
        status="queued",
        chunk_size=500,
        place_ids_csv=_ids_to_csv(place_ids),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # 백그라운드 워커 띄우기 (in-process asyncio.create_task)
    asyncio.create_task(run_job(job.id))

    out = _job_to_out(job)
    out.total = capped  # 사용자에게 미리 알려주기
    return out


@router.get("/job/{job_id}", response_model=VerifyJobOut)
async def get_verify_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifyJobOut:
    """검증 작업 상태 조회 (프론트 폴링용)."""
    res = await db.execute(select(VerifyJob).where(VerifyJob.id == job_id))
    job = res.scalar_one_or_none()
    if job is None or (job.user_id != user.id and not user.is_superadmin):
        raise HTTPException(status_code=404, detail="검증 작업을 찾을 수 없습니다.")
    return _job_to_out(job)


@router.post("/job/{job_id}/cancel", response_model=VerifyJobCancelResponse)
async def cancel_verify_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifyJobCancelResponse:
    """검증 작업 취소 요청 (다음 청크 시작 전에 멈춤)."""
    res = await db.execute(select(VerifyJob).where(VerifyJob.id == job_id))
    job = res.scalar_one_or_none()
    if job is None or (job.user_id != user.id and not user.is_superadmin):
        raise HTTPException(status_code=404, detail="검증 작업을 찾을 수 없습니다.")
    if job.status in ("completed", "cancelled", "failed"):
        return VerifyJobCancelResponse(
            id=job.id,
            status=job.status,
            cancel_requested=job.cancel_requested,
            message=f"이미 {job.status} 상태입니다.",
        )
    job.cancel_requested = True
    await db.commit()
    return VerifyJobCancelResponse(
        id=job.id,
        status=job.status,
        cancel_requested=True,
        message="취소 요청을 접수했습니다. 진행 중인 청크가 끝나면 멈춥니다.",
    )


@router.get("/job/{job_id}/mismatches.xlsx")
async def download_job_mismatches(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """완료된(또는 취소된) 작업의 불일치 명단을 .xlsx 로 다운로드.

    검증 작업 자체가 사용자 소유 places 의 verdict 를 갱신했으므로
    "지금 사용자 등록 중에서 mismatch verdict 인 것들" 을 모두 반환한다.
    """
    res = await db.execute(select(VerifyJob).where(VerifyJob.id == job_id))
    job = res.scalar_one_or_none()
    if job is None or (job.user_id != user.id and not user.is_superadmin):
        raise HTTPException(status_code=404, detail="검증 작업을 찾을 수 없습니다.")
    if job.status not in ("completed", "cancelled", "failed"):
        raise HTTPException(status_code=409, detail="작업이 아직 끝나지 않았습니다.")

    # 사용자 mismatch places 추출
    q = select(RegisteredPlace).where(
        RegisteredPlace.user_id == user.id,
        RegisteredPlace.current_verdict.in_(_MISMATCH_VERDICTS),
    ).order_by(RegisteredPlace.current_verdict, RegisteredPlace.id)
    rows = (await db.execute(q)).scalars().all()

    # openpyxl 로 xlsx 생성
    from openpyxl import Workbook                                                       # type: ignore

    wb = Workbook()
    ws = wb.active
    ws.title = "불일치 명단"
    ws.append(
        ["순번", "070 번호", "Place ID", "등록 동", "상호", "검증 상태", "검증 코드", "최근 점검"]
    )
    for idx, p in enumerate(rows, 1):
        ws.append([
            idx,
            p.phone,
            p.place_id,
            p.registered_dong,
            p.business_name,
            _VERDICT_LABEL_KO.get(p.current_verdict, p.current_verdict),
            p.current_verdict,
            (p.last_checked_at.strftime("%Y-%m-%d %H:%M:%S") if p.last_checked_at else ""),
        ])
    # 컬럼 폭
    widths = [6, 16, 12, 14, 28, 14, 18, 20]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[chr(64 + i)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"타지역서비스_불일치명단_job{job.id}_{len(rows)}건.xlsx"
    # RFC 5987 인코딩으로 한글 파일명 헤더 안전화
    from urllib.parse import quote
    encoded = quote(filename)
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
    }
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
