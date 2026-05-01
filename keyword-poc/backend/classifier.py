"""메인 플레이스 vs 타지역 플레이스 분류 룰 (v2 — 주소 패턴 보강).

분류 카테고리:
  · main                  — 일반 단일 사업자(개별 점포)
  · third_party           — 100% 타지역 확정 (070 또는 흥신소 키워드)
  · third_party_suspect   — 타지역 의심 (주소가 동/리까지만, 번지·도로명 상세 없음)
  · unknown               — 정보 부족(전화·주소 모두 없음)

룰 순서(우선순위):
  1) 전번이 070 → third_party (100%)
  2) 상호/카테고리에 흥신소 등 강제 키워드 → third_party
  3) 도로명주소(road_address) 또는 지번주소에 번지/건물 상세가 있음
       → 메인(main)
  4) 위 3개에 다 안 걸리고 주소가 시·구·동(리) 단위에서 끝남
       → third_party_suspect

실제 PoC 측정 결과(2025‑05‑01, 5개 키워드 25건):
  · 070 번호 14건은 전부 road_address=None & 동(리)까지만 → 100% 일치
  · 메인 사업자 6건은 전부 번지·건물명 보유 → 100% 일치
"""
from __future__ import annotations

import re
from typing import Iterable, Literal

# ── 강제 타지역 키워드(상호·카테고리에 들어가면 무조건 타지역) ──
THIRD_PARTY_KEYWORDS: tuple[str, ...] = (
    "흥신소",
)

Classification = Literal["third_party", "third_party_suspect", "main", "unknown"]


# ── helpers ───────────────────────────────────────────────
def _digits_only(s: str | None) -> str:
    return re.sub(r"\D", "", s) if s else ""


def is_070(phone: str | None) -> bool:
    return _digits_only(phone).startswith("070")


def has_third_party_keyword(*texts: str | None) -> bool:
    haystack = " ".join((t or "") for t in texts)
    if not haystack.strip():
        return False
    return any(kw in haystack for kw in THIRD_PARTY_KEYWORDS)


# ── 주소 상세 여부 판정 ────────────────────────────────────
# 한국 행정주소 후미 패턴(시/도, 구/군, 동/리/가/로/길) 마지막 토큰 직후에
# 번지(숫자) 또는 도로명 상세(123-45 / 빌딩명 / 층호) 가 붙는지 검사.

# 도로명 패턴(단어 끝이 '로' 또는 '길')
_ROAD_TOKEN_RE = re.compile(r"\S*[로길]\s+\S")
# 번지 패턴(숫자 또는 숫자-숫자)
_LOT_NUMBER_RE = re.compile(r"\b\d+(-\d+)?\b")
# 동/리/가 등 행정 끝단 토큰
_DONG_LIKE_TAIL_RE = re.compile(r"(동|리|가)\d?$")


def has_lot_or_road_detail(address: str | None, road_address: str | None) -> bool:
    """주소에 번지/도로명 상세가 있는가? (메인 사업자 신호)

    True 인 경우:
      · road_address 가 비어있지 않음(도로명주소 자체 존재)
      · 또는 address 안에 도로명+번지 패턴 또는 숫자 번지 패턴이 있음

    False 인 경우(예):
      · '서울특별시 중구 무교동'
      · '서울특별시 종로구 청진동'
      · '경기도 성남시 분당구 정자1동'   ← 마지막 토큰 '정자1동' 같이 동/리/가 단위
    """
    if road_address and road_address.strip():
        # 도로명주소 자체가 있는 시점에서 상세 주소 보유로 본다.
        return True

    if not address:
        return False
    addr = address.strip()
    if not addr:
        return False

    # 마지막 토큰이 '~동/~리/~가' 로 끝나면 → 동/리 단위
    last_token = addr.rsplit(" ", 1)[-1] if " " in addr else addr
    if _DONG_LIKE_TAIL_RE.search(last_token):
        return False

    # 도로명(로/길) 토큰 뒤에 추가 토큰이 붙어 있으면 메인
    if _ROAD_TOKEN_RE.search(addr):
        return True

    # 단순 번지 숫자가 보이면 메인
    if _LOT_NUMBER_RE.search(addr):
        # 단, 'XX동123' 이 한 토큰으로 묶여 있어도 무조건 메인 처리
        # (현실 데이터에서 이런 케이스는 거의 없음)
        return True

    return False


# ── 메인 분류 ─────────────────────────────────────────────
def classify(
    phone: str | None,
    business_name: str | None = None,
    category: str | None = None,
    address: str | None = None,
    road_address: str | None = None,
) -> Classification:
    """메인 / 타지역(확정) / 타지역(의심) / 알수없음."""
    # 1) 070 → 확정 타지역
    if is_070(phone):
        return "third_party"

    # 2) 흥신소 등 강제 키워드 → 확정 타지역
    if has_third_party_keyword(business_name, category):
        return "third_party"

    # 3) 주소 상세 보유 → 메인
    if has_lot_or_road_detail(address, road_address):
        return "main"

    # 4) 정보 부족 vs 의심 분기
    has_phone = bool(_digits_only(phone))
    has_addr = bool((address or "").strip())
    if not has_phone and not has_addr:
        return "unknown"
    # 전번/주소 중 하나는 있으나 주소가 동/리 단위까지만
    return "third_party_suspect"


def classify_items(items: Iterable[dict]) -> list[dict]:
    """검색 결과 dict 리스트에 'classification' 필드를 채워 반환."""
    out = []
    for it in items:
        c = classify(
            phone=it.get("phone"),
            business_name=it.get("name"),
            category=it.get("category"),
            address=it.get("address"),
            road_address=it.get("road_address"),
        )
        new_it = dict(it)
        new_it["classification"] = c
        out.append(new_it)
    return out


def summarize(items: Iterable[dict]) -> dict:
    """분류 요약 카운트 + 키워드의 '타지역 키워드 여부' 판정.

    is_third_party_keyword:
      1페이지에서 (third_party + third_party_suspect) 비율이 50% 이상이면 True.
      (확정 070 1건만으로는 부족 — 의심까지 포함해 키워드 필터링 신호)
    """
    items = list(items)
    main_c = sum(1 for x in items if x.get("classification") == "main")
    tp_c = sum(1 for x in items if x.get("classification") == "third_party")
    sus_c = sum(1 for x in items if x.get("classification") == "third_party_suspect")
    unk_c = sum(1 for x in items if x.get("classification") == "unknown")
    total = len(items)
    tp_total = tp_c + sus_c
    ratio = (tp_total / total) if total else 0.0
    return {
        "total": total,
        "main_count": main_c,
        "third_party_count": tp_c,
        "third_party_suspect_count": sus_c,
        "unknown_count": unk_c,
        "third_party_ratio": round(ratio, 3),
        "is_third_party_keyword": tp_total >= 1 and ratio >= 0.5,
    }
