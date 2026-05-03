"""자동 검증 스케줄 v2 — 주기/슬롯 자동 배정 유틸.

핵심 정책 (확정 2026-04-29):
  · 주기(verify_frequency): daily / every3d / every5d / weekly / paused
  · 슬롯(verify_slot_15m) : 0~95 (15분 단위, 하루 96개)
  · 등급별 기본 주기:
        free       → every5d
        basic      → every3d
        pro        → daily
        enterprise → daily
  · 분배: (user_id × 7919) mod 96 으로 균등 해시 → "항상 자동" 정책상
          어드민이 수동 지정해도 다음 rebalance 때 덮어쓴다.
  · 슬롯당 등록 합계 임계: SLOT_PLACES_LIMIT (기본 80건) — 초과 시 인접 슬롯
          으로 한 칸씩 이동시켜 자연 평탄화.
"""
from __future__ import annotations

from typing import Iterable, Literal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.place import RegisteredPlace


# ─────────────────────── 상수 ────────────────────────
SLOT_COUNT_15M: int = 96                   # 24h × 4 = 96 슬롯
HASH_MULTIPLIER: int = 7919                # 균등 해시용 소수
SLOT_PLACES_LIMIT: int = 80                # 슬롯당 등록 합계 권장 상한

VALID_FREQUENCIES = ("daily", "every3d", "every5d", "weekly", "paused")
FrequencyKey = Literal["daily", "every3d", "every5d", "weekly", "paused"]

# 주기 → 다음 실행까지 최소 대기 초 (last_auto_run_at 검사용).
#
# ⚠️ "정확히 N일 후 같은 시각" 슬롯에서의 누락 방지:
#   슬롯은 매 15분 정각에 트리거되지만 misfire_grace_time, 시계 드리프트, DB 커밋 지연
#   등으로 실제 실행 시각이 슬롯 정각보다 수 초~수 분 늦어질 수 있다.
#   예: 5/1 09:00:08 실행 → last=09:00:08 → 5/2 09:00:00 슬롯 진입 시
#       (now - last) = 86392 < 86400 → skipped_frequency 로 하루 누락.
#       이게 누적되면 5/3 09:00 도 누락되어 토요일 미실행처럼 보인다.
#
#   해결: interval 에 안전 마진(90분)을 빼서 "거의 N일 지났으면 due" 로 처리.
#   하루 한 번을 보장하는 데드라인은 슬롯 자체가 1일 1번만 트리거되므로 중복 위험 없음.
#
#   2026-05-03 마진 60분 → 90분 상향:
#     실측에서 last_auto_run_at = 슬롯 정각 + 6분 22초로 기록되어
#     다음 날 동일 슬롯 진입 시 (now - last) = 23h 53m 38s 가 23h(=24h-60m) 보다
#     6분 22초 모자라 skipped_frequency 로 떨어졌다 (토요일 미실행 사례).
#     마진을 90분으로 늘려 22h 30m 만 지나도 due 로 판정 → 매일 슬롯 누락 0.
SAFETY_MARGIN_SEC: int = 90 * 60   # 90분 — 슬롯 정각 vs 실행 시각 드리프트 보정

FREQUENCY_INTERVAL_SEC: dict[str, int] = {
    "daily":   24 * 3600 - SAFETY_MARGIN_SEC,        # 22시간 30분 — 매일 같은 슬롯 보장
    "every3d": 3 * 24 * 3600 - SAFETY_MARGIN_SEC,    # 70시간 30분
    "every5d": 5 * 24 * 3600 - SAFETY_MARGIN_SEC,    # 118시간 30분
    "weekly":  7 * 24 * 3600 - SAFETY_MARGIN_SEC,    # 166시간 30분
    "paused":  10 ** 12,                              # 사실상 무한 — 자동 검증 안 함
}

# 등급 → 기본 주기 매핑 (사용자 확정)
PLAN_DEFAULT_FREQUENCY: dict[str, FrequencyKey] = {
    "free":       "every5d",
    "basic":      "every3d",
    "pro":        "daily",
    "enterprise": "daily",
}


