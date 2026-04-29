"""백업 관리 라우터 — /api/v1/admin/backup/*

슈퍼어드민 전용. 백업 파일 목록/다운로드/즉시 실행을 지원한다.

엔드포인트:
  GET    /admin/backup/list                  — 카테고리별 백업 파일 목록
  GET    /admin/backup/download/{category}/{filename} — 백업 파일 다운로드
  POST   /admin/backup/run/{category}        — 즉시 실행 (db / users / code)
  GET    /admin/backup/status                — 타이머 상태 + 디스크 사용량
"""
from __future__ import annotations

import asyncio
import os
import shlex
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.api.deps import require_superadmin
from app.core.time_utils import now_kst, KST
from app.services import gdrive_uploader


router = APIRouter(
    prefix="/admin/backup",
    tags=["admin", "backup"],
    dependencies=[Depends(require_superadmin)],
)

# ── 경로 설정 ──────────────────────────────────
BACKUP_ROOT = Path(os.environ.get("BACKUP_ROOT", "/home/ubuntu/backups"))
APP_DIR = Path(os.environ.get("APP_DIR", "/opt/regionwatch/regional-monitor"))
SCRIPT_DIR = APP_DIR / "scripts" / "backup"

CATEGORY_DIRS: dict[str, Path] = {
    "db":    BACKUP_ROOT / "db",
    "users": BACKUP_ROOT / "users",
    "code":  BACKUP_ROOT / "code",
}

CATEGORY_PATTERNS: dict[str, str] = {
    # db: matches both db_*.sqlite.gz (SQLite hot-copy) and db_*.sql.gz (pg_dump)
    "db":    "db_*.gz",
    "users": "user_*.json.gz",
    "code":  "code_*.tar.gz",
}

VENV_PY = APP_DIR / "backend" / "venv" / "bin" / "python"
CATEGORY_SCRIPTS: dict[str, list[str]] = {
    "db":    ["/bin/bash", str(SCRIPT_DIR / "backup_db.sh")],
    "users": [str(VENV_PY) if VENV_PY.exists() else "/usr/bin/python3",
              str(SCRIPT_DIR / "backup_users.py")],
    "code":  ["/bin/bash", str(SCRIPT_DIR / "backup_code.sh")],
}

Category = Literal["db", "users", "code"]


# ── helpers ────────────────────────────────────

def _list_files(category: str) -> list[dict]:
    d = CATEGORY_DIRS.get(category)
    pat = CATEGORY_PATTERNS.get(category)
    if not d or not pat or not d.exists():
        return []
    items: list[dict] = []
    for p in sorted(d.glob(pat), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            st = p.stat()
            items.append({
                "filename": p.name,
                "size": st.st_size,
                "size_human": _human(st.st_size),
                "mtime": datetime.fromtimestamp(st.st_mtime, tz=KST).isoformat(),
            })
        except OSError:
            continue
    return items


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} TB"


def _safe_resolve(category: str, filename: str) -> Path:
    """경로 탈출 방지 — category 디렉터리 안의 파일만 허용."""
    if category not in CATEGORY_DIRS:
        raise HTTPException(404, f"Unknown category: {category}")
    base = CATEGORY_DIRS[category].resolve()
    target = (base / filename).resolve()
    if not str(target).startswith(str(base) + os.sep) and target != base:
        raise HTTPException(400, "Invalid filename (path traversal blocked)")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "File not found")
    return target


# ── 엔드포인트 ────────────────────────────────

@router.get("/list")
async def list_backups() -> dict:
    """카테고리별 백업 파일 목록.

    응답:
    ```
    {
      "db":    [{"filename","size","size_human","mtime"}, ...],
      "users": [...],
      "code":  [...],
      "now_kst": "2026-04-27T...+09:00"
    }
    ```
    """
    return {
        "now_kst": now_kst().isoformat(),
        "db":    _list_files("db"),
        "users": _list_files("users"),
        "code":  _list_files("code"),
    }


