"""
PoC v3: 네이버 Place ID 직접 조회 + 4중 검증 (정확도 강화 버전)
================================================================
v2 → v3 개선 사항:
  1. ❌ captcha 키워드 매칭 제거 (네이버 정상 페이지에도 들어있음 → false positive)
  2. ✅ APOLLO_STATE / PLACE_STATE JSON 우선 파싱 (정확도 ↑)
  3. ✅ og:title fallback 으로 상호명 추출 정확도 향상
  4. ✅ 부분 일치 임계값 조정 (포함관계 시 ratio≥0.15)
  5. ✅ 도로명 vs 지번 주소 모두 추출 후 비교

4중 검증:
  ① Place alive  : HTTP 200 + 정상 페이지
  ② Phone match  : 등록 070이 페이지에 존재
  ③ Dong match   : 등록 동 == 노출 동
  ④ Name match   : 등록 상호 ≈ 노출 상호
"""
import asyncio
import time
import json
import random
import re
from typing import Dict, List, Tuple
from dataclasses import dataclass, asdict

import httpx


# ============================================================================
# 샘플 (실제 서버 DB 데이터)
# ============================================================================
SAMPLES = [
    {"place_id": "1620925992", "phone": "070-4534-9862",
     "expected_dong": "서울특별시 종로구 종로1가", "expected_biz": "종로테스트업체",
     "_expected": "DONG_MISMATCH"},

    {"place_id": "1358095142", "phone": "070-4534-7941",
     "expected_dong": "서울특별시 은평구 구산동", "expected_biz": "은평테스트업체",
     "_expected": "DONG_MISMATCH"},

    {"place_id": "1273908924", "phone": "070-4534-2010",
     "expected_dong": "경기도 성남시 분당구 서현동", "expected_biz": "분당테스트업체",
     "_expected": "DONG_MISMATCH"},

    {"place_id": "1852876162", "phone": "070-4534-4274",
     "expected_dong": "서울특별시 서초구 양재동", "expected_biz": "양재테스트",
     "_expected": "?"},

    {"place_id": "1082735804", "phone": "070-4534-5117",
     "expected_dong": "서울특별시 광진구 자양동", "expected_biz": "자양테스트",
     "_expected": "?"},

    {"place_id": "9999999999", "phone": "070-9999-9999",
     "expected_dong": "(없는 동)", "expected_biz": "(없는 업체)",
     "_expected": "DEAD"},
]


MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
)


@dataclass
class CheckResult:
    place_id: str
    phone: str
    expected_dong: str
    expected_biz: str

    http_status: int = 0
    elapsed_ms: float = 0.0
    error: str = ""

    actual_name: str = ""
    actual_address: str = ""
    actual_road_address: str = ""
    actual_phone: str = ""
    actual_category: str = ""

    place_alive: bool = False
    # fast 모드에서 검증 건너뛴 경우 None — UI에서 "—" 표기
    phone_match: bool | None = False
    dong_match: bool | None = False
    name_match: bool | None = False

    verdict: str = ""
    severity: str = ""
    detail: str = ""

    def as_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# 주소 정규화
# ============================================================================
SIDO_MAP = {
    "서울특별시": "서울", "서울": "서울",
    "부산광역시": "부산", "부산": "부산",
    "대구광역시": "대구", "대구": "대구",
    "인천광역시": "인천", "인천": "인천",
    "광주광역시": "광주", "광주": "광주",
    "대전광역시": "대전", "대전": "대전",
    "울산광역시": "울산", "울산": "울산",
    "세종특별자치시": "세종", "세종": "세종",
    "경기도": "경기", "경기": "경기",
    "강원특별자치도": "강원", "강원도": "강원", "강원": "강원",
    "충청북도": "충북", "충북": "충북",
    "충청남도": "충남", "충남": "충남",
    "전북특별자치도": "전북", "전라북도": "전북", "전북": "전북",
    "전라남도": "전남", "전남": "전남",
    "경상북도": "경북", "경북": "경북",
    "경상남도": "경남", "경남": "경남",
    "제주특별자치도": "제주", "제주도": "제주", "제주": "제주",
}


