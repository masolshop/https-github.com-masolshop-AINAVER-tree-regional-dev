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
    "db":    "db_*.sqlite.gz",
    "users": "user_*.json.gz",
    "code":  "code_*.tar.gz",
}

CATEGORY_SCRIPTS: dict[str, list[str]] = {
    "db":    ["/bin/bash", str(SCRIPT_DIR / "backup_db.sh")],
    "users": ["/usr/bin/python3", str(SCRIPT_DIR / "backup_users.py")],
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
    return info


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
