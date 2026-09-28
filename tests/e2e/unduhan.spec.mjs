// E2E jalur unduhan inti web DownloadAja.
//
// Semua request eksternal di-mock (extract -> engine, GitHub Releases, beacon
// dash, CDN file) supaya test hermetic, cepat, dan nggak nembak platform asli
// dari CI. Yang diuji di sini: kontrak UI + kontrak klien kuota (X-XY-Cid);
// logika server sudah di-cover 83 pytest.
import { test, expect } from '@playwright/test';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const REL = {
  tag_name: 'v1.3.3',
  html_url: 'https://github.com/xykal/XyDownloader/releases/tag/v1.3.3',
  assets: [{
    name: 'DownloadAja-1.3.3-arm64-v8a.apk',
    size: 19551469,
    browser_download_url:
      'https://github.com/xykal/XyDownloader/releases/download/v1.3.3/DownloadAja-1.3.3-arm64-v8a.apk',
  }],
};

const EXTRACT_OK = {
  ok: true,
  platform: { id: 'youtube', name: 'YouTube' },
  count: 1,
  total: 1,
  entries: [{
    title: 'Video Keren',
    uploader: 'Kanal Contoh',
    duration: 212,
    media_kind: 'video',
    gallery: [],
    video: [{
      id: 'v360',
      label: '360p',
      ext: 'mp4',
      codec: 'h264',
      quality: 360,
      tier: 'hemat',
      size: 16,
      filename: 'DownloadAja-Video Keren-360p.mp4',
      mode: 'fetch',
      sources: [{ via: 'server', url: 'https://cdn.test/f1.mp4', size: 16, ext: 'mp4' }],
    }],
    audio: [],
  }],
};

// Mock standar: request eksternal terkunci, sisanya (statis + /api lokal) lewat.
async function mockEksternal(page, { extract } = {}) {
  await page.route('https://api.github.com/**', (r) => r.fulfill({ json: REL }));
  await page.route('**/api/public/beacon', (r) => r.fulfill({ status: 204 }));
  await page.route('**/api/history*', (r) => r.fulfill({ json: { ok: true, items: [] } }));
  if (extract) {
    await page.route('**/api/extract', (r) => r.fulfill(extract));
  }
}

function seedTidakPopup(page) {
  // Popup "Yang baru" cukup diuji di tes terpisah; di skenario lain jangan ganggu.
  return page.addInitScript(() => {
    try { localStorage.setItem('xy-seen-version', '1.3.3'); } catch { /* mode privat */ }
  });
}

test('halaman utama: versi web & link APK konsisten dengan rilis terbaru', async ({ page }) => {
  await mockEksternal(page);
  await page.goto('/');

  await expect(page.locator('#form')).toBeVisible();
  await expect(page.locator('#url')).toBeVisible();

  // Link APK diisi dari GitHub Releases (di-mock) — guard drift versi di DOM.
  const apkLink = page.locator('#apk-link');
  await expect(apkLink).toHaveAttribute('href', REL.assets[0].browser_download_url);
  await expect(apkLink.locator('span')).toContainText('Download APK v1.3.3');
});

test('alur unduhan: hasil muncul, Download jalan, X-XY-Cid terkirim', async ({ page }) => {
  await seedTidakPopup(page);
  const fileRequests = [];
  await mockEksternal(page, {
    extract: { json: EXTRACT_OK, status: 200 },
  });
  await page.route('https://cdn.test/**', async (route) => {
    fileRequests.push(route.request().headers());
    await route.fulfill({
      status: 206,
      contentType: 'video/mp4',
      headers: {
        'accept-ranges': 'bytes',
        'content-range': 'bytes 0-15/16',
      },
      body: Buffer.alloc(16, 7),
    });
  });

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
  expect(fileRequests.length).toBeGreaterThan(0);
  const cidKirim = fileRequests.map((h) => h['x-xy-cid']).find(Boolean);
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
    try { localStorage.setItem('xy-seen-version', '1.3.3'); } catch { /* mode privat */ }
  });
  await page.reload();
  await expect(popup).toHaveCount(0);
});
