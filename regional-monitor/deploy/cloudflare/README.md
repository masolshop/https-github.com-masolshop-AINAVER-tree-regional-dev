# Cloudflare 무료 플랜 연동 가이드 (taziyuk.com)

## 효과 한눈에

| 항목 | 효과 |
|------|------|
| L3/L4 볼륨 공격 | UDP/SYN flood, NTP/DNS amp 공격 무료 무제한 흡수 |
| 봇 차단 | "Bot Fight Mode" 무료 토글 1번이면 알려진 봇 자동 차단 |
| 실서버 IP 은닉 | `3.35.58.206` 직접 노출 차단 → SSH/포트스캔 표적에서 제외 |
| HTTPS | Cloudflare ↔ 클라이언트 구간 자동 SSL (Let's Encrypt 와 별개) |
| CDN | 정적 자산 전세계 엣지 캐시 — 한국 외 트래픽도 빨라짐 |

---

## 1단계: Cloudflare 가입 + 도메인 추가

1. https://dash.cloudflare.com 가입 (무료)
2. **Add a Site** → `taziyuk.com` 입력 → **Free** 플랜 선택
3. Cloudflare 가 현재 DNS 레코드를 자동 스캔 후 보여줌

## 2단계: DNS 레코드 확인

다음 두 레코드만 **Proxy = Proxied (주황 구름)** 로 설정:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `taziyuk.com` | `3.35.58.206` | 🟠 Proxied |
| A | `www` | `3.35.58.206` | 🟠 Proxied |

`MX`, `TXT`(SPF/DKIM 등) 메일 레코드는 **DNS only (회색 구름)** 로 두어야 메일 발송이 정상 동작합니다.

## 3단계: 네임서버 변경

Cloudflare 가 알려주는 2개 네임서버(예: `aria.ns.cloudflare.com`, `cole.ns.cloudflare.com`)를 도메인 등록업체(가비아/카페24/Route53 등)에 등록.

전파에 5분~24시간 소요. Cloudflare 대시보드에서 **Active** 표시되면 완료.

## 4단계: SSL/TLS 모드 — Full (strict)

Cloudflare 대시보드 → **SSL/TLS** → **Overview**:

- **Full (strict)** 선택 (서버에 Let's Encrypt 인증서가 있으므로 가능)
- "Always Use HTTPS" 토글 ON

> ⚠️ "Flexible" 은 Cloudflare↔서버 구간이 평문이라 절대 사용 금지.

## 5단계: 보안 토글 (Free 플랜 무료)

대시보드 → **Security**:

- **Bot Fight Mode**: ON  ← 알려진 봇 자동 차단
- **Challenge Passage**: 30분
- **Security Level**: Medium (사용자 신고 많은 IP 자동 챌린지)
- **Browser Integrity Check**: ON

대시보드 → **Speed** → **Optimization**:

- **Auto Minify**: HTML/CSS/JS 모두 ON (선택)
- **Brotli**: ON

## 6단계: 서버 측 nginx 설정 (real_ip 복원)

Cloudflare 를 거치면 nginx 의 `$remote_addr` 가 항상 Cloudflare edge IP 가 됩니다.
이대로 두면 **모든 사용자가 동일 IP 로 보여 rate-limit/fail2ban 이 무력화**됩니다.

이 디렉토리의 `nginx-cloudflare-realip.conf` 를 적용하세요:

```bash
sudo cp /opt/regionwatch/regional-monitor/deploy/cloudflare/nginx-cloudflare-realip.conf \
        /etc/nginx/conf.d/cloudflare-realip.conf
sudo nginx -t && sudo systemctl reload nginx
```

이후 nginx 액세스 로그·`limit_req`·`fail2ban` 모두 **진짜 클라이언트 IP** 기준으로 작동합니다.

Cloudflare IP 대역은 가끔 갱신되므로 주 1회 자동 동기화 cron 등록을 권장합니다:

```bash
sudo crontab -e
# 매주 일요일 04:00 KST 갱신
0 4 * * 0 /opt/regionwatch/regional-monitor/deploy/cloudflare/update-cf-ips.sh >> /var/log/cf-ip-update.log 2>&1
```

## 7단계: 실서버 IP 은닉 (보안 핵심)

Cloudflare 적용 후 **AWS Lightsail 방화벽** 에서 80/443 포트를 Cloudflare IP 대역만 허용:

1. Lightsail 콘솔 → 인스턴스 → **Networking** → IPv4 Firewall
2. HTTP(80), HTTPS(443) 룰을 다음으로 변경:
   - **Restrict to IP addresses**: Cloudflare IP 대역 (https://www.cloudflare.com/ips-v4/ 의 모든 CIDR)
3. SSH(22)는 본인 IP 만 허용

> ⚠️ Let's Encrypt 갱신 시 80 포트 인바운드 필요. certbot 갱신 직전·직후만 임시 개방하거나 DNS-01 챌린지로 전환.

## 8단계: 검증

Cloudflare 적용 정상 동작 확인:

```bash
# Cloudflare 헤더가 응답에 보여야 함
curl -sI https://taziyuk.com/ | grep -iE 'cf-ray|server'
#   server: cloudflare
#   cf-ray: 8a1b2c3d4e5f6g7h-ICN

# 진짜 IP 가 nginx 액세스 로그에 잘 들어가는지
sudo tail -f /var/log/nginx/access.log
#   203.0.113.45 - - [...] "GET / HTTP/2.0" 200 ...   ← Cloudflare IP 가 아닌 진짜 IP

# nslookup 으로 실서버 IP 가 노출되지 않는지
dig taziyuk.com +short
#   104.21.x.x  (Cloudflare IP)
#   172.67.x.x  (Cloudflare IP)
```

---

## 추가 추천 설정 (시간 날 때)

### Page Rules (무료 3개)
- `*taziyuk.com/api/*` → Cache Level: Bypass (API 캐시 금지)
- `*taziyuk.com/assets/*` → Edge Cache TTL: 1 month, Browser Cache: 1 year
- `*taziyuk.com/admin*` → Security Level: High (어드민 페이지 강한 보호)

### Firewall Rules (무료 5개)
- `(http.request.uri.path contains ".env")` → Block
- `(http.request.uri.path contains ".git")` → Block
- `(http.request.uri.path contains "wp-admin")` → Block (WordPress 봇 차단)
- `(cf.threat_score gt 30)` → Managed Challenge
- `(http.user_agent contains "bot" and not cf.client.bot)` → Managed Challenge

### Under Attack Mode (긴급 시)
대시보드 → **Security** → **Under Attack Mode** ON
모든 방문자에게 5초 챌린지 페이지 표시. 진짜 DDoS 발생 시 켜고, 끝나면 OFF.

---

## 롤백

Cloudflare 가 문제를 일으키면:

1. 도메인 등록업체에서 네임서버를 원래 값(가비아/Route53 등)으로 복구
2. 또는 Cloudflare 대시보드에서 A 레코드의 Proxy 를 회색 구름(DNS only)으로 변경
   → Cloudflare 우회되어 직접 접속 (SSL 인증서는 서버 자체 Let's Encrypt 사용 중이라 즉시 동작)
