"""사용자 설정 API — /api/v1/settings

- GET   /settings  : 현재 사용자 설정 조회
- PATCH /settings  : 부분 업데이트 (보낸 필드만 갱신)

플랜 게이팅:
  - free:       email_alerts 만 사용 가능
  - basic+:     email_alerts + sheet_url + sheet_sync_enabled
  - pro+:       + kakao_number
  - enterprise: + slack_webhook
허용되지 않은 채널 활성화 요청은 422 로 거절한다.

자동 검증 주기는 백엔드가 verify_slot 기반으로 매시간 분산 실행하므로
프론트의 schedule 선택 UI는 표시용이며 서버에는 저장하지 않는다(향후 플랜 확장 시 컬럼 추가).
"""
from __future__ import annotations

import re
from datetime import datetime
from app.core.time_utils import now_kst, to_kst, KST
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, HttpUrl, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

# 추가 수신자 최대 개수 (영업관리자/고객 담당자 등)
MAX_NOTIFY_EMAILS = 5
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def _parse_notify_emails(raw: str | None) -> list[str]:
    """콤마/세미콜론/줄바꿈으로 구분된 이메일 문자열을 정규화 리스트로 변환."""
    if not raw:
        return []
    parts = re.split(r"[,;\n]+", raw)
    cleaned: list[str] = []
    seen: set[str] = set()
    for p in parts:
        e = p.strip()
        if not e:
            continue
        low = e.lower()
        if low in seen:
            continue
        seen.add(low)
        cleaned.append(e)
    return cleaned

from app.core import get_db
from app.models.user import User

from .deps import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


# ─────────────────────────── 스키마 ───────────────────────────


class SettingsOut(BaseModel):
    # 알림
    email_alerts: bool
    email_address: str                       # = user.email (Google 가입 이메일)
    notify_emails: list[str] = []            # 추가 수신자 (영업관리자/고객 담당자 등)
    kakao_number: Optional[str] = None
    slack_webhook: Optional[str] = None

    # 구글시트
    sheet_url: Optional[str] = None
    sheet_sync_enabled: bool

    # 자동 검증 (KST 24h 분산 — 표시용)
    verify_slot: int                         # 0~23
    verify_slot_label: str                   # "매일 03:00 (KST)"

    # 플랜 게이팅
    plan: str                                # "free" / "basic" / "pro" / "enterprise"
    available_channels: list[str]            # 현재 플랜에서 사용 가능한 채널 키 목록


