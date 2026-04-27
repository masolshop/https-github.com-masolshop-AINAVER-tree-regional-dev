"""등록된 070 Place 관리 API."""
import asyncio
import re
import time

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
    PlaceBulkRequest,
    PlaceBulkResponse,
    PlaceBulkDeleteRequest,
    PlaceBulkDeleteResponse,
    BulkRowStatus,
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
@router.post("/bulk", response_model=PlaceBulkResponse, status_code=status.HTTP_200_OK)
async def bulk_create_places(
    req: PlaceBulkRequest,
    user: User = Depends(require_quota),       # 가입 완료 + 최소 1건 quota 가드
    db: AsyncSession = Depends(get_db),
) -> PlaceBulkResponse:
    """엑셀/CSV 일괄 등록.

    프론트엔드는 .xlsx / .csv 를 클라이언트에서 파싱해 phone 컬럼을 추출하고,
    이 엔드포인트에 JSON 배열로 보낸다 (백엔드 파일 파서/대용량 업로드 부담 회피).

    동작:
      1) 070 형식 검증 → invalid_phone
      2) 사용자 등록 중복 검사 → duplicate
      3) 사용자 quota_places 초과 → quota_exceeded
      4) 네이버 추출 (병렬, 동시 5건) → extract_failed 또는 created
      5) 트랜잭션 1회 commit (created 들만 일괄 INSERT)

    응답: 행별 status + 합계 + 남은 quota.
    """
    started = time.time()

    # 사용자의 현재 등록 수 → 쿼터 계산
    cnt_q = await db.execute(
        select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user.id)
    )
    current_count = cnt_q.scalar_one() or 0
    remaining_quota = max(user.quota_places - current_count, 0)

    # 사용자의 기존 phone 셋 (중복 체크)
    existing_q = await db.execute(
        select(RegisteredPlace.phone).where(RegisteredPlace.user_id == user.id)
    )
    existing_phones = {row[0] for row in existing_q.all()}

    # 1차 패스: phone 정규화 + 중복/쿼터/형식 검증
    PHONE_RE = re.compile(r"^070-?\d{3,4}-?\d{4}$")
    plan: list[dict] = []          # {row_index, phone_normalized, status, override_dong, override_name}
    seen_in_batch: set[str] = set()
    rows_status: list[BulkRowStatus] = []
    accept_count = 0

    for idx, row in enumerate(req.rows):
        raw_phone = (row.phone or "").strip()
        try:
            norm = normalize_phone(raw_phone) if raw_phone else ""
        except Exception:
            norm = raw_phone

        # 형식 검증
        if not norm or not PHONE_RE.match(norm):
            rows_status.append(BulkRowStatus(
                phone=raw_phone or "(빈 값)",
                status="invalid_phone",
                error=f"070 형식이 아닙니다: '{raw_phone}'",
            ))
            continue

        # 사용자 기등록 중복
        if norm in existing_phones:
            rows_status.append(BulkRowStatus(
                phone=norm,
                status="duplicate",
                error="이미 등록된 번호입니다",
            ))
            continue

        # 같은 배치 내 중복
        if norm in seen_in_batch:
            rows_status.append(BulkRowStatus(
                phone=norm,
                status="duplicate",
                error="배치 내 중복 항목",
            ))
            continue

        # 쿼터 검사 (현재까지 수락된 것 + 1 > remaining_quota)
        if accept_count >= remaining_quota:
            rows_status.append(BulkRowStatus(
                phone=norm,
                status="quota_exceeded",
                error=f"플랜 등록 한도 초과 (남은 {remaining_quota - accept_count}건)",
            ))
            continue

        seen_in_batch.add(norm)
        accept_count += 1
        plan.append({
            "row_index": idx,
            "phone": norm,
            "override_dong": row.registered_dong_override,
            "override_name": row.business_name_override,
            "status_index": len(rows_status),
        })
        rows_status.append(BulkRowStatus(phone=norm, status="pending"))

    # 2차 패스: 추출 (동시성 10 — 500건 청크 기준 ~50초)
    # 네이버 부하 분산을 위해 클라이언트는 500건씩 청크로 끊어 호출 권장
    sem = asyncio.Semaphore(10)

    async def _extract(item: dict):
        async with sem:
            try:
                ex = await extract_place_from_phone(item["phone"])
                return item, ex
            except Exception as e:                                           # 그물망
                class _F:                                                    # 가짜 실패 객체
                    success = False
                    place_id = None
                    name = None
                    dong = None
                    address = None
                    category = None
                    error = f"추출 예외: {e!s}"
                return item, _F()

    extract_results = await asyncio.gather(
        *(_extract(it) for it in plan),
        return_exceptions=False,
    )

    # 3차 패스: 성공만 INSERT
    to_insert: list[RegisteredPlace] = []
    for item, ex in extract_results:
        si = item["status_index"]
        if not getattr(ex, "success", False) or not getattr(ex, "place_id", None):
            rows_status[si] = BulkRowStatus(
                phone=item["phone"],
                status="extract_failed",
                error=getattr(ex, "error", None) or "네이버 플레이스 추출 실패",
            )
            continue

        place = RegisteredPlace(
            user_id=user.id,
            phone=item["phone"],
            place_id=ex.place_id,
            registered_dong=item["override_dong"] or ex.address or ex.dong or "",
            business_name=item["override_name"] or ex.name or "",
            full_address=ex.address,
            category=ex.category,
            current_verdict="PENDING",
        )
        to_insert.append(place)
        rows_status[si] = BulkRowStatus(
            phone=item["phone"],
            status="created",
            place_id=ex.place_id,
            business_name=ex.name,
        )

    if to_insert:
        db.add_all(to_insert)
        await db.commit()

    # 합계 집계
    counts = {"created": 0, "duplicate": 0, "invalid_phone": 0, "extract_failed": 0, "quota_exceeded": 0}
    for r in rows_status:
        counts[r.status] = counts.get(r.status, 0) + 1

    elapsed = int((time.time() - started) * 1000)
    return PlaceBulkResponse(
        requested=len(req.rows),
        created=counts["created"],
        duplicate=counts["duplicate"],
        invalid_phone=counts["invalid_phone"],
        extract_failed=counts["extract_failed"],
        quota_exceeded=counts["quota_exceeded"],
        elapsed_ms=elapsed,
        quota_remaining=remaining_quota - counts["created"],
        rows=rows_status,
    )


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
@router.post("/bulk-delete", response_model=PlaceBulkDeleteResponse)
async def bulk_delete_places(
    req: PlaceBulkDeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaceBulkDeleteResponse:
    """등록 일괄 삭제.

    · ids 가 비어있고 all=True 면 사용자의 모든 등록을 삭제.
    · ids 가 주어지면 해당 id 들만 삭제 (소유권 검증 — 다른 유저 것은 not_found 로 처리).
    · 관련 자식 레코드(DailyHealthCheck, ChangeEvent)는 cascade='all, delete-orphan' 으로 함께 제거.
    """
    started = time.time()

    # 1) 대상 조회 (소유권 검증)
    if req.all and not req.ids:
        result = await db.execute(
            select(RegisteredPlace).where(RegisteredPlace.user_id == user.id)
        )
        targets = list(result.scalars().all())
        requested = len(targets)
        not_found = 0
    else:
        if not req.ids:
            raise HTTPException(
                status_code=400,
                detail="ids 가 비어있고 all=False 입니다. 삭제할 항목이 없습니다.",
            )
        result = await db.execute(
            select(RegisteredPlace).where(
                RegisteredPlace.id.in_(req.ids),
                RegisteredPlace.user_id == user.id,
            )
        )
        targets = list(result.scalars().all())
        requested = len(req.ids)
        not_found = requested - len(targets)

    # 2) 삭제 (cascade로 자식 레코드도 함께 삭제됨)
    deleted = 0
    for place in targets:
        await db.delete(place)
        deleted += 1
    await db.commit()

    elapsed_ms = int((time.time() - started) * 1000)
    return PlaceBulkDeleteResponse(
        requested=requested,
        deleted=deleted,
        not_found=not_found,
        elapsed_ms=elapsed_ms,
    )


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
@router.post("/bulk-delete", response_model=PlaceBulkDeleteResponse)
async def bulk_delete_places(
    req: PlaceBulkDeleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaceBulkDeleteResponse:
    """등록 일괄 삭제.

    - `ids`: 삭제할 Place 내부 id 리스트 (최대 1,000건 권장)
    - `all=True`: 본인의 모든 등록 일괄 삭제 (확인 다이얼로그 후 호출)

    본인 소유의 등록만 삭제 가능. 한 번의 트랜잭션으로 처리.
    """
    from sqlalchemy import delete as sa_delete

    started = time.time()

    if not req.all and not req.ids:
        raise HTTPException(
            status_code=400,
            detail="ids 또는 all=True 중 하나는 필수입니다.",
        )

    if req.all:
        # 본인 모든 등록 삭제 (이중 확인은 프론트에서 수행)
        # 먼저 카운트
        cnt_result = await db.execute(
            select(func.count(RegisteredPlace.id)).where(
                RegisteredPlace.user_id == user.id
            )
        )
        total = int(cnt_result.scalar() or 0)
        await db.execute(
            sa_delete(RegisteredPlace).where(RegisteredPlace.user_id == user.id)
        )
        await db.commit()
        return PlaceBulkDeleteResponse(
            requested=total,
            deleted=total,
            not_found=0,
            elapsed_ms=int((time.time() - started) * 1000),
        )

    # ids 기반 삭제
    requested_ids = list(set(req.ids or []))
    if not requested_ids:
        return PlaceBulkDeleteResponse(
            requested=0, deleted=0, not_found=0, elapsed_ms=0
        )

    # 본인 소유만 추리기
    rows = await db.execute(
        select(RegisteredPlace.id).where(
            RegisteredPlace.id.in_(requested_ids),
            RegisteredPlace.user_id == user.id,
        )
    )
    owned_ids = [r[0] for r in rows.all()]

    if owned_ids:
        await db.execute(
            sa_delete(RegisteredPlace).where(
                RegisteredPlace.id.in_(owned_ids),
                RegisteredPlace.user_id == user.id,
            )
        )
        await db.commit()

    return PlaceBulkDeleteResponse(
        requested=len(requested_ids),
        deleted=len(owned_ids),
        not_found=len(requested_ids) - len(owned_ids),
        elapsed_ms=int((time.time() - started) * 1000),
    )


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

