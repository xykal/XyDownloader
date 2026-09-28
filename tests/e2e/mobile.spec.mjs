// E2E viewport HP (360px) — guard regresi responsif. Bug klasik repo ini
// pernah bikin seluruh layout runtuh cuma gara-gara satu properti CSS.
import { test, expect, devices } from '@playwright/test';
import {
  EXTRACT_1, mockEksternal, mockFileCdn, seedTidakPopup,
} from './_bantu.mjs';

test.use({ ...devices['Pixel 7'] });

test('alur unduhan inti tetap jalan di layar HP', async ({ page }) => {
  await seedTidakPopup(page);
  const rekam = [];
  await mockEksternal(page, { extract: { json: EXTRACT_1, status: 200 } });
  await mockFileCdn(page, rekam);

  await page.goto('/');
  await expect(page.locator('#form')).toBeVisible();
  await page.locator('#url').fill('https://youtu.be/contoh-1');
  await page.locator('#go').click();

  await expect(page.locator('#result .title')).toHaveText('Video Keren', { timeout: 15_000 });
  const row = page.locator('#result .opt', { hasText: '360p' }).first();
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByText('Selesai').first()).toBeVisible({ timeout: 15_000 });

  expect(rekam.length).toBeGreaterThan(0);
  expect(rekam.map((r) => r.headers['x-xy-cid']).find(Boolean)).toBeTruthy();
});