class SettingsPatch(BaseModel):
    """부분 업데이트. 모든 필드 optional, 보낸 것만 반영."""
    email_alerts: Optional[bool] = None
    # 추가 수신자: 클라이언트는 list[str] 로 보낼 수 있고,
    # 서버 저장은 콤마 구분 문자열로 정규화한다.
    notify_emails: Optional[list[str]] = Field(default=None, max_length=MAX_NOTIFY_EMAILS)
    kakao_number: Optional[str] = Field(default=None, max_length=20)
    slack_webhook: Optional[str] = Field(default=None, max_length=500)
    sheet_url: Optional[str] = Field(default=None, max_length=500)
    sheet_sync_enabled: Optional[bool] = None

    @field_validator("notify_emails")
    @classmethod
    def _validate_notify_emails(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw in v:
            if not raw:
                continue
            e = raw.strip()
            if not e:
                continue
            if not _EMAIL_RE.match(e):
                raise ValueError(f"유효하지 않은 이메일 형식: {e}")
            low = e.lower()
            if low in seen:
                continue
            seen.add(low)
            cleaned.append(e)
        if len(cleaned) > MAX_NOTIFY_EMAILS:
            raise ValueError(f"추가 수신자는 최대 {MAX_NOTIFY_EMAILS}명까지 등록할 수 있습니다")
        return cleaned

    @field_validator("kakao_number")
    @classmethod
    def _norm_kakao(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        digits = re.sub(r"\D", "", v)
        if len(digits) == 11 and digits.startswith("010"):
            return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
        if len(digits) == 10 and digits.startswith("010"):
            return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
        # 길이가 안 맞으면 그대로 둔다 (사용자 의도 보존). 422는 채널 게이팅에서만.
        return v.strip()

    @field_validator("slack_webhook")
    @classmethod
    def _validate_slack(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        v = v.strip()
        if not v.startswith("https://hooks.slack.com/"):
            raise ValueError("Slack 웹훅 URL은 https://hooks.slack.com/ 으로 시작해야 합니다")
        return v

    @field_validator("sheet_url")
    @classmethod
    def _validate_sheet(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        v = v.strip()
        if not v.startswith("https://docs.google.com/spreadsheets/"):
            raise ValueError(
                "구글시트 URL은 https://docs.google.com/spreadsheets/ 으로 시작해야 합니다"
            )
        return v


# ─────────────────────────── 플랜 게이팅 ───────────────────────────

# 채널 → 최소 플랜 (높을수록 상위)
CHANNEL_MIN_PLAN: dict[str, list[str]] = {
    "email_alerts":       ["free", "basic", "pro", "enterprise"],
    "sheet_sync":         ["basic", "pro", "enterprise"],
    "kakao_number":       ["pro", "enterprise"],
    "slack_webhook":      ["enterprise"],
}


def _available_channels(plan: str) -> list[str]:
    plan_lc = (plan or "free").lower()
    return [k for k, allowed in CHANNEL_MIN_PLAN.items() if plan_lc in allowed]


def _verify_slot_label(slot: int) -> str:
    return f"매일 {slot:02d}:00 (KST)"


def _to_out(user: User) -> SettingsOut:
    return SettingsOut(
        email_alerts=user.email_alerts,
        email_address=user.email,
        notify_emails=_parse_notify_emails(getattr(user, "notify_emails", None)),
        kakao_number=user.kakao_number,
        slack_webhook=user.slack_webhook,
        sheet_url=user.sheet_url,
        sheet_sync_enabled=user.sheet_sync_enabled,
        verify_slot=user.verify_slot,
        verify_slot_label=_verify_slot_label(user.verify_slot),
        plan=user.plan,
        available_channels=_available_channels(user.plan),
    )


# ─────────────────────────── 라우트 ───────────────────────────


@router.get("", response_model=SettingsOut)
async def get_settings(
    user: User = Depends(get_current_user),
) -> SettingsOut:
    """현재 사용자 설정 조회."""
    return _to_out(user)


@router.patch("", response_model=SettingsOut)
async def update_settings(
    patch: SettingsPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SettingsOut:
    """현재 사용자 설정 부분 업데이트.

    플랜 게이팅: 사용자의 plan 으로 허용되지 않은 채널을 활성화하려고 하면 422.
    """
    available = set(_available_channels(user.plan))

    # — 플랜 게이팅 검증 —
    if patch.kakao_number and "kakao_number" not in available:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"kakao_number 는 Pro 플랜 이상에서만 사용 가능합니다 (현재 {user.plan})",
        )
    if patch.slack_webhook and "slack_webhook" not in available:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"slack_webhook 은 Enterprise 플랜에서만 사용 가능합니다 (현재 {user.plan})",
        )
    if (
        (patch.sheet_url or patch.sheet_sync_enabled is True)
        and "sheet_sync" not in available
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"구글시트 연동은 Basic 플랜 이상에서만 사용 가능합니다 (현재 {user.plan})",
        )

    # — 부분 업데이트 (model_dump(exclude_unset=True) 로 보낸 필드만) —
    payload = patch.model_dump(exclude_unset=True)
    for key, value in payload.items():
        # 빈 문자열은 None 으로 정규화 (kakao_number/slack_webhook/sheet_url)
        if value == "":
            value = None
        # notify_emails 는 list[str] → 콤마 구분 문자열로 직렬화
        if key == "notify_emails":
            if value is None or len(value) == 0:
                value = None
            else:
                value = ", ".join(value)
        setattr(user, key, value)

    user.updated_at = now_kst()
    await db.commit()
    await db.refresh(user)
    return _to_out(user)
