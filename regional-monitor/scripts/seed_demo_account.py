"""외부 공개 데모 계정 시드 스크립트.

손으로 만든 그럴듯한 샘플 데이터(7건) + 14일치 가짜 순위 이력을 생성한다.
시연 페르소나: 타지역 영업 업종 (하수구, 심부름, 선불폰, 열쇠, 대리운전, 세차, 중고폰매입)

실행:
  cd /opt/regionwatch/regional-monitor/backend
  python -m scripts.seed_demo_account

idempotent:
  · 같은 이메일의 계정이 이미 있으면 RegisteredPlace/PlaceRankHistory 만 갱신
  · 새로 만들거나 갱신하거나 끝에 user.id 출력
  · DEMO_ACCESS_TOKEN 환경변수와 무관 — 시드만 담당

데모 계정 정보:
  email      : demo_guest@tajiyeok.com  (settings.DEMO_ACCOUNT_EMAIL)
  name       : "🎁 외부 공개 데모"
  is_demo    : True
  is_profile_complete : True (인증/모달 우회)
  plan       : 'free'
  quota_places : 999 (시드 데이터 한도 안전)
"""
from __future__ import annotations

import asyncio
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

# scripts/ 는 regional-monitor/scripts/ 에 있으므로 backend/ 는 형제 디렉터리
_here = Path(__file__).resolve()
_backend = _here.parent.parent / "backend"  # regional-monitor/backend/
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from sqlalchemy import select, delete  # noqa: E402

from app.core.database import AsyncSessionLocal, init_db  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.time_utils import now_kst  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.place import RegisteredPlace  # noqa: E402
from app.models.rank_history import PlaceRankHistory  # noqa: E402


# ─────────────────────────────────────────────────────────
# 시드 데이터 — 손으로 만든 7건, 타지역 영업 페르소나
# ─────────────────────────────────────────────────────────
DEMO_PLACES: list[dict] = [
    {
        "phone": "070-7777-1001",
        "place_id": "11111000001",
        "registered_dong": "압구정동",
        "business_name": "24시 빠른출동 하수구막힘",
        "full_address": "서울특별시 강남구 압구정동 122-3",
        "category": "하수구청소",
        "match_status": "AUTO_MATCHED",
        "keywords": ["압구정 하수구막힘", "압구정 변기막힘", "강남 하수구뚫기"],
        "dong_changed": False,
        "actual_dong": None,
        "current_verdict": "OK",
        # 키워드별 14일치 시작 순위 (자연스러운 변동)
        "rank_seed": {"압구정 하수구막힘": 4, "압구정 변기막힘": 7, "강남 하수구뚫기": 12},
    },
    {
        "phone": "070-7777-1002",
        "place_id": "11111000002",
        "registered_dong": "역삼동",
        "business_name": "강남 든든 심부름센터",
        "full_address": "서울특별시 강남구 역삼동 736-12",
        "category": "심부름",
        "match_status": "AUTO_MATCHED",
        "keywords": ["역삼 심부름", "강남 퀵서비스", "강남 흥신소"],
        "dong_changed": False,
        "actual_dong": None,
        "current_verdict": "OK",
        "rank_seed": {"역삼 심부름": 2, "강남 퀵서비스": 9, "강남 흥신소": 6},
    },
    {
        "phone": "070-7777-1003",
        "place_id": "11111000003",
        "registered_dong": "신논현동",
        "business_name": "무료개통 선불폰 천국",
        "full_address": "서울특별시 강남구 논현동 202-5",
        "category": "선불폰",
        "match_status": "AUTO_MATCHED",
        "keywords": ["강남 선불폰", "신논현 선불유심", "외국인 선불폰"],
        # 변경 노출 케이스 — 등록은 신논현동이지만 실제 노출은 논현동
        "dong_changed": True,
        "actual_dong": "논현동",
        "current_verdict": "DONG_MISMATCH",
        "rank_seed": {"강남 선불폰": 15, "신논현 선불유심": 22, "외국인 선불폰": 3},
    },
    {
        "phone": "070-7777-1004",
        "place_id": "11111000004",
        "registered_dong": "청담동",
        "business_name": "24시 출장 자물쇠 마스터",
        "full_address": "서울특별시 강남구 청담동 100-8",
        "category": "열쇠",
        "match_status": "AUTO_MATCHED",
        "keywords": ["청담 열쇠", "강남 자물쇠", "청담동 출장열쇠"],
        "dong_changed": False,
        "actual_dong": None,
        "current_verdict": "OK",
        "rank_seed": {"청담 열쇠": 5, "강남 자물쇠": 11, "청담동 출장열쇠": 1},
    },
    {
        "phone": "070-7777-1005",
        "place_id": "11111000005",
        "registered_dong": "논현동",
        "business_name": "강남 럭키 대리운전",
        "full_address": "서울특별시 강남구 논현동 88-2",
        "category": "대리운전",
        "match_status": "AUTO_MATCHED",
        "keywords": ["논현 대리운전", "강남 대리", "청담 대리운전"],
        "dong_changed": False,
        "actual_dong": None,
        "current_verdict": "OK",
        # 75위 밖 케이스 — 청담 대리운전은 일부 날에 out_of_range
        "rank_seed": {"논현 대리운전": 8, "강남 대리": 18, "청담 대리운전": 60},
    },
    {
        "phone": "070-7777-1006",
        "place_id": "11111000006",
        "registered_dong": "삼성동",
        "business_name": "24시 긴급 출장세차",
        "full_address": "서울특별시 강남구 삼성동 159-1",
        "category": "세차",
        "match_status": "AUTO_MATCHED",
        "keywords": ["삼성동 출장세차", "강남 손세차", "코엑스 세차"],
        "dong_changed": False,
        "actual_dong": None,
        "current_verdict": "OK",
        "rank_seed": {"삼성동 출장세차": 3, "강남 손세차": 14, "코엑스 세차": 7},
    },
    {
        "phone": "070-7777-1007",
        "place_id": None,  # PENDING_MATCH 케이스 — 시연 다양성
        "registered_dong": "역삼동",
        "business_name": "강남 미사용폰 매입",
        "full_address": None,
        "category": None,
        "match_status": "PENDING_MATCH",
        "keywords": ["역삼 중고폰", "강남 폰매입", "아이폰 매입"],
        "dong_changed": False,
        "actual_dong": None,
        "current_verdict": "PENDING",
        "rank_seed": {},  # 매칭 전이므로 순위 이력 없음
    },
]


