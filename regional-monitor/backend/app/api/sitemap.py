"""
사이트맵 / RSS 자동 생성 라우트
================================
공개 페이지 목록을 백엔드에서 관리하여 콘텐츠 추가/변경 시 자동으로
sitemap.xml, rss.xml을 갱신한다.

라우트:
  GET /api/v1/seo/sitemap.xml   → text/xml (sitemap.org 0.9 spec)
  GET /api/v1/seo/rss.xml       → application/rss+xml (RSS 2.0)
  GET /api/v1/seo/routes        → JSON (관리자 점검용)

nginx 측에서 다음 경로를 백엔드로 프록시한다:
  /sitemap.xml  →  /api/v1/seo/sitemap.xml
  /rss.xml      →  /api/v1/seo/rss.xml

콘텐츠 추가 시 SITE_ROUTES 리스트에 항목을 추가하기만 하면 즉시 반영.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Literal, Optional
from xml.sax.saxutils import escape

from fastapi import APIRouter
from fastapi.responses import Response


# ──────────────────────────────────────────────────────────
# 사이트 메타
# ──────────────────────────────────────────────────────────
SITE_BASE_URL = "https://taziyuk.com"
SITE_TITLE = "타지역닷컴 — 타지역서비스 네이버 노출 솔루션"
SITE_DESCRIPTION = (
    "타지역서비스(070 가상번호) 사장님을 위한 네이버 1페이지 노출 키워드 발굴, "
    "지역 경쟁도 분석, 24시간 노출 자동 체크 4종 솔루션. "
    "1,875개 등록 업체·508,854개 회선 데이터 기반 분석."
)
SITE_LANGUAGE = "ko-KR"
SITE_OG_IMAGE = "https://taziyuk.com/og-thumbnail.png"
SITE_AUTHOR_NAME = "타지역닷컴"
SITE_AUTHOR_EMAIL = "contact@taziyuk.com"

KST = timezone(timedelta(hours=9))


# ──────────────────────────────────────────────────────────
# 공개 라우트 정의
# ──────────────────────────────────────────────────────────
ChangeFreq = Literal[
    "always", "hourly", "daily", "weekly", "monthly", "yearly", "never"
]


class Route:
    """공개 라우트 메타. 사이트맵·RSS 모두에 사용."""

    def __init__(
        self,
        path: str,
        title: str,
        description: str,
        priority: float = 0.7,
        changefreq: ChangeFreq = "weekly",
        category: Optional[str] = None,
        image: Optional[str] = None,
        image_caption: Optional[str] = None,
        # RSS 게시 일자 (KST). 없으면 build 시각 사용.
        pub_date: Optional[datetime] = None,
        # 사이트맵에는 노출, RSS에는 노출 안 함 (전체 인덱스용)
        in_rss: bool = True,
    ):
        self.path = path
        self.title = title
        self.description = description
        self.priority = priority
        self.changefreq = changefreq
        self.category = category or "타지역닷컴"
        self.image = image
        self.image_caption = image_caption
        self.pub_date = pub_date
        self.in_rss = in_rss

    @property
    def loc(self) -> str:
        return f"{SITE_BASE_URL}{self.path}"


SITE_ROUTES: list[Route] = [
    Route(
        path="/",
        title="타지역서비스 네이버 노출 자동 체크 및 1페이지 노출 최적화 솔루션 — 타지역닷컴",
        description=(
            "등록하신 타지역서비스의 네이버 노출 상태를 매일 자동으로 점검하고, "
            "1페이지 노출에 효과적인 키워드를 데이터 기반으로 발굴해드립니다. "
            "1,875개 등록 업체와 508,854개 회선 데이터로 검증된 4종 솔루션."
        ),
        priority=1.0,
        changefreq="daily",
        category="홈",
        image=SITE_OG_IMAGE,
        image_caption="타지역서비스(070 가상번호) 사장님을 위한 네이버 플레이스 24시간 자동 모니터링 솔루션",
    ),
    Route(
        path="/intro",
        title='타지역 4종 솔루션 소개 — "똑같이 등록했는데 왜 우리만 안 뜰까?"',
        description=(
            "발굴 → 분석 → 진입 → 유지로 이어지는 4종 통합 솔루션. "
            "키워드 DNA 파싱, 1페이지 노출 키워드 발굴, 지역별 경쟁도 분석, 노출 관리 자동 체크."
        ),
        priority=0.9,
        changefreq="weekly",
        category="솔루션 소개",
    ),
    # ── 4대 솔루션 인트로 ──
    Route(
        path="/intro/keyword-dna",
        title="타지역 키워드 DNA 파싱 솔루션 — 상호명을 6대 DNA로 1초 만에 분해",
        description=(
            "1,875개 등록 업체와 50만 건의 데이터를 바탕으로, "
            "상호명을 MAIN/ACTION/MATERIAL/PLACE/BRAND/TAG 6개 DNA로 분해. "
            "시드 250개 + 자동 학습으로 3,574개 키워드 사전 구축. 평균 응답 130ms."
        ),
        priority=0.85,
        changefreq="weekly",
        category="키워드 DNA",
    ),
    Route(
        path="/intro/keyword-discover",
        title="네이버 1페이지 노출 키워드 발굴 솔루션 — 검색량만 보고 골랐는데 왜 안 뜨지?",
        description=(
            "508,854개 등록 업체로 검증된 청정 황금 키워드 자동 발굴 엔진. "
            "시드 키워드 1개 → 12~50개 후보 + 4단계 경쟁도(청정/경쟁/과열/포화) 자동 분류."
        ),
        priority=0.85,
        changefreq="weekly",
        category="1페이지 노출 키워드",
    ),
    Route(
        path="/intro/competition",
        title="지역별 노출 경쟁도 분석 솔루션 — 동(洞)별 진입 우선순위를 데이터로",
        description=(
            "네이버 지도 섹션을 동 단위로 분석하여 청정·경쟁·과열·포화 4단계 등급으로 "
            "진입 우선순위를 결정. Fast 모드 5~30초, Precise 모드 30초~5분."
        ),
        priority=0.85,
        changefreq="weekly",
        category="지역 경쟁도",
    ),
    Route(
        path="/intro/monitor",
        title="네이버 노출 관리 자동 체크 솔루션 — 24시간 노출 보초병",
        description=(
            "070 번호 등록 → Place ID·등록 동·상호명 자동 추출 → 매일 1회 자동 4중 검증. "
            "변동 감지 즉시 이메일·카카오 알림. 사라진 노출 사이의 매출을 다시 잡아드립니다."
        ),
        priority=0.85,
        changefreq="weekly",
        category="노출 자동 체크",
    ),
    # ── About 4개 ──
    Route(
        path="/about/what-is",
        title="타지역서비스란 무엇인가? — 네이버플레이스 확장 전략 가이드",
        description=(
            "타지역서비스의 정의, 070 가상번호의 역할, 네이버 플레이스 노출 원리, "
            "사장님이 알아야 할 핵심 개념을 사례와 함께 정리한 입문 가이드."
        ),
        priority=0.7,
        changefreq="monthly",
        category="가이드",
    ),
    Route(
        path="/about/essential-categories",
        title="타지역 필수업종 — 회선 수 기준 시장 규모 정렬",
        description=(
            "타지역서비스 운영이 필수/유효한 업종 리스트를 회선 수 기준 시장 규모 순으로 정렬. "
            "업종별 회선 수, 진입 난이도, 평균 노출 비율 등 의사결정 지표 제공."
        ),
        priority=0.7,
        changefreq="weekly",
        category="가이드",
    ),
    Route(
        path="/about/keyword-logic",
        title="타지역 키워드 로직 — 네이버 1페이지 노출의 메커니즘",
        description=(
            "네이버가 어떤 기준으로 1페이지에 어떤 업체를 노출시키는지, "
            "30자 상호 키워드 분절·매칭·070 룰·주소 룰 등 핵심 로직을 데이터로 풀어낸 분석."
        ),
        priority=0.7,
        changefreq="monthly",
        category="가이드",
    ),
    Route(
        path="/about/exposure-management",
        title="타지역 노출 관리 — 등록보다 유지가 어려운 이유와 대응법",
        description=(
            "네이버 노출은 등록보다 유지가 어렵습니다. 노출이 갑자기 빠지는 7가지 원인, "
            "자동 체크의 필요성, 24시간 모니터링으로 매출을 지키는 방법."
        ),
        priority=0.7,
        changefreq="monthly",
        category="가이드",
    ),
]


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────
def _today_iso() -> str:
    return datetime.now(KST).date().isoformat()


def _rfc822(dt: datetime) -> str:
    """RSS 2.0 RFC-822 형식 (예: 'Sat, 02 May 2026 00:00:00 +0900')."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=KST)
    return dt.strftime("%a, %d %b %Y %H:%M:%S %z")


