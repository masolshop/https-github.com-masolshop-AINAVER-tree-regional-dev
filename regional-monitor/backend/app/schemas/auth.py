"""인증/가입 스키마."""
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


# ─────────── 공통 User 출력 ───────────

class UserOut(BaseModel):
    id: int
    # 응답 시 EmailStr 사용 X — Google이 이미 검증한 값이고
    # 개발 환경의 .local TLD 등도 통과시켜야 함
    email: str
    name: str
    picture: str | None = None
    phone: str | None = None
    company: str | None = None
    job_title: str | None = None
    plan: str
    quota_places: int
    is_profile_complete: bool
    agreed_marketing: bool
    verify_slot: int = 0           # 0~23, 매일 자동 검증되는 시각(시)
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────── 1단계: Google 로그인 ───────────

class GoogleLoginRequest(BaseModel):
    """프론트에서 Google Identity Services로 받은 ID 토큰을 그대로 전달."""
    id_token: str = Field(..., min_length=20)


class GoogleLoginResponse(BaseModel):
    access_token: str               # 우리 서비스 JWT
    token_type: str = "bearer"
    user: UserOut
    needs_profile: bool             # True면 프론트가 추가정보 모달 띄움


# ─────────── 2단계: 추가정보 + 약관 ───────────

class AgreementsIn(BaseModel):
    privacy: bool = Field(..., description="개인정보 수집·이용 동의 (필수)")
    terms: bool = Field(..., description="서비스 이용약관 동의 (필수)")
    marketing: bool = Field(default=False, description="마케팅 정보 수신 동의 (선택)")


class ProfileCompleteRequest(BaseModel):
    """가입 2단계 — 추가정보 + 약관 동의 한 번에."""
    name: str = Field(..., min_length=1, max_length=120)
    phone: str = Field(..., min_length=9, max_length=20, description="010-XXXX-XXXX 형식")
    company: str = Field(..., min_length=1, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    agreements: AgreementsIn


class MeResponse(BaseModel):
    user: UserOut
