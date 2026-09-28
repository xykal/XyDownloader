// Playwright E2E — web DownloadAja (public/ + api/ lewat dev_server ASGI).
// Prinsip: hermetic. Semua request eksternal (extract -> YouTube, GitHub API,
// beacon dash, CDN) di-mock per test; yang lewat cuma statis + /api lokal
// yang sifatnya data (platforms). CI jalan tanpa secret sama sekali.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'python3 -m uvicorn dev_server:app --host 127.0.0.1 --port 8788',
    url: 'http://127.0.0.1:8788/api/platforms',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
