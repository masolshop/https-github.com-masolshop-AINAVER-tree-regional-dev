"""070 → Place 자동 추출 라우터."""
from dataclasses import asdict
from fastapi import APIRouter

from app.extractors import extract_place_from_phone
from app.schemas import ExtractRequest, ExtractResponse

router = APIRouter(prefix="/extract", tags=["extract"])


@router.post("/phone", response_model=ExtractResponse)
async def extract_phone(req: ExtractRequest) -> ExtractResponse:
    """070 번호 → Place ID + 상호 + 동 자동 추출.

    프론트의 "자동 추출" 버튼이 호출. 등록은 별도 (`POST /api/v1/places/auto`).
    """
    result = await extract_place_from_phone(req.phone)
    return ExtractResponse(**asdict(result))
