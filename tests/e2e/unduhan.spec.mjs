// E2E jalur unduhan inti web DownloadAja.
//
// Semua request eksternal di-mock (extract -> engine, GitHub Releases, beacon
// dash, CDN file) supaya test hermetic, cepat, dan nggak nembak platform asli
// dari CI. Yang diuji di sini: kontrak UI + kontrak klien kuota (X-XY-Cid);
// logika server sudah di-cover 83 pytest.
import { test, expect } from '@playwright/test';
import {
  REL, EXTRACT_1, PNG_1X1, mockEksternal, mockFileCdn, seedTidakPopup,
} from './_bantu.mjs';

test('halaman utama: versi web & link APK konsisten dengan rilis terbaru', async ({ page }) => {
  await mockEksternal(page);
  await page.goto('/');

  await expect(page.locator('#form')).toBeVisible();
  await expect(page.locator('#url')).toBeVisible();

  // Link APK diisi dari GitHub Releases (di-mock) — guard drift versi di DOM.
  const apkLink = page.locator('#apk-link');
  await expect(apkLink).toHaveAttribute('href', REL.assets[0].browser_download_url);
  await expect(apkLink.locator('span')).toContainText(`Download APK ${REL.tag_name}`);
});

test('alur unduhan: hasil muncul, Download jalan, X-XY-Cid terkirim', async ({ page }) => {
  await seedTidakPopup(page);
  const rekam = [];
  await mockEksternal(page, { extract: { json: EXTRACT_1, status: 200 } });
  await mockFileCdn(page, rekam);

  await page.goto('/');
  await page.locator('#url').fill('https://youtu.be/contoh-1');
  await page.locator('#go').click();

  // Kartu hasil
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result .title')).toHaveText('Video Keren');

  // Tombol Download di opsi 360p
  const row = page.locator('#result .opt', { hasText: '360p' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Download' }).click();

  // Unduhan selesai (saveBlob + task.done('Selesai'))
  await expect(page.getByText('Selesai').first()).toBeVisible({ timeout: 15_000 });

  // Kontrak klien kuota: minimal satu request file membawa X-XY-Cid,
  // nilainya sama dengan yang disimpan di localStorage.
  expect(rekam.length).toBeGreaterThan(0);
  const cidKirim = rekam.map((r) => r.headers['x-xy-cid']).find(Boolean);
  expect(cidKirim, 'X-XY-Cid harus terkirim di request file').toBeTruthy();
  const cidSimpan = await page.evaluate(() => {
    try { return localStorage.getItem('dlaja_cid_v1'); } catch { return null; }
  });
  expect(cidSimpan).toBe(cidKirim);
});

test('extract gagal: kartu error jelas, bukan halaman kosong', async ({ page }) => {
  await seedTidakPopup(page);
  await mockEksternal(page, {
    extract: {
      status: 200,
      json: { ok: false, error: 'Resep sedang ditinjau platform.', code: 'resep' },
    },
  });

  await page.goto('/');
  await page.locator('#url').fill('https://youtu.be/contoh-1');
  await page.locator('#go').click();

  const kartu = page.locator('#result .error-card');
  await expect(kartu).toBeVisible();
  await expect(kartu).toContainText('Gagal memproses link');
  await expect(kartu).toContainText('Resep sedang ditinjau platform.');
});

test('link ngawur: ditolak di klien tanpa memanggil server', async ({ page }) => {
  await seedTidakPopup(page);
  let extractCalls = 0;
  await mockEksternal(page, {
    extract: { status: 200, json: { ok: true, entries: [] } },
  });
  page.on('request', (r) => { if (r.url().includes('/api/extract')) extractCalls += 1; });

  await page.goto('/');
  await page.locator('#url').fill('bukan-link-sama-sekali');
  await page.locator('#go').click();

  await expect(page.locator('#toast')).toContainText('Tempel link yang valid');
  expect(extractCalls).toBe(0);
});

test('popup "Yang baru" muncul sekali untuk pengunjung baru', async ({ page }) => {
  await mockEksternal(page);
  // Gambar popup di-serve deterministik (PNG 1x1) supaya onerror nggak bikin flaky.
  await page.route('**/whats-new.webp', (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));

  await page.goto('/');
  const popup = page.getByRole('dialog', { name: /Yang baru di DownloadAja/ });
  await expect(popup).toBeVisible();

  // Kontrak "sekali": begitu versi tercatat, reload tidak menampilkan lagi.
  await page.evaluate(() => {
    try { localStorage.setItem('xy-seen-version', '1.3.4'); } catch { /* mode privat */ }
  });
  await page.reload();
  await expect(popup).toHaveCount(0);
});
