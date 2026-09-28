// E2E antrian "Unduh semua" (playlist) — PRD §10.3: maks 2 berjalan, jeda 300 ms,
// 1 klik = 1 token (X-XY-Batch), progres jujur, selesai = toast + ringkasan.
import { test, expect } from '@playwright/test';
import {
  EXTRACT_2, mockEksternal, mockFileCdn, seedTidakPopup,
} from './_bantu.mjs';

test('playlist 2 entri: Unduh semua jalan berurutan, header batch & cid terkirim', async ({ page }) => {
  await seedTidakPopup(page);
  const rekam = [];
  await mockEksternal(page, { extract: { json: EXTRACT_2, status: 200 } });
  await mockFileCdn(page, rekam);

  await page.goto('/');
  await page.locator('#url').fill('https://youtube.com/playlist?list=contoh');
  await page.locator('#go').click();

  // Dua kartu entri + tombol antrian
  await expect(page.locator('#result .title')).toHaveText(['Playlist Bagian Satu', 'Playlist Bagian Dua']);
  const tombol = page.getByRole('button', { name: 'Unduh semua (2)' });
  await expect(tombol).toBeVisible();
  await tombol.click();

  // Ringkasan akhir yang persisten (toast cuma 2,8 detik)
  await expect(page.getByText('Selesai: 2 berhasil.')).toBeVisible({ timeout: 20_000 });

  // Kontrak: 2 request file, masing-masing membawa X-XY-Cid + X-XY-Batch: 1
  expect(rekam.length).toBe(2);
  for (const r of rekam) {
    expect(r.headers['x-xy-cid'], `cid di ${r.url}`).toBeTruthy();
    expect(r.headers['x-xy-batch'], `tanda batch di ${r.url}`).toBe('1');
  }
});
