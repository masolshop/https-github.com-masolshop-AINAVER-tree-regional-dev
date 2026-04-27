#!/usr/bin/env python3
"""기존 사용자의 verify_slot 을 0~23 사이로 무작위 재배정.

배경:
  - User 모델 컬럼 default=0 으로 인해 마이그레이션 이전 가입자는 모두
    slot=0 (= 매일 KST 00:00) 으로 몰려 있어, 자정에만 검증되고 그 외
    시간대에는 자동 검증이 일어나지 않는 것처럼 보였습니다.
  - 가입 흐름(/auth/google)은 이미 random.randint(0,23) 를 부여하지만,
    기존 사용자에게는 적용되지 않았습니다.

이 스크립트는:
  - DATABASE_URL 환경변수(또는 .env 의 값)를 사용해 PostgreSQL/SQLite 어느
    DB든 자동으로 접속.
  - 기본 동작: verify_slot=0 인 사용자(특정 옵션으로 전체 사용자)에게
    User.id 를 시드로 한 결정론적 의사난수로 0~23 슬롯을 부여.
    (id 시드 → 같은 id는 항상 같은 슬롯 → 재실행 멱등)
  - --dry-run : 실제 변경 없이 결과만 출력.
  - --all     : slot=0 만이 아니라 모든 사용자 재배정.

사용:
  python3 scripts/migrate_distribute_verify_slots.py --dry-run
  python3 scripts/migrate_distribute_verify_slots.py
  python3 scripts/migrate_distribute_verify_slots.py --all
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
from collections import Counter
from pathlib import Path

# 프로젝트 루트(backend) 를 path 에 추가
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# .env 로드 (DATABASE_URL 등)
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(BACKEND_DIR / ".env")
except Exception:
    pass

from sqlalchemy import select, update  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402


def _slot_for_user(user_id: int) -> int:
    """User.id 를 시드로 한 결정론적 0~23 슬롯."""
    rng = random.Random(user_id * 2654435761 % (2**32))
    return rng.randint(0, 23)


async def run(dry_run: bool, redistribute_all: bool) -> int:
    async with AsyncSessionLocal() as db:  # type: ignore
        db: AsyncSession  # type: ignore
        if redistribute_all:
            stmt = select(User.id, User.email, User.verify_slot)
        else:
            stmt = select(User.id, User.email, User.verify_slot).where(User.verify_slot == 0)
        rows = (await db.execute(stmt)).all()

        if not rows:
            print("[migrate] 대상 사용자 없음 — 종료")
            return 0

        plan: list[tuple[int, str, int, int]] = []  # (id, email, old, new)
        for r in rows:
            uid = r[0]
            email = r[1]
            old = r[2]
            new = _slot_for_user(uid)
            if redistribute_all or new != old:
                plan.append((uid, email, old, new))

        if not plan:
            print("[migrate] 변경 사항 없음 (모두 이미 분산됨)")
            return 0

        print(f"[migrate] 대상 {len(plan)}명 (전체 {len(rows)}명):")
        for uid, email, old, new in plan[:20]:
            print(f"  - id={uid:<5} {email:<35} slot {old:>2} → {new:>2}")
        if len(plan) > 20:
            print(f"  ... (+ {len(plan) - 20} more)")

        # 분포 미리보기
        new_dist = Counter(new for _, _, _, new in plan)
        full_dist = Counter()
        for r in rows:
            uid = r[0]
            full_dist[_slot_for_user(uid) if redistribute_all else r[2]] += 1
        for uid, _e, _o, new in plan:
            if not redistribute_all:
                full_dist[new] += 1
                full_dist[0] -= 1
        print("\n[migrate] 적용 후 슬롯 분포 (예측):")
        for h in range(24):
            cnt = full_dist.get(h, 0)
            bar = "█" * cnt
            print(f"  {h:>2}시: {cnt:>4}명  {bar}")

        if dry_run:
            print("\n[migrate] --dry-run 이므로 실제 변경 없음")
            return 0

        # 실제 적용
        applied = 0
        for uid, _e, _o, new in plan:
            await db.execute(update(User).where(User.id == uid).values(verify_slot=new))
            applied += 1
        await db.commit()
        print(f"\n[migrate] 적용 완료: {applied}명 verify_slot 업데이트")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="실제 변경 없이 결과만 출력")
    parser.add_argument("--all", action="store_true", help="slot=0 만이 아니라 전체 사용자 재배정")
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL") or "(default from app.core.config)"
    print(f"[migrate] DATABASE_URL = {db_url}")
    return asyncio.run(run(dry_run=args.dry_run, redistribute_all=args.all))


if __name__ == "__main__":
    sys.exit(main())
