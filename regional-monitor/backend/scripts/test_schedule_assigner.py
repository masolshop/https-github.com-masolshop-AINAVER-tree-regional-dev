"""schedule_assigner 단위 검증 — 외부 DB 없이 로직만 빠르게 점검.

실행:
    cd regional-monitor/backend
    python scripts/test_schedule_assigner.py

검증 항목:
  1) assign_slot_15m 균등 해시: 1만 명 분포의 표준편차/최대-최소 범위
  2) default_frequency_for_plan: 매핑 정합성
  3) is_due_for_run: 주기 충족/미충족·paused/blocked 분기
  4) rebalance_all_users 의 핵심 헬퍼 (slot_index_to_label) 동작
"""
from __future__ import annotations

import importlib.util
import statistics
import sys
import time
from pathlib import Path
from types import SimpleNamespace

# backend/ 디렉토리를 sys.path 에 추가
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

# app.services.__init__ 가 verifier 를 자동 import 해서 bcrypt 등 무거운 의존성을
# 끌고 오기 때문에, 단위 테스트는 schedule_assigner.py 파일을 직접 로드한다.
# (운영 환경에선 이 우회가 필요 없음 — 모든 의존성이 venv 에 설치돼 있음)
_assigner_path = HERE.parent / "app" / "services" / "schedule_assigner.py"
_spec = importlib.util.spec_from_file_location("schedule_assigner", _assigner_path)
_mod = importlib.util.module_from_spec(_spec)
# SQLAlchemy 의 User/RegisteredPlace import 도 우회하기 위해, 모듈 본문에서
# DB 의존 함수(apply_default_schedule / rebalance_all_users) 는 호출하지 않는다.
# is_due_for_run / assign_slot_15m / 매핑 dict 등 순수 로직만 테스트.
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

SLOT_COUNT_15M = _mod.SLOT_COUNT_15M
assign_slot_15m = _mod.assign_slot_15m
default_frequency_for_plan = _mod.default_frequency_for_plan
is_due_for_run = _mod.is_due_for_run
is_valid_frequency = _mod.is_valid_frequency
slot_index_to_label = _mod.slot_index_to_label
PLAN_DEFAULT_FREQUENCY = _mod.PLAN_DEFAULT_FREQUENCY
FREQUENCY_INTERVAL_SEC = _mod.FREQUENCY_INTERVAL_SEC


# ─────────────────── 1) 해시 균등성 ───────────────────

def test_hash_uniformity() -> None:
    """1만 명을 슬롯 96개에 배정 — 표준편차·최대 부하가 합리적이어야."""
    counts = [0] * SLOT_COUNT_15M
    n = 10_000
    for uid in range(1, n + 1):
        slot = assign_slot_15m(uid)
        assert 0 <= slot < SLOT_COUNT_15M, f"slot out of range: {slot}"
        counts[slot] += 1

    expected = n / SLOT_COUNT_15M  # 약 104.17
    mean = statistics.mean(counts)
    stdev = statistics.pstdev(counts)
    cmin, cmax = min(counts), max(counts)

    print("[1] 해시 균등성 (10000명 → 96슬롯)")
    print(f"    평균 {mean:.1f}, 표준편차 {stdev:.2f}, min={cmin}, max={cmax}")

    # (id × 7919) mod 96 은 결정적 함수이므로 균등성 자체는 보장됨.
    # 96·7919 의 GCD = 1 이라 잔여류가 빠짐없이 돌아간다.
    assert abs(mean - expected) < 0.01, "평균이 기댓값과 어긋남"
    # 결정적이라 stdev=0 도 가능 — 무리한 상한 두지 않음.
    assert cmax - cmin <= 1, f"최대-최소 차이가 1 초과: {cmax - cmin}"
    print("    ✓ 통과 (완전 균등 분포)")


def test_hash_stable() -> None:
    """같은 user_id 는 항상 같은 슬롯."""
    print("[2] 해시 결정성 (같은 id → 같은 slot)")
    for uid in [1, 42, 999, 12345, 7919]:
        s1 = assign_slot_15m(uid)
        s2 = assign_slot_15m(uid)
        assert s1 == s2
    print("    ✓ 통과")


def test_hash_edge() -> None:
    """엣지 케이스 — 0/음수는 0 으로 안전 폴백."""
    print("[3] 해시 엣지 케이스")
    assert assign_slot_15m(0) == 0
    assert assign_slot_15m(-1) == 0
    assert assign_slot_15m(1) == (1 * 7919) % 96
    print("    ✓ 통과")


# ─────────────────── 2) plan → frequency 매핑 ───────────────────