def _xml(tag: str, value: str, indent: str = "    ") -> str:
    return f"{indent}<{tag}>{escape(value)}</{tag}>"


# ──────────────────────────────────────────────────────────
# Builders
# ──────────────────────────────────────────────────────────
def build_sitemap_xml() -> str:
    today = _today_iso()
    parts: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        f"  <!-- 자동 생성: {datetime.now(KST).isoformat(timespec='seconds')} -->",
    ]
    for r in SITE_ROUTES:
        parts.append("  <url>")
        parts.append(f"    <loc>{escape(r.loc)}</loc>")
        parts.append(f"    <lastmod>{today}</lastmod>")
        parts.append(f"    <changefreq>{r.changefreq}</changefreq>")
        parts.append(f"    <priority>{r.priority:.1f}</priority>")
        if r.image:
            parts.append("    <image:image>")
            parts.append(f"      <image:loc>{escape(r.image)}</image:loc>")
            parts.append(f"      <image:title>{escape(r.title)}</image:title>")
            if r.image_caption:
                parts.append(
                    f"      <image:caption>{escape(r.image_caption)}</image:caption>"
                )
            parts.append("    </image:image>")
        parts.append("  </url>")
    parts.append("</urlset>")
    return "\n".join(parts) + "\n"


def build_rss_xml() -> str:
    now = datetime.now(KST)
    parts: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0"',
        '     xmlns:content="http://purl.org/rss/1.0/modules/content/"',
        '     xmlns:atom="http://www.w3.org/2005/Atom"',
        '     xmlns:dc="http://purl.org/dc/elements/1.1/">',
        "  <channel>",
        _xml("title", SITE_TITLE, indent="    "),
        f'    <link>{escape(SITE_BASE_URL + "/")}</link>',
        f'    <atom:link href="{escape(SITE_BASE_URL + "/rss.xml")}" rel="self" type="application/rss+xml" />',
        _xml("description", SITE_DESCRIPTION, indent="    "),
        _xml("language", SITE_LANGUAGE, indent="    "),
        "    <copyright>Copyright © 2026 타지역닷컴. All rights reserved.</copyright>",
        f"    <managingEditor>{SITE_AUTHOR_EMAIL} ({SITE_AUTHOR_NAME})</managingEditor>",
        f"    <webMaster>{SITE_AUTHOR_EMAIL} ({SITE_AUTHOR_NAME})</webMaster>",
        f"    <pubDate>{_rfc822(now)}</pubDate>",
        f"    <lastBuildDate>{_rfc822(now)}</lastBuildDate>",
        "    <category>네이버 플레이스</category>",
        "    <category>타지역서비스</category>",
        "    <category>SEO</category>",
        "    <generator>taziyuk.com FastAPI sitemap-generator</generator>",
        "    <ttl>1440</ttl>",
        # RSS 2.0 image 태그: width 1~144, height 1~400 제한 준수
        # (OG 이미지 원본은 1200x630이지만 RSS image는 표준 범위로 축소 신고)
        "    <image>",
        f"      <url>{escape(SITE_OG_IMAGE)}</url>",
        _xml("title", SITE_TITLE, indent="      "),
        f'      <link>{escape(SITE_BASE_URL + "/")}</link>',
        "      <width>144</width>",
        "      <height>76</height>",
        "      <description>타지역서비스 네이버 노출 자동체크 솔루션 - 타지역닷컴</description>",
        "    </image>",
    ]
    for r in SITE_ROUTES:
        if not r.in_rss:
            continue
        pub = _rfc822(r.pub_date or now)
        parts.append("    <item>")
        parts.append(_xml("title", r.title, indent="      "))
        parts.append(f"      <link>{escape(r.loc)}</link>")
        parts.append(f'      <guid isPermaLink="true">{escape(r.loc)}</guid>')
        parts.append(
            f"      <description><![CDATA[{r.description}]]></description>"
        )
        parts.append(_xml("category", r.category, indent="      "))
        parts.append(f"      <pubDate>{pub}</pubDate>")
        parts.append(f"      <dc:creator>{SITE_AUTHOR_NAME}</dc:creator>")
        parts.append("    </item>")
    parts.append("  </channel>")
    parts.append("</rss>")
    return "\n".join(parts) + "\n"