def _build_rank_history(
    place_pk: int,
    registered_dong: str,
    rank_seed: dict[str, int],
    days: int = 14,
) -> list[PlaceRankHistory]:
    """시작 순위에서 ±2 범위로 자연스러운 14일치 순위 이력 생성.

    하루 단위 변동: 60% 동일, 25% ±1, 15% ±2.
    `청담 대리운전` 처럼 시작이 60위인 키워드는 일부 날에 75위 밖(out_of_range).
    """
    rows: list[PlaceRankHistory] = []
    today = now_kst().date()

    for kw, start_rank in rank_seed.items():
        cur = start_rank
        prev_rank: int | None = None
        for i in range(days, 0, -1):
            d: date = today - timedelta(days=i)

            # 변동
            r = random.random()
            if r < 0.60:
                delta = 0
            elif r < 0.85:
                delta = random.choice([-1, 1])
            else:
                delta = random.choice([-2, 2])
            cur = max(1, cur + delta)

            # 75위 밖 처리 (시작이 60+인 키워드만 가끔 발생)
            if cur > 75:
                out_of_range = True
                rank_val: int | None = None
            else:
                out_of_range = False
                rank_val = cur

            # rank_delta
            if prev_rank is not None and rank_val is not None:
                rank_delta = rank_val - prev_rank
            else:
                rank_delta = None

            rows.append(PlaceRankHistory(
                place_pk=place_pk,
                check_date=d,
                keyword=kw,
                dong=registered_dong,
                rank=rank_val,
                total_results=random.randint(120, 380),
                out_of_range=out_of_range,
                rank_delta=rank_delta,
            ))
            prev_rank = rank_val
    return rows


def _build_match_candidates(p: dict) -> str | None:
    """match_candidates JSON 생성 (AUTO_MATCHED 행만)."""
    if p["match_status"] != "AUTO_MATCHED":
        return None
    return json.dumps({
        "place_id": p["place_id"],
        "name": p["business_name"],
        "category": p["category"] or "",
        "phone": p["phone"],
        "virtual_phone": "",
        "address": p["full_address"] or "",
        "reasons": ["demo_seed"],
    }, ensure_ascii=False)


async def _upsert_demo_user(db) -> User:
    """데모 계정 1개를 생성 또는 갱신."""
    email = settings.DEMO_ACCOUNT_EMAIL
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            name="🎁 외부 공개 데모",
            picture=None,
            google_sub=None,
            phone="010-0000-0000",
            company="(외부 공개 데모)",
            job_title="게스트",
            agreed_privacy=True,
            agreed_terms=True,
            agreed_marketing=False,
            agreed_at=now_kst(),
            is_profile_complete=True,
            is_superadmin=False,
            is_active=True,
            is_demo=True,
            verify_slot=0,
            verify_slot_15m=0,
            verify_frequency="paused",  # 자동 검증 절대 안 함
            plan="free",
            quota_places=999,  # 시드 데이터 한도 안전
            email_alerts=False,
        )
        db.add(user)
        await db.flush()
        print(f"[seed] created demo user id={user.id} email={user.email}")
    else:
        # 기존 행 강제 동기화 (혹시 손으로 바꿔놓은 경우 복원)
        user.name = "🎁 외부 공개 데모"
        user.is_demo = True
        user.is_profile_complete = True
        user.is_active = True
        user.is_superadmin = False
        user.verify_frequency = "paused"
        user.plan = "free"
        user.quota_places = 999
        user.email_alerts = False
        print(f"[seed] updated demo user id={user.id} email={user.email}")
    return user


