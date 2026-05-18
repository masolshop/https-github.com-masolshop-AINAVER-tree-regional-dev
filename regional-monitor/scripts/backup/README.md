# 타지역서비스 자동 백업 시스템

매일 새벽 KST 기준으로 자동 백업이 동작합니다. 시스템 타임존(`/etc/timezone`)은 `Asia/Seoul`로
설정되어 있어 systemd `OnCalendar` 시각이 곧 KST가 됩니다.

## 백업 일정

| 시간 (KST) | 작업 | 산출물 | 위치 |
|---|---|---|---|
| 01:00 | DB 핫 백업 (PostgreSQL: `pg_dump`, SQLite: `.backup` + gzip) | `db_<YYYY-MM-DD>_<HHMMSS>.{sql,sqlite}.gz` | `/home/ubuntu/backups/db/` |
| 01:30 | 사용자별 데이터 export (JSON + gzip) | `user_<id>_<email>_<YYYY-MM-DD>.json.gz` | `/home/ubuntu/backups/users/` |
| 02:00 | 코드 전체 스냅샷 (tar.gz) | `code_<YYYY-MM-DD>_<HHMMSS>.tar.gz` | `/home/ubuntu/backups/code/` |

DB 종류는 `backend/.env` 의 `DATABASE_URL` 로 자동 감지된다 (sqlite/postgresql 모두 지원).

### 사용자별 export 구성 (JSON)
```json
{
  "exported_at":  "<KST ISO>",
  "user":         {<users 행 전체>},
  "places":       [<registered_places ...>],
  "change_events":[<change_events ...>],
  "daily_health_checks": [<최근 30일 ...>],
  "verify_jobs":  [<verify_jobs ...>],
  "payments":     [<payments ...>]
}
```
비밀번호 해시(`hashed_password`)는 export에서 제외됩니다.

## 보관 정책 (Retention)

- **로컬**: 7일 초과 파일 자동 삭제 (각 스크립트 내 `find -mtime +7 -delete`).
- **S3**: 활성화 시 동일 7일 정책 (S3 Lifecycle Rule 권장).
- **Google Drive**: 추후 연동 예정.

## 디렉터리 구조

```
/home/ubuntu/backups/
├── db/
├── users/
├── code/
└── logs/
    ├── backup_db.log
    ├── backup_users.log
    └── backup_code.log
```

## S3 활성화 방법

`/opt/regionwatch/regional-monitor/backend/.env` 에 다음 추가:

```env
BACKUP_S3_ENABLED=true
BACKUP_S3_BUCKET=regionwatch-backups
BACKUP_S3_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

스크립트는 `BACKUP_S3_ENABLED=true` 일 때만 `aws s3 cp` 호출 (boto3 / awscli 둘 다 지원).

## 설치/재설치

```bash
sudo bash /opt/regionwatch/regional-monitor/scripts/backup/install_timers.sh
```

## 수동 실행

```bash
# DB 백업
sudo systemctl start regionwatch-backup-db.service

# 사용자 export
sudo systemctl start regionwatch-backup-users.service

# 코드 백업
sudo systemctl start regionwatch-backup-code.service
```

또는 어드민 UI에서 "백업" 탭 → "지금 실행".

## 타이머 상태 확인

```bash
systemctl list-timers --all | grep regionwatch
sudo journalctl -u regionwatch-backup-db.service -n 50
```

## 복구 절차

### DB 복원

**PostgreSQL**:
```bash
sudo systemctl stop regionwatch-backend
gunzip -c /home/ubuntu/backups/db/db_<DATE>_<TIME>.sql.gz | \
  PGPASSWORD=<pwd> psql -h 127.0.0.1 -U regionwatch regionwatch
sudo systemctl start regionwatch-backend
```

**SQLite**:
```bash
cd /opt/regionwatch/regional-monitor/backend
sudo systemctl stop regionwatch-backend
gunzip -c /home/ubuntu/backups/db/db_<DATE>_<TIME>.sqlite.gz > regional_monitor.db
sudo systemctl start regionwatch-backend
```

### 코드 복원
```bash
sudo systemctl stop regionwatch-backend
cd /opt/regionwatch
sudo tar -xzf /home/ubuntu/backups/code/code_<DATE>_<TIME>.tar.gz
sudo systemctl start regionwatch-backend
```

### 사용자 데이터 부분 복원
JSON 파일을 읽어 필요한 행을 SQL로 복원하거나, 어드민 API에 import 엔드포인트 추가 후 사용.