# ─────────────────────── 헬퍼 ────────────────────────

def default_frequency_for_plan(plan: str | None) -> FrequencyKey:
    """플랜 → 기본 검증 주기.

    알 수 없는 플랜은 보수적으로 every5d (free 기준).
    """
    if not plan:
        return "every5d"
    return PLAN_DEFAULT_FREQUENCY.get(plan.lower(), "every5d")


def assign_slot_15m(user_id: int) -> int:
    """user_id → 0~95 슬롯 (균등 해시).

    `(user_id × 7919) mod 96` 은 회원 수가 늘어도 분포가 균등함을
    실험으로 확인 (96의 약수가 아닌 소수 7919 사용).
    """
    if user_id <= 0:
        return 0
    return (user_id * HASH_MULTIPLIER) % SLOT_COUNT_15M


def slot_index_to_label(slot: int) -> str:
    """슬롯 번호 → '00:00' 형태 라벨."""
    slot = max(0, min(SLOT_COUNT_15M - 1, slot))
    h, m = divmod(slot, 4)
    return f"{h:02d}:{m * 15:02d}"


def is_valid_frequency(freq: str) -> bool:
    return freq in VALID_FREQUENCIES


# ─────────────────────── 회원 단위 적용 ────────────────────────

async def apply_default_schedule(
    db: AsyncSession,
    user: User,
    *,
    overwrite: bool = False,
) -> bool:
    """1명의 User 에 대해 기본 주기·슬롯을 자동 배정.

    Args:
        db        : 세션 (commit 은 호출자 책임 — 가입 흐름과 함께 묶이게)
        user      : 대상 사용자 (id 가 이미 부여돼 있어야 함 → flush 후 호출)
        overwrite : True 면 기존 값을 항상 덮어씀.
                    False 면 default 값(every3d / 0)일 때만 채움.

    Returns:
        값이 실제로 변경됐으면 True.

    "항상 자동" 정책이지만 가입 직후·플랜 변경 같은 트리거에서만 호출되므로
    overwrite=False 로 두고, 일괄 rebalance 는 rebalance_all_users 로 별도 처리.
    """
    if user.id is None:
        # flush 전이면 user_id 가 아직 없어 해시가 무의미 — 호출 측 실수.
        return False

    changed = False

    # ── 슈퍼어드민은 검증 대상에서 영구 제외 ──
    # 슈퍼어드민은 본인 업체를 등록·관리하는 주체가 아니므로 자동 검증을 돌리지 않는다.
    # plan/슬롯 자동 배정 모두 건너뛰고 paused 로 강제.
    if getattr(user, "is_superadmin", False):
        if user.verify_frequency != "paused":
            user.verify_frequency = "paused"
            changed = True
        return changed

    # ── 주기 ──
    desired_freq = default_frequency_for_plan(user.plan)
    if overwrite or user.verify_frequency in (None, "", "every3d"):
        # default('every3d') 인 경우엔 plan 매핑값으로 갱신.
        # plan 이 'basic' 이면 desired_freq 도 'every3d' 라 결과 동일.
        if user.verify_frequency != desired_freq:
            user.verify_frequency = desired_freq
            changed = True
    # 사용자가 paused 로 직접 바꾼 경우는 overwrite=False 면 보존.

    # ── 슬롯 ──
    desired_slot = assign_slot_15m(user.id)
    if overwrite or user.verify_slot_15m == 0:
        if user.verify_slot_15m != desired_slot:
            user.verify_slot_15m = desired_slot
            changed = True

    # ── 호환: 기존 verify_slot (0~23) 도 같은 시각으로 맞춤 ──
    legacy_slot = desired_slot // 4  # 15분 슬롯 4개 = 1시간
    if user.verify_slot != legacy_slot and user.verify_slot_15m == desired_slot:
        user.verify_slot = legacy_slot
        changed = True

    return changed