@router.get("/status")
async def status_info() -> dict:
    """디스크 사용량 + 다음 실행 시각 (간이 정보)."""
    info: dict = {"now_kst": now_kst().isoformat(), "categories": {}}
    total_bytes = 0
    for cat, d in CATEGORY_DIRS.items():
        if not d.exists():
            info["categories"][cat] = {"count": 0, "bytes": 0, "size_human": "0 B"}
            continue
        files = list(d.glob(CATEGORY_PATTERNS[cat]))
        sz = sum(f.stat().st_size for f in files if f.is_file())
        info["categories"][cat] = {
            "count": len(files),
            "bytes": sz,
            "size_human": _human(sz),
            "latest_mtime": (
                datetime.fromtimestamp(
                    max((f.stat().st_mtime for f in files), default=0), tz=KST
                ).isoformat() if files else None
            ),
        }
        total_bytes += sz
    info["total_bytes"] = total_bytes
    info["total_size_human"] = _human(total_bytes)
    info["s3_enabled"] = os.environ.get("BACKUP_S3_ENABLED", "false").lower() == "true"
    info["s3_bucket"] = os.environ.get("BACKUP_S3_BUCKET", "") if info["s3_enabled"] else None
    info["retention_days"] = 7
    info["schedule"] = {
        "db":    "01:00 KST",
        "users": "01:30 KST",
        "code":  "02:00 KST",
    }
    # Google Drive 상태 (활성/비활성, 사유)
    info["gdrive"] = gdrive_uploader.status_info()
    return info


# ──────────────────────────────────────────────────────────────
# Google Drive 업로드 (Service Account)
# ──────────────────────────────────────────────────────────────

@router.get("/gdrive/status")
async def gdrive_status() -> dict:
    """Drive 연결 상태 + 원격 파일 카운트."""
    info = gdrive_uploader.status_info()
    if info.get("ready"):
        try:
            files = gdrive_uploader.list_remote()
            from collections import Counter
            cnt = Counter(f["category"] for f in files)
            total_size = sum(f.get("size", 0) for f in files)
            info["remote_total"] = len(files)
            info["remote_total_size"] = total_size
            info["remote_total_size_human"] = _human(total_size)
            info["remote_by_category"] = {c: cnt.get(c, 0) for c in CATEGORY_DIRS.keys()}
        except Exception as e:  # noqa: BLE001
            info["remote_error"] = str(e)[:300]
    return info


@router.get("/gdrive/list")
async def gdrive_list(category: str | None = None) -> dict:
    """Drive 측 파일 목록 (카테고리 선택 가능)."""
    if not gdrive_uploader.is_enabled():
        return {"ok": False, "files": [], "reason": "disabled", "status": gdrive_uploader.status_info()}
    if category and category not in CATEGORY_DIRS:
        raise HTTPException(400, f"Unknown category: {category}")
    try:
        files = gdrive_uploader.list_remote(category=category)
        return {"ok": True, "files": files, "count": len(files), "now_kst": now_kst().isoformat()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"gdrive list failed: {e}")


@router.post("/gdrive/upload/{category}/{filename}")
async def gdrive_upload_one(category: str, filename: str) -> dict:
    """단일 로컬 백업 파일을 Drive 로 업로드."""
    if not gdrive_uploader.is_enabled():
        raise HTTPException(
            400,
            "Google Drive 업로드 비활성 — .env 의 GDRIVE_ENABLED / GDRIVE_CREDENTIALS_JSON / GDRIVE_FOLDER_ID 확인",
        )
    target = _safe_resolve(category, filename)
    try:
        # Drive 호출은 동기 블로킹 → 스레드 오프로드
        result = await asyncio.to_thread(
            gdrive_uploader.upload_file, str(target), category
        )
        return {"ok": True, "category": category, "filename": filename, **result}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"upload failed: {e}")


@router.post("/gdrive/sync/{category}")
async def gdrive_sync_category(category: str) -> dict:
    """카테고리 전체 동기화 — 로컬에 있고 Drive 에 없는 파일만 업로드."""
    if not gdrive_uploader.is_enabled():
        raise HTTPException(400, "Google Drive 업로드 비활성")
    if category not in CATEGORY_DIRS:
        raise HTTPException(400, f"Unknown category: {category}")

    local_files = _list_files(category)
    try:
        remote_files = await asyncio.to_thread(
            gdrive_uploader.list_remote, category
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"gdrive list failed: {e}")

    remote_names = {f["name"] for f in remote_files}
    base_dir = CATEGORY_DIRS[category]

    uploaded: list[dict] = []
    skipped: list[str] = []
    errors: list[dict] = []
    for lf in local_files:
        name = lf["filename"]
        if name in remote_names:
            skipped.append(name)
            continue
        path = base_dir / name
        try:
            r = await asyncio.to_thread(
                gdrive_uploader.upload_file, str(path), category
            )
            uploaded.append({"name": name, "file_id": r.get("file_id"), "size": r.get("size")})
        except Exception as e:  # noqa: BLE001
            errors.append({"name": name, "error": str(e)[:300]})

    return {
        "ok": True,
        "category": category,
        "uploaded": uploaded,
        "uploaded_count": len(uploaded),
        "skipped_count": len(skipped),
        "errors": errors,
        "now_kst": now_kst().isoformat(),
    }