def test_plan_mapping() -> None:
    print("[4] default_frequency_for_plan")
    assert default_frequency_for_plan("free") == "every5d"
    assert default_frequency_for_plan("basic") == "every3d"
    assert default_frequency_for_plan("pro") == "daily"
    assert default_frequency_for_plan("enterprise") == "daily"
    # 알 수 없는 / None / 빈문자열 → every5d (보수적 free 기준)
    assert default_frequency_for_plan(None) == "every5d"
    assert default_frequency_for_plan("") == "every5d"
    assert default_frequency_for_plan("xxx") == "every5d"
    # 대소문자 무시
    assert default_frequency_for_plan("FREE") == "every5d"
    assert default_frequency_for_plan("Pro") == "daily"
    print("    매핑:", dict(PLAN_DEFAULT_FREQUENCY))
    print("    ✓ 통과")


# ─────────────────── 3) is_due_for_run ───────────────────

def _mk_user(**kw):
    """User 모방 객체 (실제 모델 import 없이)."""
    base = dict(
        is_active=True,
        is_profile_complete=True,
        verify_frequency="every3d",
        last_auto_run_at=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_is_due_for_run() -> None:
    print("[5] is_due_for_run")
    now_ts = time.time()

    # ① 한 번도 실행 안 했음 → due
    u = _mk_user(verify_frequency="daily", last_auto_run_at=None)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is True and reason == "first_run"

    # ② daily 인데 23시간 전 실행 → 아직 멀었음
    u = _mk_user(verify_frequency="daily")
    u.last_auto_run_at = SimpleNamespace(timestamp=lambda: now_ts - 23 * 3600)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is False and reason == "skipped_frequency"

    # ③ daily 인데 25시간 전 실행 → due
    u.last_auto_run_at = SimpleNamespace(timestamp=lambda: now_ts - 25 * 3600)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is True and reason == "due"

    # ④ every5d 인데 4일 전 실행 → 아직
    u = _mk_user(verify_frequency="every5d")
    u.last_auto_run_at = SimpleNamespace(timestamp=lambda: now_ts - 4 * 86400)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is False and reason == "skipped_frequency"

    # ⑤ every5d 인데 6일 전 → due
    u.last_auto_run_at = SimpleNamespace(timestamp=lambda: now_ts - 6 * 86400)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is True and reason == "due"

    # ⑥ paused — 무한대 인터벌이므로 항상 False
    u = _mk_user(verify_frequency="paused")
    u.last_auto_run_at = SimpleNamespace(timestamp=lambda: now_ts - 365 * 86400)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is False and reason == "skipped_paused"

    # ⑦ blocked
    u = _mk_user(is_active=False)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is False and reason == "blocked"

    # ⑧ 프로필 미완성
    u = _mk_user(is_profile_complete=False)
    due, reason = is_due_for_run(u, now_ts=now_ts)
    assert due is False and reason == "skipped_incomplete"

    print("    ✓ 8개 분기 모두 통과")


# ─────────────────── 4) 슬롯 라벨/검증 ───────────────────

def test_slot_label() -> None:
    print("[6] slot_index_to_label")
    assert slot_index_to_label(0) == "00:00"
    assert slot_index_to_label(1) == "00:15"
    assert slot_index_to_label(4) == "01:00"
    assert slot_index_to_label(50) == "12:30"
    assert slot_index_to_label(95) == "23:45"
    # 범위 밖 → clamp
    assert slot_index_to_label(-5) == "00:00"
    assert slot_index_to_label(999) == "23:45"
    print("    ✓ 통과")


def test_is_valid_frequency() -> None:
    print("[7] is_valid_frequency")
    for f in ("daily", "every3d", "every5d", "weekly", "paused"):
        assert is_valid_frequency(f), f
    for f in ("", "hourly", "EVERY3D", "monthly"):
        assert not is_valid_frequency(f), f
    print("    ✓ 통과")


def test_frequency_intervals() -> None:
    print("[8] FREQUENCY_INTERVAL_SEC 정합성")
    assert FREQUENCY_INTERVAL_SEC["daily"] == 86400
    assert FREQUENCY_INTERVAL_SEC["every3d"] == 3 * 86400
    assert FREQUENCY_INTERVAL_SEC["every5d"] == 5 * 86400
    assert FREQUENCY_INTERVAL_SEC["weekly"] == 7 * 86400
    # paused 는 매우 큰 값 (사실상 무한)
    assert FREQUENCY_INTERVAL_SEC["paused"] >= 365 * 86400 * 100
    print("    ✓ 통과")


# ─────────────────── 메인 ───────────────────

def main() -> None:
    print("=" * 60)
    print("schedule_assigner 단위 검증 시작")
    print("=" * 60)
    test_hash_uniformity()
    test_hash_stable()
    test_hash_edge()
    test_plan_mapping()
    test_is_due_for_run()
    test_slot_label()
    test_is_valid_frequency()
    test_frequency_intervals()
    print("=" * 60)
    print("✅ 전체 통과")
    print("=" * 60)


if __name__ == "__main__":
    main()
