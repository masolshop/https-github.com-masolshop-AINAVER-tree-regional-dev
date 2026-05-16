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
CB_WEAK_THRESHOLD = 25             # 약한 신호: 윈도 내 25회 누적이어야 OPEN
                                   # (2026-05-16 3차 완화 — 12→25. rerun-out-of-range
                                   #  잡에서 외곽 키워드의 goto/no_list_items 일시 실패가
                                   #  60초 안에 12회 쉽게 누적되어 false OPEN 발생.)
CB_WEAK_WINDOW_SEC = 90.0          # 약한 신호의 연속성 윈도 (60→90초)
CB_COOLDOWN_SEC = 120              # OPEN 유지 시간 (그대로)

# 약한(weak) 에러 prefix 화이트리스트. 이 prefix 로 시작하는 res.error 는
# weak 으로 분류 = 60초 윈도 12회 누적 시 OPEN.
#
# ⚠️ 제외 prefix (none 으로 분류, 회로차단 카운터에 누적 안 됨):
#   · "empty_items"  — 시골 면/리/희소 키워드(예: 목포 삼학동 렉카)에서
#                      네이버가 정상적으로 0건 결과를 줄 수 있다. 차단이 아니다.
#                      특히 rerun-out-of-range 잡은 정의상 이미 out_of_range
#                      였던 셀만 다시 시도 → empty_items 가 정상적으로 다발.
#                      이걸 weak 으로 누적시키면 60초 안에 12회가 쉽게 채워져
#                      false OPEN 이 발생 (실제 서버 로그에서 확인 완료).
_WEAK_ERROR_PREFIXES = (
    "goto",          # 페이지 이동 타임아웃 — 진짜 네트워크/렌더 문제일 수 있음
    "no_list_items",  # DOM 로드 실패 — 같은 류
    "dom_extract",    # JS 실행 실패 — 거의 안 일어남
    "crash",          # Playwright 크래시
)