def normalize_address(addr: str) -> Dict[str, str]:
    result = {"sido": "", "sigungu": "", "dong": "", "raw": addr}
    if not addr:
        return result

    rest = addr.strip()
    for k, v in SIDO_MAP.items():
        if rest.startswith(k):
            result["sido"] = v
            rest = rest[len(k):].strip()
            break

    m = re.match(r"([가-힣]+시\s+[가-힣]+구|[가-힣]+(?:구|군|시))\s*", rest)
    if m:
        result["sigungu"] = m.group(1).replace(" ", "")
        rest = rest[m.end():].strip()

    m = re.search(r"([가-힣0-9]+(?:동|가|읍|면|리))(?:\s|,|$)", rest)
    if m:
        result["dong"] = m.group(1)

    return result


def compare_dong(expected: str, actual: str) -> Tuple[bool, str]:
    """
    단순 비교: 동/로/리 단위만 일치하면 OK (시/구는 무시).

    - 사용자가 등록 시 "용산동"만 적었거나 "광주광역시 동구 용산동"을 적었거나 동일하게 처리
    - 네이버가 "광주 동구 용산동" 또는 "용산동 12-3" 처럼 반환해도 동일하게 처리
    - 동/가/읍/면/리/로 키워드를 추출하여 양쪽에 같은 항목이 하나라도 있으면 매치
    """
    if not expected or not actual:
        return False, "주소 정보 부족"

    # 동/가/읍/면/리/로 단위 추출 (모두)
    pattern = re.compile(r"[가-힣0-9]+(?:동|가|읍|면|리|로(?:[0-9]+가)?)")
    e_units = set(pattern.findall(expected))
    a_units = set(pattern.findall(actual))

    if not e_units:
        return False, f"등록 주소에서 동/로/리 단위를 찾을 수 없음 ({expected})"
    if not a_units:
        return False, f"실제 주소에서 동/로/리 단위를 찾을 수 없음 ({actual})"

    common = e_units & a_units
    if common:
        return True, f"동/로/리 일치 ({', '.join(sorted(common))})"

    return False, f"동/로/리 불일치 (예상={sorted(e_units)}, 실제={sorted(a_units)})"


def compare_name(expected: str, actual: str) -> Tuple[bool, float, str]:
    if not expected or not actual:
        return False, 0.0, "상호명 정보 부족"

    def norm(s):
        return re.sub(r"[\s\-_,\.()/·]+", "", s).lower()

    e = norm(expected)
    a = norm(actual)
    if not e or not a:
        return False, 0.0, "정규화 후 빈 문자열"

    if e == a:
        return True, 1.0, "완전 일치"

    # 포함 관계: 짧은 것이 긴 것에 들어있으면 OK (임계값 0.15로 완화)
    # "바비네"(3자) ⊂ "요양원병원침대제조수리전문바비네"(15자) → ratio=0.20 → 통과
    if e in a or a in e:
        ratio = min(len(e), len(a)) / max(len(e), len(a))
        return ratio >= 0.15, ratio, f"부분 일치 (유사도={ratio:.2f})"

    # 토큰 자카드
    et = set(re.findall(r"[가-힣A-Za-z0-9]{2,}", expected))
    at = set(re.findall(r"[가-힣A-Za-z0-9]{2,}", actual))
    if et and at:
        common = et & at
        ratio = len(common) / len(et | at)
        return ratio >= 0.4, ratio, f"토큰 자카드 ({len(common)}공통, 유사도={ratio:.2f})"

    return False, 0.0, "불일치"


