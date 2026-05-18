"""인증/가입 스키마."""
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


# ─────────── 공통 User 출력 ───────────

class UserOut(BaseModel):
    id: int
    # 응답 시 EmailStr 사용 X — Google이 이미 검증한 값이고
    # 개발 환경의 .local TLD 등도 통과시켜야 함
    email: str
    username: str | None = None              # 직접가입 사용자만 보유
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
    is_superadmin: bool = False
    is_active: bool = True
    # 외부 공개 데모 게스트 세션 여부 — 프론트가 배너/가드 표시에 사용
    is_demo: bool = False
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


# ─────────── 비밀번호 로그인 (어드민/직접가입) ───────────

class PasswordLoginRequest(BaseModel):
    """이메일 또는 아이디 + 비밀번호 로그인.

    `email` 필드는 호환성 위해 그대로 두되, 내부에서는 이메일/아이디 둘 다 허용.
    """
    email: str = Field(..., min_length=3, max_length=255, description="이메일 또는 아이디")
    password: str = Field(..., min_length=4, max_length=200)


# ─────────── 외부 공개 데모 로그인 ───────────

class DemoLoginRequest(BaseModel):
    """`/demo?t=...` 링크의 t 토큰을 백엔드 DEMO_ACCESS_TOKEN 과 대조.

    토큰 일치 시 미리 시드된 demo_guest 계정의 JWT 발급.
    데모 계정은 is_demo=True 라서 모든 mutation 가드(block_if_demo)에 막힘.
    """
    token: str = Field(..., min_length=1, max_length=200)


class DemoLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class PasswordLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ─────────── 직접 회원가입 (아이디/비밀번호) ───────────

class SignupAgreementsIn(BaseModel):
    privacy: bool = Field(..., description="개인정보 수집·이용 동의 (필수)")
    terms: bool = Field(..., description="서비스 이용약관 동의 (필수)")
    marketing: bool = Field(default=False, description="마케팅 정보 수신 동의 (선택)")


class SignupRequest(BaseModel):
    """직접 회원가입 — 아이디/비밀번호 + 이메일/이름/회사/휴대폰."""
    username: str = Field(..., min_length=4, max_length=30, description="아이디 (4~30자 영문/숫자/_.)")
    password: str = Field(..., min_length=8, max_length=200, description="비밀번호 (8자 이상)")
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=120)
    phone: str = Field(..., min_length=9, max_length=20, description="010-XXXX-XXXX")
    company: str = Field(..., min_length=1, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    agreements: SignupAgreementsIn


class SignupResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ─────────── 가입 전 중복 확인 (휴대폰/이메일) ───────────

class CheckDuplicateRequest(BaseModel):
    """가입 전 휴대폰/이메일 중복 여부 확인.

    `field`:
      - "phone": value 는 010-XXXX-XXXX / 01012345678 / 10-1234-5678 / 1012345678 등 모든 형식 허용
      - "email": value 는 이메일 형식
    """
    field: str = Field(..., description="'phone' 또는 'email'")
    value: str = Field(..., min_length=1, max_length=255)


class CheckDuplicateResponse(BaseModel):
    field: str                # "phone" 또는 "email"
    value_normalized: str     # 정규화된 값 (예: 010-1234-5678 / lowercased email)
    available: bool           # True = 사용 가능, False = 이미 가입됨
    message: str              # UI 표시용 한국어 메시지
    valid_format: bool = True # 형식 유효성 (False 면 정규식 통과 실패)


# ─────────── 아이디/비밀번호 찾기 ───────────

class ForgotIdRequest(BaseModel):
    """가입 시 등록한 이메일로 아이디 안내."""
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    """이메일로 비밀번호 재설정 링크 발송.

    아이디(username) 또는 이메일(email) 중 하나는 반드시 보내야 한다.
    """
    username: str | None = Field(default=None, max_length=60)
    email: EmailStr | None = None


class ResetPasswordRequest(BaseModel):
    """이메일 링크로 받은 토큰 + 새 비밀번호."""
    token: str = Field(..., min_length=20, max_length=120)
    new_password: str = Field(..., min_length=8, max_length=200)


class ResetPasswordVerifyResponse(BaseModel):
    """토큰 유효성 사전 확인 응답."""
    valid: bool
    email_masked: str | None = None  # ex: "ce***@femayeon.com"


# ─────────── 검증 시각 변경 ───────────

class VerifySlotUpdateRequest(BaseModel):
    """매일 자동 검증되는 시각(0~23시) 변경."""
    verify_slot: int = Field(..., ge=0, le=23, description="0~23시(KST)")


class VerifySlotUpdateResponse(BaseModel):
    user: UserOut
    next_run_at: datetime  # KST 기준 다음 실행 시각


# ─────────── 본인 프로필 수정 ───────────

class MyProfileUpdateRequest(BaseModel):
    """로그인 사용자 본인이 직접 수정 가능한 프로필 필드.
    전부 optional — 보낸 필드만 갱신.
    이메일은 unique 제약 + 형식 검사. 회사명/직함은 빈값 허용(null 저장).
    """
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    company: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)


class MyProfileUpdateResponse(BaseModel):
    user: UserOut
