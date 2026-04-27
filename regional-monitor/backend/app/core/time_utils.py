"""한국 시간(KST, UTC+9) 강제 시간 유틸리티.

전체 시스템에서 시간을 다룰 때 반드시 이 모듈을 통해야 함.
- DB 저장: timezone-aware KST datetime (offset +09:00)
- API 응답: ISO 8601 with +09:00 offset
- 비교 연산: 모두 KST 기준

원칙:
  ❌ datetime.utcnow()                # 절대 금지 (naive UTC)
  ❌ datetime.now()                    # 절대 금지 (서버 OS TZ 의존)
  ✅ now_kst()                         # 권장 (timezone-aware KST)
  ✅ to_kst(dt)                        # naive/aware → KST aware 변환
  ✅ KSTDateTime                       # SQLAlchemy 컬럼 타입 (자동 KST aware)
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator

# ─── 표준 KST 타임존 객체 ───
KST = timezone(timedelta(hours=9), name="KST")


def now_kst() -> datetime:
    """현재 한국 시각 (timezone-aware, +09:00).

    DB INSERT default 와 모든 시간 기록에 사용.
    """
    return datetime.now(KST)


def to_kst(dt: datetime | None) -> datetime | None:
    """임의 datetime 을 KST aware 로 변환.

    - None → None
    - naive (tz=None) → "이미 UTC 인 값"으로 가정하고 KST 로 변환
    - aware → KST 로 변환
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        # 과거 데이터(naive UTC) 호환: UTC 로 간주 후 KST 변환
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(KST)


def kst_iso(dt: datetime | None) -> str | None:
    """datetime → KST ISO 문자열 (e.g. '2026-04-27T18:30:00+09:00').

    Pydantic 응답 등 외부 노출용.
    """
    if dt is None:
        return None
    return to_kst(dt).isoformat()


def kst_strftime(dt: datetime | None, fmt: str = "%Y-%m-%d %H:%M:%S") -> str | None:
    """datetime → KST 포맷 문자열 (메일·알림·로그용)."""
    if dt is None:
        return None
    return to_kst(dt).strftime(fmt)


# ─── 호환성 alias ───────────────
# 기존 코드가 datetime.utcnow() 패턴이면 이 함수로 점진적 교체.
# 새 데이터는 KST aware 로 저장되지만, 비교 시 to_kst 로 정규화하면 안전.
def utcnow_compat() -> datetime:
    """레거시 호환용 — 새 코드는 now_kst() 직접 사용."""
    return now_kst()


# ─── SQLAlchemy 컬럼 타입 ───────────────
class KSTDateTime(TypeDecorator):
    """모든 datetime 을 KST timezone-aware 로 직렬화/역직렬화.

    - INSERT 시: aware datetime 그대로 (naive 면 UTC 로 가정 후 KST 변환)
    - SELECT 시: SQLite/PostgreSQL 모두 KST aware datetime 반환

    SQLite 은 timezone 정보를 저장하지 않으므로,
    저장 직전 UTC 로 정규화 → 읽을 때 다시 KST aware 로 변환.
    PostgreSQL TIMESTAMPTZ 컬럼이면 timezone=True 가 그대로 동작.
    """
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):  # noqa: ANN001
        """저장 직전 — naive 든 aware 든 UTC naive 로 정규화."""
        if value is None:
            return None
        if value.tzinfo is None:
            # 과거 코드 호환: naive 면 KST 라고 가정 (지금 코드는 모두 aware)
            value = value.replace(tzinfo=KST)
        # SQLite 호환: UTC naive 로 저장
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):  # noqa: ANN001
        """읽을 때 — UTC naive → KST aware."""
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(KST)