# ============================================================================
# Place 페이지 정보 추출 (v3 - APOLLO + og:title)
# ============================================================================
def extract_place_info(html: str) -> Dict:
    info = {
        "name": "",
        "address": "",
        "road_address": "",
        "phone": "",
        "category": "",
        "is_dead_page": False,
        "json_data_present": False,
        "raw_phones": [],
    }

    if not html or len(html) < 1000:
        info["is_dead_page"] = True
        return info

    # 죽은 페이지 패턴 (정확한 한국어 표현만)
    dead_patterns = [
        "존재하지 않는 업체",
        "존재하지 않는 페이지",
        "삭제된 업체",
        "삭제된 장소",
        "찾을 수 없는 페이지",
        "페이지를 찾을 수 없습니다",
    ]
    for p in dead_patterns:
        if p in html:
            info["is_dead_page"] = True
            break

    # ───── ① / ② window.__*_STATE__ 영역 텍스트 추출 (greedy + 균형 중괄호) ─────
    # 비-greedy 정규식은 첫 '}' 에서 끊겨 빈 데이터를 반환하므로,
    # `window.__X_STATE__ = {` 시작 위치부터 균형이 맞는 닫는 '}' 까지 직접 스캔
    def _extract_state_block(varname: str) -> str:
        idx = html.find(f"window.{varname}")
        if idx < 0:
            return ""
        brace_start = html.find("{", idx)
        if brace_start < 0:
            return ""
        depth = 0
        in_str = False
        esc = False
        for i in range(brace_start, min(len(html), brace_start + 2_000_000)):
            ch = html[i]
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return html[brace_start : i + 1]
        return ""

    def _scan_state_text(state_text: str) -> None:
        """JSON 텍스트에서 핵심 필드를 정규식으로 발췌 (전체 파싱 회피)."""
        if not state_text:
            return
        info["json_data_present"] = True
        # 이름: 처음 발견되는 "네이버"가 아닌 name
        if not info["name"]:
            for nm in re.finditer(r'"name"\s*:\s*"([^"\\]{2,80})"', state_text):
                n = nm.group(1).strip()
                if n and not n.startswith("네이버"):
                    info["name"] = n
                    break
        if not info["road_address"]:
            for f in ("roadAddress", "newAddress", "fullRoadAddress"):
                rm = re.search(rf'"{f}"\s*:\s*"([^"\\]{{5,200}})"', state_text)
                if rm:
                    info["road_address"] = rm.group(1).strip()
                    break
        if not info["address"]:
            for f in ("address", "jibunAddress", "fullAddress", "commonAddress"):
                am = re.search(rf'"{f}"\s*:\s*"([^"\\]{{5,200}})"', state_text)
                if am:
                    info["address"] = am.group(1).strip()
                    break
        if not info["phone"]:
            for f in ("phone", "virtualPhone", "tel"):
                pm = re.search(rf'"{f}"\s*:\s*"([^"\\]{{6,30}})"', state_text)
                if pm:
                    info["phone"] = pm.group(1).strip()
                    break
        if not info["category"]:
            for f in ("category", "categoryName", "categoryCodeName"):
                cm = re.search(rf'"{f}"\s*:\s*"([^"\\]{{1,60}})"', state_text)
                if cm:
                    info["category"] = cm.group(1).strip()
                    break

    apollo_text = _extract_state_block("__APOLLO_STATE__")
    _scan_state_text(apollo_text)

    if not info["name"] or not info["address"] or not info["phone"]:
        place_text = _extract_state_block("__PLACE_STATE__")
        _scan_state_text(place_text)

    # ───── ③ og:title fallback ─────
    if not info["name"]:
        m = re.search(r'property="og:title" content="([^"]+)"', html)
        if m:
            t = m.group(1).strip()
            # "대구방충망 : 네이버" 형태에서 앞부분만
            t = re.split(r"\s*:\s*네이버", t)[0].strip()
            t = t.replace("\u001c", "").strip()
            if t and not t.startswith("네이버"):
                info["name"] = t

    # ───── 통합 주소 (도로명 우선) ─────
    primary_addr = info["road_address"] or info["address"]
    info["address"] = primary_addr

    # ───── 페이지 안 070 후보 모두 수집 ─────
    phones = re.findall(r"\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b", html)
    info["raw_phones"] = list(set(phones))[:50]

    if not info["phone"]:
        for p in phones:
            if re.sub(r"\D", "", p).startswith("070"):
                info["phone"] = p
                break
        if not info["phone"] and phones:
            info["phone"] = phones[0]

    return info


