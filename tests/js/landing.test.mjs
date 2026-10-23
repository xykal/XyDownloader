import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../web/src/index.js';

const url = 'https://dlaja.xyverse.my.id';
const asset = {arch: 'arm64-v8a', url: 'https://github.com/xykal/XyDownloader/releases/download/v1.3.4/DownloadAja-1.3.4-arm64-v8a.apk'};
function env(assets = [asset]) { return {ASSETS: {fetch: async () => Response.json({assets})}}; }

test('health describes APK-only hosting, not a Python downloader', async () => {
 const r = await worker.fetch(new Request(url + '/api/health'), env());
 assert.equal(r.status, 200); assert.equal((await r.json()).mode, 'apk-only');
});
test('old extraction endpoint is explicitly retired', async () => {
 const r = await worker.fetch(new Request(url + '/api/extract?url=https://example.com'), env());
 assert.equal(r.status, 410); assert.equal((await r.json()).error, 'web_downloader_retired');
});
test('APK redirect is GitHub-only and never streams video', async () => {
 const r = await worker.fetch(new Request(url + '/download/arm64-v8a'), env());
 assert.equal(r.status, 302); assert.equal(r.headers.get('Location'), asset.url);
 assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('tampered release URL falls back to official releases', async () => {
 const r = await worker.fetch(new Request(url + '/download/arm64-v8a'), env([{...asset, url:'https://evil.test/app.apk'}]));
 assert.equal(r.headers.get('Location'), 'https://github.com/xykal/XyDownloader/releases/latest');
});
test('unknown architecture returns 404', async () => {
 assert.equal((await worker.fetch(new Request(url + '/download/evil'), env())).status, 404);
});
test('POST cannot create a proxy or extract job', async () => {
 const r = await worker.fetch(new Request(url + '/api/extract', {method: 'POST'}), env());
 assert.equal(r.status, 405);
});
test('legacy domain redirects to canonical site', async () => {
 const r = await worker.fetch(new Request('https://dlaja.projectkal.my.id/apk.html'), env());
 assert.equal(r.status, 308); assert.equal(r.headers.get('Location'), url + '/apk.html');
});
test('static responses carry security headers', async () => {
 const r = await worker.fetch(new Request(url + '/'), env());
 assert.equal(r.headers.get('X-Frame-Options'), 'DENY');
 assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});
