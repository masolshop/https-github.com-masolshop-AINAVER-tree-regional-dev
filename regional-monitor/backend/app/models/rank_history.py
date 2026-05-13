"""PlaceRankHistory 모델 — 동별 키워드 순위 일별 이력 (솔루션 #5).

매일 자동체크(운영자 트리거 또는 향후 스케줄러)가 등록된 (place, dong, keyword)
조합으로 네이버 지도 검색 → 사장님 업체의 현재 노출 순위(1~75위)를 기록한다.

UNIQUE(place_pk, check_date, keyword) — 같은 날 같은 키워드 중복 방지.
"""
from __future__ import annotations

from datetime import datetime, date

from app.core.time_utils import now_kst, KSTDateTime
from sqlalchemy import String, Integer, Boolean, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PlaceRankHistory(Base):
    __tablename__ = "place_rank_history"
    __table_args__ = (
        UniqueConstraint("place_pk", "check_date", "keyword", name="uq_rank_place_date_keyword"),
        Index("ix_rank_history_place_date", "place_pk", "check_date"),
        Index("ix_rank_history_keyword_date", "keyword", "check_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    place_pk: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("registered_places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # KST 기준 체크 날짜
    check_date: Mapped[date] = mapped_column(Date, nullable=False)
    # 추적 키워드 (예: "흥신소")
    keyword: Mapped[str] = mapped_column(String(100), nullable=False)
    # 검색 시 사용한 동/리 (예: "압구정동")
    dong: Mapped[str] = mapped_column(String(120), nullable=False)

    # 순위 1~75, NULL이면 75위 밖 (out_of_range=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 해당 검색의 totalCount (네이버 응답값)
    total_results: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 75위 밖 여부
    out_of_range: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 전일 대비 변동(음수=상승, 양수=하락, 0=동일, None=비교 불가)
    rank_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    checked_at: Mapped[datetime] = mapped_column(
        KSTDateTime, default=now_kst, nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<PlaceRankHistory place_pk={self.place_pk} "
            f"date={self.check_date} keyword={self.keyword!r} rank={self.rank}>"
        )
