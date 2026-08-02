import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

import { getServerEnv } from '@/config/env.server';
import { generateId as newId } from '@/lib/identifiers';
import { getDb } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { ensurePersonalWorkspace } from '@/server/services/workspace-provisioning';

import { getEmailAdapter } from './email';

/**
 * The one authoritative Better Auth instance (ADR 0008).
 *
 * Lazily constructed — `getAuth()` is not called at module scope anywhere in
 * this codebase — so building or statically generating a page never opens a
 * database connection just because this module was imported. `getDb()`
 * itself is equally lazy (`src/server/db/client.ts`); constructing
 * `betterAuth()` does not query anything on its own, it only wires
 * configuration, so this is safe even before that.
 */

/**
 * Confirmed against the installed adapter (`better-auth@1.6.25` /
 * `@better-auth/drizzle-adapter`): `getSchema(model)` resolves a model
 * ("users", "sessions", …) by looking up that exact key on the `schema`
 * object passed here. The per-model `modelName` below is what makes the
 * resolved key match our table names — there is no implicit pluralization
 * this adapter version applies to the four core models on its own.
 *
 * No `fields` mapping is needed for any model: every Drizzle column in
 * `src/server/db/schema/auth.ts` is named with Better Auth's own canonical
 * camelCase field name (e.g. `emailVerified`, `expiresAt`, `providerId`) —
 * only the underlying SQL column is snake_case, which Drizzle itself
 * resolves transparently. Renaming a TS property there would require adding
 * a matching `fields` entry here; changing only the SQL column name never does.
 */
function buildDatabaseAdapter() {
  return drizzleAdapter(getDb(), {
    provider: 'pg',
    schema,
  });
}

/**
 * Fails closed in production: a missing or placeholder-shaped secret would
 * let sessions be signed with a guessable key, and that must be loud, not a
 * silent security downgrade. Outside production, an unset secret is filled
 * with a clearly-labelled, obviously-non-production value so local
 * development and CI (which never set `BETTER_AUTH_SECRET`) still boot.
 */
function resolveAuthSecret(): string {
  const secret = getServerEnv().BETTER_AUTH_SECRET;

  if (process.env.NODE_ENV !== 'production') {
    return secret ?? 'dev-only-secret-do-not-use-in-production-'.padEnd(32, '0');
  }

  const looksPlaceholder =
    secret === undefined ||
    secret.length < 32 ||
    /changeme|placeholder|example|secret123|password/i.test(secret);

  if (looksPlaceholder) {
    throw new Error(
      'BETTER_AUTH_SECRET is missing, too short, or looks like a placeholder in production. ' +
        'Generate a real one with: openssl rand -base64 32',
    );
  }

  return secret;
}

/** Beyond `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` (always trusted), operators opt in explicitly per environment. */
function resolveTrustedOrigins(): string[] {
  const extra = getServerEnv().BETTER_AUTH_TRUSTED_ORIGINS;
  return extra === undefined
    ? []
    : extra
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}

/**
 * The single source of truth for whether Google sign-in is available —
 * called from Server Components (`login`/`register` pages) to decide
 * whether to render the Google button as active at all, and reused here so
 * the button and the actual provider registration can never disagree. A
 * secret value never crosses into the boolean; only its presence does.
 */
export function isGoogleSignInConfigured(): boolean {
  const env = getServerEnv();
  return env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
}

function buildSocialProviders(): Parameters<typeof betterAuth>[0]['socialProviders'] {
  const env = getServerEnv();
  if (env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined) {
    return undefined;
  }

  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  };
}

/**
 * Better Auth's database-backed rate limiter keys on IP + route only, never
 * the account being signed into — so a real attacker hammering `/sign-in/email`
 * from one IP and an e2e suite legitimately signing in many times from one CI
 * runner IP are, to the limiter, indistinguishable. The production numbers
 * below are a real security control and stay in force everywhere except when
 * `E2E_TEST_MODE=true` (set only by `.github/workflows/ci.yml`'s `e2e` job —
 * a real deployment must never set it), where they widen enough for the
 * suite's own traffic without disabling the feature the suite is also there
 * to exercise.
 */
