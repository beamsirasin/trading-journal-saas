import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a real production build, not the dev server — dev-only
 * behaviour (overlays, unoptimised bundles) would make these tests lie.
 */
export default defineConfig({
  testDir: './e2e',
  // Provisions the fixed e2e test identities directly in the database
  // `webServer` boots against — a no-op when DATABASE_URL is unset locally.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Spread rather than `workers: undefined` — exactOptionalPropertyTypes
  // distinguishes "absent" from "explicitly undefined".
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport is a first-class target (CLAUDE.md §8), so it is part of
    // the default run rather than an optional extra.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: 'pnpm build && pnpm start --port ' + PORT,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
