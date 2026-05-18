"""070 → Place 자동 추출 라우터."""
from dataclasses import asdict
from fastapi import APIRouter, Request, Response

from app.core.rate_limit import limiter
from app.extractors import extract_place_from_phone
from app.schemas import ExtractRequest, ExtractResponse

router = APIRouter(prefix="/extract", tags=["extract"])


@router.post("/phone", response_model=ExtractResponse)
@limiter.limit("30/minute")
async def extract_phone(request: Request, response: Response, req: ExtractRequest) -> ExtractResponse:
    """070 번호 → Place ID + 상호 + 동 자동 추출.

    프론트의 "자동 추출" 버튼이 호출. 등록은 별도 (`POST /api/v1/places/auto`).

    rate limit (slowapi): IP당 분당 30회. 외부 네이버 API 호출이 무거우므로
    nginx limit_req(rl_expensive=20r/m) 와 함께 다단 방어.
    """
    result = await extract_place_from_phone(req.phone)
    return ExtractResponse(**asdict(result))
