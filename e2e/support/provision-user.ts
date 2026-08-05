import { hashPassword } from 'better-auth/crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';
import { generateId } from '../../src/lib/identifiers';
import {
  accounts,
  billingTransactions,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
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
 *
 * `entitlement` (Phase 3C): every onboarded fixture gets a real
 * `workspace_entitlements` row, matching what `completeOnboarding` would
 * have produced. Locked product decision: the trial allows exactly ONE
 * active account — so omitting `entitlement` entirely defaults to an
 * ACTIVE Professional plan (limit 15), not a trial, giving every
 * pre-Phase-3C E2E spec (`accounts.spec.ts`, `onboarding.spec.ts`, and
 * others that create several accounts through the UI without knowing
 * entitlements exist) the same generous headroom they always had — none of
 * them are testing trial/limit behavior, so they should not need to know it
 * exists. Passing `entitlement` explicitly (even `{}`) opts into real,
 * honest trial semantics (1-account limit, 7-day expiry by default) for
 * tests that specifically exercise entitlement behavior
 * (`e2e/entitlements.spec.ts`). Pass overrides to construct an
 * expired-trial, active-plan, or over-limit fixture directly — a "trusted
 * test-only method to expire the trial" (Phase 3C brief), not a code path
 * reachable from any production route. `additionalAccounts` seeds extra
 * non-archived accounts directly (bypassing the create-account entitlement
 * check entirely, since this is fixture setup, not a user action) — needed
 * to construct an already-over-limit workspace, which the real UI can never
 * produce on its own. `omitEntitlementRow` skips inserting any
 * `workspace_entitlements` row at all — the fail-closed anomaly no real
 * onboarding flow can produce (`completeOnboarding` always starts a trial
 * atomically), constructed here only to prove the UI and server both fail
 * closed rather than granting unlimited access when the snapshot can't be
 * resolved.
 */
export async function provisionVerifiedUser(
  connectionUrl: string,
  { email, password, name }: { email: string; password: string; name: string },
  options: {
    readonly onboarded?: boolean;
    readonly entitlement?: {
      readonly status?: 'trialing' | 'active' | 'expired' | 'canceled';
      readonly planKey?: 'starter' | 'trader' | 'professional' | null;
      readonly trialEndsAt?: Date | null;
      readonly billingCurrency?: 'THB' | 'USD' | null;
      readonly currentPeriodStartedAt?: Date | null;
      readonly currentPeriodEndsAt?: Date | null;
    };
    readonly additionalAccounts?: number;
    /** Extra accounts seeded already archived — for restore-blocked fixtures. */
    readonly additionalArchivedAccounts?: number;
    /** Skip inserting a `workspace_entitlements` row entirely — the fail-closed anomaly state. */
    readonly omitEntitlementRow?: boolean;
  } = {},
): Promise<{ id: string; email: string; password: string; name: string }> {
  const onboarded = options.onboarded ?? true;
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error('Refusing to provision a user outside the guarded TEST_DATABASE_URL.');
  }
  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      users,
      accounts,
      workspaces,
      workspaceMembers,
      userPreferences,
      tradingAccounts,
      workspaceEntitlements,
      billingTransactions,
    },
  });

  try {
    // Idempotent for repeated local/CI runs against a reused database: clear
    // any prior run's row for this fixed email before recreating it, rather
    // than accumulating duplicate test users or failing on the unique index.
    // Cascades away any prior workspace/account/preferences too.
    const priorUsers = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (priorUsers.length > 0) {
      const priorWorkspaces = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          inArray(
            workspaces.personalOwnerUserId,
            priorUsers.map(({ id }) => id),
          ),
        );
      if (priorWorkspaces.length > 0) {
        await db.delete(billingTransactions).where(
          inArray(
            billingTransactions.workspaceId,
            priorWorkspaces.map(({ id }) => id),
          ),
        );
      }
    }
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

      if (options.omitEntitlementRow !== true) {
        const entitlementOverride = options.entitlement;
        const {
          status,
          planKey,
          trialEndsAt,
          billingCurrency,
          currentPeriodStartedAt,
          currentPeriodEndsAt,
        } =
          entitlementOverride === undefined
            ? {
                // No entitlement behavior under test — an active Professional
                // plan (limit 15) gives every pre-Phase-3C spec the same
                // headroom it always had, so it never has to know a 1-account
                // trial exists.
                status: 'active' as const,
                planKey: 'professional' as const,
                trialEndsAt: null,
                billingCurrency: 'USD' as const,
                currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              }
            : {
                status: entitlementOverride.status ?? 'trialing',
                planKey: entitlementOverride.planKey ?? null,
                trialEndsAt:
                  entitlementOverride.trialEndsAt === undefined
                    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    : entitlementOverride.trialEndsAt,
                billingCurrency:
                  entitlementOverride.billingCurrency === undefined &&
                  entitlementOverride.status === 'active'
                    ? ('USD' as const)
                    : (entitlementOverride.billingCurrency ?? null),
                currentPeriodStartedAt:
                  entitlementOverride.currentPeriodStartedAt === undefined &&
                  entitlementOverride.status === 'active'
                    ? new Date(Date.now() - 24 * 60 * 60 * 1000)
                    : (entitlementOverride.currentPeriodStartedAt ?? null),
                currentPeriodEndsAt:
                  entitlementOverride.currentPeriodEndsAt === undefined &&
                  entitlementOverride.status === 'active'
                    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                    : (entitlementOverride.currentPeriodEndsAt ?? null),
              };
        await db.insert(workspaceEntitlements).values({
          workspaceId,
          status,
          planKey,
          trialStartedAt: new Date(),
          trialEndsAt,
          billingCurrency,
          billingInterval: billingCurrency === null ? null : 'monthly',
          currentPeriodStartedAt,
          currentPeriodEndsAt,
        });
      }

      const additionalAccounts = options.additionalAccounts ?? 0;
      for (let i = 0; i < additionalAccounts; i += 1) {
        await db.insert(tradingAccounts).values({
          id: generateId(),
          workspaceId,
          name: `Additional Account ${i + 1}`,
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '5000',
          timezone: 'Asia/Bangkok',
        });
      }

      const additionalArchivedAccounts = options.additionalArchivedAccounts ?? 0;
      for (let i = 0; i < additionalArchivedAccounts; i += 1) {
        await db.insert(tradingAccounts).values({
          id: generateId(),
          workspaceId,
          name: `Archived Account ${i + 1}`,
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '5000',
          timezone: 'Asia/Bangkok',
          isArchived: true,
        });
      }
    }

    return { id: userId, email, password, name };
  } finally {
    await client.end();
  }
}
