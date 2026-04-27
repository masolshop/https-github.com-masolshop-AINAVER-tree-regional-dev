"""실시간 노출 검증 API."""
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models.place import RegisteredPlace
from app.models.check import DailyHealthCheck
from app.models.user import User
from app.schemas import (
    LiveCheckRequest,
    LiveCheckResponse,
    VerificationResult,
    VerificationDetail,
)
from app.services import verify_batch, summarize_results
from .deps import get_current_user

router = APIRouter(prefix="/verify", tags=["verify"])


@router.post("/live", response_model=LiveCheckResponse)
async def run_live_check(
    req: LiveCheckRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LiveCheckResponse:
    """현재 사용자 등록 070들에 대해 즉시 4중 검증 실행.

    프론트의 "지금 검증 시작" 버튼이 호출.
    - place_ids 가 None 이면 전체 등록을 검증.
    - 결과는 DB(daily_health_checks)에 기록되고, registered_places.current_verdict 갱신.
    """
    query = select(RegisteredPlace).where(RegisteredPlace.user_id == user.id)
    if req.place_ids:
        query = query.where(RegisteredPlace.id.in_(req.place_ids))
    result = await db.execute(query)
    places = list(result.scalars().all())

    if not places:
        raise HTTPException(status_code=404, detail="검증할 등록이 없습니다.")

    # 병렬 검증 (concurrency 10)
    t0 = time.perf_counter()
    raw_results = await verify_batch(places, concurrency=10)
    total_ms = int((time.perf_counter() - t0) * 1000)

    # DB 기록 + verdict 캐시 갱신
    for r, place in zip(raw_results, places):
        d = r["detail"]
        check = DailyHealthCheck(
            place_id_ref=place.id,
            alive=d["alive"],
            phone_match=d["phone_match"],
            dong_match=d["dong_match"],
            name_match=d["name_match"],
            actual_phone=d["actual_phone"],
            actual_dong=d["actual_dong"],
            actual_name=d["actual_name"],
            actual_address=d["actual_address"],
            verdict=r["verdict"],
            response_ms=r["response_ms"],
            http_status=r["http_status"],
            error=r["error"],
            checked_at=r["checked_at"],
        )
        db.add(check)

        place.current_verdict = r["verdict"]
        place.last_checked_at = r["checked_at"]
        # 자동 추출 보강 (이전에 비어 있던 경우만)
        if not place.full_address and d.get("actual_address"):
            place.full_address = d["actual_address"]

    await db.commit()

    # 응답 변환
    summary = summarize_results(raw_results)
    avg_ms = summary["avg_ms"]
    throughput = round(len(raw_results) / total_ms * 1000, 1) if total_ms > 0 else 0.0

    items = [
        VerificationResult(
            place_id_ref=r["place_id_ref"],
            phone=r["phone"],
            place_id=r["place_id"],
            registered_dong=r["registered_dong"],
            business_name=r["business_name"],
            detail=VerificationDetail(
                alive=r["detail"]["alive"],
                phone_match=r["detail"]["phone_match"],
                dong_match=r["detail"]["dong_match"],
                name_match=r["detail"]["name_match"],
                actual_phone=r["detail"]["actual_phone"],
                actual_dong=r["detail"]["actual_dong"],
                actual_name=r["detail"]["actual_name"],
                actual_address=r["detail"]["actual_address"],
            ),
            verdict=r["verdict"],
            response_ms=r["response_ms"],
            http_status=r["http_status"],
            error=r["error"],
            checked_at=r["checked_at"],
        )
        for r in raw_results
    ]

    return LiveCheckResponse(
        total_ms=total_ms,
        avg_ms=avg_ms,
        throughput=throughput,
        results=items,
        summary={
            "ok": summary["ok"],
            "warning": summary["warning"],
            "danger": summary["danger"],
        },
    )
