# APK-first: Cloudflare hosting, no downloader backend

## Active architecture

- `dlaja.xyverse.my.id`: Worker `dlaja-web` serves static files from `web/public/`.
- `dlaja.projectkal.my.id`: canonical redirect to the main hostname on the same Worker.
- APK binaries remain on GitHub Releases, not streamed through the landing Worker.
- `/api/health` is a lightweight deployment health check, not a Python API.
- Former web downloader endpoints return HTTP 410 with a message directing users to Android.
- Python backend source and the previous web UI remain in `api/`, `xydl/`, and `public/` for development/history. They are **not** deployed by the production workflow.
- No Vercel or Railway service is required by this architecture. Existing Vercel resources are not deleted, and no paid subscription has been created or changed.
- Proxy/dashboard Workers are retained for compatibility; they are not dependencies of the landing page's APK download links.

## Deployment

`web/wrangler.toml` describes the static assets and both custom domains. CI uses the existing Cloudflare secrets. It no longer invokes Vercel.

```sh
python scripts/build_apk_landing.py
cd web
npx wrangler@4 deploy
```

Deploy workflow runs on relevant main-branch changes, release publication, a weekly schedule, or manual dispatch. The build fetches the latest **published release** and refuses to deploy if one of the three APK architectures is absent. No GitHub token is shipped to the browser. The manifest can remain on the previous release if a newer build fails; links always remain visible via the GitHub Releases fallback.

APK versions are displayed from `releases.json`, not hard-coded into the page. Existing latest published APK at cutover: **v1.3.4**. The modular-engine main-branch Android builds passed, but they are CI artifacts, not a newly tagged release. Hosting migration does not silently publish a new APK version or change its signing key.

## Traffic and cost controls

- No video extraction, transcoding, or media proxying exists in the landing Worker.
- `/download/<arch>` redirects to a validated official GitHub APK URL; invalid/missing data falls back to the official release page.
- No keepalive polling, database, cron Worker, external fonts, frontend analytics, or dynamic GitHub API calls are required by the page.
- Cloudflare/GitHub usage policies and limits still apply. This is not a claim of unlimited free bandwidth.

## Validation

- Python regression suite: 115 passed.
- JavaScript suite: 64 passed, including 8 new landing/security tests.
- New Playwright landing suite: 4 passed across desktop/mobile (layout, links, health, API retirement, 404).
- Existing backend/UI tests remain available independently.
- Main-branch modular Android build succeeded before this migration. No APK code changed in the hosting cutover.

## Operations

1. Check `/api/health` for `mode: apk-only`.
2. Check `/releases.json` for all three architectures.
3. Check `/download/arm64-v8a` returns a 302 to the official APK, rather than transferring APK bytes.
4. `Monitor produksi` now checks the APK-only health signature, plus the existing proxy/dashboard endpoints.
5. To roll back the landing, deploy a prior Worker version in Cloudflare. The old Vercel deployment is blocked by fair-use limits and is **not** a working rollback origin until Vercel restores it.

## Local tests

```sh
python -m pytest -q
node --test tests/js/*.test.mjs
npm ci
npx playwright install --with-deps chromium
npm run e2e:landing
```
