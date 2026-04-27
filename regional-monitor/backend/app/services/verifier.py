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

    place.place_id 가 NULL 인 경우 (등록 직후, 미추출 상태):
      1) phone → place_id 추출을 먼저 시도
      2) 추출 성공 → 추출된 정보로 4중 검증
      3) 추출 실패 → DEAD verdict 로 즉시 반환 (네이버에서 노출 못 찾음)

    Returns:
        dict: 표준 검증 결과 dict (run_live_check 응답에 사용).
    """
    # ── place_id 가 비어있으면 먼저 phone→place 추출 시도 ──
    if not place.place_id:
        try:
            from app.extractors.phone_to_place import (
                extract_place_from_phone,
                extract_dong_from_address,
            )
            ext = await extract_place_from_phone(place.phone)
            if ext and ext.success and ext.place_id:
                # DB 객체에 채워 넣기 (caller 가 commit)
                place.place_id = ext.place_id
                if not place.business_name:
                    place.business_name = ext.name or ""
                if not place.registered_dong and ext.address:
                    place.registered_dong = extract_dong_from_address(ext.address) or ""
                if not place.full_address and ext.address:
                    place.full_address = ext.address
                if not place.category and ext.category:
                    place.category = ext.category
            else:
                # 추출 실패 → 노출 못 찾음 = DEAD
                return {
                    "place_id_ref": place.id,
                    "phone": place.phone,
                    "place_id": None,
                    "registered_dong": place.registered_dong,
                    "business_name": place.business_name,
                    "detail": {
                        "alive": False,
                        "phone_match": False,
                        "dong_match": False,
                        "name_match": False,
                        "actual_phone": None,
                        "actual_dong": None,
                        "actual_name": None,
                        "actual_address": None,
                    },
                    "verdict": "DEAD",
                    "response_ms": 0,
                    "http_status": getattr(ext, "http_status", 0) if ext else 0,
                    "error": (getattr(ext, "error", None) if ext else None) or "extract_failed",
                    "checked_at": now_kst(),
                }
        except Exception as e:                                                            # noqa: BLE001
            return {
                "place_id_ref": place.id,
                "phone": place.phone,
                "place_id": None,
                "registered_dong": place.registered_dong,
                "business_name": place.business_name,
                "detail": {
                    "alive": False,
                    "phone_match": False,
                    "dong_match": False,
                    "name_match": False,
                    "actual_phone": None,
                    "actual_dong": None,
                    "actual_name": None,
                    "actual_address": None,
                },
                "verdict": "DEAD",
                "response_ms": 0,
                "http_status": 0,
                "error": f"extract_exception: {type(e).__name__}",
                "checked_at": now_kst(),
            }

    sample = {
        "place_id": place.place_id,
        "phone": place.phone,
        "expected_dong": place.registered_dong or "",
        "expected_biz": place.business_name or "",
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
