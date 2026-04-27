"""대용량 검증 작업 실행기 (in-process asyncio worker).

설계 요약
─────────
- /verify/job 엔드포인트가 VerifyJob 레코드를 생성하고
  asyncio.create_task(run_job(job_id)) 로 워커를 띄운다.
- 워커는 자체 DB 세션(AsyncSessionLocal)을 만들어 청크 단위로 검증.
- 각 청크 끝나면 진행률(processed/chunks_done) 업데이트 → 프론트가 폴링.
- 사용자가 cancel_requested=True 로 표시하면 다음 청크 시작 전에 멈춘다.

플랜별 한도 (verify_job 1회 최대)
  free       :   100
  basic      :  1000
  pro        :  5000
  enterprise : 10000
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models.place import RegisteredPlace
from app.models.user import User
from app.models.verify_job import VerifyJob
from app.services import verify_batch
from app.services.persist import persist_results
from app.services.notifier import notify_user_events

logger = logging.getLogger("verify_job")

# ── 글로벌 동시 작업 한도 ──
_GLOBAL_JOB_SEMAPHORE = asyncio.Semaphore(50)
# 청크 내부의 검증 동시성 (verifier.verify_batch 의 concurrency 인자)
CHUNK_CONCURRENCY = 10
# 청크 사이 작은 yield 시간(ms)
CHUNK_YIELD_MS = 50

# 플랜별 1회 검증 한도
PLAN_VERIFY_LIMIT = {
    "free": 100,
    "basic": 1_000,
    "pro": 5_000,
    "enterprise": 10_000,
}


def get_plan_limit(plan: str | None) -> int:
    return PLAN_VERIFY_LIMIT.get((plan or "free").lower(), 100)


def _csv_to_ids(csv: str | None) -> list[int] | None:
    if not csv:
        return None
    out: list[int] = []
    for part in csv.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out or None


def _ids_to_csv(ids: Iterable[int] | None) -> str | None:
    if not ids:
        return None
    return ",".join(str(int(i)) for i in ids)


async def _load_places(db: AsyncSession, user_id: int, ids: list[int] | None) -> list[RegisteredPlace]:
    q = select(RegisteredPlace).where(RegisteredPlace.user_id == user_id)
    if ids:
        q = q.where(RegisteredPlace.id.in_(ids))
    result = await db.execute(q)
    return list(result.scalars().all())


async def _refresh_job(db: AsyncSession, job_id: int) -> VerifyJob | None:
    res = await db.execute(select(VerifyJob).where(VerifyJob.id == job_id))
    return res.scalar_one_or_none()


def _summarize(raw_results: list[dict]) -> tuple[int, int, int]:
    """raw_results -> (ok, warning, danger) 카운트."""
    ok = warning = danger = 0
    for r in raw_results:
        v = r.get("verdict")
        if v == "OK":
            ok += 1
        elif v in ("PHONE_MISMATCH", "DONG_MISMATCH", "NAME_MISMATCH"):
            warning += 1
        elif v in ("REGION_MISMATCH", "DEAD"):
            danger += 1
    return ok, warning, danger


async def run_job(job_id: int) -> None:
    """VerifyJob 워커 메인 루프.

    한 작업당 별도 DB 세션(AsyncSessionLocal)을 사용한다.
    """
    async with _GLOBAL_JOB_SEMAPHORE:
        # 1) 작업 + 사용자 + place 들 로드
        async with AsyncSessionLocal() as db:
            job = await _refresh_job(db, job_id)
            if job is None:
                logger.warning("verify_job %d not found, abort", job_id)
                return
            user = (await db.execute(select(User).where(User.id == job.user_id))).scalar_one_or_none()
            if user is None:
                job.status = "failed"
                job.error = "user not found"
                job.finished_at = datetime.utcnow()
                await db.commit()
                return

            ids = _csv_to_ids(job.place_ids_csv)
            places = await _load_places(db, job.user_id, ids)

            # 한도 체크 (모집된 실제 개수 기준)
            limit = get_plan_limit(user.plan)
            if len(places) > limit:
                places = places[:limit]

            job.total = len(places)
            job.chunks_total = (len(places) + job.chunk_size - 1) // job.chunk_size
            job.status = "running"
            job.started_at = datetime.utcnow()
            await db.commit()

            if not places:
                job.status = "completed"
                job.finished_at = datetime.utcnow()
                await db.commit()
                return

        # 2) 청크 처리 (각 청크마다 fresh session)
        try:
            for chunk_index in range(0, len(places), 500):
                # 취소 체크
                async with AsyncSessionLocal() as db:
                    job = await _refresh_job(db, job_id)
                    if job is None or job.cancel_requested:
                        if job is not None:
                            job.status = "cancelled"
                            job.finished_at = datetime.utcnow()
                            await db.commit()
                        logger.info("verify_job %d cancelled at chunk_index=%d", job_id, chunk_index)
                        return

                chunk = places[chunk_index : chunk_index + 500]

                # 실제 검증 (HTTP 호출 — DB 세션 불필요)
                t0 = time.perf_counter()
                raw_results = await verify_batch(chunk, concurrency=CHUNK_CONCURRENCY)
                elapsed_ms = int((time.perf_counter() - t0) * 1000)

                # DB persist (새 세션)
                async with AsyncSessionLocal() as db:
                    persist_stats = await persist_results(db, raw_results)

                    # full_address 보강
                    place_by_id = {p.id: p for p in chunk}
                    place_in_db = (
                        (await db.execute(
                            select(RegisteredPlace).where(
                                RegisteredPlace.id.in_(list(place_by_id.keys()))
                            )
                        )).scalars().all()
                    )
                    pid_in_db = {p.id: p for p in place_in_db}
                    for r in raw_results:
                        p = pid_in_db.get(r["place_id_ref"])
                        if p and not p.full_address:
                            addr = r["detail"].get("actual_address")
                            if addr:
                                p.full_address = addr
                    await db.commit()

                    # notifier (best-effort)
                    new_events = persist_stats.pop("new_events", []) or []
                    if settings.NOTIFY_ENABLED and new_events:
                        try:
                            user2 = (await db.execute(select(User).where(User.id == job_id_to_user_id(job_id)))).scalar_one_or_none() if False else None  # noqa: E501
                            # 사용자 다시 로드
                            user_res = await db.execute(select(User).where(User.id == user.id))
                            user2 = user_res.scalar_one_or_none()
                            if user2:
                                await notify_user_events(db, user2, new_events, place_lookup=pid_in_db)
                        except Exception as e:                                       # noqa: BLE001
                            logger.warning("notifier failed in job %d: %s", job_id, e)

                # 진행률 업데이트
                async with AsyncSessionLocal() as db:
                    job = await _refresh_job(db, job_id)
                    if job is None:
                        return
                    ok, warn, danger = _summarize(raw_results)
                    job.processed += len(chunk)
                    job.ok_count += ok
                    job.warning_count += warn
                    job.danger_count += danger
                    job.chunks_done += 1
                    await db.commit()
                logger.info(
                    "verify_job %d chunk %d/%d done in %d ms (ok=%d warn=%d danger=%d)",
                    job_id,
                    chunk_index // 500 + 1,
                    (len(places) + 499) // 500,
                    elapsed_ms,
                    ok, warn, danger,
                )

                # 작은 yield (이벤트 루프 양보)
                await asyncio.sleep(CHUNK_YIELD_MS / 1000.0)

            # 정상 종료
            async with AsyncSessionLocal() as db:
                job = await _refresh_job(db, job_id)
                if job is None:
                    return
                if job.cancel_requested:
                    job.status = "cancelled"
                else:
                    job.status = "completed"
                job.finished_at = datetime.utcnow()
                await db.commit()
            logger.info("verify_job %d done status=%s", job_id, job.status)

        except Exception as exc:                                                     # noqa: BLE001
            logger.exception("verify_job %d failed: %s", job_id, exc)
            try:
                async with AsyncSessionLocal() as db:
                    job = await _refresh_job(db, job_id)
                    if job is not None:
                        job.status = "failed"
                        job.error = str(exc)[:1000]
                        job.finished_at = datetime.utcnow()
                        await db.commit()
            except Exception:                                                         # noqa: BLE001
                logger.exception("failed to update job %d as failed", job_id)


# 헬퍼 (__future__ annotations 환경에서 NameError 회피용)
def job_id_to_user_id(_jid: int) -> int:  # pragma: no cover
    return 0
