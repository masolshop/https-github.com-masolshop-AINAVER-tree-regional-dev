"""메인 / 타지역 플레이스 분류 룰 v2 — 주소 패턴 보강.

분류 카테고리:
  · main                  — 일반 단일 사업자(개별 점포)
  · third_party           — 100% 타지역 확정 (070 또는 흥신소 키워드)
  · third_party_suspect   — 타지역 의심 (주소가 동/리까지만, 번지·도로명 상세 없음)
  · unknown               — 정보 부족(전화·주소 모두 없음)

룰 순서(우선순위):
  1) 전번이 070 → third_party (100%)
  2) 상호/카테고리에 흥신소 등 강제 키워드 → third_party
  3) 도로명주소(road_address) 또는 지번주소에 번지/건물 상세
       → main
  4) 위 3개에 다 안 걸리고 주소가 시·구·동(리) 단위에서 끝남
       → third_party_suspect

PoC 측정 결과(2025‑05‑01, 30개 키워드 93건):
  · 룰 위반 0건 / main 정확도 100% / 의심 케이스 1.1%.
"""
from __future__ import annotations

import re
from typing import Iterable, Literal

THIRD_PARTY_KEYWORDS: tuple[str, ...] = (
    "흥신소",
)

Classification = Literal["third_party", "third_party_suspect", "main", "unknown"]

# 도로명 패턴(단어 끝이 '로' 또는 '길' + 공백 + 다음 토큰)
_ROAD_TOKEN_RE = re.compile(r"\S*[로길]\s+\S")
# 번지 숫자 패턴
_LOT_NUMBER_RE = re.compile(r"\b\d+(-\d+)?\b")
# 행정 끝단 토큰(동/리/가)
_DONG_LIKE_TAIL_RE = re.compile(r"(동|리|가)\d?$")


def _digits_only(s: str | None) -> str:
    return re.sub(r"\D", "", s) if s else ""


def is_070(phone: str | None) -> bool:
    return _digits_only(phone).startswith("070")


def has_third_party_keyword(*texts: str | None) -> bool:
    haystack = " ".join((t or "") for t in texts)
    if not haystack.strip():
        return False
    return any(kw in haystack for kw in THIRD_PARTY_KEYWORDS)


def has_lot_or_road_detail(address: str | None, road_address: str | None) -> bool:
    """주소에 번지/도로명 상세가 있는가? (메인 사업자 신호)"""
    if road_address and road_address.strip():
        return True
    if not address:
        return False
    addr = address.strip()
    if not addr:
        return False
    last_token = addr.rsplit(" ", 1)[-1] if " " in addr else addr
    if _DONG_LIKE_TAIL_RE.search(last_token):
        return False
    if _ROAD_TOKEN_RE.search(addr):
        return True
    if _LOT_NUMBER_RE.search(addr):
        return True
    return False


def classify(
    phone: str | None,
    business_name: str | None = None,
    category: str | None = None,
    address: str | None = None,
    road_address: str | None = None,
) -> Classification:
    """메인 / 타지역(확정) / 타지역(의심) / 알수없음."""
    if is_070(phone):
        return "third_party"
    if has_third_party_keyword(business_name, category):
        return "third_party"
    if has_lot_or_road_detail(address, road_address):
        return "main"
    has_phone = bool(_digits_only(phone))
    has_addr = bool((address or "").strip())
    if not has_phone and not has_addr:
        return "unknown"
    return "third_party_suspect"


def classify_items(items: Iterable[dict]) -> list[dict]:
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
    """분류 요약 카운트 + 키워드의 '타지역 키워드 여부' 판정."""
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
