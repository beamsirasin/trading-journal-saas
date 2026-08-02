import type { FullConfig } from '@playwright/test';

import { E2E_USER_A, E2E_USER_B } from './support/fixtures';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * Runs once before the whole Playwright suite. Provisions the two fixed
 * test identities directly in the database `webServer` will boot against
 * (see `e2e/support/env.ts` for why every auth-adjacent page needs one).
 *
 * A no-op when `DATABASE_URL` is unset: the specs that need these users skip
 * themselves with an explicit reason (`hasE2eDatabase`), so there is nothing
 * useful to provision, and this must not be the thing that fails the run
 * locally where no disposable database is configured.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    return;
  }

  await provisionVerifiedUser(databaseUrl, E2E_USER_A);
  await provisionVerifiedUser(databaseUrl, E2E_USER_B);
}
