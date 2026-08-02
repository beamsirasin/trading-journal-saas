/**
 * Whether the e2e run has a real database behind it.
 *
 * `pnpm build && pnpm start` (Playwright's `webServer`, see
 * `playwright.config.ts`) always runs with `NODE_ENV=production` — Next.js
 * sets that itself for `build`/`start`, overriding whatever the shell env
 * says. Every page under `(public)/login`, `(public)/register` and the whole
 * `(app)` tree now calls `getOptionalSession()` unconditionally (defence in
 * depth against an already-authenticated visitor, and the actual auth
 * boundary for `(app)`), which opens a real database connection. Without
 * `DATABASE_URL`, those pages 500 rather than render — so every test that
 * touches them needs a real, migrated database, not just the ones that
 * submit a form.
 *
 * Locally that database is not always available (see
 * `docs/migration-runbook.md`); CI provisions a disposable Postgres service
 * and sets `DATABASE_URL` before starting the app. Tests gated on this flag
 * skip with an explicit reason rather than failing or, worse, silently
 * passing against a server that never actually rendered the page.
 */
export const hasE2eDatabase = Boolean(process.env.DATABASE_URL);

export const E2E_SKIP_REASON =
  'DATABASE_URL is not set for this e2e run — see docs/migration-runbook.md for how to point ' +
  'Playwright at a disposable database. This suite runs for real in CI.';