def _classify_error(err: str | None) -> str:
    """error 문자열을 'strong' / 'weak' / 'none' 으로 분류.

    현재 strong 에 해당하는 명시적 패턴은 없음 (HTTP 응답 헤더를 미수집).
    추후 _do_search 에서 429/403 등을 감지하면 'rate_limited' 같은 prefix 로
    표시 → 여기서 strong 으로 분류하면 즉시 빠른 OPEN.

    분류 정책 (2026-05-16, 1회 완화 → 2026-05-16 2회차 완화):
      · "none"   : err 없음, naver_unavailable, **empty_items**, 그리고
                    매칭되지 않는 알 수 없는 에러 (보수적 fallback)
      · "strong" : http_429 / http_403 / http_5xx / rate_limited
      · "weak"   : 명시적 렌더 실패 prefix (_WEAK_ERROR_PREFIXES)
    """
    if not err:
        return "none"
    if err == "naver_unavailable":
        # 이미 OPEN 으로 단락된 호출 — 카운터에 누적하지 않음
        return "none"
    e = err.lower()
    # empty_items 는 "결과 0건" 이라는 정상 상태일 수 있으므로 카운터에서 제외.
    # (시골 면/리, 희소 키워드, rerun-out-of-range 잡에서 자주 등장.)
    if e.startswith("empty_items"):
        return "none"
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
    # 알 수 없는 에러는 **none** 으로 안전하게 분류 (이전: weak).
    # weak fallback 이 false OPEN 의 한 원인이었으므로, 명시적 prefix 가
    # 없는 신규/예외 케이스는 카운터에 누적시키지 않는다.
    return "none"


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
    // li.VLTHu 가 1차 셀렉터. fallback 으로 a[href*="/place/"] 를 가진
    // li 도 함께 잡아 클래스 이름 변경에 대비한다.
    let lis = Array.from(document.querySelectorAll('li.VLTHu'));
    if (lis.length === 0) {
        const anchors = document.querySelectorAll(
            'a[href*="/place/"], a[href*="/restaurant/"], a[href*="/hairshop/"]'
        );
        const seen = new Set();
        anchors.forEach((a) => {
            const li = a.closest('li');
            if (li && !seen.has(li)) {
                seen.add(li);
                lis.push(li);
            }
        });
    }

    // 잘 알려진 카테고리 suffix 후보 (네이버 분류 체계에서 빈출).
    // _EXTRACT_JS 안에서 name/category 추출이 실패했을 때 마지막 보조 휴리스틱으로 사용.
    // 백엔드 _KNOWN_CATEGORY_SUFFIXES 와 동기화. 단독 2글자 suffix("운송"/"시공"/
    // "공사"/"공단") 는 의도적으로 제외 — false-positive 위험 큼.
    const KNOWN_CATEGORY_SUFFIXES = [
        '공사,공단',
        '견인운송','화물운송','자동차운송','이사운송','특수운송',
        '심부름센터','흥신소','출장세차','출장수리',
        '하수구막힘','수도수리','보일러수리','도배','장판',
        '청소대행','입주청소','이사청소','사무실청소',
        '줄눈시공','탄성코트','에폭시','방수공사',
        '인테리어','리모델링',
    ];

    // 한 element 의 직계 텍스트(자식 element 내용 제외) 만 모아주는 헬퍼.
    // 인접 span/strong 텍스트가 줄바꿈 없이 결합되는 모바일 레이아웃 문제를 우회.
    function elementOwnText(el) {
        if (!el) return '';
        let s = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                s += node.textContent || '';
            }
        }
        return s.trim();
    }

    // li 내부에서 텍스트를 가진 inline element 들의 텍스트를 순서대로 수집.
    // - <a href="/place/..."> 안에 보통 <span>상호</span><span>카테고리</span> 구조.
    // - 같은 a 내에서 element 단위로 분리해야 "상호+카테고리"가 한 덩어리로
    //   합쳐지는 문제를 피할 수 있다.
    function collectInlineTexts(root) {
        const out = [];
        const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
        const walk = (el) => {
            if (!el || SKIP_TAGS.has(el.tagName)) return;
            const own = elementOwnText(el);
            if (own) out.push(own);
            for (const child of el.children) walk(child);
        };
        walk(root);
        return out;
    }

    // 텍스트가 카테고리 suffix 후보인지 검사 (단독 카테고리 토큰).
    function looksLikeCategory(t) {
        if (!t) return false;
        const s = t.trim();
        if (!s) return false;
        if (s.length > 18) return false; // 너무 길면 카테고리 아님 (보통 ≤10)
        return KNOWN_CATEGORY_SUFFIXES.some((suf) => s === suf || s.endsWith(suf));
    }

    const out = [];
    lis.forEach((li, idx) => {
        // place_id 추출 — /place/{id}, /restaurant/{id}, /hairshop/{id}
        let pid = '';
        const a = li.querySelector(
            'a[href*="/place/"], a[href*="/restaurant/"], a[href*="/hairshop/"]'
        );
        if (a) {
            const href = a.getAttribute('href') || '';
            const m = href.match(/\/(?:place|restaurant|hairshop)\/(\d+)/);
            if (m) pid = m[1];
        }

        const fullText = (li.innerText || '').trim();
        const isAd = fullText.includes('광고');

        // ── 1차: anchor 내부 inline element 단위로 텍스트 수집.
        //    name = 첫 비-광고 텍스트 (보통 <span>상호</span>)
        //    category = 두 번째 텍스트 (보통 <span>카테고리</span>)
        let name = '';
        let category = '';
        const anchorTexts = a ? collectInlineTexts(a) : [];
        const cleaned = anchorTexts
            .map((t) => t.replace(/\s+/g, ' ').trim())
            .filter((t) => t && t !== '광고');

        if (cleaned.length >= 1) name = cleaned[0];
        if (cleaned.length >= 2) {
            // 두 번째 텍스트가 카테고리 형태이면 채택. 아니면 더 뒤를 스캔.
            for (let i = 1; i < cleaned.length; i++) {
                if (looksLikeCategory(cleaned[i])) {
                    category = cleaned[i];
                    break;
                }
            }
            // 그래도 못 찾았으면 그냥 두 번째 텍스트 채택 (기존 동작과 호환).
            if (!category) category = cleaned[1];
        }

        // ── 2차: 1차에서 name 이 비어있으면 li 의 innerText 첫 줄로 fallback.
        if (!name) {
            const lines = fullText.split('\n').map((s) => s.trim()).filter(Boolean);
            for (const ln of lines) {
                if (ln === '광고') continue;
                name = ln;
                break;
            }
            if (!category) {
                const ni = lines.indexOf(name);
                if (ni >= 0 && ni + 1 < lines.length) category = lines[ni + 1];
            }
        }

        // ── 3차 보조: category 가 비었거나 name 에 안 붙어 있을 때,
        //    name 끝이 KNOWN_CATEGORY_SUFFIXES 중 하나로 끝나면 그것을 category 로 채택.
        //    (백엔드 _strip_category_suffix 의 매칭 성공률을 높이는 보험.)
        if (!category && name) {
            for (const suf of KNOWN_CATEGORY_SUFFIXES) {
                if (name.endsWith(suf) && name.length > suf.length) {
                    category = suf;
                    break;
                }
            }
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
        # 1차 시도 — domcontentloaded 까지만 대기 (빠름).
        # 실패 시 1회 재시도 — 모바일 네트워크/CPU 일시 느림 케이스 흡수.
        goto_err: str | None = None
        for attempt in (1, 2):
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                goto_err = None
                break
            except Exception as e:  # noqa: BLE001
                goto_err = f"goto: {type(e).__name__}"
                if attempt == 1:
                    await page.wait_for_timeout(500)  # 짧은 백오프 후 재시도
        if goto_err is not None:
            return MapSearchResult(
                query=q, total_count=0,
                error=goto_err,
                elapsed_ms=int((time.time() - t0) * 1000),
            )

        # 리스트 등장 대기 — 다중 셀렉터로 클래스 이름 변경 / 0건 결과 페이지 모두 커버.
        #   · li.VLTHu               : 정상 결과 페이지의 카드
        #   · a[href*="/place/"]     : 결과 카드 내부의 anchor (fallback)
        #   · .no_result, .empty     : "결과 없음" 안내 영역 (= 정상 0건 응답)
        # 어느 하나라도 잡히면 페이지 로드 성공으로 간주하고 진행한다.
        # 이렇게 하면 "0건 결과 페이지" 는 no_list_items 가 아니라
        # empty_items 로 정확히 분류되어 회로차단 카운터에서 제외된다.
        list_wait_selectors = (
            "li.VLTHu, "
            "a[href*='/place/'], "
            "a[href*='/restaurant/'], "
            "a[href*='/hairshop/'], "
            "[class*='no_result'], "
            "[class*='noResult'], "
            "[class*='empty']"
        )
        try:
            await page.wait_for_selector(list_wait_selectors, timeout=LI_WAIT_MS)
        except Exception as e:  # noqa: BLE001
            # 한 번 더 시도 — SPA 가 느리게 SSR 마운트되는 케이스 흡수.
            try:
                await page.wait_for_timeout(800)
                await page.wait_for_selector(
                    list_wait_selectors, timeout=LI_WAIT_MS // 2
                )
            except Exception as e2:  # noqa: BLE001
                return MapSearchResult(
                    query=q, total_count=0,
                    error=f"no_list_items: {type(e2).__name__}",
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