# ──────────────────────────────────────────────────────────
# Router
# ──────────────────────────────────────────────────────────
router = APIRouter(prefix="/seo", tags=["seo"])


@router.api_route(
    "/sitemap.xml",
    methods=["GET", "HEAD"],
    response_class=Response,
    summary="동적 생성 사이트맵 (sitemap.org 0.9) — GET/HEAD 모두 허용",
)
async def sitemap_xml() -> Response:
    body = build_sitemap_xml()
    return Response(
        content=body,
        media_type="application/xml; charset=utf-8",
        headers={
            # 검색엔진은 자주 가져가도 부담 없도록 1시간 캐시
            "Cache-Control": "public, max-age=3600",
            "X-Generated-At": datetime.now(KST).isoformat(timespec="seconds"),
        },
    )


@router.api_route(
    "/rss.xml",
    methods=["GET", "HEAD"],
    response_class=Response,
    summary="동적 생성 RSS 피드 (RSS 2.0) — GET/HEAD 모두 허용",
)
async def rss_xml() -> Response:
    body = build_rss_xml()
    return Response(
        content=body,
        media_type="application/rss+xml; charset=utf-8",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-Generated-At": datetime.now(KST).isoformat(timespec="seconds"),
        },
    )


@router.get(
    "/routes",
    summary="등록된 공개 라우트 목록 (관리자 점검용)",
)
async def list_routes() -> dict:
    return {
        "base_url": SITE_BASE_URL,
        "count": len(SITE_ROUTES),
        "routes": [
            {
                "path": r.path,
                "loc": r.loc,
                "title": r.title,
                "priority": r.priority,
                "changefreq": r.changefreq,
                "category": r.category,
                "in_rss": r.in_rss,
            }
            for r in SITE_ROUTES
        ],
    }
