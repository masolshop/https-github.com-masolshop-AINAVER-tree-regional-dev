#!/usr/bin/env python3
"""백업 스크립트용 Google Drive 업로드 후크 (CLI).

사용:
    python3 gdrive_upload.py <category> <local_path>

  · category: db / users / code
  · local_path: 업로드할 파일 절대경로

환경변수 (regional-monitor/backend/.env 또는 systemd EnvironmentFile):
  GDRIVE_ENABLED            true 일 때만 동작 (기본: false)
  GDRIVE_CREDENTIALS_JSON   Service Account JSON 파일 경로
  GDRIVE_FOLDER_ID          Drive 측 백업 루트 폴더 ID
  GDRIVE_RETENTION_DAYS     자동 정리 보존일 (기본 30)

비활성/실패 시에도 종료코드 0 반환 — 백업 스크립트 자체는 절대 실패시키지 않는다.
업로드 결과는 /home/ubuntu/backups/logs/gdrive_upload.log 에 기록된다.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

LOG_DIR = Path(os.environ.get("BACKUP_ROOT", "/home/ubuntu/backups")) / "logs"
LOG_FILE = LOG_DIR / "gdrive_upload.log"


def _log(msg: str) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S %Z')}] {msg}"
        print(line, flush=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        # 로그 실패는 무시 (백업 본체는 계속 진행되어야 함)
        pass


def _load_env_file() -> None:
    """.env 가 있으면 환경변수에 로드 (systemd EnvironmentFile 미사용 환경 대비)."""
    candidates = [
        Path(os.environ.get("APP_DIR", "/opt/regionwatch/regional-monitor")) / "backend" / ".env",
    ]
    for p in candidates:
        if not p.exists():
            continue
        try:
            for ln in p.read_text(encoding="utf-8").splitlines():
                ln = ln.strip()
                if not ln or ln.startswith("#") or "=" not in ln:
                    continue
                k, _, v = ln.partition("=")
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        except Exception:
            pass


def _is_enabled() -> bool:
    if os.environ.get("GDRIVE_ENABLED", "false").strip().lower() not in ("1", "true", "yes", "y", "on"):
        return False
    cred = os.environ.get("GDRIVE_CREDENTIALS_JSON")
    if not cred or not Path(cred).exists():
        return False
    if not os.environ.get("GDRIVE_FOLDER_ID"):
        return False
    return True


SCOPES = ["https://www.googleapis.com/auth/drive"]
SUBFOLDER = {"db": "db", "users": "users", "code": "code"}


def upload(category: str, local_path: Path) -> int:
    """1건 업로드 + 실패 시 prune 시도 안 함. 종료코드 반환."""
    if category not in SUBFOLDER:
        _log(f"ERROR: unknown category={category}")
        return 0  # 백업 자체는 성공이므로 0
    if not local_path.exists():
        _log(f"ERROR: local file not found: {local_path}")
        return 0

    if not _is_enabled():
        _log(f"SKIP gdrive upload (disabled) cat={category} file={local_path.name}")
        return 0

    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except Exception as e:
        _log(f"WARN: google-api-python-client 미설치 — pip install google-api-python-client : {e}")
        return 0

    cred_path = os.environ["GDRIVE_CREDENTIALS_JSON"]
    parent_root = os.environ["GDRIVE_FOLDER_ID"]

    try:
        creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
        service = build("drive", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        _log(f"ERROR: Drive auth failed: {e}")
        return 0

    sub = SUBFOLDER[category]

    # 카테고리 하위 폴더 ensure
    try:
        q = (
            f"name = '{sub}' and mimeType = 'application/vnd.google-apps.folder' "
            f"and '{parent_root}' in parents and trashed = false"
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
            sub_id = items[0]["id"]
        else:
            created = service.files().create(
                body={
                    "name": sub,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [parent_root],
                },
                fields="id",
                supportsAllDrives=True,
            ).execute()
            sub_id = created["id"]
            _log(f"created subfolder cat={category} id={sub_id}")
    except Exception as e:
        _log(f"ERROR: subfolder ensure failed: {e}")
        return 0

    # 업로드 (이름 중복 시 그대로 추가 — Drive는 동명 다중 허용; 어드민 sync 가 정리)
    try:
        t0 = time.time()
        media = MediaFileUpload(str(local_path), resumable=True)
        f = service.files().create(
            body={"name": local_path.name, "parents": [sub_id]},
            media_body=media,
            fields="id,name,size,createdTime,webViewLink",
            supportsAllDrives=True,
        ).execute()
        elapsed = time.time() - t0
        _log(
            f"OK cat={category} name={f.get('name')} id={f.get('id')} "
            f"size={f.get('size')} elapsed={elapsed:.1f}s"
        )
        # 성공 결과를 stdout JSON으로도 출력 (셸 스크립트에서 파싱 가능)
        print(json.dumps({"ok": True, **f}, ensure_ascii=False), flush=True)
    except Exception as e:
        _log(f"ERROR: upload failed name={local_path.name}: {e}\n{traceback.format_exc()[:600]}")
        return 0

    # 보존 정책 (best-effort)
    try:
        days = int(os.environ.get("GDRIVE_RETENTION_DAYS", "30"))
        cutoff_iso = (datetime.utcnow().replace(microsecond=0).isoformat() + "Z")
        # createdTime <= cutoff (-days)
        from datetime import timedelta, timezone
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_str = cutoff_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        q2 = f"'{sub_id}' in parents and trashed = false and createdTime < '{cutoff_str}'"
        page = None
        deleted = 0
        while True:
            res2 = service.files().list(
                q=q2,
                spaces="drive",
                fields="nextPageToken, files(id,name,createdTime)",
                pageSize=100,
                pageToken=page,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            ).execute()
            for old in res2.get("files", []):
                try:
                    service.files().delete(fileId=old["id"], supportsAllDrives=True).execute()
                    deleted += 1
                except Exception as e2:
                    _log(f"WARN: prune delete failed id={old['id']}: {e2}")
            page = res2.get("nextPageToken")
            if not page:
                break
        if deleted > 0:
            _log(f"prune cat={category} deleted_old={deleted} cutoff={cutoff_str} retention={days}d")
    except Exception as e:
        _log(f"WARN: prune failed cat={category}: {e}")

    return 0


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: gdrive_upload.py <category> <local_path>", file=sys.stderr)
        return 0
    _load_env_file()
    cat = sys.argv[1].strip()
    path = Path(sys.argv[2]).expanduser().resolve()
    return upload(cat, path)


if __name__ == "__main__":
    sys.exit(main())
