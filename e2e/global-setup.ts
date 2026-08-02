import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FullConfig } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_USER_A, E2E_USER_B } from './support/fixtures';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * Runs once before the whole Playwright suite. Provisions the two fixed
 * test identities directly in the database `webServer` will boot against
 * (see `e2e/support/env.ts` for why every auth-adjacent page needs one).
 *
 * Also seeds an empty storage-state file at the path `e2e/auth.setup.ts`
 * writes the real one to. The `setup` project (playwright.config.ts) skips
 * its own body when there's no database (nothing to log into), but the
 * `chromium`/`mobile-chrome` projects' `storageState: authFile` is a static
 * config value evaluated regardless — an empty-but-present file here is what
 * lets that resolve to "no session" instead of an ENOENT.
 *
 * A no-op for provisioning when `DATABASE_URL` is unset: the specs that need
 * these users skip themselves with an explicit reason (`hasE2eDatabase`), so
 * there is nothing useful to provision, and this must not be the thing that
 * fails the run locally where no disposable database is configured.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  await mkdir(path.dirname(authStateFile), { recursive: true });
  await writeFile(authStateFile, JSON.stringify({ cookies: [], origins: [] }));

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    return;
  }

  await provisionVerifiedUser(databaseUrl, E2E_USER_A);
  await provisionVerifiedUser(databaseUrl, E2E_USER_B);
}