async def _wipe_demo_data(db, user_id: int) -> None:
    """기존 데모 데이터(RegisteredPlace + PlaceRankHistory) 전부 삭제.

    user_id 가 격리되므로 다른 사용자 데이터에 절대 영향 없음.
    """
    # PlaceRankHistory 는 RegisteredPlace 의 CASCADE 로 같이 삭제됨
    res = await db.execute(
        delete(RegisteredPlace).where(RegisteredPlace.user_id == user_id)
    )
    print(f"[seed] wiped {res.rowcount} previous demo place(s)")


async def _seed_places(db, user_id: int) -> list[tuple[int, dict]]:
    """7건 RegisteredPlace 시드. (place_pk, original_dict) 페어 반환."""
    out: list[tuple[int, dict]] = []
    for p in DEMO_PLACES:
        kws_str = ",".join(p["keywords"]) if p["keywords"] else None
        place = RegisteredPlace(
            user_id=user_id,
            phone=p["phone"],
            place_id=p["place_id"],
            registered_dong=p["registered_dong"],
            business_name=p["business_name"],
            full_address=p["full_address"],
            category=p["category"],
            tracking_keywords=kws_str,
            match_confidence=100 if p["match_status"] == "AUTO_MATCHED" else None,
            match_status=p["match_status"],
            match_candidates=_build_match_candidates(p),
            matched_at=now_kst() if p["match_status"] == "AUTO_MATCHED" else None,
            dong_changed=p["dong_changed"],
            actual_dong=p["actual_dong"],
            current_verdict=p["current_verdict"],
            last_checked_at=now_kst() if p["match_status"] == "AUTO_MATCHED" else None,
            in_latest_upload=True,
            excluded_at=None,
        )
        db.add(place)
        await db.flush()  # id 확보
        out.append((place.id, p))
        print(
            f"[seed]   + place_pk={place.id} {p['business_name']} "
            f"({p['registered_dong']}, {p['match_status']}, "
            f"keywords={len(p['keywords'])})"
        )
    return out


async def _seed_rank_history(db, place_seeds: list[tuple[int, dict]]) -> int:
    """각 AUTO_MATCHED 행에 14일치 가짜 순위 이력 시드."""
    total = 0
    random.seed(42)  # 재현 가능한 가짜 데이터
    for place_pk, p in place_seeds:
        if not p["rank_seed"]:
            continue
        rows = _build_rank_history(
            place_pk=place_pk,
            registered_dong=p["registered_dong"],
            rank_seed=p["rank_seed"],
            days=14,
        )
        for row in rows:
            db.add(row)
        total += len(rows)
        print(
            f"[seed]   + history place_pk={place_pk} "
            f"keywords={len(p['rank_seed'])} rows={len(rows)}"
        )
    return total


async def main() -> None:
    # 1) DB 초기화 (is_demo 컬럼 마이그레이션 보장)
    print("[seed] init_db() — ensure schema + migrations…")
    await init_db()

    async with AsyncSessionLocal() as db:
        # 2) 데모 사용자 upsert
        user = await _upsert_demo_user(db)
        await db.commit()  # user.id 확정

        # 3) 기존 데모 데이터 wipe (idempotent 재시드)
        await _wipe_demo_data(db, user.id)
        await db.commit()

        # 4) 7건 시드
        place_seeds = await _seed_places(db, user.id)
        await db.commit()

        # 5) 14일치 순위 이력
        history_rows = await _seed_rank_history(db, place_seeds)
        await db.commit()

        print("[seed] ─────────────────────────────────────────")
        print(f"[seed] DONE — demo user id={user.id}")
        print(f"[seed]   places         : {len(place_seeds)}")
        print(f"[seed]   rank_history   : {history_rows} rows")
        print(f"[seed]   demo email     : {user.email}")
        print(f"[seed]   is_demo flag   : {user.is_demo}")
        print("[seed] ─────────────────────────────────────────")
        print("[seed] 다음 단계:")
        print("[seed]   1) 환경변수 DEMO_ACCESS_TOKEN=<랜덤 문자열> 설정")
        print("[seed]   2) sudo systemctl restart regionwatch-backend")
        print("[seed]   3) 공유 링크: https://www.tajiyeok.com/demo?t=<token>")


if __name__ == "__main__":
    asyncio.run(main())
