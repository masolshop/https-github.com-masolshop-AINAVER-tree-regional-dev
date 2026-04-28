"""APScheduler 기반 자동 검증 스케줄러.

전략 — 한국 시간(KST) 기준 24시간 분산 (시간당 1회):
  · 매 시각 KST 정각마다(00시, 01시, ..., 23시) 깨어남
  · User.verify_slot == 현재 KST 시각(0~23) 인 사용자만 검증
  · 사용자 분산: 가입 시 random(0..23) 으로 verify_slot 자동 배정
  · 부하 예상 (1만 사용자, 평균 5건/사용자 기준):
      슬롯당 ~417명 × 5 = 2,085건 / 1시간 → 0.6 RPS  (네이버 안전)

⚠️ 시간대 정책:
  · DB 저장은 UTC (datetime.utcnow), 비교 기준은 모두 UTC
  · 사용자 노출 / verify_slot 매칭은 KST 기준
  · "내 검증 시각: 매일 03시" = KST 03:00 (= UTC 18:00 전날)

처리 흐름:
  1) verify_slot == KST 현재 시각 + is_profile_complete=True 사용자 조회
  2) 그 사용자들의 RegisteredPlace 일괄 조회 (chunked)
  3) verify_batch(concurrency=5) 로 검증
  4) persist_results() 로 ChangeEvent + DailyHealthCheck 기록
  5) 실패 시 30s/2m/10m 지수 백오프 재시도 (최대 3회)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from app.core.time_utils import now_kst, to_kst, KST
from typing import Sequence

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.place import RegisteredPlace
from app.models.check import VerificationRun
from app.services.verifier import verify_batch
from app.services.persist import persist_results
from app.services.notifier import notify_user_events


log = logging.getLogger("scheduler")
# uvicorn 환경에서는 root logger가 WARNING이라 log.info 가 안 보임 → 강제 INFO
log.setLevel(logging.INFO)
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    log.addHandler(_h)
    log.propagate = False
# apscheduler 자체 로그도 살림 (잡 트리거 흔적 추적용)
logging.getLogger("apscheduler").setLevel(logging.INFO)
logging.getLogger("apscheduler.scheduler").setLevel(logging.INFO)
logging.getLogger("apscheduler.executors.default").setLevel(logging.INFO)


def _print(msg: str) -> None:
    """uvicorn stdout 직접 출력 (logging 설정과 무관하게 항상 보이도록)."""
    print(f"[scheduler] {msg}", flush=True)


# ──────────────────────────────────────────────────────────────
# 시간대
# ──────────────────────────────────────────────────────────────
KST = timezone(timedelta(hours=9))


def kst_now() -> datetime:
    """현재 KST 시각 (timezone-aware)."""
    return datetime.now(KST)


def kst_hour() -> int:
    """현재 KST 시각의 hour (0~23). verify_slot 비교용."""
    return kst_now().hour


# ──────────────────────────────────────────────────────────────
# 튜닝 파라미터
# ──────────────────────────────────────────────────────────────

# 사용자당 동시 검증 수 (네이버 부하 보호)
PER_USER_CONCURRENCY = 5

# 사용자 처리 청크 크기 (메모리 보호)
USER_CHUNK_SIZE = 50

# 재시도 백오프 (초)
RETRY_BACKOFF_SEC = [30, 120, 600]


# ──────────────────────────────────────────────────────────────
# 슬롯 검증 메인
# ──────────────────────────────────────────────────────────────


async def _verify_user_places(
    user_id: int,
    place_ids: Sequence[int],
    attempt: int = 0,
) -> dict:
    """단일 사용자의 등록 070 일괄 검증.

    실패 시(네트워크/DB) 지수 백오프로 재시도.
    """
    try:
        async with AsyncSessionLocal() as db:
            q = await db.execute(
                select(RegisteredPlace).where(RegisteredPlace.id.in_(place_ids))
            )
            places = list(q.scalars().all())
            if not places:
                return {"updated": 0, "events": 0, "history": 0}

            results = await verify_batch(places, concurrency=PER_USER_CONCURRENCY)
            stats = await persist_results(db, results)

            # ── 알림 발송 (best-effort, ChangeEvent 가 있을 때만) ──
            new_events = stats.pop("new_events", []) or []
            place_lookup = stats.pop("place_lookup", {}) or {}
            if settings.NOTIFY_ENABLED and new_events:
                try:
                    user = await db.get(User, user_id)
                    if user is not None:
                        notif_stats = await notify_user_events(
                            db, user, new_events, place_lookup=place_lookup,
                        )
                        stats["email_sent"] = notif_stats.get("email_sent", 0)
                        stats["slack_sent"] = notif_stats.get("slack_sent", 0)
                except Exception as e:                                          # noqa: BLE001
                    # 알림 실패가 검증 결과 자체를 망치지 않도록.
                    log.warning("notify failed user=%d err=%s", user_id, e)

            stats["user_id"] = user_id
            stats["places"] = len(places)
            return stats

    except Exception as e:
        log.warning(
            "verify failed user=%d attempt=%d/%d err=%s",
            user_id, attempt + 1, len(RETRY_BACKOFF_SEC) + 1, e,
        )
        if attempt < len(RETRY_BACKOFF_SEC):
            await asyncio.sleep(RETRY_BACKOFF_SEC[attempt])
            return await _verify_user_places(user_id, place_ids, attempt + 1)
        # 최종 실패
        log.error("verify gave up for user=%d places=%d err=%s",
                  user_id, len(place_ids), e)
        return {"updated": 0, "events": 0, "history": 0,
                "user_id": user_id, "error": str(e)}


async def _record_run(
    *,
    user_id: int,
    trigger: str,
    mode: str,
    slot_hour: int,
    started_at: datetime,
    total: int,
    ok: int,
    dead: int,
    pending: int,
    events: int,
    elapsed_ms: int,
) -> None:
    """VerificationRun 1행 INSERT (best-effort)."""
    try:
        async with AsyncSessionLocal() as db:
            db.add(VerificationRun(
                user_id=user_id,
                trigger=trigger,
                mode=mode,
                slot_hour=slot_hour,
                total_count=total,
                ok_count=ok,
                dead_count=dead,
                pending_count=pending,
                events_count=events,
                elapsed_ms=elapsed_ms,
                started_at=started_at,
            ))
            await db.commit()
    except Exception as e:                                                  # noqa: BLE001
        log.warning("record_run failed user=%d err=%s", user_id, e)


async def run_slot_verification(slot_hour: int | None = None) -> dict:
    """현재 KST 시각(또는 지정 시각) 슬롯의 사용자들 일괄 검증.

    Args:
        slot_hour: 0~23 (KST). None 이면 현재 KST hour 사용.

    Returns:
        {"slot": int, "users": N, "places": M, "events": K, "elapsed_ms": int}
    """
    started_at = now_kst()
    slot = slot_hour if slot_hour is not None else kst_hour()

    _print(f"slot {slot} (KST) verification triggered at {started_at}")
    log.info("=== slot %d (KST) verification started ===", slot)

    # 1) 해당 슬롯의 활성 사용자 + 그들의 place_id 매핑 한 번에 조회
    async with AsyncSessionLocal() as db:
        q_users = await db.execute(
            select(User.id)
            .where(User.verify_slot == slot)
            .where(User.is_profile_complete.is_(True))
        )
        user_ids = [row[0] for row in q_users.all()]

        if not user_ids:
            _print(f"slot {slot}: no users (skip)")
            log.info("slot %d: no users", slot)
            return {
                "slot": slot, "users": 0, "places": 0,
                "events": 0, "elapsed_ms": 0,
            }

        q_places = await db.execute(
            select(RegisteredPlace.id, RegisteredPlace.user_id)
            .where(RegisteredPlace.user_id.in_(user_ids))
        )
        rows = q_places.all()

    # 2) user_id → [place_id, ...] 매핑
    by_user: dict[int, list[int]] = {}
    for pid, uid in rows:
        by_user.setdefault(uid, []).append(pid)

    user_jobs: list[tuple[int, list[int]]] = [
        (uid, pids) for uid, pids in by_user.items() if pids
    ]
    total_places = sum(len(pids) for _, pids in user_jobs)

    if not user_jobs:
        _print(f"slot {slot}: {len(user_ids)} users but 0 places")
        log.info("slot %d: %d users but 0 places", slot, len(user_ids))
        return {
            "slot": slot, "users": len(user_ids), "places": 0,
            "events": 0, "elapsed_ms": 0,
        }

    _print(f"slot {slot}: processing {len(user_jobs)} users / {total_places} places")

    # 3) USER_CHUNK_SIZE 단위로 동시 실행 (사용자 간 병렬, 사용자 내부도 병렬)
    total_events = 0
    total_updated = 0
    # 사용자별 결과 저장 (VerificationRun INSERT용)
    per_user_results: list[dict] = []
    for i in range(0, len(user_jobs), USER_CHUNK_SIZE):
        chunk = user_jobs[i : i + USER_CHUNK_SIZE]
        results = await asyncio.gather(
            *(_verify_user_places(uid, pids) for uid, pids in chunk),
            return_exceptions=False,
        )
        for r in results:
            total_events += r.get("events", 0)
            total_updated += r.get("updated", 0)
            per_user_results.append(r)

    elapsed_ms = int((now_kst() - started_at).total_seconds() * 1000)
    summary = {
        "slot": slot,
        "users": len(user_jobs),
        "places": total_places,
        "updated": total_updated,
        "events": total_events,
        "elapsed_ms": elapsed_ms,
    }

    # 4) 사용자별 VerificationRun 기록 (현재 verdict 분포로)
    try:
        async with AsyncSessionLocal() as db:
            for uid, pids in user_jobs:
                # 현재 verdict 분포를 다시 한번 정확히 집계
                from sqlalchemy import func as _f
                vq = await db.execute(
                    select(RegisteredPlace.current_verdict, _f.count(RegisteredPlace.id))
                    .where(RegisteredPlace.user_id == uid)
                    .group_by(RegisteredPlace.current_verdict)
                )
                v_map = {str(k): v for k, v in vq.all()}
                # 정규화: "VerdictKind.OK" 같은 enum repr도 처리
                def _v(name: str) -> int:
                    return v_map.get(name, 0) + v_map.get(f"VerdictKind.{name}", 0)
                ok_n = _v("OK")
                dead_n = _v("DEAD")
                pend_n = _v("PENDING")
                # ⭐ MISMATCH 계열(PHONE/DONG/NAME/REGION)은 "이상" 카테고리에 포함시켜야
                # total_count에 누락되지 않음. UI 상으로도 OK가 아닌 모든 verdict는 "이상"으로 표시.
                mismatch_n = (
                    _v("PHONE_MISMATCH")
                    + _v("DONG_MISMATCH")
                    + _v("NAME_MISMATCH")
                    + _v("REGION_MISMATCH")
                )
                # 그 외 알 수 없는 verdict까지 안전하게 합산 (집계 누락 방지)
                user_total = sum(v_map.values())
                # dead_count에는 DEAD + 모든 MISMATCH 포함 (UI "이상" 컬럼 의미와 일치)
                dead_n = dead_n + mismatch_n
                # 매칭된 결과의 events 개수
                user_events = next(
                    (r.get("events", 0) for r in per_user_results if r.get("user_id") == uid),
                    0,
                )
                db.add(VerificationRun(
                    user_id=uid,
                    trigger="scheduler",
                    mode="full",
                    slot_hour=slot,
                    total_count=user_total,
                    ok_count=ok_n,
                    dead_count=dead_n,
                    pending_count=pend_n,
                    events_count=user_events,
                    elapsed_ms=elapsed_ms,
                    started_at=started_at,
                ))
            await db.commit()
    except Exception as e:                                                  # noqa: BLE001
        log.warning("verification_run insert failed: %s", e)
        _print(f"slot {slot}: failed to record verification_run: {e}")

    _print(f"slot {slot} done: {summary}")
    log.info("=== slot %d done: %s ===", slot, summary)
    return summary


# ──────────────────────────────────────────────────────────────
# Scheduler 라이프사이클
# ──────────────────────────────────────────────────────────────

_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> AsyncIOScheduler:
    """앱 시작 시 호출. 이미 시작돼 있으면 그대로 반환."""
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler

    # KST 기준으로 매 시각 정각 실행
    sched = AsyncIOScheduler(timezone="Asia/Seoul")

    sched.add_job(
        run_slot_verification,
        trigger=CronTrigger(minute=0, timezone="Asia/Seoul"),
        id="slot_verification",
        name="hourly slot verification (KST)",
        replace_existing=True,
        max_instances=1,           # 같은 슬롯 중복 실행 방지
        coalesce=True,             # 미실행분이 누적되면 1번만 실행
        misfire_grace_time=600,    # 10분 이내 늦은 실행은 OK
    )

    sched.start()
    _scheduler = sched
    log.info("scheduler started — hourly slot verification armed (KST)")
    return sched


def stop_scheduler() -> None:
    """앱 종료 시 호출."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("scheduler stopped")
    _scheduler = None


def get_next_run_at() -> datetime | None:
    """다음 실행 예정 시각 (마이페이지 노출용)."""
    if not _scheduler:
        return None
    job = _scheduler.get_job("slot_verification")
    return job.next_run_time if job else None


__all__ = [
    "run_slot_verification",
    "start_scheduler",
    "stop_scheduler",
    "get_next_run_at",
]
