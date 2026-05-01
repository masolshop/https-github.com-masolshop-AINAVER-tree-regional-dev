"""타지역키워드 DNA 파싱 솔루션 — 규칙 기반 형태소 분석 (AI 미사용).

데이터:
  - data/keyword_dna/business_names.xlsx — 타지역 등록 업체 상호 (1,875개, 회선수 가중치)
  - data/keyword_dna/categories.xlsx     — 업종 리스트 (216개, 업종수 가중치)

파이프라인:
  1) 사전 구축 (오프라인 1회): seed + auto-extracted n-gram → 6 카테고리 라벨링
  2) Aho-Corasick / 최장일치 토크나이저
  3) 분석기: 사용자 입력 키워드를 포함하는 상호만 필터, 회선수 가중 토큰 빈도 → 6 카테고리 DNA
"""
from .dictionary import build_dictionary, load_dictionary, CATEGORIES
from .tokenizer import LongestMatchTokenizer
from .analyzer import analyze_keyword, list_known_keywords
from .compare import compare_keywords
from .graph import build_graph
from .recommend import recommend_keywords

__all__ = [
    "build_dictionary",
    "load_dictionary",
    "CATEGORIES",
    "LongestMatchTokenizer",
    "analyze_keyword",
    "list_known_keywords",
    "compare_keywords",
    "build_graph",
    "recommend_keywords",
]
