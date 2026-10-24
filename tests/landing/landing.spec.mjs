import {test, expect} from '@playwright/test';
test('landing and APK links are usable without downloader backend', async ({page}) => {
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.goto('/');
 await expect(page.getByRole('heading', {level:1})).toContainText('Simpan yang');
 await expect(page.locator('[data-version]').first()).toContainText('v');
 await expect(page.locator('input')).toHaveCount(0);
 await expect(page.locator('.release-strip')).toContainText('Masih prerelease');
 await expect(page.getByRole('link', {name:'Lihat prerelease'})).toHaveAttribute('href', 'https://github.com/xykal/XyDownloader/releases/tag/v1.3.5');
 await page.locator('.nav-cta').click();
 await expect(page.locator('#download')).toBeInViewport();
 await expect(page.locator('a[href="/download/arm64-v8a"]')).toHaveCount(1);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
 expect(errors).toEqual([]);
});
test('release redirect, health and removed web API', async ({request}) => {
 const r = await request.get('/download/arm64-v8a', {maxRedirects:0});
 expect(r.status()).toBe(302); expect(r.headers().location).toMatch(/^https:\/\/github.com\/xykal\/XyDownloader\/releases\/download\/.*\.apk$/);
 expect((await (await request.get('/api/health')).json()).mode).toBe('apk-only');
 expect((await request.get('/api/extract')).status()).toBe(410);
 expect((await request.get('/not-a-page')).status()).toBe(404);
});
test('authentic screenshots, structured data and social image are available', async ({page,request}) => {
 await page.goto('/');
 await expect(page.locator('.actual-phone img')).toBeVisible();
 await expect(page.locator('.screens-grid img')).toHaveCount(3);
 await expect(page.locator('.fake-input')).toHaveCount(0);
 const schema = JSON.parse(await page.locator('#app-schema').textContent());
 expect(schema['@graph'].some(e=>e['@type']==='SoftwareApplication')).toBeTruthy();
 const og = await request.get('/og-cover.jpg');
 expect(og.status()).toBe(200);expect(og.headers()['content-type']).toContain('image/jpeg');
 expect((await request.get('/screenshots/home.webp')).status()).toBe(200);
 expect((await request.get('/robots.txt')).status()).toBe(200);
 expect((await request.get('/sitemap.xml')).status()).toBe(200);
});

test('universal download chooser hides architecture until opened; SVG icons load', async ({page}) => {
 await page.goto('/');
 await expect(page.locator('#download-options')).not.toHaveAttribute('open', '');
 await expect(page.locator('.apk-option').first()).not.toBeVisible();
 await expect(page.locator('.hero-actions .primary')).toHaveText('Unduh aplikasi');
 await expect(page.locator('.hero-actions .primary')).toHaveAttribute('href', '#download');
 await page.locator('.hero-actions .primary').click();
 await expect(page.locator('.apk-option')).toHaveCount(3);
 await expect(page.locator('.apk-option').first()).toBeVisible();
 await expect(page.locator('.platforms img')).toHaveCount(5);
 expect(await page.locator('.platforms img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBeTruthy();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
test('native architecture selection works without JavaScript', async ({browser,baseURL}) => {
 const context = await browser.newContext({javaScriptEnabled:false});
 const page = await context.newPage();
 await page.goto(baseURL);
 await page.locator('#download-options > summary').click();
 await expect(page.locator('.apk-option').first()).toBeVisible();
 await expect(page.locator('.apk-option')).toHaveCount(3);
 await context.close();
});
