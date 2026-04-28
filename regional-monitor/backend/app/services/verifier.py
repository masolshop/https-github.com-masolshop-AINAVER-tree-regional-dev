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
from app.services.place_id_checker import (
    check_place,
    check_place_fast,
    MOBILE_UA,
    acquire_verification_slot,
    release_verification_slot,
    get_current_naver_limit,
    get_active_verification_count,
)


# ────────────────────────────────────────────────────────────
async def verify_one(
    client: httpx.AsyncClient,
    place: RegisteredPlace,
    mode: str = "full",
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
    # mode='fast' → place_id 존재 유무만 (HEAD 요청, ~35% 빠름)
    # mode='full' → 전화/동/로/리 풀 검증 (기본값, 기존 동작 유지)
    checker = check_place_fast if mode == "fast" else check_place
    cr = await checker(client, sample)

    # PENDING(429 rate-limit 등 일시 오류) → fast 모드는 외부 retry 생략
    # fast 모드: 내부 3회 재시도(3-8-15초)로 충분, 외부 안전망은 청크 시간 폭증 위험
    #   → PENDING은 다음 검증 사이클에서 자연스럽게 재처리됨 (DB에 PENDING으로 남음)
    # full 모드: 정확도가 중요하므로 외부 1회 재시도 유지
    if cr.verdict == "PENDING" and mode == "full":
        import random as _r
        await asyncio.sleep(5 + _r.uniform(0, 5))
        cr = await checker(client, sample)

    # verdict 매핑 — place_id_checker는 OK/PHONE_MISMATCH/DONG_MISMATCH/DEAD/PENDING/ERROR 반환
    # (NAME_MISMATCH는 단순화 정책에 따라 더 이상 발생하지 않음)
    verdict = cr.verdict if cr.verdict else "PENDING"
    if verdict == "ERROR":
        verdict = "DEAD"  # 네트워크 오류는 DEAD로 통합 (사용자 입장에서는 같음)
    elif verdict == "SUSPICIOUS":
        verdict = "DONG_MISMATCH"  # 보수적

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
    mode: str = "full",
) -> list[dict]:
    """여러 Place 병렬 검증.

    Args:
        places: 검증 대상 RegisteredPlace iterable
        concurrency: 동시 요청 수 (full=3, fast=8 권장)
        mode: 'full' (전화+동/로/리 검증) / 'fast' (페이지 존재 유무만)
    """
    place_list = list(places)
    if not place_list:
        return []

    # 적응형 동시성 — 활성 사용자 수에 따라 글로벌 세마포어가 자동 조정됨
    # 단일 사용자: 글로벌 5 슬롯 → concurrency=5 까지 풀로 활용
    # 다중 사용자: 글로벌 2 슬롯 → 사용자별 concurrency=2 한도 자동 큐잉
    await acquire_verification_slot()
    try:
        # 현재 활성 사용자 수에 맞춰 로컬 동시성도 적응
        active = get_active_verification_count()
        global_limit = get_current_naver_limit()
        # 단일 사용자(active==1): 호출자 지정 concurrency 그대로 사용 (최대 글로벌 한도)
        # 다중 사용자(active>=2): 글로벌 한도 이하로 강제 (안전)
        effective_concurrency = (
            min(concurrency, global_limit) if active <= 1 else global_limit
        )
        sem = asyncio.Semaphore(effective_concurrency)

        async with httpx.AsyncClient(http2=False, follow_redirects=True) as client:

            async def _one(p):
                async with sem:
                    return await verify_one(client, p, mode=mode)

            return await asyncio.gather(*(_one(p) for p in place_list))
    finally:
        await release_verification_slot()


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