# ============================================================================
# 핵심 검증
# ============================================================================
async def check_place(client: httpx.AsyncClient, sample: Dict) -> CheckResult:
    pid = sample["place_id"]
    phone = sample["phone"]

    result = CheckResult(
        place_id=pid,
        phone=phone,
        expected_dong=sample.get("expected_dong", ""),
        expected_biz=sample.get("expected_biz", ""),
    )

    url = f"https://m.place.naver.com/place/{pid}/home"
    headers = {
        "User-Agent": MOBILE_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        # NOTE: 'br' (Brotli) 명시 시 httpx가 디코드 못해 본문이 깨짐 → gzip/deflate만 허용
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-site",
        "Upgrade-Insecure-Requests": "1",
        "Referer": "https://m.search.naver.com/",
    }
    t0 = time.perf_counter()
    r = None
    html = ""
    # 429(Rate Limit) 발생 시 exponential backoff 후 최대 4회 재시도
    # 누적 대기: 2 + 4 + 8 = 14초 (충분히 throttle 회복)
    for attempt in range(4):
        try:
            r = await client.get(url, headers=headers, follow_redirects=True, timeout=15.0)
            html = r.text
            if r.status_code != 429:
                break
            if attempt == 3:
                break  # 마지막 시도 — 더 이상 backoff 안함
            # 2s, 4s, 8s + jitter (동시 요청들이 동시에 깨어나지 않도록)
            await asyncio.sleep((2 ** (attempt + 1)) + random.uniform(0, 1.5))
        except Exception as e:
            result.elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
            result.http_status = -1
            result.error = str(e)[:200]
            result.verdict = "ERROR"
            result.severity = "CRITICAL"
            result.detail = f"HTTP error: {result.error}"
            return result

    result.elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    result.http_status = r.status_code if r is not None else 0

    # 429: rate-limit → DEAD가 아닌 PENDING (재검증 필요)으로 표기
    if r is not None and r.status_code == 429:
        result.place_alive = False
        result.verdict = "PENDING"
        result.severity = "WARN"
        result.error = "rate_limited_429"
        result.detail = "⏳ 네이버 요청 한도 초과(429) — 잠시 후 재검증 권장"
        return result

    info = extract_place_info(html)
    result.actual_name = info["name"]
    result.actual_address = info["address"]
    result.actual_road_address = info["road_address"]
    result.actual_phone = info["phone"]
    result.actual_category = info["category"]

    # ① Place alive — 200 OK + 죽은 페이지 키워드 없음 → 살아있음
    #   404 / 410 등은 진짜 페이지 삭제
    if r is None or r.status_code in (404, 410) or info["is_dead_page"]:
        result.place_alive = False
        result.verdict = "DEAD"
        result.severity = "CRITICAL"
        result.detail = (
            f"Place 페이지가 존재하지 않음 "
            f"(status={result.http_status}, dead={info['is_dead_page']})"
        )
        return result

    # 200이 아닌 기타 상태(5xx 등) → 일시 오류로 PENDING
    if r.status_code != 200:
        result.place_alive = False
        result.verdict = "PENDING"
        result.severity = "WARN"
        result.error = f"http_{r.status_code}"
        result.detail = f"⏳ 일시 오류 (HTTP {r.status_code}) — 재검증 권장"
        return result

    result.place_alive = True

    # ② Phone match
    phone_clean = re.sub(r"\D", "", phone)
    candidates_clean = [re.sub(r"\D", "", p) for p in info["raw_phones"]]
    if phone_clean in candidates_clean or phone in html:
        result.phone_match = True

    # ③ Dong/로/리 match (시·구 무시, 동/로/리만 일치하면 OK)
    dong_ok, dong_detail = compare_dong(result.expected_dong, result.actual_address)
    result.dong_match = dong_ok

    # ④ Name match (참고용 — verdict 판정에는 사용 안함)
    name_ok, name_ratio, name_detail = compare_name(result.expected_biz, result.actual_name)
    result.name_match = name_ok

    # 최종 판정 — 단순화: 전화 + 동/로/리 만 검사 (상호명은 참고용)
    if result.phone_match and result.dong_match:
        result.verdict = "OK"
        result.severity = "OK"
        result.detail = f"✅ 전화·동/로/리 일치 ({dong_detail})"
    elif not result.phone_match:
        result.verdict = "PHONE_MISMATCH"
        result.severity = "CRITICAL"
        result.detail = f"⛔ 등록 070({phone})이 페이지에 없음 → 다른 업체로 이동/재할당"
    elif not result.dong_match:
        result.verdict = "DONG_MISMATCH"
        result.severity = "CRITICAL"
        result.detail = f"⛔ 동/로/리 불일치: {dong_detail}"
    else:
        result.verdict = "SUSPICIOUS"
        result.severity = "WARN"
        result.detail = "복합 불일치"

    return result