@router.post("/gdrive/prune")
async def gdrive_prune(category: str | None = None, days: int | None = None) -> dict:
    """Drive 측 보존 정책 적용 — days 초과 파일 자동 삭제."""
    if not gdrive_uploader.is_enabled():
        raise HTTPException(400, "Google Drive 업로드 비활성")
    if category and category not in CATEGORY_DIRS:
        raise HTTPException(400, f"Unknown category: {category}")
    try:
        return await asyncio.to_thread(
            gdrive_uploader.prune_old, category, days
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"prune failed: {e}")


@router.delete("/gdrive/file/{file_id}")
async def gdrive_delete_one(file_id: str) -> dict:
    """Drive 단건 삭제 (file_id 기반)."""
    if not gdrive_uploader.is_enabled():
        raise HTTPException(400, "Google Drive 업로드 비활성")
    try:
        return await asyncio.to_thread(gdrive_uploader.delete_remote, file_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"delete failed: {e}")


@router.get("/download/{category}/{filename}")
async def download_backup(category: str, filename: str):
    """백업 파일 다운로드."""
    target = _safe_resolve(category, filename)
    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type="application/octet-stream",
    )


@router.post("/run/{category}")
async def run_backup(category: str) -> dict:
    """백업 즉시 실행.

    카테고리: db / users / code

    실행은 비동기로 트리거되고, 완료 전이라도 즉시 응답한다.
    실제 결과는 /admin/backup/list 또는 로그(/home/ubuntu/backups/logs/)에서 확인.
    """
    if category not in CATEGORY_SCRIPTS:
        raise HTTPException(400, f"Unknown category: {category}")

    cmd = CATEGORY_SCRIPTS[category]
    script_path = Path(cmd[1])
    if not script_path.exists():
        raise HTTPException(
            500,
            f"Backup script not found: {script_path} "
            "(scripts/backup/ 가 서버에 배포되었는지 확인)"
        )

    started_at = now_kst().isoformat()
    unit = f"regionwatch-backup-{category}.service"

    async def _try_systemctl(args: list[str]) -> tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
        return proc.returncode or 0, (stderr.decode("utf-8", errors="replace") +
                                       stdout.decode("utf-8", errors="replace")).strip()

    try:
        # 1차: systemctl start (PolicyKit 허용 환경)
        rc, err1 = await _try_systemctl(["systemctl", "start", "--no-block", unit])
        if rc == 0:
            return {
                "ok": True,
                "category": category,
                "started_at": started_at,
                "method": "systemctl",
                "unit": unit,
                "message": "백업이 시작되었습니다. 완료 후 목록에서 확인하세요.",
            }

        # 2차: sudo -n systemctl (sudoers.d/regionwatch-backup 활성화 시)
        rc2, err2 = await _try_systemctl(
            ["sudo", "-n", "/bin/systemctl", "start", "--no-block", unit]
        )
        if rc2 == 0:
            return {
                "ok": True,
                "category": category,
                "started_at": started_at,
                "method": "sudo-systemctl",
                "unit": unit,
                "message": "백업이 시작되었습니다 (sudo). 완료 후 목록에서 확인하세요.",
            }

        # 3차: 직접 스크립트 실행 (백그라운드 nohup)
        proc3 = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
        return {
            "ok": True,
            "category": category,
            "started_at": started_at,
            "method": "direct",
            "pid": proc3.pid,
            "systemctl_error": err1,
            "sudo_error": err2,
            "message": "systemctl 권한 부족 — 직접 실행으로 시작했습니다.",
        }
    except asyncio.TimeoutError:
        raise HTTPException(504, "Backup trigger timed out")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Failed to start backup: {e}")


__all__ = ["router"]
