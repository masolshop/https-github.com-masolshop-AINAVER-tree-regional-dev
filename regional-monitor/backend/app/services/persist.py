"""검증 결과 → DB 영속화 + ChangeEvent 자동 생성.

verify_batch() 가 만든 raw dict 리스트를 받아:
  1) DailyHealthCheck INSERT (검증 raw 결과 시계열)
  2) RegisteredPlace.current_verdict / last_checked_at UPDATE
  3) verdict 가 바뀌었으면 ChangeEvent INSERT  ← "변경 즉시 발견"의 핵심

이 모듈은 라우터(/verify/live 수동 검증)와 스케줄러 둘 다에서 호출된다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.check import ChangeEvent, DailyHealthCheck
from app.models.place import RegisteredPlace


# ──────────────────────────────────────────────────────────────
# verdict → 사용자 향 의미
# ──────────────────────────────────────────────────────────────

# OK 와 비-OK 사이 전이 패턴
_BAD_VERDICTS = {
    "PHONE_MISMATCH",
    "DONG_MISMATCH",
    "NAME_MISMATCH",
    "REGION_MISMATCH",
    "DEAD",
}


def classify_event(prev: str, new: str, detail: dict) -> tuple[str, str] | None:
    """이전/현재 verdict 비교 → (event_type, summary). 변경 없으면 None.

    event_type:
      EXPOSURE_LOST  — OK → 비-OK (가장 중요)
      RECOVERED      — 비-OK → OK
      REGION_CHANGED — 시/도 단위 이동
      DONG_CHANGED   — 동 변경
      NAME_CHANGED   — 상호 변경
      PAGE_DELETED   — 페이지 자체 삭제 (404)
      OTHER_CHANGED  — 그 외 verdict 변경
    """
    if prev == new:
        return None
    # 첫 검증(이전이 PENDING/CHECKING)은 변경으로 보지 않음 — baseline 수립
    if prev in {"PENDING", "CHECKING", ""}:
        return None

    actual_dong = (detail or {}).get("actual_dong") or ""
    actual_name = (detail or {}).get("actual_name") or ""

    # 가장 심각: 페이지 자체가 사라진 경우
    if new == "DEAD":
        return ("PAGE_DELETED", "네이버 플레이스 페이지가 삭제되었습니다.")

    # 회복: 비-OK → OK
    if prev in _BAD_VERDICTS and new == "OK":
        return ("RECOVERED", "정상 노출로 회복되었습니다.")

    # 노출 상실: OK → 비-OK
    if prev == "OK" and new in _BAD_VERDICTS:
        if new == "REGION_CHANGED" or new == "REGION_MISMATCH":
            return ("REGION_CHANGED", f"시/도 단위로 노출 지역이 바뀌었습니다 ({actual_dong}).")
        if new == "DONG_MISMATCH":
            return ("DONG_CHANGED", f"노출 지역이 변경되었습니다 ({actual_dong}).")
        if new == "NAME_MISMATCH":
            return ("NAME_CHANGED", f"노출 상호가 변경되었습니다 ({actual_name}).")
        return ("EXPOSURE_LOST", f"정상 노출이 깨졌습니다 ({new}).")

    # 비-OK → 다른 비-OK (예: DONG_MISMATCH → REGION_MISMATCH)
    if new == "REGION_MISMATCH":
        return ("REGION_CHANGED", f"시/도 단위 변경이 감지되었습니다 ({actual_dong}).")
    if new == "DONG_MISMATCH":
        return ("DONG_CHANGED", f"노출 동이 변경되었습니다 ({actual_dong}).")
    if new == "NAME_MISMATCH":
        return ("NAME_CHANGED", f"노출 상호가 변경되었습니다 ({actual_name}).")

    return ("OTHER_CHANGED", f"검증 상태가 {prev} → {new} 로 변경되었습니다.")


# ──────────────────────────────────────────────────────────────
# 영속화 메인
# ──────────────────────────────────────────────────────────────


async def persist_results(
    db: AsyncSession,
    results: Iterable[dict],
) -> dict:
    """검증 결과를 DB에 반영.

    Returns:
        {"updated": N, "events": M, "history": K}  통계
    """
    updated = 0
    new_events = 0
    history_rows = 0
    now = datetime.utcnow()

    # place_id_ref → RegisteredPlace 매핑 (1번 쿼리)
    refs = [r["place_id_ref"] for r in results]
    if not refs:
        return {"updated": 0, "events": 0, "history": 0}

    q = await db.execute(select(RegisteredPlace).where(RegisteredPlace.id.in_(refs)))
    places = {p.id: p for p in q.scalars().all()}

    for r in results:
        place = places.get(r["place_id_ref"])
        if place is None:
            continue

        prev = place.current_verdict or "PENDING"
        new = r["verdict"]
        detail = r.get("detail") or {}

        # 1) DailyHealthCheck (시계열 raw)
        db.add(DailyHealthCheck(
            place_id_ref=place.id,
            alive=detail.get("alive", False),
            phone_match=detail.get("phone_match", False),
            dong_match=detail.get("dong_match", False),
            name_match=detail.get("name_match", False),
            actual_phone=detail.get("actual_phone"),
            actual_dong=detail.get("actual_dong"),
            actual_name=detail.get("actual_name"),
            actual_address=detail.get("actual_address"),
            verdict=new,
            response_ms=r.get("response_ms", 0),
            http_status=r.get("http_status", 0),
            error=r.get("error"),
            checked_at=now,
        ))
        history_rows += 1

        # 2) ChangeEvent (verdict 변경 시)
        evt = classify_event(prev, new, detail)
        if evt:
            event_type, summary = evt
            db.add(ChangeEvent(
                place_id_ref=place.id,
                event_type=event_type,
                prev_verdict=prev,
                new_verdict=new,
                summary=summary,
                detected_at=now,
            ))
            new_events += 1

        # 3) RegisteredPlace 갱신
        place.current_verdict = new
        place.last_checked_at = now
        updated += 1

    await db.commit()
    return {"updated": updated, "events": new_events, "history": history_rows}


__all__ = ["persist_results", "classify_event"]
