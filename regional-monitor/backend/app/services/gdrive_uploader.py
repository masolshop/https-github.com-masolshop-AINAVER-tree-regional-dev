"""Google Drive 업로드 서비스 (Service Account 인증).

기능:
  · upload_file(local_path, category)        — 로컬 백업 파일 → Drive 업로드
  · list_remote(category)                    — Drive 측 파일 목록
  · delete_remote(file_id)                   — 단일 파일 삭제
  · prune_old(category, days=30)             — 보존 정책 (오래된 파일 자동 삭제)
  · is_enabled()                             — Drive 연결 가능 여부

폴더 구조:
  GDRIVE_FOLDER_ID (root)
    ├─ db/
    ├─ users/
    └─ code/

환경변수:
  GDRIVE_ENABLED            — true/false  (기본 false — 비활성)
  GDRIVE_CREDENTIALS_JSON   — Service Account JSON 파일 경로
  GDRIVE_FOLDER_ID          — Drive 측 백업 루트 폴더 ID
  GDRIVE_RETENTION_DAYS     — 자동 정리 보존일 (기본 30)

비활성 상태(GDRIVE_ENABLED=false 또는 라이브러리 미설치)에서는
모든 함수가 안전하게 no-op/예외 반환하여 서버 기동을 막지 않는다.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("gdrive")
log.setLevel(logging.INFO)


# ── 라이브러리 지연 임포트 ─────────────────────────────────────
# google-api-python-client 가 설치 안 된 환경에서도 서버는 정상 기동되어야 한다.
_DRIVE_LIBS_AVAILABLE: bool | None = None
_service_cache: Any = None
_service_cache_at: float = 0.0


def _has_libs() -> bool:
    global _DRIVE_LIBS_AVAILABLE
    if _DRIVE_LIBS_AVAILABLE is not None:
        return _DRIVE_LIBS_AVAILABLE
    try:
        import google.oauth2.service_account  # noqa: F401
        from googleapiclient.discovery import build  # noqa: F401
        _DRIVE_LIBS_AVAILABLE = True
    except Exception as e:
        log.warning("[gdrive] google-api-python-client 미설치 — Drive 업로드 비활성: %s", e)
        _DRIVE_LIBS_AVAILABLE = False
    return _DRIVE_LIBS_AVAILABLE


# ── 환경변수 helper ──────────────────────────────────────────
def _env_bool(key: str, default: bool = False) -> bool:
    v = os.environ.get(key)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "y", "on")


def _credentials_path() -> str | None:
    return os.environ.get("GDRIVE_CREDENTIALS_JSON")


def _folder_id() -> str | None:
    return os.environ.get("GDRIVE_FOLDER_ID")


def _retention_days() -> int:
    try:
        return int(os.environ.get("GDRIVE_RETENTION_DAYS", "30"))
    except ValueError:
        return 30


SCOPES = ["https://www.googleapis.com/auth/drive"]
# 카테고리별 하위 폴더 이름 — Drive 측에서 자동 생성/캐시
CATEGORY_SUBFOLDERS = {"db": "db", "users": "users", "code": "code"}


def is_enabled() -> bool:
    """GDRIVE_ENABLED=true + 라이브러리 + 키파일 모두 충족해야 사용 가능."""
    if not _env_bool("GDRIVE_ENABLED", False):
        return False
    if not _has_libs():
        return False
    cred = _credentials_path()
    if not cred or not Path(cred).exists():
        return False
    if not _folder_id():
        return False
    return True


def status_info() -> dict:
    """진단용 — 어드민 UI 에서 활성/비활성 사유 표시."""
    cred = _credentials_path()
    folder = _folder_id()
    return {
        "enabled": _env_bool("GDRIVE_ENABLED", False),
        "ready": is_enabled(),
        "libs_installed": _has_libs(),
        "credentials_path_set": bool(cred),
        "credentials_path_exists": bool(cred and Path(cred).exists()),
        "folder_id_set": bool(folder),
        "folder_id": folder if folder else None,
        "retention_days": _retention_days(),
    }


# ── Drive 서비스 객체 (캐싱) ──────────────────────────────────
def _get_service() -> Any:
    """googleapiclient Drive v3 서비스 핸들 (lazy + 캐시)."""
    global _service_cache, _service_cache_at
    if not _has_libs():
        raise RuntimeError("google-api-python-client 미설치 — pip install google-api-python-client")

    cred_path = _credentials_path()
    if not cred_path or not Path(cred_path).exists():
        raise RuntimeError(
            f"GDRIVE_CREDENTIALS_JSON 가 가리키는 파일을 찾을 수 없습니다: {cred_path}"
        )

    import time as _time
    # 12시간 캐시 — 서비스 객체는 토큰 자동 갱신 함
    if _service_cache is not None and (_time.time() - _service_cache_at) < 12 * 3600:
        return _service_cache

    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    _service_cache = service
    _service_cache_at = _time.time()
    return service


# ── 카테고리 하위 폴더 ID 캐시 ────────────────────────────────
_subfolder_cache: dict[str, str] = {}


def _ensure_subfolder(category: str) -> str:
    """카테고리 하위 폴더 ID 반환 — 없으면 생성, 캐시 사용."""
    if category in _subfolder_cache:
        return _subfolder_cache[category]

    sub_name = CATEGORY_SUBFOLDERS.get(category)
    if not sub_name:
        raise ValueError(f"Unknown category: {category}")

    parent = _folder_id()
    if not parent:
        raise RuntimeError("GDRIVE_FOLDER_ID 미설정")

    service = _get_service()

    # 이미 존재하는지 검색
    q = (
        f"name = '{sub_name}' "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and '{parent}' in parents and trashed = false"
    )
    res = service.files().list(
        q=q,
        spaces="drive",
        fields="files(id,name)",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    items = res.get("files", [])
    if items:
        sid = items[0]["id"]
        _subfolder_cache[category] = sid
        return sid

    # 없으면 생성
    body = {
        "name": sub_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent],
    }
    created = service.files().create(
        body=body, fields="id", supportsAllDrives=True
    ).execute()
    sid = created["id"]
    _subfolder_cache[category] = sid
    log.info("[gdrive] subfolder created category=%s id=%s", category, sid)
    return sid


# ── 핵심 동작 ────────────────────────────────────────────────
def upload_file(local_path: str | Path, category: str) -> dict:
    """로컬 파일을 Drive 카테고리 폴더로 업로드.

    Returns: {ok, file_id, name, size, web_view_link, ...}
    """
    if not is_enabled():
        raise RuntimeError("Google Drive 업로드 비활성 (GDRIVE_ENABLED 또는 키 미설정)")

    p = Path(local_path)
    if not p.exists() or not p.is_file():
        raise FileNotFoundError(f"Local file not found: {p}")

    from googleapiclient.http import MediaFileUpload

    parent_id = _ensure_subfolder(category)
    service = _get_service()

    body = {"name": p.name, "parents": [parent_id]}
    media = MediaFileUpload(str(p), resumable=True)
    file = service.files().create(
        body=body,
        media_body=media,
        fields="id,name,size,createdTime,webViewLink",
        supportsAllDrives=True,
    ).execute()

    log.info(
        "[gdrive] uploaded category=%s name=%s id=%s size=%s",
        category, p.name, file.get("id"), file.get("size"),
    )
    return {
        "ok": True,
        "file_id": file.get("id"),
        "name": file.get("name"),
        "size": int(file.get("size") or 0),
        "created_time": file.get("createdTime"),
        "web_view_link": file.get("webViewLink"),
    }


def list_remote(category: str | None = None, page_size: int = 200) -> list[dict]:
    """Drive 측 백업 파일 목록.

    category=None → 모든 카테고리 통합. 그 외 db/users/code 만 가능.
    """
    if not is_enabled():
        return []

    service = _get_service()
    cats = [category] if category else list(CATEGORY_SUBFOLDERS.keys())

    out: list[dict] = []
    for cat in cats:
        try:
            sid = _ensure_subfolder(cat)
        except Exception as e:
            log.warning("[gdrive] subfolder lookup failed cat=%s err=%s", cat, e)
            continue

        q = f"'{sid}' in parents and trashed = false"
        page_token: str | None = None
        while True:
            res = service.files().list(
                q=q,
                spaces="drive",
                fields="nextPageToken, files(id,name,size,createdTime,modifiedTime,webViewLink)",
                pageSize=page_size,
                pageToken=page_token,
                orderBy="createdTime desc",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()
            for f in res.get("files", []):
                out.append({
                    "category": cat,
                    "file_id": f.get("id"),
                    "name": f.get("name"),
                    "size": int(f.get("size") or 0),
                    "created_time": f.get("createdTime"),
                    "modified_time": f.get("modifiedTime"),
                    "web_view_link": f.get("webViewLink"),
                })
            page_token = res.get("nextPageToken")
            if not page_token:
                break
    return out


def delete_remote(file_id: str) -> dict:
    """Drive 파일 단건 삭제."""
    if not is_enabled():
        raise RuntimeError("Google Drive 비활성")
    service = _get_service()
    service.files().delete(fileId=file_id, supportsAllDrives=True).execute()
    log.info("[gdrive] deleted file_id=%s", file_id)
    return {"ok": True, "file_id": file_id}


def prune_old(category: str | None = None, days: int | None = None) -> dict:
    """보존 정책 — days 초과 파일 삭제.

    Returns: {deleted, kept, errors, cutoff_iso}
    """
    if not is_enabled():
        return {"ok": False, "reason": "disabled"}

    days = days if days is not None else _retention_days()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_iso = cutoff.isoformat()

    deleted = 0
    kept = 0
    errors: list[dict] = []
    files = list_remote(category=category)

    for f in files:
        ct_str = f.get("created_time") or f.get("modified_time")
        if not ct_str:
            kept += 1
            continue
        # createdTime 은 RFC3339 → fromisoformat 처리
        try:
            ct = datetime.fromisoformat(ct_str.replace("Z", "+00:00"))
        except Exception:
            kept += 1
            continue
        if ct < cutoff:
            try:
                delete_remote(f["file_id"])
                deleted += 1
            except Exception as e:  # noqa: BLE001
                errors.append({"file_id": f["file_id"], "name": f["name"], "error": str(e)[:200]})
        else:
            kept += 1

    return {
        "ok": True,
        "deleted": deleted,
        "kept": kept,
        "errors": errors,
        "cutoff_iso": cutoff_iso,
        "retention_days": days,
    }


__all__ = [
    "is_enabled",
    "status_info",
    "upload_file",
    "list_remote",
    "delete_remote",
    "prune_old",
]
