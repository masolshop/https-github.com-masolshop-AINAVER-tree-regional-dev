"""
타지역 순위 자동체크 솔루션 — 매일 자동체크 CLI 엔트리.

현재 정책: 자동 systemd timer 는 비활성화. 운영자가 다음 중 한 가지 방법으로 호출:
  1) 수동 CLI:        python -m app.jobs.rank_tracker_job
  2) 관리자 API:      POST /api/v1/rank-tracker/run-rank-check (백그라운드 실행)
  3) 향후 스케줄러:    cron / systemd timer 가 재활성화되면 동일 진입점을 호출

동작:
1) AsyncSessionLocal 세션 생성
2) run_daily_rank_check() 호출 → AUTO_MATCHED/CONFIRMED 회원 × 추적 키워드 일괄 순위 체크
3) 결과 stats 를 stdout(JSON) 및 logger 로 출력
4) 종료 코드 0 (정상) / 1 (예외)

systemd 환경에서는 stdout/stderr 가 journald 로 흘러간다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import traceback
from datetime import datetime

from app.core.database import AsyncSessionLocal, init_db
from app.core.time_utils import now_kst
from app.services.rank_checker import run_daily_rank_check

log = logging.getLogger("rank_tracker_job")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
    )


async def _run() -> dict[str, int | str]:
    started_at = now_kst()
    log.info("rank_tracker_job start kst=%s", started_at.isoformat())

    # 스키마/컬럼 동기화(이미 init 완료된 운영 환경에서도 idempotent)
    try:
        await init_db()
    except Exception as e:  # noqa: BLE001
        log.warning("init_db skipped (already initialized?): %s", e)

    async with AsyncSessionLocal() as db:
        stats = await run_daily_rank_check(db)

    finished_at = now_kst()
    duration = (finished_at - started_at).total_seconds()
    payload: dict[str, int | str] = {
        "job": "rank_tracker_daily",
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_sec": round(duration, 2),
        **stats,
    }
    log.info("rank_tracker_job done: %s", json.dumps(payload, ensure_ascii=False))
    print(json.dumps(payload, ensure_ascii=False))
    return payload


def main() -> int:
    _setup_logging()
    try:
        asyncio.run(_run())
        return 0
    except KeyboardInterrupt:
        log.warning("rank_tracker_job interrupted")
        return 130
    except Exception as e:  # noqa: BLE001
        log.error("rank_tracker_job FAILED: %s", e)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
