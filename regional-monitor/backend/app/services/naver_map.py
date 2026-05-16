"""
네이버 지도 SPA(map.naver.com/p/search/...) 검색 결과 파서.

[2026-05-16 전면 재작성]
이전 구현은 모바일 엔드포인트 `m.map.naver.com/search2/search.naver` 의
HTML 응답에 임베드된 `__RQ_STREAMING_STATE__` 를 파싱했으나, 해당 엔드포인트가
사실상 폐쇄되어 HTTP 500 만 반환한다 (5/5 trials, 10s timeout). 신규 모바일
엔드포인트 `map.naver.com/p/api/search/allSearch` 는 서버 IP 가 captcha
challenge 대상이라 `pageId:"ncaptcha-all-search-no-result"` 응답이 돌아온다.

→ Playwright 헤드리스 Chromium 으로 SPA 를 실제 렌더링해서 captcha 를
우회한다. PoC4/5 (2026-05-16, 5/5 query 성공) 검증 완료.

[수집 정책 — 사용자 확정 2026-05-16]
- 우리 서비스는 **타지역 키워드**(예: "압구정동 흥신소", "신사동 하수구막힘")만
  다룬다. 큰 로컬 키워드("강남역 맛집")와 달리 모두 `pcmap.place.naver.com/place/list`
  iframe 으로 라우팅된다.
- **상위 20위 까지만** 의미가 있다. 21위 밖은 "순위권 없음" 으로 통일.
- 한 번의 SPA 로드 = 한 번의 첫 페이지(70건 prefetch 됨) → 페이지네이션 불필요.

[추출 알고리즘]
1. `https://map.naver.com/p/search/{query}` 페이지 로드.
2. `pcmap.place.naver.com/place/list` iframe 이 잡힐 때까지 대기.
3. iframe 내부의 `window.__APOLLO_STATE__` 에서:
   - `ROOT_QUERY['placeList({...})'].businesses.items` 의 `__ref` 배열이 **랭킹 순서**.
   - 각 ref → `PlaceListBusinessesItem:<id>` 엔티티에서 id/name/category/address 추출.
   - `ROOT_QUERY['adBusinesses({...})'].items` 또는 엔티티의 `adId != null` 이 광고.
4. 동시에 iframe DOM `li.VLTHu` 에서 "광고" 텍스트 마커를 수집해 cross-check.
   DOM 의 광고 인덱스 = Apollo items 인덱스 (PoC5 검증 완료).
5. 광고 슬롯을 모두 제외한 organic 결과의 **상위 20개**가 rank 1~20.

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
NAV_TIMEOUT_MS = 30_000  # page.goto 타임아웃 (ms)
IFRAME_WAIT_MS = 12_000  # pcmap iframe 등장 대기 (ms)
LI_WAIT_MS = 10_000  # li.VLTHu 첫 등장 대기 (ms)

# 회로차단 — Playwright 호출은 한 번 실패 시 비용이 크므로 임계치를 보수적으로.
CB_FAIL_THRESHOLD = 5  # 연속 실패 N 회 누적 시 OPEN
CB_COOLDOWN_SEC = 120  # OPEN 유지 시간

# ─────────────────────────────────────────────────────────────────────────────
# 회로차단기 (이전 구현과 동일 인터페이스 유지)
# ─────────────────────────────────────────────────────────────────────────────
class _CircuitBreaker:
    """Playwright 호출이 연속 실패할 때 후속 호출을 즉시 단락시키는 회로차단기."""

    def __init__(self) -> None:
        self._consecutive_fail = 0
        self._opened_at: float = 0.0
        self._state: str = "CLOSED"  # CLOSED / OPEN / HALF_OPEN

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
        self._consecutive_fail = 0
        if self._state in ("OPEN", "HALF_OPEN"):
            log.info("naver_map circuit breaker → CLOSED (recovered)")
        self._state = "CLOSED"
        self._opened_at = 0.0

    def on_failure(self) -> None:
        self._consecutive_fail += 1
        if self._state == "HALF_OPEN":
            self._state = "OPEN"
            self._opened_at = time.monotonic()
            log.warning("naver_map circuit breaker → OPEN (half-open probe failed)")
            return
        if self._state == "CLOSED" and self._consecutive_fail >= CB_FAIL_THRESHOLD:
            self._state = "OPEN"
            self._opened_at = time.monotonic()
            log.warning(
                "naver_map circuit breaker → OPEN (%d consecutive failures, cooldown=%ds)",
                self._consecutive_fail, CB_COOLDOWN_SEC,
            )

    @property
    def state(self) -> str:
        return self._state


_circuit = _CircuitBreaker()


def is_circuit_open() -> bool:
    """현재 회로차단 상태가 OPEN 인지 확인 (rank_checker 가 워커 진입 전 단락용)."""
    return _circuit.state == "OPEN"


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
# Apollo state 추출 JS — iframe context 안에서 실행
# ─────────────────────────────────────────────────────────────────────────────
_EXTRACT_JS = r"""
() => {
    const apollo = window.__APOLLO_STATE__;
    if (!apollo) return { error: 'no_apollo' };

    // 1) Find placeList(...) and adBusinesses(...) keys in ROOT_QUERY
    let placeListKey = null;
    let adBusinessesKey = null;
    for (const k of Object.keys(apollo.ROOT_QUERY || {})) {
        if (k.startsWith('placeList(')) placeListKey = k;
        else if (k.startsWith('adBusinesses(')) adBusinessesKey = k;
    }
    if (!placeListKey) return { error: 'no_placeList_key' };

    const placeList = apollo.ROOT_QUERY[placeListKey];
    const items = (placeList && placeList.businesses && placeList.businesses.items) || [];

    // 2) Build ad ref set from adBusinesses ROOT_QUERY
    const adRefs = new Set();
    if (adBusinessesKey && apollo.ROOT_QUERY[adBusinessesKey]) {
        const adObj = apollo.ROOT_QUERY[adBusinessesKey];
        const adItems = (adObj && adObj.items) || [];
        for (const r of adItems) {
            if (r && r.__ref) adRefs.add(r.__ref);
        }
    }

    // 3) Walk items in order, resolve __ref → entity, attach isAd
    const ordered = [];
    for (const r of items) {
        const ref = r && r.__ref;
        if (!ref) continue;
        const ent = apollo[ref];
        if (!ent) continue;
        const isAdApollo = adRefs.has(ref) || (ent.adId != null);
        ordered.push({
            id: String(ent.id || ''),
            name: String(ent.name || ''),
            category: String(ent.category || ''),
            address: String(ent.address || ''),
            roadAddress: String(ent.roadAddress || ''),
            phone: String(ent.phone || ent.tel || ''),
            virtualPhone: String(ent.virtualPhone || ent.virtualTel || ''),
            x: ent.x != null ? String(ent.x) : '',
            y: ent.y != null ? String(ent.y) : '',
            isAdApollo,
        });
    }

    // 4) DOM 광고 마커 인덱스 (DOM index == items index, PoC5 검증)
    const lis = document.querySelectorAll('li.VLTHu');
    const domAdFlags = [];
    lis.forEach((li) => {
        const t = li.innerText || '';
        domAdFlags.push(t.includes('광고'));
    });

    return {
        ordered,
        domAdFlags,
        domCount: lis.length,
        placeListKey: placeListKey.slice(0, 220),
        adBusinessesKey: adBusinessesKey ? adBusinessesKey.slice(0, 220) : null,
    };
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
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


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
    """Apollo entity → MapPlace."""
    def _f(v: str) -> float | None:
        try:
            return float(v) if v else None
        except (TypeError, ValueError):
            return None

    return MapPlace(
        place_id=str(it.get("id") or ""),
        name=str(it.get("name") or ""),
        category=str(it.get("category") or ""),
        phone=str(it.get("phone") or ""),
        virtual_phone=str(it.get("virtualPhone") or ""),
        address=str(it.get("address") or ""),
        road_address=str(it.get("roadAddress") or ""),
        latitude=_f(it.get("y") or ""),
        longitude=_f(it.get("x") or ""),
    )


async def _scroll_to_load(frame, target: int = TOP_N + 5, max_scrolls: int = 8) -> int:
    """top N+여유분이 DOM 에 로드될 때까지 스크롤. 실패해도 OK (Apollo 에서 데이터는 이미 가짐)."""
    for _ in range(max_scrolls):
        try:
            n = await frame.locator("li.VLTHu").count()
        except Exception:  # noqa: BLE001
            return 0
        if n >= target:
            return n
        try:
            await frame.evaluate(
                """
                () => {
                    const lis = document.querySelectorAll('li.VLTHu');
                    if (lis.length) lis[lis.length - 1].scrollIntoView({ block: 'end' });
                    const cs = document.querySelectorAll('div');
                    for (const c of cs) {
                        if (c.scrollHeight > c.clientHeight + 100) c.scrollTop = c.scrollHeight;
                    }
                }
                """
            )
            await frame.wait_for_timeout(500)
        except Exception:  # noqa: BLE001
            break
    try:
        return await frame.locator("li.VLTHu").count()
    except Exception:  # noqa: BLE001
        return 0


async def _do_search(query: str) -> MapSearchResult:
    """Playwright 로 한 번 검색 → MapSearchResult."""
    q = (query or "").strip()
    if not q:
        return MapSearchResult(query=q, total_count=0, error="empty query")

    t0 = time.time()
    browser = await _get_browser()
    ctx = await browser.new_context(
        user_agent=_UA,
        viewport={"width": 1366, "height": 900},
        locale="ko-KR",
        timezone_id="Asia/Seoul",
    )
    try:
        page = await ctx.new_page()
        # 자원 절약: 이미지/폰트/미디어 차단 (Apollo state 만 필요)
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

        url = f"https://map.naver.com/p/search/{q}"
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        except Exception as e:  # noqa: BLE001
            return MapSearchResult(
                query=q, total_count=0,
                error=f"goto: {type(e).__name__}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        # pcmap iframe 등장 대기
        deadline = time.time() + (IFRAME_WAIT_MS / 1000.0)
        target_frame = None
        while time.time() < deadline:
            await page.wait_for_timeout(400)
            for fr in page.frames:
                if "pcmap.place.naver.com" in fr.url and "place/list" in fr.url:
                    target_frame = fr
                    break
            if target_frame:
                break
        if target_frame is None:
            return MapSearchResult(
                query=q, total_count=0,
                error="no_pcmap_iframe",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        # li 첫 등장 대기
        try:
            await target_frame.wait_for_selector("li.VLTHu", timeout=LI_WAIT_MS)
        except Exception as e:  # noqa: BLE001
            return MapSearchResult(
                query=q, total_count=0,
                error=f"no_list_items: {type(e).__name__}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        await target_frame.wait_for_timeout(400)
        # DOM 광고 마커가 모두 잡히도록 어느 정도 스크롤 (top 20+여유분)
        await _scroll_to_load(target_frame, target=TOP_N + 5, max_scrolls=6)

        try:
            data = await target_frame.evaluate(_EXTRACT_JS)
        except Exception as e:  # noqa: BLE001
            return MapSearchResult(
                query=q, total_count=0,
                error=f"apollo_extract: {type(e).__name__}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        if not data or "error" in data:
            return MapSearchResult(
                query=q, total_count=0,
                error=f"extract: {data.get('error') if data else 'no_data'}",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        ordered = data.get("ordered") or []
        dom_ad_flags = data.get("domAdFlags") or []

        # 광고 필터: Apollo isAd OR DOM 광고 마커 (PoC5 정책)
        organic: list[MapPlace] = []
        for i, it in enumerate(ordered):
            is_ad_apollo = bool(it.get("isAdApollo"))
            is_ad_dom = bool(i < len(dom_ad_flags) and dom_ad_flags[i])
            if is_ad_apollo or is_ad_dom:
                continue
            organic.append(_to_map_place(it))
            if len(organic) >= TOP_N:
                break

        elapsed = int((time.time() - t0) * 1000)
        # total_count = top N 안에 들어간 organic 수. caller (rank_checker) 는
        # `for idx, it in enumerate(res.items, start=1)` 로 순회하며 매칭만
        # 보므로 total_count 의 정확한 의미는 별로 중요하지 않다 (호환만 유지).
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
        _circuit.on_failure()
        return MapSearchResult(
            query=q, total_count=0,
            error=f"crash: {type(e).__name__}: {e}",
            elapsed_ms=0,
        )

    # error 유무에 따라 회로차단 카운터 갱신
    if res.error:
        # 'naver_unavailable' 은 이미 차단 상태에서 단락된 거라 카운터 증가 X
        if res.error != "naver_unavailable":
            _circuit.on_failure()
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
