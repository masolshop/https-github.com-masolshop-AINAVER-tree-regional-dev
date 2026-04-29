"""APScheduler 기반 자동 검증 스케줄러.

전략 v2 (2026-04-29) — 한국 시간(KST) 기준 15분 슬롯 분산:
  · 매 15분 정각마다(00, 15, 30, 45) 깨어남 → 하루 96회
  · slot_index = (KST hour * 4) + (KST minute // 15)
  · User.verify_slot_15m == 현재 slot_index 인 사용자만 후보
  · 추가로 verify_frequency 주기(daily/every3d/every5d/weekly/paused) 충족 검사
  · 사용자 분산: 가입 시 균등 해시 (id × 7919) mod 96
  · 부하 예상 (1만 사용자, 평균 5건):
      슬롯당 ~104명 × 5 = 520건 / 15분 → 0.6 RPS  (네이버 안전)

dry-run 운영 (1주일):
  · VERIFY_SCHEDULER_V2_DRY_RUN=true (기본 True — 첫 1주는 안전모드)
  · v2 트리거는 VerifyScheduleLog 에 status='dry_run_recorded' 만 남기고
    실제 검증은 수행하지 않음
  · 기존 hourly 트리거(=v1)가 그대로 살아 있어 매시 정각 실제 검증 수행
  · 1주일 후 VERIFY_SCHEDULER_V2_DRY_RUN=false → v2 본가동, hourly 트리거 제거

⚠️ 시간대 정책:
  · DB 저장은 KST (now_kst), 비교 기준은 모두 KST
  · "내 검증 슬롯: 슬롯 50" = KST 12:30 시작

처리 흐름 (v2 본가동 시):
  1) verify_slot_15m == 현재 slot AND is_due_for_run() == True 사용자 조회
  2) 그 사용자들의 RegisteredPlace 일괄 조회 (chunked)
  3) verify_batch(concurrency=1, pace=500ms) 로 검증
  4) persist_results() + ChangeEvent + DailyHealthCheck 기록
  5) User.last_auto_run_at 갱신 + VerifyScheduleLog status='executed'
  6) 슬롯당 14분 상한 — 다음 슬롯과 겹침 방지
"""
from __future__ import annotations

import asyncio
import logging
import os as _os
from datetime import datetime, timezone, timedelta
from app.core.time_utils import now_kst, to_kst, KST
from typing import Sequence

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select, func as _f

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.models.place import RegisteredPlace
from app.models.check import VerificationRun
from app.models.verify_schedule_log import VerifyScheduleLog
from app.services.verifier import verify_batch
from app.services.persist import persist_results
from app.services.notifier import notify_user_events
from app.services.schedule_assigner import (
    SLOT_COUNT_15M,
    is_due_for_run,
)


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
    """현재 KST 시각의 hour (0~23). [DEPRECATED — v1 호환 유지]"""
    return kst_now().hour


