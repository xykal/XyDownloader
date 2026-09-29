# DownloadAja Admin Dashboard

Worker: `dlaja-dash`  
Custom host: `https://dash.dlaja.xyverse.my.id`  
Fallback: `https://dash.xyverse.my.id` (hostname stabil, bukan `*.workers.dev` yang bisa ikut berubah saat subdomain akun diganti)

## Login URL

Obscure gate path (secret `GATE_PATH`):

```text
https://dash.dlaja.xyverse.my.id/g/<GATE_PATH>/login
```

Root `/` returns 404 on purpose.

## Auth

- Username + password (hash di `ADMIN_PASS_HASH`: `hmac-sha256$...` atau `pbkdf2$...`)
- Cloudflare Turnstile (`TURNSTILE_SECRET` + sitekey in login.html)
- Session cookie HMAC (`SESSION_SECRET`)

Secrets via `wrangler secret put` (never commit).

## Secret yang dipakai

| Secret | Fungsi |
|---|---|
| `ADMIN_USER`, `ADMIN_PASS_HASH` | login admin |
| `SESSION_SECRET` | tanda tangan cookie sesi |
| `TURNSTILE_SECRET` | verifikasi captcha login |
| `PASS_PEPPER` | (opsional) pepper buat hash `hmac-sha256$` |
| `GATE_PATH` | path gelap buat buka UI |
| `PROBE_REPORT_SECRET` | HMAC buat nerima laporan "siapa yang nyoba nembus API" dari Vercel |

`PROBE_REPORT_SECRET` harus SAMA dengan env `XYDL_PROBE_SECRET` di Vercel. Fungsinya:
endpoint publik `POST /api/public/beacon` tidak boleh percaya `body.ip` kiriman browser
asing — kalau boleh, siapa pun bisa nulis IP karangan ke tabel device/probe di UI admin.
API produk (Vercel) yang lihat IP asli pengguna, jadi laporannya ditandatangani
`X-Xydl-Probe-Ts` + `X-Xydl-Probe-Sig = hex(hmac_sha256(secret, "<ts>.<ip>"))`, jendela
waktu 5 menit. Tanpa secret ini, dash fallback ke `CF-Connecting-IP` (probe dari Vercel
cuma kehilangan kolom IP — tidak error).

## Beacon publik & batas tulis KV

`POST /api/public/beacon` dan `GET /api/public/config` itu publik tanpa auth, dan tiap
event bisa jadi ±6 operasi tulis KV. Ada budget per-isolate
(`writeAllowed` di `src/index.js`): 40 event/menit/IP, 12 probe/menit/IP, 600 tulis/menit
per isolate. Lewat batas → tetap dibalas `200 {ok:true, limited:true}` dan TIDAK ditulis
(klien tidak boleh lihat error, nanti dia retry-storm). Naikkan lewat konstanta di bagian
atas file kalau trafik lagi tinggi — jangan lewat UI.

## Features

- Remote config in KV (`CONFIG`) → public `GET /api/public/config`
- Admin UI: maintenance, YouTube web policy, default quality, APK URL, disabled platforms
- `robots.txt` Disallow all · `x-robots-tag: noindex`

## Deploy

```bash
cd dash
npx wrangler deploy
```
