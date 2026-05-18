"""regions.json (4,819 동/리 트리) 로더.

전국 시도 → 시군구 → 동/리(또는 면+리) 트리.
세종특별자치시는 시군구가 빈 문자열("")로 저장되어 있다.

엑셀 원본을 그대로 반영하므로 변환/필터를 추가하지 않는다.
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "regions.json",
)


@lru_cache(maxsize=1)
def load_regions() -> dict[str, dict[str, list[str]]]:
    """{ sido: { sigungu: [dong/ri ...] } } 트리를 캐시 반환."""
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        logger.error("regions.json not found at %s", _DATA_PATH)
        return {}
    except json.JSONDecodeError as e:
        logger.error("regions.json parse error: %s", e)
        return {}
    return data


def regions_summary() -> dict[str, Any]:
    tree = load_regions()
    sido_count = len(tree)
    sigungu_count = sum(len(v) for v in tree.values())
    dong_count = sum(len(d) for v in tree.values() for d in v.values())
    return {
        "sido_count": sido_count,
        "sigungu_count": sigungu_count,
        "dong_count": dong_count,
    }


def list_sigungu(sido: str) -> list[str]:
    """주어진 시도 안의 시군구 목록. 세종은 빈 문자열 한 개."""
    tree = load_regions()
    return list((tree.get(sido) or {}).keys())


def list_dong(sido: str, sigungu: str) -> list[str]:
    tree = load_regions()
    return list((tree.get(sido) or {}).get(sigungu) or [])


def all_sigungu() -> list[dict[str, str]]:
    """전국 일괄 검색용 — 모든 (sido, sigungu) 쌍."""
    tree = load_regions()
    out: list[dict[str, str]] = []
    for sido, sgs in tree.items():
        for sg in sgs:
            out.append({"sido": sido, "sigungu": sg})
    return out


def sigungu_in_sido(sido: str) -> list[dict[str, str]]:
    """특정 시도 일괄 검색용."""
    return [{"sido": sido, "sigungu": sg} for sg in list_sigungu(sido)]


def short_name(sigungu_or_dong: str) -> str:
    """검색 쿼리에 쓰는 첫 토큰. '부강면 갈산리' → '갈산리' 가 아니라
    호출 측에서 그대로 쓰도록 원본 반환. (호출자에 정책 위임)"""
    return (sigungu_or_dong or "").strip()


@lru_cache(maxsize=1)
def _dong_to_region_index() -> dict[str, list[tuple[str, str]]]:
    """동/리 이름 → [(sido, sigungu), ...] 역인덱스 (대소문자/공백 통일).

    한 동 이름이 여러 시군구에 존재할 수 있으므로 list로 반환한다.
    예: "신사동" → [("서울특별시","강남구"), ("서울특별시","관악구")]
    """
    tree = load_regions()
    index: dict[str, list[tuple[str, str]]] = {}
    for sido, sgs in tree.items():
        for sigungu, dongs in sgs.items():
            for dong in dongs or []:
                key = (dong or "").strip()
                if not key:
                    continue
                index.setdefault(key, []).append((sido, sigungu))
                # 면+리 케이스: "부강면 갈산리" 도 마지막 토큰으로 별도 등록
                parts = key.split()
                if len(parts) > 1:
                    last = parts[-1].strip()
                    if last and last != key:
                        index.setdefault(last, []).append((sido, sigungu))
    return index


def lookup_region_by_dong(dong: str) -> list[tuple[str, str]]:
    """등록동 이름으로 가능한 (sido, sigungu) 후보 목록을 반환.

    빈 입력 또는 매칭 없음 → [] 반환.
    검색 쿼리 구성 시 후보가 1개면 자동 선택, 여러개면 첫 후보 우선 +
    상호/070 매칭 점수로 최종 선택한다.
    """
    key = (dong or "").strip()
    if not key:
        return []
    idx = _dong_to_region_index()
    return list(idx.get(key) or [])
