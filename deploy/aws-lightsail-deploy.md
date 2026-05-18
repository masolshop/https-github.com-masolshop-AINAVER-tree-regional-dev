# AWS Lightsail Deployment (Seoul ap-northeast-2)

## Server
- **IP**: 3.35.58.206 (Static IP)
- **OS**: Ubuntu 22.04.5 LTS
- **Specs**: 2 GB RAM, 78 GB SSD
- **Path**: `/home/ubuntu/apps/regionwatch/regional-monitor`
- **DB**: SQLite (`backend/regional_monitor.db`)

## Services (systemd)
- `regionwatch-backend.service` — uvicorn (2 workers) on 127.0.0.1:8000
- `nginx.service` — reverse proxy on 0.0.0.0:80

## URLs
- Frontend: http://3.35.58.206/
- API: http://3.35.58.206/api/v1/...
- Health: http://3.35.58.206/health

## Superadmin
- Email: `ceo@femayeon.com`
- Password: `sun3328io$$`  ← 변경 필요!

## Common operations

### Re-deploy (code update)
```bash
ssh -i ~/.ssh/lightsail_seoul.pem ubuntu@3.35.58.206
cd /home/ubuntu/apps/regionwatch
git pull origin genspark_ai_developer
cd regional-monitor/backend && ./venv/bin/pip install -q -r requirements.txt
cd ../frontend && npm install --no-audit --no-fund && npm run build
sudo systemctl restart regionwatch-backend
```

### Restart backend
```bash
sudo systemctl restart regionwatch-backend
sudo journalctl -u regionwatch-backend -f
```

### View logs
```bash
tail -f /home/ubuntu/logs/regionwatch-backend.log
tail -f /home/ubuntu/logs/regionwatch-backend.err.log
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Next steps
- [ ] Add HTTPS with Let's Encrypt (requires domain)
- [ ] Migrate SQLite → PostgreSQL (already running on the box)
- [ ] Setup auto-backup of `regional_monitor.db`
- [ ] Configure SMTP/Slack in `backend/.env`