# ─────────────────────── 일괄 rebalance ────────────────────────

async def _slot_load_map(db: AsyncSession) -> dict[int, int]:
    """현재 슬롯별 등록 합계 (active 회원만).

    Returns:
        { slot_index: places_count }, 미배정 슬롯은 0.
    """
    q = (
        select(
            User.verify_slot_15m,
            func.count(RegisteredPlace.id),
        )
        .join(RegisteredPlace, RegisteredPlace.user_id == User.id, isouter=True)
        .where(User.is_active.is_(True))
        .where(User.verify_frequency != "paused")
        .group_by(User.verify_slot_15m)
    )
    res = await db.execute(q)
    out: dict[int, int] = {i: 0 for i in range(SLOT_COUNT_15M)}
    for slot, cnt in res.all():
        out[int(slot or 0)] = int(cnt or 0)
    return out


async def rebalance_all_users(
    db: AsyncSession,
    *,
    target_max: int = SLOT_PLACES_LIMIT,
    max_passes: int = 3,
    dry_run: bool = False,
) -> dict:
    """슬롯당 등록 합계가 target_max 를 넘으면 인접 슬롯으로 한 명씩 이동.

    "항상 자동" 정책: 모든 active 회원 대상.
    paused 회원은 부하 계산에 포함하지 않음.

    알고리즘 (간단·수렴 보장):
      1) 현재 슬롯 부하 맵 계산
      2) 가장 부하 큰 슬롯에서 '등록 가장 적은 회원' 1명을 골라
         인접 (slot±1) 슬롯 중 부하가 더 작은 쪽으로 이동
      3) 모든 슬롯이 target_max 이하가 되거나 max_passes 도달 시 종료

    Args:
        target_max  : 슬롯당 등록 권장 상한 (기본 80건)
        max_passes  : 전체 패스 횟수 (회원 수 × 패스 만큼 이동 시도)
        dry_run     : True 면 실제 user.verify_slot_15m 을 바꾸지 않고
                      이동 계획만 반환

    Returns:
        {
          "before_max": int,   # 이전 최대 슬롯 부하
          "after_max":  int,
          "moved":      int,   # 실제 이동한 회원 수
          "passes":     int,
          "plan":       [{user_id, from_slot, to_slot, place_count}, ...]  # dry_run 결과
        }
    """
    plan: list[dict] = []
    moved = 0

    # 사전 부하 맵
    load = await _slot_load_map(db)
    before_max = max(load.values()) if load else 0

    for _pass in range(max_passes):
        # 가장 부하 큰 슬롯 정렬 (내림차순)
        hot_slots = sorted(load.items(), key=lambda kv: kv[1], reverse=True)
        top_slot, top_load = hot_slots[0]
        if top_load <= target_max:
            break

        # top 슬롯에서 등록 적은 회원 1명 선택 (이동 영향 최소화)
        candidate_q = await db.execute(
            select(
                User.id,
                func.coalesce(func.count(RegisteredPlace.id), 0).label("pc"),
            )
            .join(RegisteredPlace, RegisteredPlace.user_id == User.id, isouter=True)
            .where(User.verify_slot_15m == top_slot)
            .where(User.is_active.is_(True))
            .where(User.verify_frequency != "paused")
            .group_by(User.id)
            .order_by("pc")  # 등록 적은 순
            .limit(1)
        )
        row = candidate_q.first()
        if not row:
            break
        cand_id, cand_pc = int(row[0]), int(row[1])

        # 인접 슬롯 중 부하가 더 작은 쪽
        left = (top_slot - 1) % SLOT_COUNT_15M
        right = (top_slot + 1) % SLOT_COUNT_15M
        target_slot = left if load[left] <= load[right] else right

        # 옮겨도 target 부하가 top 보다 작아야 의미 있음
        if load[target_slot] + cand_pc >= top_load:
            # 더 멀리 — 가장 한가한 슬롯으로 도약 (전역 min)
            global_min_slot = min(load, key=load.get)
            if load[global_min_slot] + cand_pc < top_load:
                target_slot = global_min_slot
            else:
                # 어디로 옮겨도 균형 안 맞음 — 종료
                break

        plan.append({
            "user_id": cand_id,
            "from_slot": top_slot,
            "to_slot": target_slot,
            "place_count": cand_pc,
        })

        if not dry_run:
            await db.execute(
                User.__table__.update()
                .where(User.id == cand_id)
                .values(
                    verify_slot_15m=target_slot,
                    verify_slot=target_slot // 4,
                )
            )
            moved += 1

        # 메모리상 부하 맵 갱신
        load[top_slot] -= cand_pc
        load[target_slot] += cand_pc

    after_max = max(load.values()) if load else 0

    return {
        "before_max": before_max,
        "after_max":  after_max,
        "moved":      moved,
        "passes":     max_passes,
        "plan":       plan,
        "dry_run":    dry_run,
        "target_max": target_max,
    }


