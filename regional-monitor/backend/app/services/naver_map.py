"""
네이버 지도 모바일 플레이스 (m.place.naver.com) 검색 결과 파서.

[2026-05-16 모바일 라우트 전환 — PoC mobile-final 검증 완료]
이전 PC SPA (map.naver.com/p/search/) → pcmap iframe → __APOLLO_STATE__ 경로는
작동했지만 다음 단점이 있었다:
  · iframe 등장 대기 + 진입 비용 → 쿼리당 5~7초
  · place_id 추출이 Apollo `__ref` cross-resolve 에 의존 → fragile
  · "강남역 맛집" 같은 큰 로컬 키워드는 iframe 으로 라우팅되지 않아 실패

모바일 라우트 `https://m.place.naver.com/place/list?query=...` 가:
  · iframe 없이 직접 `li.VLTHu` 렌더 → place_id 가 `<a href=".../place/{ID}...">` 로 노출
  · 첫 페이지에 ~100건 prefetch → 별도 스크롤 불필요
  · 쿼리당 2.0~3.3초 (PC 대비 2배 빠름)
  · 5/5 query 검증 완료 (압구정 흥신소, 신사 하수구막힘, 역삼 줄눈, 청담 입주청소, 삼성 심부름센터)

타지역 키워드 ("<지역> <서비스업>") 만 다루는 우리 도메인에 모바일 라우트가 최적.

[수집 정책 — 사용자 확정 2026-05-16]
- 우리 서비스는 **타지역 키워드**(예: "압구정동 흥신소", "신사동 하수구막힘")만 다룬다.
- **상위 20위 까지만** 의미가 있다. 21위 밖은 "순위권 없음" 으로 통일.
- 한 번의 페이지 로드로 100건 prefetch → 페이지네이션 불필요.

[추출 알고리즘]
1. `https://m.place.naver.com/place/list?query={query}` 페이지 로드 (모바일 UA).
2. `li.VLTHu` 등장 대기.
3. 각 `li` 에서 추출:
   - place_id: 내부 a[href] 에서 /place/{ID}, /restaurant/{ID}, /hairshop/{ID} 정규식 추출.
   - name: 첫 줄 (단, 첫 줄이 "광고" 라면 두 번째 줄).
   - is_ad: `li.innerText` 에 "광고" 문자열 존재 여부.
4. 광고 제외 organic 결과의 DOM 순서가 곧 랭킹. 상위 20 까지만 반환.

[브라우저 lifecycle]
- 워커마다 새 브라우저를 띄우면 cold-start (~2초) 비용이 커지므로,
  프로세스 전역 singleton 브라우저 + 호출당 새 context 를 쓴다.
- 컨텍스트는 호출 단위로 닫아 쿠키/캐시 누적 → bot detection 위험을 회피.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# 정책 상수 — 사용자 확정 (2026-05-16)
# ─────────────────────────────────────────────────────────────────────────────
TOP_N = 20  # 상위 N위까지만 수집. 21위 이하는 "순위권 없음" 으로 통일.

# Playwright 호출 타임아웃
NAV_TIMEOUT_MS = 20_000  # page.goto 타임아웃 (ms) — 모바일은 PC 보다 가벼움
LI_WAIT_MS = 10_000  # li.VLTHu 첫 등장 대기 (ms)

# ─────────────────────────────────────────────────────────────────────────────
# 회로차단 정책 (2026-05-16 — 민감도 완화)
# ─────────────────────────────────────────────────────────────────────────────
# 배경
#   이전 구현은 모든 에러를 단일 카운터로 누적 → 연속 5회면 OPEN. 그런데
#   실제로 카운트되는 "실패" 의 대부분은 진짜 네이버 차단(429/403) 이 아니라
#   Playwright 렌더링 일시 실패였다:
#     · goto: TimeoutError       — 20초 안에 domcontentloaded 못 받음 (네트워크 지연)
#     · no_list_items: ...       — li.VLTHu 셀렉터 10초 내 안 뜸 (SPA 느림/RAM 부족)
#     · dom_extract: ...         — page.evaluate 예외 (JS 일시 오류)
#     · empty_items              — DOM 은 떴는데 li 가 0개 (진짜 0건 결과일 수도)
#     · crash: ...               — Playwright 자체 크래시
#
#   이런 약한 신호들이 5번 연속이면 OPEN 된 뒤 120초 동안 모든 호출 단락 →
#   사용자가 "네이버 차단" 으로 오해. 실제로는 차단이 아닌데도.
#
# 새 정책
#   에러를 두 그룹으로 나누고 별도 카운터:
#     · STRONG  : 진짜 차단 의심 신호 (HTTP 429/403/5xx — 현재 미구현, 향후 확장)
#                 임계치 3, 단발 발생만으로도 OPEN 으로 빠르게 진입.
#     · WEAK    : 위의 렌더링/타임아웃/empty 류
#                 임계치 12 + 윈도 60초.
#                 즉 "최근 60초 내에 약한 실패가 연속 12회" 가 되어야 OPEN.
#                 띄엄띄엄 실패하거나, 사이에 1건이라도 성공하면 카운터 리셋.
#   on_success 가 한 번이라도 호출되면 두 카운터 모두 즉시 0 으로.
CB_STRONG_THRESHOLD = 3            # 강한 신호: 연속 3회면 즉시 OPEN
CB_WEAK_THRESHOLD = 12             # 약한 신호: 연속 12회 + 윈도 내일 때만 OPEN
CB_WEAK_WINDOW_SEC = 60.0          # 약한 신호의 연속성 윈도
CB_COOLDOWN_SEC = 120              # OPEN 유지 시간 (그대로)

# 약한(weak) 에러 prefix 화이트리스트. 이 prefix 로 시작하는 res.error 는
# 모두 weak 으로 분류. 명시적 strong 이 추가되면 그쪽 prefix 도 정의 예정.
_WEAK_ERROR_PREFIXES = (
    "goto",
    "no_list_items",
    "dom_extract",
    "empty_items",
    "crash",
)


def _classify_error(err: str | None) -> str:
    """error 문자열을 'strong' / 'weak' / 'none' 으로 분류.

    현재 strong 에 해당하는 명시적 패턴은 없음 (HTTP 응답 헤더를 미수집).
    추후 _do_search 에서 429/403 등을 감지하면 'rate_limited' 같은 prefix 로
    표시 → 여기서 strong 으로 분류하면 즉시 빠른 OPEN.
    """
    if not err:
        return "none"
    if err == "naver_unavailable":
        # 이미 OPEN 으로 단락된 호출 — 카운터에 누적하지 않음
        return "none"
    e = err.lower()
    # 향후 strong 후보 (현재 미생산이지만 분류 룰만 미리 정의):
    if (
        e.startswith("rate_limited")
        or e.startswith("http_429")
        or e.startswith("http_403")
        or e.startswith("http_5")
    ):
        return "strong"
    for p in _WEAK_ERROR_PREFIXES:
        if e.startswith(p):
            return "weak"
    # 알 수 없는 에러는 weak 으로 안전하게 분류 (즉시 OPEN 시키지 않음)
    return "weak"


# ─────────────────────────────────────────────────────────────────────────────
# 회로차단기 (이전 외부 인터페이스 유지: state / allow / on_success / on_failure)
# ─────────────────────────────────────────────────────────────────────────────
class _CircuitBreaker:
    """Playwright 호출이 연속 실패할 때 후속 호출을 즉시 단락시키는 회로차단기.

    [2026-05-16] strong/weak 분리 + weak 시간 윈도 적용.
    """

    def __init__(self) -> None:
        self._strong_fail = 0
        self._weak_fail = 0
        self._last_weak_fail_at: float = 0.0
        self._opened_at: float = 0.0
        self._state: str = "CLOSED"  # CLOSED / OPEN / HALF_OPEN
        # 마지막 trip 사유 로깅용
        self._last_open_reason: str = ""

    def allow(self) -> bool:
        if self._state == "CLOSED":
            return True
        if self._state == "OPEN":
            if time.monotonic() - self._opened_at >= CB_COOLDOWN_SEC:
                self._state = "HALF_OPEN"
                return True
            return False
        return False  # HALF_OPEN — 이미 1회 통과 중

    def on_success(self) -> None:
        self._strong_fail = 0
        self._weak_fail = 0
        self._last_weak_fail_at = 0.0
        if self._state in ("OPEN", "HALF_OPEN"):
            log.info("naver_map circuit breaker → CLOSED (recovered)")
        self._state = "CLOSED"
        self._opened_at = 0.0
        self._last_open_reason = ""

    def on_failure(self, *, kind: str = "weak") -> None:
        """실패 1건 누적.

        Args:
          kind: 'strong' / 'weak'. _classify_error 의 출력이 그대로 들어온다.
                'none' 이면 호출자가 미리 걸러내야 한다 (여기서는 weak 로 fallback).
        """
        # HALF_OPEN 단계에서 한 번이라도 실패 → 즉시 OPEN 으로 복귀 (기존 동작 유지)
        if self._state == "HALF_OPEN":
            self._state = "OPEN"
            self._opened_at = time.monotonic()
            self._last_open_reason = f"half-open probe failed ({kind})"
            log.warning("naver_map circuit breaker → OPEN (half-open probe failed, kind=%s)", kind)
            return

        if kind == "strong":
            self._strong_fail += 1
            if self._strong_fail >= CB_STRONG_THRESHOLD and self._state == "CLOSED":
                self._state = "OPEN"
                self._opened_at = time.monotonic()
                self._last_open_reason = (
                    f"strong: {self._strong_fail} consecutive rate-limit/5xx signals"
                )
                log.warning(
                    "naver_map circuit breaker → OPEN (strong, %d consecutive, cooldown=%ds)",
                    self._strong_fail, CB_COOLDOWN_SEC,
                )
            return

        # weak — 시간 윈도 적용: 마지막 weak 실패와 너무 멀리 떨어져 있으면
        # 연속성 리셋. "최근 60초 내 12회 연속" 일 때만 OPEN.
        now = time.monotonic()
        if (
            self._last_weak_fail_at > 0
            and now - self._last_weak_fail_at > CB_WEAK_WINDOW_SEC
        ):
            # 윈도 밖 → 카운터 리셋하고 새로 시작 (현재 실패는 1로 카운트)
            self._weak_fail = 1
        else:
            self._weak_fail += 1
        self._last_weak_fail_at = now

        if self._weak_fail >= CB_WEAK_THRESHOLD and self._state == "CLOSED":
            self._state = "OPEN"
            self._opened_at = now
            self._last_open_reason = (
                f"weak: {self._weak_fail} failures within {CB_WEAK_WINDOW_SEC:.0f}s window"
            )
            log.warning(
                "naver_map circuit breaker → OPEN (weak, %d failures in %.0fs window, cooldown=%ds)",
                self._weak_fail, CB_WEAK_WINDOW_SEC, CB_COOLDOWN_SEC,
            )

    @property
    def state(self) -> str:
        return self._state

    @property
    def last_open_reason(self) -> str:
        return self._last_open_reason


_circuit = _CircuitBreaker()


def is_circuit_open() -> bool:
    """현재 회로차단이 후속 호출을 단락시킬 상태인지 확인.

    [2026-05-16 fix] 단순히 state 만 보면 cooldown 만료 후에도 영원히 OPEN 으로
    노출되는 버그가 있었다 (`_CircuitBreaker.allow()` 는 OPEN→HALF_OPEN 전이를
    내부적으로만 처리하므로, 후속 호출이 없으면 state 가 영원히 "OPEN" 으로 남음).

    프런트엔드 청크 루프가 `progress.naver_circuit_open` 을 폴링해 자동 재개를
    결정하기 때문에, cooldown 이 만료됐다면 즉시 False 를 반환해 자동 재개가
    트리거되도록 한다 (실제 첫 호출이 HALF_OPEN probe 가 됨).
    """
    if _circuit.state != "OPEN":
        return False
    # OPEN 이지만 cooldown 만료 → effectively recoverable.
    if time.monotonic() - _circuit._opened_at >= CB_COOLDOWN_SEC:
        return False
    return True


# ─────────────────────────────────────────────────────────────────────────────
# 데이터 모델 — 외부 API 유지 (caller 호환)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class MapPlace:
    place_id: str
    name: str
    category: str
    phone: str
    virtual_phone: str
    address: str  # 지번 주소
    road_address: str
    latitude: float | None
    longitude: float | None
    # 분류 결과 (classifier 채움)
    is_other_region: bool = False
    sido: str = ""
    sigungu: str = ""
    dong: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "place_id": self.place_id,
            "name": self.name,
            "category": self.category,
            "phone": self.phone,
            "virtual_phone": self.virtual_phone,
            "address": self.address,
            "road_address": self.road_address,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "is_other_region": self.is_other_region,
            "sido": self.sido,
            "sigungu": self.sigungu,
            "dong": self.dong,
        }


@dataclass
class MapSearchResult:
    query: str
    total_count: int
    items: list[MapPlace] = field(default_factory=list)
    error: str | None = None
    elapsed_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "total_count": self.total_count,
            "items": [it.as_dict() for it in self.items],
            "error": self.error,
            "elapsed_ms": self.elapsed_ms,
        }


# ─────────────────────────────────────────────────────────────────────────────
# DOM 추출 JS — m.place.naver.com 페이지 context 안에서 실행
# li.VLTHu 가 DOM 순서로 곧 랭킹 순서. 광고는 li.innerText 에 "광고" 토큰.
# ─────────────────────────────────────────────────────────────────────────────
_EXTRACT_JS = r"""
() => {
    const lis = document.querySelectorAll('li.VLTHu');
    const out = [];
    lis.forEach((li, idx) => {
        // place_id 추출 — /place/{id}, /restaurant/{id}, /hairshop/{id}
        let pid = '';
        const a = li.querySelector('a[href*="/place/"], a[href*="/restaurant/"], a[href*="/hairshop/"]');
        if (a) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/(?:place|restaurant|hairshop)\/(\d+)/);
            if (m) pid = m[1];
        }

        const fullText = (li.innerText || '').trim();
        const isAd = fullText.includes('광고');
        const lines = fullText.split('\n').map(s => s.trim()).filter(Boolean);

        // name: 첫 비어있지 않고 '광고' 가 아닌 줄.
        let name = '';
        for (const ln of lines) {
            if (ln === '광고') continue;
            name = ln;
            break;
        }

        // category: name 다음 줄에서 추론 (간단 휴리스틱). 실패해도 OK.
        let category = '';
        const nameIdx = lines.indexOf(name);
        if (nameIdx >= 0 && nameIdx + 1 < lines.length) {
            category = lines[nameIdx + 1];
        }

        out.push({
            idx,
            id: pid,
            name,
            category,
            isAd,
        });
    });
    return { items: out, total: lis.length };
};
"""


# ─────────────────────────────────────────────────────────────────────────────
# 브라우저 lifecycle — singleton browser per process
# ─────────────────────────────────────────────────────────────────────────────
_pw_instance = None  # async_playwright().__aenter__() 의 반환
_browser = None
_browser_lock = asyncio.Lock()

_BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-gpu",
]
# 모바일 UA + 모바일 viewport 로 m.place.naver.com 의 모바일 레이아웃 진입.
_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 "
    "Mobile/15E148 Safari/604.1"
)
_MOBILE_VIEWPORT = {"width": 390, "height": 844}


async def _get_browser():
    """프로세스 전역 브라우저 인스턴스 (lazy init)."""
    global _pw_instance, _browser
    if _browser is not None and _browser.is_connected():
        return _browser
    async with _browser_lock:
        # double-check after acquiring lock
        if _browser is not None and _browser.is_connected():
            return _browser
        try:
            from playwright.async_api import async_playwright  # noqa: WPS433
        except ImportError as e:
            log.error("playwright import failed — install with `pip install playwright && playwright install chromium`: %s", e)
            raise
        if _pw_instance is None:
            _pw_instance = await async_playwright().start()
        _browser = await _pw_instance.chromium.launch(headless=True, args=_BROWSER_ARGS)
        log.info("naver_map: playwright browser launched (pid=%s)", id(_browser))
        return _browser


async def shutdown_browser() -> None:
    """프로세스 종료 시 호출 (FastAPI lifespan)."""
    global _pw_instance, _browser
    try:
        if _browser is not None:
            await _browser.close()
    except Exception as e:  # noqa: BLE001
        log.warning("browser.close failed: %s", e)
    finally:
        _browser = None
    try:
        if _pw_instance is not None:
            await _pw_instance.stop()
    except Exception as e:  # noqa: BLE001
        log.warning("playwright.stop failed: %s", e)
    finally:
        _pw_instance = None


# ─────────────────────────────────────────────────────────────────────────────
# 본체 — 단일 쿼리 검색
# ─────────────────────────────────────────────────────────────────────────────
def _to_map_place(it: dict) -> MapPlace:
    """DOM extract dict → MapPlace.

    모바일 라우트는 phone/address/좌표를 DOM 에 노출하지 않으므로 빈값으로 둔다.
    rank_checker 는 place_id 매칭만 보고, 나머지 필드는 RegisteredPlace 에서 가져오므로 OK.
    """
    return MapPlace(
        place_id=str(it.get("id") or ""),
        name=str(it.get("name") or ""),
        category=str(it.get("category") or ""),
        phone="",
        virtual_phone="",
        address="",
        road_address="",
        latitude=None,
        longitude=None,
    )


async def _do_search(query: str) -> MapSearchResult:
    """Playwright + 모바일 UA 로 m.place.naver.com 검색 → MapSearchResult."""
    q = (query or "").strip()
    if not q:
        return MapSearchResult(query=q, total_count=0, error="empty query")

    t0 = time.time()
    browser = await _get_browser()
    ctx = await browser.new_context(
        user_agent=_UA,
        viewport=_MOBILE_VIEWPORT,
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        locale="ko-KR",
        timezone_id="Asia/Seoul",
    )
    try:
        page = await ctx.new_page()
        # 자원 절약: 이미지/폰트/미디어 차단 (DOM 텍스트만 필요)
        async def _block(route):
            try:
                rt = route.request.resource_type
                if rt in ("image", "media", "font"):
                    await route.abort()
                else:
                    await route.continue_()
            except Exception:  # noqa: BLE001
                pass
        try:
            await ctx.route("**/*", _block)
        except Exception:  # noqa: BLE001
            pass

        url = f"https://m.place.naver.com/place/list?query={q}"
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        except Exception as e:  # noqa: BLE001
            return MapSearchResult(
                query=q, total_count=0,
                error=f"goto: {type(e).__name__}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        # li.VLTHu 등장 대기 — 모바일은 SSR 로 첫 페이지에 ~100건 prefetch 됨
        try:
            await page.wait_for_selector("li.VLTHu", timeout=LI_WAIT_MS)
        except Exception as e:  # noqa: BLE001
            return MapSearchResult(
                query=q, total_count=0,
                error=f"no_list_items: {type(e).__name__}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        await page.wait_for_timeout(300)

        try:
            data = await page.evaluate(_EXTRACT_JS)
        except Exception as e:  # noqa: BLE001
            return MapSearchResult(
                query=q, total_count=0,
                error=f"dom_extract: {type(e).__name__}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        items_raw = (data or {}).get("items") or []
        if not items_raw:
            return MapSearchResult(
                query=q, total_count=0,
                error="empty_items",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        # 광고 필터 — DOM "광고" 텍스트 마커. organic 만 DOM 순서대로 top N.
        organic: list[MapPlace] = []
        for it in items_raw:
            if it.get("isAd"):
                continue
            if not it.get("id"):
                # place_id 추출 실패한 row 는 매칭 불가하므로 스킵
                continue
            organic.append(_to_map_place(it))
            if len(organic) >= TOP_N:
                break

        elapsed = int((time.time() - t0) * 1000)
        return MapSearchResult(
            query=q,
            total_count=len(organic),
            items=organic,
            elapsed_ms=elapsed,
        )
    finally:
        try:
            await ctx.close()
        except Exception:  # noqa: BLE001
            pass


# ─────────────────────────────────────────────────────────────────────────────
# 공개 API — 이전과 동일 시그니처
# ─────────────────────────────────────────────────────────────────────────────
async def search_map(
    query: str,
    *,
    display: int = TOP_N,  # 호환 인자 — 무시되고 항상 TOP_N(20) 까지만 반환
    client: Any = None,    # 호환 인자 — 무시 (Playwright 는 자체 브라우저 사용)
    timeout: float = 30.0,  # 호환 인자 — 내부 NAV_TIMEOUT_MS 등으로 분기됨
) -> MapSearchResult:
    """단일 쿼리 검색 — Playwright SPA 렌더링으로 top 20 추출.

    - `display`, `client`, `timeout` 인자는 이전 HTTP 기반 구현과의 caller
      호환을 위해 받지만 내부 정책 (top 20, singleton browser, NAV_TIMEOUT_MS)
      이 우선한다.
    - 회로차단 OPEN → 즉시 `naver_unavailable` 로 단락 (이전 동작 그대로).
    - 결과 `items` 는 광고 제외 organic **상위 20개** 만 포함. 21위 이하는
      알 수 없으며, caller 는 매칭 실패 시 "순위권 없음" 으로 표시해야 한다.
    """
    _ = display, client, timeout  # 명시적으로 무시

    q = (query or "").strip()
    if not q:
        return MapSearchResult(query=q, total_count=0, error="empty query")

    if not _circuit.allow():
        return MapSearchResult(
            query=q, total_count=0, error="naver_unavailable", elapsed_ms=0,
        )

    try:
        res = await _do_search(q)
    except Exception as e:  # noqa: BLE001
        log.exception("search_map crashed for query=%r", q)
        # crash 는 weak 류 (브라우저/메모리 일시 문제. 네이버 차단과 무관)
        _circuit.on_failure(kind="weak")
        return MapSearchResult(
            query=q, total_count=0,
            error=f"crash: {type(e).__name__}: {e}",
            elapsed_ms=0,
        )

    # error 유무에 따라 회로차단 카운터 갱신.
    # 2026-05-16 — 에러 타입을 strong/weak/none 으로 분류 후 차등 처리.
    #   · none  : 'naver_unavailable' (이미 OPEN 으로 단락된 호출) → 카운터 무시
    #   · strong: 429/403/5xx 같은 진짜 차단 신호 → 3회면 즉시 OPEN
    #   · weak  : goto timeout / empty_items / dom_extract 등 → 60초 윈도 12회 OPEN
    if res.error:
        kind = _classify_error(res.error)
        if kind in ("strong", "weak"):
            _circuit.on_failure(kind=kind)
        # 'none' 케이스 (naver_unavailable) 는 누적 안 함
    else:
        _circuit.on_success()
    return res


async def search_many(
    queries: list[str],
    *,
    concurrency: int = 2,  # Playwright 는 RAM 무거우므로 보수적으로
    pace_ms: int = 500,
    display: int = TOP_N,
) -> list[MapSearchResult]:
    """여러 쿼리 동시 N + 페이스로 호출."""
    if not queries:
        return []
    results: list[MapSearchResult | None] = [None] * len(queries)
    sem = asyncio.Semaphore(max(1, concurrency))
    pace_s = max(0.0, pace_ms / 1000.0)

    async def one(idx: int, q: str) -> None:
        async with sem:
            results[idx] = await search_map(q, display=display)
            if pace_s:
                await asyncio.sleep(pace_s)

    await asyncio.gather(*[one(i, q) for i, q in enumerate(queries)])

    out: list[MapSearchResult] = []
    for r in results:
        out.append(r if r is not None else MapSearchResult(query="", total_count=0, error="missing"))
    return out
