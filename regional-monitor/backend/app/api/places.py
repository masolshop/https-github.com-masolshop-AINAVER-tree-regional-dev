"""등록된 070 Place 관리 API."""
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

    # 용어 통일:
    # - 주의(불일치) = 전화/동/상호/지역 불일치
    # - 네이버 미노출(danger) = DEAD (페이지 삭제) 만 해당
    summary = PlaceSummary(
        total=len(places),
        ok=sum(1 for p in places if p.current_verdict == "OK"),
        warning=sum(
            1 for p in places
            if p.current_verdict in {"PHONE_MISMATCH", "DONG_MISMATCH", "NAME_MISMATCH", "REGION_MISMATCH"}
        ),
        danger=sum(
            1 for p in places
            if p.current_verdict == "DEAD"
        ),
        pending=sum(
            1 for p in places
            if p.current_verdict in {"PENDING", "CHECKING"}
        ),
        excluded=sum(1 for p in places if not p.in_latest_upload),
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
    """엑셀/CSV 일괄 등록 — 추출 분리형 (Phase 1: phone만 저장).

    프론트엔드는 .xlsx / .csv 를 클라이언트에서 파싱해 phone 컬럼을 추출하고,
    이 엔드포인트에 JSON 배열로 보낸다 (백엔드 파일 파서/대용량 업로드 부담 회피).

    동작 (네이버 호출 없음 — 빠르고 안정적):
      1) 070 형식 검증 → invalid_phone
      2) 사용자 등록 중복 검사 → duplicate
      3) 사용자 quota_places 초과 → quota_exceeded
      4) 통과한 phone 들을 그대로 DB INSERT (place_id/name 등은 NULL)
         current_verdict = "PENDING" 로 표시되어 검증 시작 시 추출+검증이 함께 수행된다.

    이렇게 분리하면:
      - 1500건 등록이 1초도 안 걸림 (DB INSERT만)
      - 네이버 차단/타임아웃에 영향받지 않음
      - 사용자가 "지금 검증 시작" 누르면 verify_job_runner가 추출+검증을 청크로 처리

    미포함 번호 처리 (재업로드 지원):
      · is_first_chunk=True 인 호출에서 사용자의 기존 모든 번호를
        in_latest_upload=False, excluded_at=now() 로 일괄 마킹.
      · 이번 청크/이후 청크에 다시 등장하는 번호는 in_latest_upload=True,
        excluded_at=NULL 로 복귀(중복 처리 시).
      · 신규 INSERT 는 in_latest_upload=True 로 시작.
      · 결과적으로 엑셀에 빠진 번호만 "미포함 번호" 로 남음.

    동/상호 override 자동 갱신 (update_existing=True):
      · 기존 070 이 다시 등장하면 row 의 dong/name override 로 DB 갱신
      · 변경된 행은 change_events(USER_OVERRIDE_CHANGED) 자동 기록
      · current_verdict='PENDING' 으로 리셋 → 다음 검증에서 새 값으로 재판정

    자동 재검증 (auto_verify=True, is_last_chunk=True):
      · 신규 INSERT + 갱신된 070 만 모아서 백그라운드 검증 잡 큐잉
      · 사용자 클릭 없이 빠르게 OK/변경/미노출 판정 → 토스트로 진행률 안내

    응답: 행별 status + 합계 + 남은 quota + 미포함/복귀 + 갱신 + 자동 검증 큐잉.
    """
    from app.core.time_utils import now_kst
    from sqlalchemy import update as sa_update
    from app.models.check import ChangeEvent

    started = time.time()

    # ── 미포함 번호 마킹 (재업로드 1번째 청크에서만 실행) ──
    excluded_marked = 0
    if req.is_first_chunk:
        # 현재 in_latest_upload=True 인 행을 모두 False 로 (해당 청크/후속 청크에서
        # duplicate 처리될 때 다시 True 로 복귀시킴)
        mark_q = await db.execute(
            sa_update(RegisteredPlace)
            .where(
                RegisteredPlace.user_id == user.id,
                RegisteredPlace.in_latest_upload == True,  # noqa: E712
            )
            .values(in_latest_upload=False, excluded_at=now_kst())
        )
        excluded_marked = mark_q.rowcount or 0
        await db.commit()

    # 사용자의 현재 등록 수 → 쿼터 계산
    cnt_q = await db.execute(
        select(func.count(RegisteredPlace.id)).where(RegisteredPlace.user_id == user.id)
    )
    current_count = cnt_q.scalar_one() or 0
    remaining_quota = max(user.quota_places - current_count, 0)

    # 사용자의 기존 phone → (id, registered_dong, business_name) 매핑
    # update_existing 모드에서 기존 dong/name 비교 후 갱신 + change_events 기록
    existing_q = await db.execute(
        select(
            RegisteredPlace.id,
            RegisteredPlace.phone,
            RegisteredPlace.registered_dong,
            RegisteredPlace.business_name,
            RegisteredPlace.current_verdict,
        ).where(RegisteredPlace.user_id == user.id)
    )
    existing_rows_data = list(existing_q.all())
    existing_phones = {r[1] for r in existing_rows_data}
    existing_phone_info: dict[str, tuple[int, str | None, str | None, str]] = {
        r[1]: (r[0], r[2], r[3], r[4]) for r in existing_rows_data
    }

    # phone 정규화 + 중복/쿼터/형식 검증 + INSERT 객체 누적
    PHONE_RE = re.compile(r"^070-?\d{3,4}-?\d{4}$")
    to_insert: list[RegisteredPlace] = []
    seen_in_batch: set[str] = set()
    rows_status: list[BulkRowStatus] = []
    accept_count = 0

    # update_existing 결과 누적
    overrides_to_apply: list[dict] = []      # [{id, phone, new_dong, new_name, prev_dong, prev_name, prev_verdict}]
    dong_changed_count = 0
    name_changed_count = 0

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

        # 사용자 기등록 중복 — 재업로드 시 미포함 해제(in_latest_upload=True 복귀)
        if norm in existing_phones:
            seen_in_batch.add(norm)
            # update_existing 모드: 동/상호 변경분 비교 후 갱신
            if req.update_existing:
                pid, prev_dong, prev_name, prev_verdict = existing_phone_info[norm]
                new_dong = (row.registered_dong_override or "").strip() or None
                new_name = (row.business_name_override or "").strip() or None
                # row 에 새 값이 명시된 경우만 비교 (빈 값은 무시 — 기존 유지)
                dong_diff = (
                    new_dong is not None
                    and (prev_dong or "") != new_dong
                )
                name_diff = (
                    new_name is not None
                    and (prev_name or "") != new_name
                )
                if dong_diff or name_diff:
                    overrides_to_apply.append({
                        "id": pid,
                        "phone": norm,
                        "new_dong": new_dong if dong_diff else prev_dong,
                        "new_name": new_name if name_diff else prev_name,
                        "prev_dong": prev_dong,
                        "prev_name": prev_name,
                        "prev_verdict": prev_verdict,
                        "dong_diff": dong_diff,
                        "name_diff": name_diff,
                    })
                    if dong_diff:
                        dong_changed_count += 1
                    if name_diff:
                        name_changed_count += 1

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
        # 사용자 override가 있으면 채우고, 없으면 NULL — 검증 시작 시 자동 추출됨
        place = RegisteredPlace(
            user_id=user.id,
            phone=norm,
            place_id=None,                                  # 검증 시작 시 추출
            registered_dong=row.registered_dong_override or None,
            business_name=row.business_name_override or None,
            full_address=None,
            category=None,
            current_verdict="PENDING",                      # 미검증 상태
        )
        to_insert.append(place)
        rows_status.append(BulkRowStatus(
            phone=norm,
            status="created",
            place_id=None,
            business_name=row.business_name_override or None,
        ))

    # 한 번에 일괄 INSERT (네이버 호출 없음 — 매우 빠름)
    new_inserted_ids: list[int] = []
    if to_insert:
        db.add_all(to_insert)
        await db.commit()
        # 새로 INSERT 된 PK 수집 (자동 검증 잡 큐잉용)
        for p in to_insert:
            if p.id is not None:
                new_inserted_ids.append(p.id)

    # ── 동/상호 override 자동 갱신 (update_existing=True) ──
    overrides_updated = 0
    updated_ids: list[int] = []
    if req.update_existing and overrides_to_apply:
        for ov in overrides_to_apply:
            # DB 갱신 — current_verdict 도 PENDING 으로 리셋 (다음 검증에서 새 값 비교)
            await db.execute(
                sa_update(RegisteredPlace)
                .where(
                    RegisteredPlace.id == ov["id"],
                    RegisteredPlace.user_id == user.id,
                )
                .values(
                    registered_dong=ov["new_dong"],
                    business_name=ov["new_name"],
                    current_verdict="PENDING",  # 동/상호 변경 → 재검증 필요
                )
            )
            updated_ids.append(ov["id"])
            overrides_updated += 1

            # change_events 자동 기록 (USER_OVERRIDE_CHANGED)
            parts = []
            if ov["dong_diff"]:
                parts.append(
                    f"동: '{ov['prev_dong'] or '(없음)'}' → '{ov['new_dong']}'"
                )
            if ov["name_diff"]:
                parts.append(
                    f"상호: '{ov['prev_name'] or '(없음)'}' → '{ov['new_name']}'"
                )
            summary = "고객요청 변경 (엑셀 재업로드): " + " / ".join(parts)
            db.add(ChangeEvent(
                place_id_ref=ov["id"],
                event_type="USER_OVERRIDE_CHANGED",
                prev_verdict=ov["prev_verdict"],
                new_verdict="PENDING",
                summary=summary[:500],
            ))
        await db.commit()

    # ── 미포함 해제 (재업로드에 다시 등장한 번호) ──
    # 이번 청크의 phone 들 중 기존 DB 에 있는 것들을 in_latest_upload=True 로 복귀.
    excluded_restored = 0
    if seen_in_batch:
        restore_phones = [p for p in seen_in_batch if p in existing_phones]
        if restore_phones:
            res = await db.execute(
                sa_update(RegisteredPlace)
                .where(
                    RegisteredPlace.user_id == user.id,
                    RegisteredPlace.phone.in_(restore_phones),
                    RegisteredPlace.in_latest_upload == False,  # noqa: E712
                )
                .values(in_latest_upload=True, excluded_at=None)
            )
            excluded_restored = res.rowcount or 0
            await db.commit()

    # ── 자동 재검증 잡 큐잉 (마지막 청크 + auto_verify=True) ──
    #
    # 정책 (2026-05-11 개선):
    #   기존: 신규 INSERT + override 갱신 ID 만 자동 검증 → 기존 PENDING(미검증) 누적분이
    #         계속 "검증 대기" 로 남아 사용자가 의아해함 (사례: user_id=19 케이엘공조,
    #         1차 1,000건 업로드 후 2차 279건 재업로드 시 신규 279건만 검증되고
    #         기존 1,000건 PENDING 그대로 남음).
    #   변경: 신규 + 갱신 + "사용자 전체 등록 중 PENDING/CHECKING 상태인 모든 ID" 합집합으로
    #         큐잉 → 업로드 한 번이 끝나면 검증 대기가 0 에 수렴.
    #         (단, 플랜 한도는 run_job 내부에서 다시 적용되므로 안전.)
    auto_verify_queued = False
    auto_verify_target_count = 0
    if req.is_last_chunk and req.auto_verify:
        # 1) 신규 INSERT + override 갱신 ID
        target_ids_set: set[int] = {*new_inserted_ids, *updated_ids}

        # 2) 기존 PENDING/CHECKING 상태인 사용자 전체 등록 ID — 검증 대기 누적분 흡수
        try:
            pending_q = await db.execute(
                select(RegisteredPlace.id).where(
                    RegisteredPlace.user_id == user.id,
                    RegisteredPlace.current_verdict.in_(("PENDING", "CHECKING")),
                )
            )
            target_ids_set.update(row[0] for row in pending_q.all())
        except Exception as e:  # noqa: BLE001
            # 누적분 흡수 실패해도 신규/갱신은 검증 진행 — 비치명적
            import logging
            logging.getLogger(__name__).warning(
                "auto_verify pending sweep 실패: user_id=%s err=%s", user.id, e,
            )

        target_ids = list(target_ids_set)
        if target_ids:
            try:
                from app.services.verify_job_runner import enqueue_verify_job
                await enqueue_verify_job(
                    db=db,
                    user=user,
                    place_ids=target_ids,
                    mode="full",
                    trigger="upload_auto",
                )
                auto_verify_queued = True
                auto_verify_target_count = len(target_ids)
            except Exception as e:  # noqa: BLE001
                # 잡 큐잉 실패해도 업로드 자체는 성공으로 응답 (사용자가 수동 검증 가능)
                import logging
                logging.getLogger(__name__).warning(
                    "auto_verify enqueue 실패: user_id=%s targets=%d err=%s",
                    user.id, len(target_ids), e,
                )

    # 합계 집계 (extract_failed 카테고리는 더 이상 발생하지 않음)
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
        excluded_marked=excluded_marked,
        excluded_restored=excluded_restored,
        overrides_updated=overrides_updated,
        dong_changed=dong_changed_count,
        name_changed=name_changed_count,
        auto_verify_queued=auto_verify_queued,
        auto_verify_target_count=auto_verify_target_count,
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
        # 용어 통일: 주의=전화/동/상호/지역 불일치, 네이버 미노출(danger)=DEAD
        warning=sum(counts.get(k, 0) for k in ("PHONE_MISMATCH", "DONG_MISMATCH", "NAME_MISMATCH", "REGION_MISMATCH")),
        danger=counts.get("DEAD", 0),
        pending=sum(counts.get(k, 0) for k in ("PENDING", "CHECKING")),
    )

