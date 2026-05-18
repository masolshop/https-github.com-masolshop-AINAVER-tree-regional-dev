"""대용량 검증 작업 스키마."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ─── 요청 ───
class VerifyJobCreate(BaseModel):
    """검증 작업 생성 요청.

    - place_ids 가 None/빈 리스트면 사용자의 등록 전체를 검증.
    - 그렇지 않으면 해당 ID 들만 검증 (사용자 소유만 필터링됨).
    """
    place_ids: list[int] | None = Field(default=None)


# ─── 상태 응답 ───
class VerifyJobOut(BaseModel):
    id: int
    user_id: int
    status: Literal["queued", "running", "completed", "cancelled", "failed"]
    cancel_requested: bool

    total: int
    processed: int
    ok_count: int
    warning_count: int
    danger_count: int

    chunk_size: int
    chunks_total: int
    chunks_done: int

    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    error: str | None

    # 편의 필드 — 진행률(0–100)과 ETA(초)
    progress_pct: float = 0.0
    eta_seconds: int | None = None
    elapsed_seconds: int | None = None
    mismatch_count: int = 0

    class Config:
        from_attributes = True


class VerifyJobCancelResponse(BaseModel):
    id: int
    status: str
    cancel_requested: bool
    message: str
