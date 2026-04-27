"""실시간 노출 검증 API."""
import asyncio
import io
import time
from datetime import datetime
from app.core.time_utils import now_kst, to_kst, KST

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
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

# Verdict 한글 라벨 (XLSX 다운로드용)
_VERDICT_LABEL_KO = {
    "OK": "정상 노출",
    "PHONE_MISMATCH": "전화 불일치",
    "DONG_MISMATCH": "동 불일치",
    "NAME_MISMATCH": "상호 불일치",
    "REGION_MISMATCH": "지역 불일치",
    "DEAD": "페이지 삭제",
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


@router.post("/live", response_model=LiveCheckResponse)
async def run_live_check(
    req: LiveCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LiveCheckResponse:
    """현재 사용자 등록 070들에 대해 즉시 4중 검증 실행.

    프론트의 "지금 검증 시작" 버튼이 호출.
    - place_ids 가 None 이면 전체 등록을 검증.
    - 결과는 DB(daily_health_checks)에 기록되고, registered_places.current_verdict 갱신.
    """
    query = select(RegisteredPlace).where(RegisteredPlace.user_id == user.id)
    if req.place_ids:
        query = query.where(RegisteredPlace.id.in_(req.place_ids))
    result = await db.execute(query)
    places = list(result.scalars().all())

    if not places:
        raise HTTPException(status_code=404, detail="검증할 등록이 없습니다.")

    # 병렬 검증 (concurrency 5 — 네이버 429 방지)
    t0 = time.perf_counter()
    raw_results = await verify_batch(places, concurrency=5)
    total_ms = int((time.perf_counter() - t0) * 1000)

    # DB 기록 + verdict 캐시 갱신 + ChangeEvent 자동 생성
    persist_stats = await persist_results(db, raw_results)

    # 자동 추출 보강 (이전에 비어 있던 full_address 만 채움)
    place_by_id = {p.id: p for p in places}
    for r in raw_results:
        place = place_by_id.get(r["place_id_ref"])
        if place and not place.full_address:
            addr = r["detail"].get("actual_address")
            if addr:
                place.full_address = addr
    await db.commit()

    # ── 변경 이벤트가 발생했을 때만 알림 발송 (best-effort) ──
    # 즉시 검증에서도 변경이 감지되면 사용자에게 Email/Slack 알림을 즉시 전송.
    new_events = persist_stats.pop("new_events", []) or []
    place_lookup = persist_stats.pop("place_lookup", {}) or place_by_id
    if settings.NOTIFY_ENABLED and new_events:
        try:
            await notify_user_events(db, user, new_events, place_lookup=place_lookup)
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
