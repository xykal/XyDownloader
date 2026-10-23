import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/landing', timeout: 30000, workers: 2,
  use: {baseURL: 'http://127.0.0.1:8789', screenshot: 'only-on-failure'},
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome']}},
    {name: 'mobile', use: {...devices['Pixel 7']}},
  ],
  webServer: {
    command: 'npx -y wrangler@4 dev --ip 0.0.0.0 --port 8789', cwd: 'web',
    url: 'http://127.0.0.1:8789/api/health', reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