def kst_slot_15m() -> int:
    """현재 KST 시각의 15분 슬롯 번호 (0~95).

    slot = (hour × 4) + (minute // 15)
    예: 03:30 → 14, 12:45 → 51, 23:45 → 95
    """
    n = kst_now()
    return (n.hour * 4) + (n.minute // 15)


# ──────────────────────────────────────────────────────────────
# 튜닝 파라미터
# ──────────────────────────────────────────────────────────────
#
# 자동 검증 정책 (2026-04-28 사용자 결정):
#   "자동 정기 체크도 서버단에서 진행되는 것이니 시간에 쫓기지 말고 시간 조절해서 진행."
#   → 정확도와 안정성을 최우선으로, 네이버 IP throttle 위험을 거의 0으로 만든다.
#
#   - 모드: fast (페이지 존재 유무만 확인 — 정밀 검증은 등록 시 1회로 충분)
#   - 속도:
#       · 수동 fast: concurrency=2, pace 200ms
#       · 자동 fast: concurrency=1 (직렬) + pace 500ms
#         → 296건 ≈ (290ms 응답 + 500ms 페이스) × 296 ≈ 약 4분
#         → 시간이 충분히 길어져 네이버 차단 위험 사실상 없음
#   - 사용자 간에도 USER_CHUNK_SIZE=20 으로 좁혀 동시 부하 추가 완화.
#
# v2 (2026-04-29):
#   슬롯당 14분 상한 + 96슬롯 분산 → 같은 슬롯에 들어오는 회원은 평균 (총회원수/96).
# ──────────────────────────────────────────────────────────────

# 자동 검증 모드 (fast / full)
AUTO_VERIFY_MODE = "fast"

# 사용자당 동시 검증 수 (자동) — 직렬(1), 정확도 최우선
PER_USER_CONCURRENCY = 1

# 요청 간 페이스 (ms)
AUTO_PACE_MS = 500

# 사용자 처리 청크 크기 (메모리 + 네이버 부하 분산)
USER_CHUNK_SIZE = 20

# 재시도 백오프 (초)
RETRY_BACKOFF_SEC = [30, 120, 600]

# 슬롯 1회 처리시간 상한 (초). 14분 = 다음 15분 슬롯과 1분 여유.
SLOT_TIME_BUDGET_SEC = 14 * 60

# dry-run 모드 — True 면 실제 검증 안 하고 VerifyScheduleLog 만 기록
VERIFY_SCHEDULER_V2_DRY_RUN: bool = (
    _os.environ.get("VERIFY_SCHEDULER_V2_DRY_RUN", "true").lower() in ("1", "true", "yes")
)


# ──────────────────────────────────────────────────────────────
# 슬롯 검증 — 사용자 1명 단위
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

            import time as _time
            _t0 = _time.perf_counter()
            results = await verify_batch(
                places,
                concurrency=PER_USER_CONCURRENCY,
                mode=AUTO_VERIFY_MODE,
                pace_ms=AUTO_PACE_MS,
            )
            elapsed_ms = int((_time.perf_counter() - _t0) * 1000)
            stats = await persist_results(db, results)

            # ── 알림 발송 (best-effort, ChangeEvent 가 있을 때만) ──
            new_events = stats.pop("new_events", []) or []
            place_lookup = stats.pop("place_lookup", {}) or {}
            if settings.NOTIFY_ENABLED and new_events:
                try:
                    user = await db.get(User, user_id)
                    if user is not None:
                        ok_n = sum(1 for r in results if str(r["verdict"]).endswith("OK"))
                        dead_n = sum(1 for r in results if str(r["verdict"]).endswith("DEAD"))
                        pending_n = sum(1 for r in results if str(r["verdict"]).endswith("PENDING"))
                        mismatch_n = sum(
                            1 for r in results
                            if str(r["verdict"]).endswith(("PHONE_MISMATCH", "DONG_MISMATCH",
                                                            "NAME_MISMATCH", "REGION_MISMATCH"))
                        )
                        run_summary = {
                            "total": len(results),
                            "ok": ok_n,
                            "dead": dead_n,
                            "mismatch": mismatch_n,
                            "pending": pending_n,
                            "elapsed_ms": elapsed_ms,
                            "mode": AUTO_VERIFY_MODE,
                            "trigger": "scheduler",
                        }
                        notif_stats = await notify_user_events(
                            db, user, new_events,
                            place_lookup=place_lookup,
                            run_summary=run_summary,
                        )
                        stats["email_sent"] = notif_stats.get("email_sent", 0)
                        stats["slack_sent"] = notif_stats.get("slack_sent", 0)
                except Exception as e:                                          # noqa: BLE001
                    log.warning("notify failed user=%d err=%s", user_id, e)

            stats["user_id"] = user_id
            stats["places"] = len(places)
            stats["elapsed_ms"] = elapsed_ms
            return stats

    except Exception as e:
        log.warning(
            "verify failed user=%d attempt=%d/%d err=%s",
            user_id, attempt + 1, len(RETRY_BACKOFF_SEC) + 1, e,
        )
        if attempt < len(RETRY_BACKOFF_SEC):
            await asyncio.sleep(RETRY_BACKOFF_SEC[attempt])
            return await _verify_user_places(user_id, place_ids, attempt + 1)
        log.error("verify gave up for user=%d places=%d err=%s",
                  user_id, len(place_ids), e)
        return {"updated": 0, "events": 0, "history": 0,
                "user_id": user_id, "error": str(e), "elapsed_ms": 0}


# ──────────────────────────────────────────────────────────────
# VerifyScheduleLog 기록 (dry-run / 본가동 공통)
# ──────────────────────────────────────────────────────────────


async def _log_schedule_entry(
    *,
    db,
    user_id: int,
    slot_index: int,
    scheduled_at: datetime,
    frequency: str,
    places_checked: int,
    elapsed_ms: int,
    status: str,
    note: str | None,
    dry_run: bool,
) -> None:
    """VerifyScheduleLog 1행 추가 (best-effort, 호출자가 commit)."""
    db.add(VerifyScheduleLog(
        user_id=user_id,
        slot_index=slot_index,
        scheduled_at=scheduled_at,
        frequency=frequency,
        places_checked=places_checked,
        elapsed_ms=elapsed_ms,
        status=status,
        note=note,
        dry_run=dry_run,
    ))


# ──────────────────────────────────────────────────────────────
# v2 메인 — 15분 슬롯 검증
# ──────────────────────────────────────────────────────────────


async def run_slot_15m_verification(
    slot_index: int | None = None,
    *,
    dry_run: bool | None = None,
) -> dict:
    """현재 KST 15분 슬롯의 사용자들 처리.

    Args:
        slot_index : 0~95. None 이면 현재 KST 슬롯.
        dry_run    : True 면 기록만 하고 실제 검증 안 함.
                     None 이면 환경변수 VERIFY_SCHEDULER_V2_DRY_RUN 따름.

    Returns:
        {
          "slot": int, "scheduled_at": datetime, "dry_run": bool,
          "candidates": int,        # 슬롯에 묶인 active 회원 수
          "due": int,               # 주기 충족 회원 수
          "skipped_frequency": int, # 주기 미충족
          "skipped_paused": int,
          "executed": int,          # 실제 검증 수행
          "places_total": int,
          "elapsed_ms": int,
        }
    """
    started_at = now_kst()
    started_ts = started_at.timestamp()
    slot = slot_index if slot_index is not None else kst_slot_15m()
    is_dry_run = dry_run if dry_run is not None else VERIFY_SCHEDULER_V2_DRY_RUN

    if not (0 <= slot < SLOT_COUNT_15M):
        log.warning("invalid slot_index=%d, fallback to current", slot)
        slot = kst_slot_15m()

    _print(f"[v2] slot {slot}/{SLOT_COUNT_15M} (KST) triggered at {started_at} dry_run={is_dry_run}")
    log.info("=== v2 slot %d (dry_run=%s) started ===", slot, is_dry_run)

    summary = {
        "slot": slot,
        "scheduled_at": started_at,
        "dry_run": is_dry_run,
        "candidates": 0,
        "due": 0,
        "skipped_frequency": 0,
        "skipped_paused": 0,
        "skipped_incomplete": 0,
        "skipped_blocked": 0,
        "executed": 0,
        "failed": 0,
        "places_total": 0,
        "elapsed_ms": 0,
    }

    # 1) 슬롯에 묶인 사용자 + 주기 판정
    async with AsyncSessionLocal() as db:
        # 슬롯 매칭 회원 전체 (paused·blocked 도 일단 가져와서 로그 기록)
        q_users = await db.execute(
            select(User).where(User.verify_slot_15m == slot)
        )
        candidates = list(q_users.scalars().all())
        summary["candidates"] = len(candidates)

        if not candidates:
            elapsed_ms = int((now_kst() - started_at).total_seconds() * 1000)
            summary["elapsed_ms"] = elapsed_ms
            _print(f"[v2] slot {slot}: no candidates")
            return summary

        # 주기 판정 → due / skipped 분류
        due_users: list[User] = []
        skipped_logs: list[tuple[int, str, str, str]] = []  # (uid, freq, status, note)
        for u in candidates:
            ok, reason = is_due_for_run(u, now_ts=started_ts)
            if ok:
                due_users.append(u)
                continue
            # 사유별 카운트
            if reason == "blocked":
                summary["skipped_blocked"] += 1
                status = "skipped_blocked"
            elif reason == "skipped_incomplete":
                summary["skipped_incomplete"] += 1
                status = "skipped_incomplete"
            elif reason == "skipped_paused":
                summary["skipped_paused"] += 1
                status = "skipped_paused"
            elif reason == "skipped_frequency":
                summary["skipped_frequency"] += 1
                status = "skipped_frequency"
            else:
                status = "skipped_other"
            skipped_logs.append((u.id, u.verify_frequency or "every3d", status, reason))

        summary["due"] = len(due_users)

        # 스킵 로그 일괄 INSERT (dry-run 무관 — 항상 기록)
        for uid, freq, status, note in skipped_logs:
            await _log_schedule_entry(
                db=db, user_id=uid, slot_index=slot, scheduled_at=started_at,
                frequency=freq, places_checked=0, elapsed_ms=0,
                status=status, note=note, dry_run=is_dry_run,
            )
        await db.commit()

        if not due_users:
            elapsed_ms = int((now_kst() - started_at).total_seconds() * 1000)
            summary["elapsed_ms"] = elapsed_ms
            _print(f"[v2] slot {slot}: 0 due (candidates={len(candidates)}, "
                   f"freq_skip={summary['skipped_frequency']}, "
                   f"paused={summary['skipped_paused']}, "
                   f"blocked={summary['skipped_blocked']}, "
                   f"incomplete={summary['skipped_incomplete']})")
            log.info("v2 slot %d: 0 due, %s", slot, summary)
            return summary

        # 2) 등록 매핑
        user_ids = [u.id for u in due_users]
        q_places = await db.execute(
            select(RegisteredPlace.id, RegisteredPlace.user_id)
            .where(RegisteredPlace.user_id.in_(user_ids))
        )
        rows = q_places.all()

    by_user: dict[int, list[int]] = {}
    for pid, uid in rows:
        by_user.setdefault(uid, []).append(pid)

    user_jobs: list[tuple[User, list[int]]] = [
        (u, by_user.get(u.id, [])) for u in due_users
    ]
    total_places = sum(len(pids) for _, pids in user_jobs)
    summary["places_total"] = total_places

    _print(f"[v2] slot {slot}: due={len(due_users)} users / {total_places} places "
           f"(dry_run={is_dry_run})")

    # 3) dry-run 이면 실제 검증 안 하고 기록만 ───────────────
    if is_dry_run:
        async with AsyncSessionLocal() as db:
            for u, pids in user_jobs:
                await _log_schedule_entry(
                    db=db, user_id=u.id, slot_index=slot, scheduled_at=started_at,
                    frequency=u.verify_frequency or "every3d",
                    places_checked=len(pids), elapsed_ms=0,
                    status="dry_run_recorded",
                    note=f"would verify {len(pids)} places",
                    dry_run=True,
                )
            await db.commit()
        summary["executed"] = 0  # dry-run 은 executed 0
        elapsed_ms = int((now_kst() - started_at).total_seconds() * 1000)
        summary["elapsed_ms"] = elapsed_ms
        _print(f"[v2] slot {slot} DRY-RUN done: {summary}")
        log.info("=== v2 slot %d DRY-RUN done: %s ===", slot, summary)
        return summary

    # 4) 본가동 — 청크 단위로 실제 검증, 슬롯 시간 예산 초과 시 중단 ───
    executed = 0
    failed = 0
    per_user_results: dict[int, dict] = {}

    for i in range(0, len(user_jobs), USER_CHUNK_SIZE):
        # 시간 예산 초과 검사 (다음 슬롯 진입 전 종료)
        elapsed_sec = (now_kst() - started_at).total_seconds()
        if elapsed_sec >= SLOT_TIME_BUDGET_SEC:
            remaining = len(user_jobs) - i
            log.warning("v2 slot %d budget exceeded — %d users skipped", slot, remaining)
            _print(f"[v2] slot {slot}: TIME BUDGET EXCEEDED, {remaining} users skipped")
            # 남은 회원은 skipped_budget 으로 기록
            async with AsyncSessionLocal() as db:
                for u, pids in user_jobs[i:]:
                    await _log_schedule_entry(
                        db=db, user_id=u.id, slot_index=slot, scheduled_at=started_at,
                        frequency=u.verify_frequency or "every3d",
                        places_checked=0, elapsed_ms=0,
                        status="skipped_budget",
                        note="slot time budget exceeded",
                        dry_run=False,
                    )
                await db.commit()
            break

        chunk = user_jobs[i : i + USER_CHUNK_SIZE]
        chunk_pairs = [(u.id, pids) for u, pids in chunk if pids]
        if not chunk_pairs:
            # 등록 0건인 회원 — 로그만 남김
            async with AsyncSessionLocal() as db:
                for u, _ in chunk:
                    await _log_schedule_entry(
                        db=db, user_id=u.id, slot_index=slot, scheduled_at=started_at,
                        frequency=u.verify_frequency or "every3d",
                        places_checked=0, elapsed_ms=0,
                        status="executed",
                        note="no places",
                        dry_run=False,
                    )
                # last_auto_run_at 갱신 — 등록 0이라도 주기 카운트는 진행
                from sqlalchemy import update
                await db.execute(
                    update(User).where(User.id.in_([u.id for u, _ in chunk]))
                    .values(last_auto_run_at=now_kst())
                )
                await db.commit()
            executed += len(chunk)
            continue

        results = await asyncio.gather(
            *(_verify_user_places(uid, pids) for uid, pids in chunk_pairs),
            return_exceptions=False,
        )
        for r in results:
            uid = r.get("user_id")
            if uid is not None:
                per_user_results[uid] = r
            if r.get("error"):
                failed += 1
            else:
                executed += 1

        # 처리 후: VerifyScheduleLog 본가동 기록 + last_auto_run_at 갱신
        async with AsyncSessionLocal() as db:
            from sqlalchemy import update
            now_ts_after = now_kst()
            for u, pids in chunk:
                r = per_user_results.get(u.id, {})
                err = r.get("error")
                await _log_schedule_entry(
                    db=db, user_id=u.id, slot_index=slot, scheduled_at=started_at,
                    frequency=u.verify_frequency or "every3d",
                    places_checked=len(pids),
                    elapsed_ms=int(r.get("elapsed_ms") or 0),
                    status="failed" if err else "executed",
                    note=str(err)[:200] if err else None,
                    dry_run=False,
                )
            # 성공/실패 모두 last_auto_run_at 갱신 (실패해도 다음 주기까지는 대기)
            await db.execute(
                update(User).where(User.id.in_([u.id for u, _ in chunk]))
                .values(last_auto_run_at=now_ts_after)
            )
            await db.commit()

    summary["executed"] = executed
    summary["failed"] = failed

    # 5) VerificationRun 기록 (본가동만 — dry-run 은 verification_run 안 만듦)
    try:
        async with AsyncSessionLocal() as db:
            for u, pids in user_jobs:
                if u.id not in per_user_results:
                    continue
                vq = await db.execute(
                    select(RegisteredPlace.current_verdict, _f.count(RegisteredPlace.id))
                    .where(RegisteredPlace.user_id == u.id)
                    .group_by(RegisteredPlace.current_verdict)
                )
                v_map = {str(k): v for k, v in vq.all()}

                def _v(name: str) -> int:
                    return v_map.get(name, 0) + v_map.get(f"VerdictKind.{name}", 0)

                ok_n = _v("OK")
                dead_n = _v("DEAD")
                pend_n = _v("PENDING")
                mismatch_n = (
                    _v("PHONE_MISMATCH") + _v("DONG_MISMATCH")
                    + _v("NAME_MISMATCH") + _v("REGION_MISMATCH")
                )
                user_total = sum(v_map.values())
                dead_n = dead_n + mismatch_n
                user_events = per_user_results[u.id].get("events", 0)
                user_elapsed = int(per_user_results[u.id].get("elapsed_ms") or 0)
                db.add(VerificationRun(
                    user_id=u.id,
                    trigger="scheduler",
                    mode=AUTO_VERIFY_MODE,
                    slot_hour=slot // 4,  # v1 호환 — slot_hour 는 0~23
                    total_count=user_total,
                    ok_count=ok_n,
                    dead_count=dead_n,
                    pending_count=pend_n,
                    events_count=user_events,
                    elapsed_ms=user_elapsed,
                    started_at=started_at,
                ))
            await db.commit()
    except Exception as e:                                                  # noqa: BLE001
        log.warning("verification_run insert failed: %s", e)

    elapsed_ms = int((now_kst() - started_at).total_seconds() * 1000)
    summary["elapsed_ms"] = elapsed_ms
    _print(f"[v2] slot {slot} done: {summary}")
    log.info("=== v2 slot %d done: %s ===", slot, summary)
    return summary


# ──────────────────────────────────────────────────────────────
# v1 (DEPRECATED) — 시간(0~23) 슬롯 + verify_slot 사용
# dry-run 기간(1주일) 동안 실제 검증을 담당. v2 본가동 시 제거 예정.
# ──────────────────────────────────────────────────────────────


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
    """[DEPRECATED — v1] 현재 KST hour 슬롯의 사용자들 검증.

    dry-run 기간 동안 실제 검증을 담당. v2 본가동 시 이 함수와 hourly 트리거 제거.
    """
    started_at = now_kst()
    slot = slot_hour if slot_hour is not None else kst_hour()

    _print(f"[v1] slot {slot} (KST) verification triggered at {started_at}")
    log.info("=== v1 slot %d (KST) verification started ===", slot)

    async with AsyncSessionLocal() as db:
        q_users = await db.execute(
            select(User.id)
            .where(User.verify_slot == slot)
            .where(User.is_profile_complete.is_(True))
        )
        user_ids = [row[0] for row in q_users.all()]

        if not user_ids:
            _print(f"[v1] slot {slot}: no users (skip)")
            log.info("v1 slot %d: no users", slot)
            return {
                "slot": slot, "users": 0, "places": 0,
                "events": 0, "elapsed_ms": 0,
            }

        q_places = await db.execute(
            select(RegisteredPlace.id, RegisteredPlace.user_id)
            .where(RegisteredPlace.user_id.in_(user_ids))
        )
        rows = q_places.all()

    by_user: dict[int, list[int]] = {}
    for pid, uid in rows:
        by_user.setdefault(uid, []).append(pid)

    user_jobs: list[tuple[int, list[int]]] = [
        (uid, pids) for uid, pids in by_user.items() if pids
    ]
    total_places = sum(len(pids) for _, pids in user_jobs)

    if not user_jobs:
        _print(f"[v1] slot {slot}: {len(user_ids)} users but 0 places")
        return {
            "slot": slot, "users": len(user_ids), "places": 0,
            "events": 0, "elapsed_ms": 0,
        }

    _print(f"[v1] slot {slot}: processing {len(user_jobs)} users / {total_places} places")

    total_events = 0
    total_updated = 0
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

    # VerificationRun 기록
    try:
        async with AsyncSessionLocal() as db:
            for uid, pids in user_jobs:
                vq = await db.execute(
                    select(RegisteredPlace.current_verdict, _f.count(RegisteredPlace.id))
                    .where(RegisteredPlace.user_id == uid)
                    .group_by(RegisteredPlace.current_verdict)
                )
                v_map = {str(k): v for k, v in vq.all()}

                def _v(name: str) -> int:
                    return v_map.get(name, 0) + v_map.get(f"VerdictKind.{name}", 0)

                ok_n = _v("OK")
                dead_n = _v("DEAD")
                pend_n = _v("PENDING")
                mismatch_n = (
                    _v("PHONE_MISMATCH") + _v("DONG_MISMATCH")
                    + _v("NAME_MISMATCH") + _v("REGION_MISMATCH")
                )
                user_total = sum(v_map.values())
                dead_n = dead_n + mismatch_n
                user_events = next(
                    (r.get("events", 0) for r in per_user_results if r.get("user_id") == uid),
                    0,
                )
                db.add(VerificationRun(
                    user_id=uid,
                    trigger="scheduler",
                    mode=AUTO_VERIFY_MODE,
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
        log.warning("v1 verification_run insert failed: %s", e)

    _print(f"[v1] slot {slot} done: {summary}")
    log.info("=== v1 slot %d done: %s ===", slot, summary)
    return summary


# ──────────────────────────────────────────────────────────────
# Scheduler 라이프사이클
# ──────────────────────────────────────────────────────────────

_scheduler: AsyncIOScheduler | None = None


# ──────────────────────────────────────────────────────────────
# 자동 검증 주기 (KST)
# ──────────────────────────────────────────────────────────────
# v2 도입(2026-04-29) 이후:
#   · v2 트리거(15분 슬롯, 96회/일) — 기본 dry-run, 기록만 남김
#   · v1 트리거(hourly, 24회/일) — 기존 verify_slot 기반 실제 검증 유지
#   · dry-run 1주일 운영 후 VERIFY_SCHEDULER_V2_DRY_RUN=false 설정 →
#     v2 가 실제 검증 담당, v1 트리거는 KEEP_V1_SCHEDULER=false 로 끔.
# ──────────────────────────────────────────────────────────────

AUTO_VERIFY_SCHEDULE = _os.environ.get("AUTO_VERIFY_SCHEDULE", "hourly").lower()
KEEP_V1_SCHEDULER: bool = (
    _os.environ.get("KEEP_V1_SCHEDULER", "true").lower() in ("1", "true", "yes")
)


def _build_v1_trigger() -> CronTrigger:
    """v1 (hourly/daily/every3d/every5d) 트리거."""
    tz = "Asia/Seoul"
    if AUTO_VERIFY_SCHEDULE == "daily":
        return CronTrigger(minute=0, timezone=tz)
    if AUTO_VERIFY_SCHEDULE == "every3d":
        return CronTrigger(day="1,4,7,10,13,16,19,22,25,28", hour=3, minute=0, timezone=tz)
    if AUTO_VERIFY_SCHEDULE == "every5d":
        return CronTrigger(day="1,6,11,16,21,26", hour=3, minute=0, timezone=tz)
    return CronTrigger(minute=0, timezone=tz)


def _build_v2_trigger() -> CronTrigger:
    """v2 — 매 15분 정각 (00, 15, 30, 45)."""
    return CronTrigger(minute="0,15,30,45", timezone="Asia/Seoul")


def start_scheduler() -> AsyncIOScheduler:
    """앱 시작 시 호출. 이미 시작돼 있으면 그대로 반환.

    Jobs:
      · slot_verification_v2  — 15분 슬롯 (dry-run 기본 ON)
      · slot_verification     — 시간 슬롯 [v1, KEEP_V1_SCHEDULER=true 일 때만]
    """
    global _scheduler
    if _scheduler and _scheduler.running:
        return _scheduler

    sched = AsyncIOScheduler(timezone="Asia/Seoul")

    # v2 트리거 — 항상 등록 (dry-run 모드면 기록만 남김)
    sched.add_job(
        run_slot_15m_verification,
        trigger=_build_v2_trigger(),
        id="slot_verification_v2",
        name=f"slot v2 (15min, dry_run={VERIFY_SCHEDULER_V2_DRY_RUN}, KST)",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=300,    # 5분 이내 늦은 실행은 OK
    )

    # v1 트리거 — 환경변수로 끌 수 있게 (v2 본가동 후 OFF)
    if KEEP_V1_SCHEDULER:
        sched.add_job(
            run_slot_verification,
            trigger=_build_v1_trigger(),
            id="slot_verification",
            name=f"slot v1 ({AUTO_VERIFY_SCHEDULE}, KST)",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=600,
        )

    sched.start()
    _scheduler = sched
    log.info(
        "scheduler started — v2(dry_run=%s, every 15min) + v1(%s, keep=%s) "
        "mode=%s concurrency=%d pace=%dms",
        VERIFY_SCHEDULER_V2_DRY_RUN, AUTO_VERIFY_SCHEDULE, KEEP_V1_SCHEDULER,
        AUTO_VERIFY_MODE, PER_USER_CONCURRENCY, AUTO_PACE_MS,
    )
    _print(f"v2 dry_run={VERIFY_SCHEDULER_V2_DRY_RUN}, "
           f"v1 keep={KEEP_V1_SCHEDULER}, schedule={AUTO_VERIFY_SCHEDULE}")
    return sched


def stop_scheduler() -> None:
    """앱 종료 시 호출."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("scheduler stopped")
    _scheduler = None


def get_next_run_at() -> datetime | None:
    """다음 실행 예정 시각 (마이페이지 노출용).

    v1 트리거가 살아있으면 v1 시각을 우선 반환 (사용자 verify_slot 매일 N시 표기 호환).
    v1 이 꺼졌으면 v2 의 다음 슬롯 시각.
    """
    if not _scheduler:
        return None
    job = _scheduler.get_job("slot_verification") if KEEP_V1_SCHEDULER else None
    if job is None:
        job = _scheduler.get_job("slot_verification_v2")
    return job.next_run_time if job else None


def get_v2_dry_run() -> bool:
    """현재 v2 dry-run 모드 여부."""
    return VERIFY_SCHEDULER_V2_DRY_RUN


__all__ = [
    "run_slot_verification",
    "run_slot_15m_verification",
    "start_scheduler",
    "stop_scheduler",
    "get_next_run_at",
    "get_v2_dry_run",
    "kst_slot_15m",
    "VERIFY_SCHEDULER_V2_DRY_RUN",
    "KEEP_V1_SCHEDULER",
    "SLOT_TIME_BUDGET_SEC",
]
