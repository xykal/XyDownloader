// Utilitas bersama tes E2E: fixture eksternal + mock hermetic.
// File ini BUKAN spek (tidak cocok pola *.spec.*) — cuma modul bantu.
import { expect } from '@playwright/test';

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const REL = {
  tag_name: 'v1.3.4',
  html_url: 'https://github.com/xykal/XyDownloader/releases/tag/v1.3.4',
  assets: [{
    name: 'DownloadAja-1.3.4-arm64-v8a.apk',
    size: 19600000,
    browser_download_url:
      'https://github.com/xykal/XyDownloader/releases/download/v1.3.4/DownloadAja-1.3.4-arm64-v8a.apk',
  }],
};

// Opsi unduhan kecil mode 'fetch' -> fetchRanged (kontrak X-XY-Cid diuji di sini).
export function optUnduhan(fileUrl) {
  return {
    id: 'v360',
    label: '360p',
    ext: 'mp4',
    codec: 'h264',
    quality: 360,
    tier: 'hemat',
    size: 16,
    filename: 'DownloadAja-Video Keren-360p.mp4',
    mode: 'fetch',
    sources: [{ via: 'server', url: fileUrl, size: 16, ext: 'mp4' }],
  };
}

export function entri(judul, fileUrl, webpageUrl) {
  return {
    title: judul,
    uploader: 'Kanal Contoh',
    webpage_url: webpageUrl,
    duration: 212,
    media_kind: 'video',
    gallery: [],
    video: [optUnduhan(fileUrl)],
    audio: [],
  };
}

export const EXTRACT_1 = {
  ok: true,
  platform: { id: 'youtube', name: 'YouTube' },
  count: 1,
  total: 1,
  entries: [entri('Video Keren', 'https://cdn.test/a.mp4', 'https://youtu.be/contoh-1')],
};

export const EXTRACT_2 = {
  ok: true,
  platform: { id: 'youtube', name: 'YouTube' },
  count: 2,
  total: 2,
  entries: [
    entri('Playlist Bagian Satu', 'https://cdn.test/a.mp4', 'https://youtu.be/playlist-1'),
    entri('Playlist Bagian Dua', 'https://cdn.test/b.mp4', 'https://youtu.be/playlist-2'),
  ],
};

// Kunci semua request eksternal; sisanya (statis + /api lokal data) lewat.
export async function mockEksternal(page, { extract } = {}) {
  await page.route('https://api.github.com/**', (r) => r.fulfill({ json: REL }));
  await page.route('**/api/public/beacon', (r) => r.fulfill({ status: 204 }));
  await page.route('**/api/history*', (r) => r.fulfill({ json: { ok: true, items: [] } }));
  if (extract) {
    await page.route('**/api/extract', (r) => r.fulfill(extract));
  }
}

// Mock file CDN sambil merekam header tiap request (buat asersi X-XY-Cid/Batch).
export async function mockFileCdn(page, rekam) {
  await page.route('https://cdn.test/**', async (route) => {
    rekam.push({ url: route.request().url(), headers: route.request().headers() });
    await route.fulfill({
      status: 206,
      contentType: 'video/mp4',
      headers: { 'accept-ranges': 'bytes', 'content-range': 'bytes 0-15/16' },
      body: Buffer.alloc(16, 7),
    });
  });
}

export function seedTidakPopup(page) {
  // Popup "Yang baru" cukup diuji tersendiri; di skenario lain jangan ganggu.
  return page.addInitScript(() => {
    try { localStorage.setItem('xy-seen-version', '1.3.4'); } catch { /* mode privat */ }
  });
}

export async function unduhSampaiSelesai(page, { link = 'https://youtu.be/contoh-1' } = {}) {
  await page.locator('#url').fill(link);
  await page.locator('#go').click();
  await expect(page.locator('#result .title').first()).toBeVisible({ timeout: 15_000 });
  const row = page.locator('#result .opt', { hasText: '360p' }).first();
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(page.getByText('Selesai').first()).toBeVisible({ timeout: 15_000 });
}
