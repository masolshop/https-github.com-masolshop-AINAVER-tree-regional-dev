"""
타지역 판정 + 동별 경쟁도 4단계 분류.

규칙 (PoC 검증 완료):
- 도로명에 "(로|길) + 숫자" 있으면 메인 (정상 등록)
- 지번에 "(동|가|리|면) + 숫자" 있으면 메인 (정상 등록)
- 둘 다 없으면 → 타지역 (주민센터 묶음 등록 추정)

경쟁도 등급 (사용자 정의):
- 청정  : 1~5개
- 경쟁  : 6~10개
- 과열  : 11~15개
- 포화  : 16개 이상
- 없음  : 0개
"""
from __future__ import annotations

import re
from typing import Iterable

from app.services.naver_map import MapPlace


# ─────────────────────────────────────────────────────────────────────────────
# 타지역 판정
# ─────────────────────────────────────────────────────────────────────────────
_ROAD_NUM_RE = re.compile(r"(로|길)\s*\d")
_JIBUN_NUM_RE = re.compile(r"(동|가|리|면)\s*\d")


def is_other_region(item: MapPlace | dict) -> bool:
    """타지역(번지 없음) 판정.

    True = 타지역 (메인 자리를 빼앗기는 외부 업체)
    False = 메인 (해당 동에 정식 등록된 업체)
    """
    if isinstance(item, MapPlace):
        road = (item.road_address or "").strip()
        addr = (item.address or "").strip()
    else:
        road = (item.get("road_address") or item.get("roadAddress") or "").strip()
        addr = (item.get("address") or "").strip()

    # 도로명 + 숫자 → 메인
    if road and _ROAD_NUM_RE.search(road):
        return False
    # 지번 + 숫자 → 메인
    if addr and _JIBUN_NUM_RE.search(addr):
        return False
    # 주소 자체가 비어있으면 타지역으로 간주 (안전 측)
    if not road and not addr:
        return True
    # 동/리/가/면까지만 → 타지역
    return True


# ─────────────────────────────────────────────────────────────────────────────
# 주소 → (시도, 시군구, 동/리)
# ─────────────────────────────────────────────────────────────────────────────
_DONG_SUFFIXES = ("동", "리", "가")
_FACE_SUFFIXES = ("면", "읍")


def parse_region(item: MapPlace | dict) -> tuple[str, str, str]:
    """네이버 노출 주소 기준으로 (시도, 시군구, 동/리) 추출.

    네이버 표기를 그대로 따름 — 종종 동·구 매핑이 혼동되는 케이스도 그대로 사용.
    """
    if isinstance(item, MapPlace):
        addr = (item.address or item.road_address or "").strip()
    else:
        addr = (
            item.get("address")
            or item.get("road_address")
            or item.get("roadAddress")
            or ""
        ).strip()
    if not addr:
        return ("", "", "")

    tokens = addr.split()
    if not tokens:
        return ("", "", "")

    sido = tokens[0]
    sigungu = ""
    dong = ""

    if len(tokens) >= 2:
        sigungu = tokens[1]
        # 두 토큰 시군구 (예: "강릉시 강동면", "수원시 영통구")
        if len(tokens) >= 3 and (
            tokens[2].endswith(_FACE_SUFFIXES) or tokens[2].endswith("구")
        ):
            sigungu = f"{tokens[1]} {tokens[2]}"

    # 동/리/가 추출 — sigungu 이후 토큰에서 첫 번째 매칭
    skip = 1 + (2 if " " in sigungu else 1)  # sido + sigungu(1or2 token)
    for tok in tokens[skip:]:
        # "압구정동", "을지로1가", "마송리" 등
        if tok.endswith(_DONG_SUFFIXES):
            dong = tok
            break
        # "조치원읍" 같은 면/읍이 동 자리에 올 때
        if tok.endswith(_FACE_SUFFIXES):
            dong = tok
            break

    return (sido, sigungu, dong)


def enrich(items: list[MapPlace]) -> list[MapPlace]:
    """모든 item에 is_other_region / sido / sigungu / dong 채움."""
    for it in items:
        sido, sigungu, dong = parse_region(it)
        it.sido = sido
        it.sigungu = sigungu
        it.dong = dong
        it.is_other_region = is_other_region(it)
    return items


# ─────────────────────────────────────────────────────────────────────────────
# 4단계 등급
# ─────────────────────────────────────────────────────────────────────────────
GRADE_NONE = "none"
GRADE_CLEAN = "clean"  # 청정 1~5
GRADE_COMPETE = "compete"  # 경쟁 6~10
GRADE_HEATED = "heated"  # 과열 11~15
GRADE_SATURATED = "saturated"  # 포화 16+

GRADE_LABEL = {
    GRADE_NONE: "없음",
    GRADE_CLEAN: "청정",
    GRADE_COMPETE: "경쟁",
    GRADE_HEATED: "과열",
    GRADE_SATURATED: "포화",
}

# 사용자 정의 임계값 (변경 시 한 곳만 수정)
GRADE_THRESHOLDS = [
    (16, GRADE_SATURATED),
    (11, GRADE_HEATED),
    (6, GRADE_COMPETE),
    (1, GRADE_CLEAN),
]


def grade_for_count(n: int) -> str:
    if n <= 0:
        return GRADE_NONE
    for threshold, label in GRADE_THRESHOLDS:
        if n >= threshold:
            return label
    return GRADE_NONE


# ─────────────────────────────────────────────────────────────────────────────
# 동별 집계
# ─────────────────────────────────────────────────────────────────────────────
def aggregate_by_dong(items: Iterable[MapPlace]) -> dict[str, dict]:
    """동(시도+시군구+동) 단위로 집계.

    반환: {"서울특별시 강남구 압구정동": {sido, sigungu, dong, total, other, main, grade, items[]}}
    """
    buckets: dict[str, dict] = {}
    for it in items:
        if not it.dong:
            continue
        key = f"{it.sido} {it.sigungu} {it.dong}".strip()
        b = buckets.setdefault(
            key,
            {
                "key": key,
                "sido": it.sido,
                "sigungu": it.sigungu,
                "dong": it.dong,
                "total": 0,
                "other": 0,
                "main": 0,
                "items": [],
            },
        )
        b["total"] += 1
        if it.is_other_region:
            b["other"] += 1
        else:
            b["main"] += 1
        b["items"].append(it.as_dict())

    for b in buckets.values():
        b["grade"] = grade_for_count(b["other"])
        b["grade_label"] = GRADE_LABEL[b["grade"]]
    return buckets


def grade_distribution(buckets: dict[str, dict]) -> dict[str, int]:
    """등급별 동 개수 분포."""
    dist = {g: 0 for g in (GRADE_NONE, GRADE_CLEAN, GRADE_COMPETE, GRADE_HEATED, GRADE_SATURATED)}
    for b in buckets.values():
        dist[b["grade"]] = dist.get(b["grade"], 0) + 1
    return dist
