# DownloadAja Admin Dashboard

Worker: `dlaja-dash`  
Custom host: `https://dash.dlaja.xyverse.my.id`  
Fallback: `https://dlaja-dash.akuntiktok76y.workers.dev`

## Login URL

Obscure gate path (secret `GATE_PATH`):

```text
https://dash.dlaja.xyverse.my.id/g/<GATE_PATH>/login
```

Root `/` returns 404 on purpose.

## Auth

- Username + password (PBKDF2 hash in `ADMIN_PASS_HASH`)
- Cloudflare Turnstile (`TURNSTILE_SECRET` + sitekey in login.html)
- Session cookie HMAC (`SESSION_SECRET`)

Secrets via `wrangler secret put` (never commit).

## Features

- Remote config in KV (`CONFIG`) → public `GET /api/public/config`
- Admin UI: maintenance, YouTube web policy, default quality, APK URL, disabled platforms
- `robots.txt` Disallow all · `x-robots-tag: noindex`

## Deploy

```bash
cd dash
npx wrangler deploy
```
