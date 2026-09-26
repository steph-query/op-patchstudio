import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/test/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  /**
   * Fieldwork ships as a macOS desktop app: Tauri renders it in WKWebView, so
   * **webkit is the production engine** and is listed first. Chromium is kept as a
   * second opinion on anything engine-specific.
   *
   * Firefox and the mobile viewports were left over from this project's PWA days.
   * Nothing ships to Gecko or to a phone, so those runs could only produce false
   * alarms — and firefox's binary is not installed, which made the documented
   * `npm run test:e2e` fail before it asserted anything. The responsive widths that
   * do matter are covered explicitly at 1440 and 800 in `branding.e2e.ts`.
   */
  projects: [
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
