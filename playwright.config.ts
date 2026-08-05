import { defineConfig, devices } from '@playwright/test';

import { resolveE2eBetterAuthSecret } from './e2e/support/better-auth-secret';
import { validateTestDatabaseEnvironment } from './scripts/test-database-safety.mjs';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
const guardedDatabase = process.env.TEST_DATABASE_URL
  ? validateTestDatabaseEnvironment()
  : undefined;

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
    // Playwright's own documented pattern for a mixed authenticated/
    // unauthenticated suite: this project only runs e2e/auth.setup.ts (real
    // login, saved session), and `chromium`/`mobile-chrome` depend on it so
    // it always completes first. It does NOT set `storageState` itself —
    // most specs (pricing, login/register, route-protection) must still
    // start unauthenticated; only the Phase-1-era specs that assume an
    // already-authenticated `/app/*` opt in per-file via
    // `test.use({ storageState: authStateFile })`.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    // Mobile viewport is a first-class target (CLAUDE.md §8), so it is part of
    // the default run rather than an optional extra.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, dependencies: ['setup'] },
  ],

  webServer: {
    command: 'pnpm build && pnpm start --port ' + PORT,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // CI pipes stdout too: Better Auth/Next.js server errors (e.g. a 500 from
    // an API route) log there, and CI has no other way to see them — a local
    // run stays quiet since a developer can already see the same errors in
    // their own terminal.
    stdout: process.env.CI ? 'pipe' : 'ignore',
    stderr: 'pipe',
    env: {
      ...process.env,
      // This process serves the E2E app at this exact loopback origin. Never
      // inherit a developer's unrelated local auth URL into the production
      // test server or Better Auth will correctly reject browser requests.
      BETTER_AUTH_URL: baseURL,
      // Shared with `e2e/support/authenticate.ts`'s database-session
      // fixture via `resolveE2eBetterAuthSecret()` — that fixture signs a
      // session cookie for THIS exact server process to verify, so both
      // sides must resolve to the identical secret by construction, not by
      // coincidence of a duplicated literal.
      BETTER_AUTH_SECRET: resolveE2eBetterAuthSecret(),
      ...(guardedDatabase ? { E2E_TEST_MODE: 'true' } : {}),
      ...(guardedDatabase ? { DATABASE_URL: guardedDatabase.testUrl } : {}),
    },
  },
});