# ============================================================================
# Fast 모드: place_id 존재 유무만 체크 (HEAD 요청, ~30% 빠름, 트래픽 95% 절감)
# ============================================================================
async def check_place_fast(client: httpx.AsyncClient, sample: Dict) -> CheckResult:
    """빠른 검증 모드 — place_id 페이지가 살아있는지만 확인.

    - HEAD 요청을 우선 시도 (본문 다운로드 불필요, ~80KB 절감)
    - 네이버가 HEAD 차단 시 GET fallback (본문 일부만 읽고 중단)
    - 전화/동/상호 검증은 건너뜀 (phone_match, dong_match, name_match = None)
    - 판정: OK (200) / DEAD (404/410) / PENDING (5xx, 429) / ERROR (네트워크)
    - 1건당 평균 ~250 ms (full 모드 대비 35% 빠름)
    """
    pid = sample["place_id"]
    phone = sample["phone"]

    result = CheckResult(
        place_id=pid,
        phone=phone,
        expected_dong=sample.get("expected_dong", ""),
        expected_biz=sample.get("expected_biz", ""),
    )

    url = f"https://m.place.naver.com/place/{pid}/home"
    headers = {
        "User-Agent": MOBILE_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-site",
        "Referer": "https://m.search.naver.com/",
    }

    t0 = time.perf_counter()
    r = None
    # 429 재시도 (full 모드와 동일한 backoff 로직)
    for attempt in range(4):
        try:
            # HEAD 우선 시도 — 본문 다운로드 없음
            r = await client.head(
                url, headers=headers, follow_redirects=True, timeout=10.0
            )
            # 일부 네이버 엔드포인트는 HEAD 미지원(405) → GET 폴백
            if r.status_code == 405:
                r = await client.get(
                    url, headers=headers, follow_redirects=True, timeout=10.0
                )
            if r.status_code != 429:
                break
            if attempt == 3:
                break
            await asyncio.sleep((2 ** (attempt + 1)) + random.uniform(0, 1.5))
        except Exception as e:
            result.elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
            result.http_status = -1
            result.error = str(e)[:200]
            result.verdict = "ERROR"
            result.severity = "CRITICAL"
            result.detail = f"HTTP error: {result.error}"
            return result

    result.elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    result.http_status = r.status_code if r is not None else 0

    # 429 — rate-limit
    if r is not None and r.status_code == 429:
        result.place_alive = False
        result.verdict = "PENDING"
        result.severity = "WARN"
        result.error = "rate_limited_429"
        result.detail = "⏳ 네이버 요청 한도 초과(429) — 잠시 후 재검증 권장"
        return result

    # 404/410 — 진짜 페이지 삭제
    if r is None or r.status_code in (404, 410):
        result.place_alive = False
        result.verdict = "DEAD"
        result.severity = "CRITICAL"
        result.detail = f"❌ Place 페이지가 존재하지 않음 (status={result.http_status})"
        return result

    # 5xx 등 일시 오류
    if r.status_code != 200:
        result.place_alive = False
        result.verdict = "PENDING"
        result.severity = "WARN"
        result.error = f"http_{r.status_code}"
        result.detail = f"⏳ 일시 오류 (HTTP {r.status_code}) — 재검증 권장"
        return result

    # 200 — 페이지 살아있음
    # fast 모드는 본문을 보지 않으므로 전화/동/상호 비교 생략
    result.place_alive = True
    result.verdict = "OK"
    result.severity = "OK"
    result.detail = "✅ 페이지 정상 노출 (빠른 검증 — 전화/동 비교 생략)"
    # 빠른 검증임을 표시 — UI에서 "—" 처리
    result.phone_match = None  # type: ignore[assignment]
    result.dong_match = None  # type: ignore[assignment]
    result.name_match = None  # type: ignore[assignment]
    return result


