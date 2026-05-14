"""One-shot: re-run matching for all NEEDS_MANUAL rows.

Usage (on Lightsail server):
    cd /opt/regionwatch/backend
    sudo -u regionwatch /opt/regionwatch/venv/bin/python -m scripts.rematch_needs_manual

This bypasses HTTP auth and directly invokes _run_matching_for_ids in-process.
It groups place_ids by user_id (since the worker is user-scoped) and runs them
sequentially per user.
"""
from __future__ import annotations

import asyncio
import logging
import sys
from collections import defaultdict

from sqlalchemy import select

from app.api.rank_tracker import _run_matching_for_ids
from app.core.database import AsyncSessionLocal
from app.models.place import RegisteredPlace

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("rematch")


async def main() -> int:
    # 1. Collect all NEEDS_MANUAL rows grouped by user_id
    async with AsyncSessionLocal() as db:
        q = await db.execute(
            select(RegisteredPlace.id, RegisteredPlace.user_id).where(
                RegisteredPlace.match_status == "NEEDS_MANUAL",
                RegisteredPlace.tracking_keywords.is_not(None),
            )
        )
        rows = q.all()

    if not rows:
        log.info("No NEEDS_MANUAL rows found. Nothing to do.")
        return 0

    by_user: dict[int, list[int]] = defaultdict(list)
    for pid, uid in rows:
        by_user[uid].append(pid)

    total = sum(len(v) for v in by_user.values())
    log.info(
        "Re-matching %d NEEDS_MANUAL rows across %d user(s): %s",
        total,
        len(by_user),
        {uid: len(v) for uid, v in by_user.items()},
    )

    # 2. Run sequentially per user (worker itself is sequential, ~1s/row, so be patient)
    for uid, pids in by_user.items():
        log.info("→ user_id=%d : %d rows", uid, len(pids))
        await _run_matching_for_ids(uid, pids)
        log.info("← user_id=%d : done", uid)

    log.info("All done. %d rows attempted.", total)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
