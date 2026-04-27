"""User 모델."""
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    picture: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # OAuth
    google_sub: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)

    # 플랜: free / basic / pro / enterprise
    plan: Mapped[str] = mapped_column(String(20), default="free", nullable=False)
    quota_places: Mapped[int] = mapped_column(Integer, default=5, nullable=False)

    # 구글시트 연동
    sheet_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sheet_sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 알림 설정
    email_alerts: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    kakao_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    slack_webhook: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 타임스탬프
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} plan={self.plan}>"
