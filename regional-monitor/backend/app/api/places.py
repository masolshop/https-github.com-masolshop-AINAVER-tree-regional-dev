"""등록된 070 Place 관리 API."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import get_db
from app.models.place import RegisteredPlace
from app.models.user import User
from app.schemas import (
    PlaceCreate,
    PlaceCreateAuto,
    PlaceUpdate,
    PlaceOut,
    PlaceListOut,
    PlaceSummary,
    MessageResponse,
)
from app.extractors import extract_place_from_phone, normalize_phone
from .deps import get_current_user, require_quota

router = APIRouter(prefix="/places", tags=["places"])


# ────────────────────────────────────────────────────────────
@router.get("", response_model=PlaceListOut)
async def list_places(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaceListOut:
    """현재 사용자의 등록 070 목록 + 요약 카운트."""
    result = await db.execute(
        select(RegisteredPlace)
        .where(RegisteredPlace.user_id == user.id)
        .order_by(RegisteredPlace.created_at.desc())
    )
    places = list(result.scalars().all())

    summary = PlaceSummary(
        total=len(places),
        ok=sum(1 for p in places if p.current_verdict == "OK"),
        warning=sum(
            1 for p in places
            if p.current_verdict in {"PHONE_MISMATCH", "DONG_MISMATCH", "NAME_MISMATCH"}
        ),
        danger=sum(
            1 for p in places
            if p.current_verdict in {"REGION_MISMATCH", "DEAD"}
        ),
        pending=sum(
            1 for p in places
            if p.current_verdict in {"PENDING", "CHECKING"}
        ),
    )

    return PlaceListOut(
        summary=summary,
        items=[PlaceOut.model_validate(p) for p in places],
    )


# ────────────────────────────────────────────────────────────
@router.post("", response_model=PlaceOut, status_code=status.HTTP_201_CREATED)
async def create_place(
    req: PlaceCreate,
    user: User = Depends(require_quota),
    db: AsyncSession = Depends(get_db),
) -> PlaceOut:
    """수동 등록 — 사용자가 모든 필드를 직접 입력."""
    norm_phone = normalize_phone(req.phone)

    # 중복 검사
    existing = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.user_id == user.id,
            RegisteredPlace.phone == norm_phone,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"이미 등록된 070 번호입니다: {norm_phone}",
        )

    place = RegisteredPlace(
        user_id=user.id,
        phone=norm_phone,
        place_id=req.place_id,
        registered_dong=req.registered_dong,
        business_name=req.business_name,
        current_verdict="PENDING",
    )
    db.add(place)
    await db.commit()
    await db.refresh(place)
    return PlaceOut.model_validate(place)


# ────────────────────────────────────────────────────────────
@router.post("/auto", response_model=PlaceOut, status_code=status.HTTP_201_CREATED)
async def create_place_auto(
    req: PlaceCreateAuto,
    user: User = Depends(require_quota),
    db: AsyncSession = Depends(get_db),
) -> PlaceOut:
    """자동 등록 — 070만 입력하면 Place ID/동/상호 자동 추출 후 저장.

    SaaS 핵심 가치: 사용자는 070 하나만 관리.
    """
    norm_phone = normalize_phone(req.phone)

    # 중복 검사
    existing = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.user_id == user.id,
            RegisteredPlace.phone == norm_phone,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"이미 등록된 070 번호입니다: {norm_phone}",
        )

    # 자동 추출
    extracted = await extract_place_from_phone(norm_phone)
    if not extracted.success or not extracted.place_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"{norm_phone} 번호로 네이버 플레이스를 찾을 수 없습니다. "
                f"수동 등록을 사용하거나 번호를 확인해주세요. "
                f"(원인: {extracted.error or 'unknown'})"
            ),
        )

    place = RegisteredPlace(
        user_id=user.id,
        phone=norm_phone,
        place_id=extracted.place_id,
        registered_dong=req.registered_dong_override or extracted.address or extracted.dong or "",
        business_name=req.business_name_override or extracted.name or "",
        full_address=extracted.address,
        category=extracted.category,
        current_verdict="PENDING",
    )
    db.add(place)
    await db.commit()
    await db.refresh(place)
    return PlaceOut.model_validate(place)


# ────────────────────────────────────────────────────────────
@router.patch("/{place_id}", response_model=PlaceOut)
async def update_place(
    place_id: int,
    req: PlaceUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaceOut:
    """등록 정보 수정 (등록 동/상호만)."""
    result = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_id,
            RegisteredPlace.user_id == user.id,
        )
    )
    place = result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="등록 정보를 찾을 수 없습니다.")

    if req.registered_dong is not None:
        place.registered_dong = req.registered_dong
    if req.business_name is not None:
        place.business_name = req.business_name

    await db.commit()
    await db.refresh(place)
    return PlaceOut.model_validate(place)


# ────────────────────────────────────────────────────────────
@router.delete("/{place_id}", response_model=MessageResponse)
async def delete_place(
    place_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    """등록 삭제."""
    result = await db.execute(
        select(RegisteredPlace).where(
            RegisteredPlace.id == place_id,
            RegisteredPlace.user_id == user.id,
        )
    )
    place = result.scalar_one_or_none()
    if not place:
        raise HTTPException(status_code=404, detail="등록 정보를 찾을 수 없습니다.")

    await db.delete(place)
    await db.commit()
    return MessageResponse(message=f"{place.phone} 등록이 삭제되었습니다.")


# ────────────────────────────────────────────────────────────
@router.get("/summary", response_model=PlaceSummary)
async def get_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaceSummary:
    """대시보드용 요약 카운트만."""
    result = await db.execute(
        select(RegisteredPlace.current_verdict, func.count(RegisteredPlace.id))
        .where(RegisteredPlace.user_id == user.id)
        .group_by(RegisteredPlace.current_verdict)
    )
    counts = dict(result.all())
    total = sum(counts.values())
    return PlaceSummary(
        total=total,
        ok=counts.get("OK", 0),
        warning=sum(counts.get(k, 0) for k in ("PHONE_MISMATCH", "DONG_MISMATCH", "NAME_MISMATCH")),
        danger=sum(counts.get(k, 0) for k in ("REGION_MISMATCH", "DEAD")),
        pending=sum(counts.get(k, 0) for k in ("PENDING", "CHECKING")),
    )
