"""
4중 검증 서비스 — Place ID 직접 조회로 alive/phone/dong/name 4가지를 검증.

place_id_checker.py 의 핵심 함수들을 재사용하면서, FastAPI/DB 와 호환되는
표준화된 결과 형식을 반환한다.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from app.core.time_utils import now_kst, to_kst, KST
from typing import Iterable

import httpx

from app.models.place import RegisteredPlace
from app.services.place_id_checker import check_place, MOBILE_UA


# ────────────────────────────────────────────────────────────
async def verify_one(
    client: httpx.AsyncClient,
    place: RegisteredPlace,
) -> dict:
    """단일 Place 검증.

    Returns:
        dict: {
            "place_id_ref": int,            # registered_places.id
            "phone": str,
            "place_id": str,
            "registered_dong": str,
            "business_name": str,
            "detail": {alive, phone_match, dong_match, name_match,
                       actual_phone, actual_dong, actual_name, actual_address},
            "verdict": Verdict,
            "response_ms": int,
            "http_status": int,
            "error": str|None,
            "checked_at": datetime
        }
    """
    sample = {
        "place_id": place.place_id,
        "phone": place.phone,
        "expected_dong": place.registered_dong,
        "expected_biz": place.business_name,
    }
    cr = await check_place(client, sample)

    # verdict 매핑 — place_id_checker는 OK/PHONE_MISMATCH/DONG_MISMATCH/NAME_MISMATCH/DEAD/ERROR 반환
    verdict = cr.verdict if cr.verdict else "PENDING"
    if verdict == "ERROR":
        verdict = "DEAD"  # 네트워크 오류는 DEAD로 통합 (사용자 입장에서는 같음)
    elif verdict == "SUSPICIOUS":
        verdict = "DONG_MISMATCH"  # 보수적

    # REGION_MISMATCH 추가 판정 — 시/도 단위 차이가 있으면 격상
    if verdict == "DONG_MISMATCH" and cr.detail and "완전히 다른 지역" in cr.detail:
        verdict = "REGION_MISMATCH"

    # 동(짧게) 추출
    actual_dong = ""
    if cr.actual_address:
        # "서울 종로구 홍지동" → "홍지동"
        from app.extractors.phone_to_place import extract_dong_from_address
        actual_dong = extract_dong_from_address(cr.actual_address) or cr.actual_address

    return {
        "place_id_ref": place.id,
        "phone": place.phone,
        "place_id": place.place_id,
        "registered_dong": place.registered_dong,
        "business_name": place.business_name,
        "detail": {
            "alive": cr.place_alive,
            "phone_match": cr.phone_match,
            "dong_match": cr.dong_match,
            "name_match": cr.name_match,
            "actual_phone": cr.actual_phone or None,
            "actual_dong": actual_dong or None,
            "actual_name": cr.actual_name or None,
            "actual_address": cr.actual_address or None,
        },
        "verdict": verdict,
        "response_ms": int(cr.elapsed_ms),
        "http_status": cr.http_status,
        "error": cr.error or None,
        "checked_at": now_kst(),
    }


# ────────────────────────────────────────────────────────────
async def verify_batch(
    places: Iterable[RegisteredPlace],
    concurrency: int = 10,
) -> list[dict]:
    """여러 Place 병렬 검증."""
    place_list = list(places)
    if not place_list:
        return []

    sem = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient(http2=False, follow_redirects=True) as client:

        async def _one(p):
            async with sem:
                return await verify_one(client, p)

        return await asyncio.gather(*(_one(p) for p in place_list))


# ────────────────────────────────────────────────────────────
def summarize_results(results: list[dict]) -> dict:
    """검증 결과 요약 카운트."""
    total = len(results)
    ok = sum(1 for r in results if r["verdict"] == "OK")
    warning = sum(
        1 for r in results
        if r["verdict"] in {"PHONE_MISMATCH", "DONG_MISMATCH", "NAME_MISMATCH"}
    )
    danger = sum(
        1 for r in results
        if r["verdict"] in {"REGION_MISMATCH", "DEAD"}
    )
    avg_ms = (sum(r["response_ms"] for r in results) // total) if total else 0
    return {
        "total": total,
        "ok": ok,
        "warning": warning,
        "danger": danger,
        "avg_ms": avg_ms,
    }


__all__ = ["verify_one", "verify_batch", "summarize_results", "MOBILE_UA"]
