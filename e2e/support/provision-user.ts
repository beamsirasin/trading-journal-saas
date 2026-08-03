import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';
import { generateId } from '../../src/lib/identifiers';
import {
  accounts,
  tradingAccounts,
  userPreferences,
  users,
  workspaceMembers,
  workspaces,
} from '../../src/server/db/schema';

/**
 * Directly provisions an already-verified user with a real Better-Auth
 * password hash, bypassing the browser and the (deliberately fail-closed,
 * no-provider-configured) email adapter entirely.
 *
 * This does NOT import `src/lib/auth/server.ts` or `src/server/db/client.ts`
 * — both pull in the `server-only` marker package, which throws outside a
 * Next.js RSC context (the same constraint the integration test suite hit;
 * see `vitest.integration.config.ts`). Playwright's `globalSetup` runs as a
 * plain Node script, not through Next's bundler, so it connects directly
 * with `postgres`/`drizzle` and only the plain schema/crypto/id modules
 * that carry no such import.
 *
 * The resulting user can complete a REAL `signIn.email` through the browser
 * against the actual running app — no session cookie is fabricated here, only
 * the account a genuine login can succeed against.
 *
 * `onboarded`: since Phase 3A, every `/app/*` page except `/app/onboarding`
 * itself redirects an incomplete-onboarding workspace there
 * (`(app)/app/(main)/layout.tsx`). Every EXISTING consumer of this fixture
 * (`e2e/auth.setup.ts`'s shared storage state, reused by app-shell/i18n/theme
 * specs written before trading accounts existed) assumes landing on `/app`
 * succeeds immediately — so `onboarded` defaults to `true`, provisioning a
 * workspace, one trading account, and `onboardingCompletedAt` alongside the
 * user. Only `e2e/onboarding.spec.ts` needs the pre-onboarding state, and
 * passes `onboarded: false` explicitly.
 */
export async function provisionVerifiedUser(
  connectionUrl: string,
  { email, password, name }: { email: string; password: string; name: string },
  options: { readonly onboarded?: boolean } = {},
): Promise<{ id: string; email: string; password: string; name: string }> {
  const onboarded = options.onboarded ?? true;
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error('Refusing to provision a user outside the guarded TEST_DATABASE_URL.');
  }
  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, {
    schema: { users, accounts, workspaces, workspaceMembers, userPreferences, tradingAccounts },
  });

  try {
    // Idempotent for repeated local/CI runs against a reused database: clear
    // any prior run's row for this fixed email before recreating it, rather
    // than accumulating duplicate test users or failing on the unique index.
    // Cascades away any prior workspace/account/preferences too.
    await db.delete(users).where(eq(users.email, email));

    const userId = generateId();
    await db.insert(users).values({
      id: userId,
      name,
      email,
      emailVerified: true,
    });

    const hash = await hashPassword(password);
    await db.insert(accounts).values({
      id: generateId(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
    });

    if (onboarded) {
      const workspaceId = generateId();
      await db.insert(workspaces).values({
        id: workspaceId,
        name: 'Personal workspace',
        slug: `personal-${userId}`,
        kind: 'personal',
        personalOwnerUserId: userId,
        onboardingCompletedAt: new Date(),
      });
      await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });

      const accountId = generateId();
      await db.insert(tradingAccounts).values({
        id: accountId,
        workspaceId,
        name: 'Main Trading Account',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000',
        timezone: 'Asia/Bangkok',
      });

      await db.insert(userPreferences).values({
        userId,
        activeWorkspaceId: workspaceId,
        activeTradingAccountId: accountId,
      });
    }

    return { id: userId, email, password, name };
  } finally {
    await client.end();
  }
}
