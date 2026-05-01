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
