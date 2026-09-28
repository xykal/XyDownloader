// E2E panel pengguna: Riwayat unduhan & Pengaturan.
// Riwayat = kontrak PRD: "Unduh lagi" = extract ULANG (media_url/fid tidak pernah
// disimpan — PRD G2). Pengaturan = persist di perangkat (localStorage), survive reload.
import { test, expect } from '@playwright/test';
import {
  EXTRACT_1, mockEksternal, mockFileCdn, seedTidakPopup, unduhSampaiSelesai,
} from './_bantu.mjs';

test('riwayat: unduhan tercatat, "Unduh lagi" memproses ulang tautan', async ({ page }) => {
  await seedTidakPopup(page);
  const rekam = [];
  let extractCalls = 0;
  await mockEksternal(page, { extract: { json: EXTRACT_1, status: 200 } });
  await mockFileCdn(page, rekam);
  page.on('request', (r) => { if (r.url().includes('/api/extract')) extractCalls += 1; });

  await page.goto('/');
  await unduhSampaiSelesai(page);
  expect(extractCalls).toBe(1);

  // Tunggu catatan riwayat benar-benar tersimpan (IndexedDB) — tanpa sleep buta.
  // (historyStore ada di scope modul app.js; baca IDB-nya langsung.)
  await expect.poll(
    () => page.evaluate(() => new Promise((res) => {
      const open = indexedDB.open('xydl-history', 1);
      open.onerror = () => res(-1);
      open.onsuccess = () => {
        try {
          const req = open.result.transaction('items', 'readonly').objectStore('items').get('list');
          req.onsuccess = () => res(((req.result && req.result.list) || []).length);
          req.onerror = () => res(-1);
        } catch { res(-1); }
      };
    })),
    { timeout: 10_000 },
  ).toBeGreaterThan(0);

  await page.locator('#btn-history').click();
  const modal = page.getByRole('dialog', { name: 'Riwayat unduhan' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('.history-row')).toHaveCount(1);
  await expect(modal.locator('.history-row')).toContainText('Video Keren');
  await expect(modal.locator('.history-row')).toContainText('360p');

  // "Unduh lagi" = extract ulang (bukan link simpanan)
  await modal.getByRole('button', { name: 'Unduh lagi' }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('#result .title')).toHaveText('Video Keren', { timeout: 15_000 });
  expect(extractCalls).toBe(2);
});

test('pengaturan: toggle tersimpan di perangkat, survive reload', async ({ page }) => {
  await seedTidakPopup(page);
  await mockEksternal(page);

  await page.goto('/');
  await page.locator('#btn-settings').click();
  const modal = page.getByRole('dialog', { name: 'Pengaturan DownloadAja' });
  await expect(modal).toBeVisible();

  // Checkbox 'Autoplay video' (input saudara label, bukan nested) — baca kondisi awal.
  const cekbox = modal.locator('.settings-row', { hasText: 'Autoplay video' })
    .locator('input[type=checkbox]');
  const awal = await cekbox.isChecked();
  await cekbox.click();
  await expect(cekbox).toBeChecked({ checked: !awal });

  // Persist: localStorage + survive reload
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  const tersimpan = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('dlaja-settings-v1') || '{}'); } catch { return {}; }
  });
  expect(tersimpan.autoplayVideo).toBe(!awal);

  await page.reload();
  await page.locator('#btn-settings').click();
  const modal2 = page.getByRole('dialog', { name: 'Pengaturan DownloadAja' });
  await expect(modal2.locator('.settings-row', { hasText: 'Autoplay video' })
    .locator('input[type=checkbox]')).toBeChecked({ checked: !awal });
});