# ─────────────────────── 슬롯 처리 대상자 조회 ────────────────────────

def is_due_for_run(user: User, *, now_ts: float) -> tuple[bool, str]:
    """현재 시점에 이 회원의 자동 검증을 실행해야 하는가?

    Args:
        user   : User 객체 (verify_frequency, last_auto_run_at 사용)
        now_ts : 현재 시각 (epoch 초)

    Returns:
        (due, reason) — due=False 면 reason 에 사유.
    """
    # 슈퍼어드민은 자동 검증 대상에서 영구 제외 (DB 의 verify_frequency 와 무관하게 차단)
    if getattr(user, "is_superadmin", False):
        return False, "skipped_superadmin"
    if not user.is_active:
        return False, "blocked"
    if not user.is_profile_complete:
        return False, "skipped_incomplete"
    if user.verify_frequency == "paused":
        return False, "skipped_paused"

    interval = FREQUENCY_INTERVAL_SEC.get(user.verify_frequency, FREQUENCY_INTERVAL_SEC["every3d"])
    if user.last_auto_run_at is None:
        return True, "first_run"

    last_ts = user.last_auto_run_at.timestamp()
    if (now_ts - last_ts) < interval:
        return False, "skipped_frequency"

    # ⚠️ 같은 KST 날짜 내 중복 실행 가드 (daily 정책의 명시적 보장).
    #
    # 운영 데이터(2026-05-01)에서 user 12 (slot_15m=84, daily)가 같은 날 두 번
    # 실행된 사례 발견 — slot_hour=10(run 41) + slot_hour=21(run 45).
    # 가능한 경로:
    #   · 슬롯/주기 변경 직후 이전 슬롯에 잠시 매칭되어 두 번 진입
    #   · misfire 누적으로 다음 슬롯 진입 시 interval 만 통과해 재실행
    # 어떤 경로든 "하루 1회"는 daily 정책이므로 KST date 비교로 차단.
    try:
        from datetime import datetime as _dt, timedelta as _td, timezone as _tz
        _KST = _tz(_td(hours=9))
        last_kst_date = user.last_auto_run_at.astimezone(_KST).date()
        now_kst_date = _dt.fromtimestamp(now_ts, tz=_KST).date()
        if last_kst_date == now_kst_date:
            return False, "skipped_already_run_today"
    except Exception:                                                       # noqa: BLE001
        # 시간대 계산 실패해도 위 interval 가드로 fallback.
        pass

    return True, "due"


__all__ = [
    "SLOT_COUNT_15M",
    "SLOT_PLACES_LIMIT",
    "VALID_FREQUENCIES",
    "FREQUENCY_INTERVAL_SEC",
    "PLAN_DEFAULT_FREQUENCY",
    "default_frequency_for_plan",
    "assign_slot_15m",
    "slot_index_to_label",
    "is_valid_frequency",
    "apply_default_schedule",
    "rebalance_all_users",
    "is_due_for_run",
]
