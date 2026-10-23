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
 await expect(page.locator('a[href="/download/arm64-v8a"]')).toHaveCount(2);
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