function buildRateLimitCustomRules(): Record<string, { window: number; max: number }> {
  const isE2eTestMode = getServerEnv().E2E_TEST_MODE === 'true';

  if (isE2eTestMode) {
    return {
      '/sign-in/email': { window: 60, max: 50 },
      '/sign-up/email': { window: 60, max: 50 },
      '/forget-password': { window: 60, max: 50 },
      '/reset-password': { window: 60, max: 50 },
      '/send-verification-email': { window: 60, max: 50 },
      '/sign-in/social': { window: 60, max: 50 },
    };
  }

  return {
    '/sign-in/email': { window: 60, max: 5 },
    '/sign-up/email': { window: 60, max: 5 },
    '/forget-password': { window: 60, max: 3 },
    '/reset-password': { window: 60, max: 5 },
    '/send-verification-email': { window: 60, max: 3 },
    '/sign-in/social': { window: 60, max: 10 },
  };
}

/**
 * Extracted into its own function so `ReturnType<typeof buildAuth>` below
 * captures the exact type this specific config literal produces. Caching
 * via `ReturnType<typeof betterAuth>` directly does not typecheck: that
 * resolves against `betterAuth`'s generic default rather than this call's
 * inferred options type, and the two are not assignable to each other.
 */
function buildAuth() {
  return betterAuth({
    database: buildDatabaseAdapter(),
    secret: resolveAuthSecret(),
    baseURL: getServerEnv().BETTER_AUTH_URL ?? 'http://localhost:3000',
    trustedOrigins: resolveTrustedOrigins(),

    // Replaces Better Auth's own built-in `/api/auth/error` page (unstyled,
    // English-only) with the app's localized one — this is what a cancelled
    // or denied Google OAuth attempt actually redirects to.
    onAPIError: {
      errorURL: '/auth-error',
    },

    advanced: {
      database: {
        // A GenerateIdFn — the `model`/`size` parameter Better Auth passes is
        // irrelevant here since every table uses the same UUIDv7 strategy
        // (ADR 0008), so it is accepted but unused.
        generateId: () => newId(),
      },
    },

    user: { modelName: 'users' },
    session: {
      modelName: 'sessions',
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh once per day of activity
      cookieCache: {
        // A short read-through cache only — every security-sensitive check in
        // src/server/auth/dal.ts calls auth.api.getSession, which re-verifies
        // against the database rather than trusting this cache.
        enabled: true,
        maxAge: 60,
      },
    },
    account: {
      modelName: 'accounts',
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        // requireLocalEmailVerified stays at Better Auth's own secure default
        // (true): an unverified local account cannot be used as an OAuth
        // account-takeover target.
      },
    },
    verification: { modelName: 'verifications' },

    emailVerification: {
      sendOnSignUp: true,
      // Recovery path for an expired verification link: since sign-in itself
      // is refused for an unverified user (requireEmailVerification below),
      // retrying sign-in is the natural next action, and this makes that
      // retry also issue a fresh link rather than requiring a separate
      // "resend" step the user has to find.
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        await getEmailAdapter().sendVerificationEmail({ to: user.email, url });
      },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await getEmailAdapter().sendPasswordResetEmail({ to: user.email, url });
      },
    },

    socialProviders: buildSocialProviders(),

    rateLimit: {
      enabled: true,
      storage: 'database',
      // Must match the schema's actual export name (`rateLimits`,
      // src/server/db/schema/auth.ts), not the SQL table name (`rate_limits`)
      // — the Drizzle adapter's getSchema(model) does a plain `schema[model]`
      // lookup against the JS module's export keys, not against column/table
      // identifiers. Getting this wrong silently 500s every rate-limited
      // request (i.e. every real auth call) with an empty response body —
      // only surfaced by running against a real database in CI, not by
      // typecheck/lint/unit tests. `user`/`session`/`account`/`verification`
      // above happen to avoid this because their plural modelName override
      // coincides with their schema export name; `rateLimit`'s does not.
      modelName: 'rateLimits',
      window: 60,
      max: 100,
      customRules: buildRateLimitCustomRules(),
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // This hook runs after Better Auth's own user-creation write
            // completes; it is NOT guaranteed to share that transaction (not
            // documented either way by the installed version), so
            // `ensurePersonalWorkspace` owns its own transaction and is
            // idempotent — safe to also re-run from `requireSession()` if
            // this hook ever fails independently (Phase 2 brief §12).
            await ensurePersonalWorkspace(user.id);
          },
        },
      },
    },

    // Must be last in the plugins array per Better Auth's own Next.js
    // integration docs — it patches cookie writes so Set-Cookie headers
    // reach the browser correctly when Better Auth's server API is called
    // from a Server Action rather than a Route Handler.
    plugins: [nextCookies()],
  });
}

let authInstance: ReturnType<typeof buildAuth> | undefined;

export function getAuth() {
  authInstance ??= buildAuth();
  return authInstance;
}
