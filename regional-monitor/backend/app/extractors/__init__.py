"""Naver Place 추출 모듈 패키지.

지연 import로 `python -m app.extractors.phone_to_place` 실행 시
RuntimeWarning(중복 import)을 방지.
"""
__all__ = [
    "ExtractedPlace",
    "extract_place_from_phone",
    "extract_batch",
    "normalize_phone",
    "extract_dong_from_address",
]


def __getattr__(name: str):
    if name in __all__:
        from . import phone_to_place
        return getattr(phone_to_place, name)
    raise AttributeError(f"module 'app.extractors' has no attribute {name!r}")
