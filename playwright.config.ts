import { defineConfig, devices } from '@playwright/test'

const testPort = process.env.PLAYWRIGHT_PORT || '4173'
const testBaseUrl = `http://127.0.0.1:${testPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    baseURL: testBaseUrl,
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${testPort}`,
    url: testBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