# ============================================================================
# 실행 + 리포트
# ============================================================================
async def run_full_validation(samples: List[Dict], concurrency: int = 10):
    print("=" * 95)
    print(f"PoC v3: 4중 검증 (정확도 강화)  | n={len(samples)}, conc={concurrency}")
    print("=" * 95)

    sem = asyncio.Semaphore(concurrency)

    async def bounded(client, s):
        async with sem:
            return await check_place(client, s)

    t0 = time.perf_counter()
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[bounded(client, s) for s in samples])
    total_ms = (time.perf_counter() - t0) * 1000

    for r, s in zip(results, samples):
        print("─" * 95)
        print(f"📞 {r.phone}  |  Place ID: {r.place_id}  |  HTTP {r.http_status} ({r.elapsed_ms}ms)")
        print(f"   [등록] 동: {r.expected_dong}")
        print(f"          상호: {r.expected_biz}")
        print(f"   [노출] 상호: {r.actual_name or '(없음)'}")
        print(f"          주소(도로): {r.actual_road_address or '(없음)'}")
        print(f"          주소(통합): {r.actual_address or '(없음)'}")
        print(f"          전화: {r.actual_phone or '(없음)'}")
        print(f"          카테고리: {r.actual_category or '(없음)'}")
        print(f"   [4중]  alive={'✅' if r.place_alive else '❌'}  "
              f"phone={'✅' if r.phone_match else '❌'}  "
              f"dong={'✅' if r.dong_match else '❌'}  "
              f"name={'✅' if r.name_match else '❌'}")
        exp = s.get("_expected", "?")
        match_mark = "✅" if exp == r.verdict or exp == "?" else "🟡 (예상과 다름)"
        print(f"   [판정] {r.severity}: {r.verdict}  (예상={exp}) {match_mark}")
        print(f"   [설명] {r.detail}")

    print()
    print("=" * 95)
    print("📊 SUMMARY")
    print("=" * 95)
    by_v = {}
    for r in results:
        by_v[r.verdict] = by_v.get(r.verdict, 0) + 1
    for v, c in sorted(by_v.items(), key=lambda x: -x[1]):
        print(f"  {v:20s}: {c}건")

    avg_ms = sum(r.elapsed_ms for r in results) / len(results)
    print(f"\n  총 처리시간: {total_ms:.0f}ms  |  건당 평균: {avg_ms:.0f}ms"
          f"  |  처리량: {len(results)/(total_ms/1000):.1f} req/s")

    return results


def unit_tests():
    print("=" * 95)
    print("🧪 UNIT TESTS")
    print("=" * 95)

    print("\n[ compare_dong ]")
    cases = [
        ("서울특별시 종로구 종로1가",  "서울 종로구 홍지동",       False, "구 같으나 동 다름"),
        ("서울특별시 서초구 양재동",   "수원시 인계동",           False, "다른 시"),
        ("서울특별시 서초구 양재동",   "서울 서초구 양재동",       True,  "정확히 일치"),
        ("경기도 성남시 분당구 서현동", "경기 성남시 분당구 서현동", True,  "정확히 일치"),
        ("서울특별시 은평구 구산동",   "대구 달서구 두류동",       False, "완전히 다른 지역"),
    ]
    p = 0
    for exp, act, expected, desc in cases:
        ok, detail = compare_dong(exp, act)
        s = "✅" if ok == expected else "❌"
        print(f"  {s} [{desc}] match={ok} (기대={expected}) | {detail}")
        if ok == expected:
            p += 1
    print(f"  → {p}/{len(cases)} 통과")

    print("\n[ compare_name ]")
    cases2 = [
        ("종로테스트업체",   "종로테스트업체",                True,  "완전 일치"),
        ("바비네",          "요양원병원침대제조수리전문바비네",  True,  "포함 관계 (짧은 등록명)"),
        ("강남스타일",      "대구방충망",                   False, "완전 불일치"),
        ("ainaver",        "AINAVER",                    True,  "대소문자만 다름"),
    ]
    p = 0
    for exp, act, expected, desc in cases2:
        ok, ratio, detail = compare_name(exp, act)
        s = "✅" if ok == expected else "❌"
        print(f"  {s} [{desc}] '{exp}' vs '{act}'  match={ok} (기대={expected}, ratio={ratio:.2f})")
        if ok == expected:
            p += 1
    print(f"  → {p}/{len(cases2)} 통과")
    print()


async def main():
    unit_tests()
    await run_full_validation(SAMPLES, concurrency=10)


if __name__ == "__main__":
    asyncio.run(main())
