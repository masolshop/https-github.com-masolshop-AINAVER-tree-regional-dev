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
    # 분기 정책 (사용자 결정 / 2026-04-28):
    #   ① 네이버 검색에 결과가 정상 응답되었는데 place_id 가 안 잡히는 경우
    #      = 그 070 번호의 플레이스 자체가 네이버에 노출되지 않음
    #      = "페이지 누락(DEAD)" 으로 확정.
    #        예) error='place_id_not_found', 'name_not_found_in_search'
    #   ② 네이버가 캡차/차단/네트워크/HTTP 4xx·5xx 로 응답해 검색 자체가 실패한 경우
    #      = 일시적 차단이므로 PENDING(검증 대기) 으로 보류 → 다음 회차 재시도.
    #        예) error='naver_blocked_captcha', 'http_429', 'http_403',
    #            'network: ...', 응답 status_code != 200
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
                # 추출 실패 사유 분류
                ext_status = getattr(ext, "http_status", 0) if ext else 0
                ext_error = (getattr(ext, "error", None) if ext else None) or "extract_failed"
                ext_resp_ms = getattr(ext, "response_ms", 0) if ext else 0

                # 일시 차단 신호 — PENDING 유지
                # (캡차/네트워크/HTTP 비-200 는 네이버 응답 자체가 비정상)
                _temporary_signals = (
                    "naver_blocked_captcha",
                    "network",
                    "http_403",
                    "http_429",
                    "http_5",        # 5xx 계열 전부
                )
                is_temporary = any(ext_error.startswith(sig) for sig in _temporary_signals)

                # ② 일시 차단 → PENDING
                # ① 검색 응답은 정상인데 결과 없음 → DEAD
                fail_verdict = "PENDING" if is_temporary else "DEAD"

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
                    "verdict": fail_verdict,
                    "response_ms": ext_resp_ms,
                    "http_status": ext_status,
                    "error": ext_error,
                    "checked_at": now_kst(),
                }
        except Exception as e:                                                            # noqa: BLE001
            # 추출 단계의 예기치 못한 예외 = 일시 오류 → PENDING
            # (코드 버그 / 네이버 응답 포맷 변경 등이므로 사용자에게 "삭제" 단정은 위험)
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
                "verdict": "PENDING",
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
        # ⚠️ 네트워크 오류 / timeout / 403·429 등 일시 차단은 절대 DEAD 가 아님.
        # 사용자에게 "페이지 삭제" 알림이 오는 false-positive 의 주범이므로 PENDING 으로
        # 통일하여 다음 회차에서 재검증하도록 한다.
        verdict = "PENDING"
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
    pace_ms: int = 0,
) -> list[dict]:
    """여러 Place 병렬 검증.

    Args:
        places: 검증 대상 RegisteredPlace iterable
        concurrency: 동시 요청 수 (full=3, fast=8 권장)
        mode: 'full' (전화+동/로/리 검증) / 'fast' (페이지 존재 유무만)
        pace_ms: 각 작업 시작 직전 추가 지연 (ms). 자동 검증에서 서버/네이버 부하를
            추가로 낮추기 위해 사용. 0이면 비활성. (sem 내부에서 sleep → 실제 RPS↓)
    """
    place_list = list(places)
    if not place_list:
        return []

    # 적응형 동시성:
    #  - 단일 사용자(active==1): 글로벌 SOLO=2, 로컬 sem=요청값(기본 5) → 글로벌이 실제 한도
    #  - 다중 사용자(active>=2): 글로벌 MULTI=1로 전환되어 사용자 간 자동 직렬화
    # 로컬 sem은 빠르게 글로벌에 진입하기 위한 큐잉 한도 (글로벌이 절대 상한)
    acquire_verification_slot()
    try:
        sem = asyncio.Semaphore(concurrency)
        pace_sec = max(0, pace_ms) / 1000.0

        async with httpx.AsyncClient(http2=False, follow_redirects=True) as client:

            async def _one(p):
                async with sem:
                    if pace_sec > 0:
                        await asyncio.sleep(pace_sec)
                    return await verify_one(client, p, mode=mode)

            return await asyncio.gather(*(_one(p) for p in place_list))
    finally:
        release_verification_slot()


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
