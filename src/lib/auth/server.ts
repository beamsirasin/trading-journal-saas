import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { cookies } from 'next/headers';

import { getServerEnv } from '@/config/env.server';
import { generateId as newId } from '@/lib/identifiers';
import { getDb } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { ensurePersonalWorkspace } from '@/server/services/workspace-provisioning';

import { logDispatchStage } from './dispatch-log';
import { getEmailAdapter } from './email';
import { resolveSupportedEmailLocale } from './email-templates';
import { evaluatePasswordPolicy } from './password-policy';
import { RESEND_VERIFICATION_WINDOW_SECONDS } from './rate-limit-config';
import {
  isLoopbackUrl,
  resolveAuthBaseUrl,
  resolveTrustedOrigins,
  shouldUseSecureCookies,
} from './runtime-config';

/**
 * Server-side enforcement of the shared password-complexity policy
 * (`src/lib/auth/password-policy.ts`) — the security boundary; the
 * registration form's real-time checklist is UX only and cannot be trusted
 * on its own (a request can always bypass client JavaScript entirely).
 *
 * Wired as the ROOT-level `hooks.before` because Better Auth 1.6.25 exposes
 * exactly one such slot per `betterAuth()` instance (typed `AuthMiddleware`,
 * singular — not the array-of-`{matcher,handler}` shape plugin-level hooks
 * use). Confirmed via `dist/api/dispatch.mjs`'s `getHooks()`: a root
 * `hooks.before` is registered with `matcher: () => true` and therefore
 * runs before EVERY endpoint, which is why this handler checks `ctx.path`
 * itself rather than relying on any framework-level path scoping — exactly
 * as required: it must affect `/sign-up/email` only, never `/sign-in/email`,
 * password verification, or Google OAuth (none of which pass through this
 * `if` at all).
 *
 * Runs strictly before Better Auth's own user-creation and
 * verification-email dispatch inside `signUpEmail` (`dist/api/routes/sign-up.mjs`):
 * `runBeforeHooks` executes ahead of the endpoint body, and a thrown
 * `APIError` here propagates out of that call entirely — the endpoint body
 * (and therefore `internalAdapter.createUser` and
 * `emailVerification.sendVerificationEmail`) never runs. `hooks.before`
 * itself is unaffected by `rateLimit` (a separate, router-level concern
 * that still applies before this handler is ever reached via the real HTTP
 * path), so this hook can neither strengthen nor weaken it.
 *
 * `ctx.body` here is the RAW pre-`zod`-validated request body (validation
 * happens inside the endpoint itself, which this hook runs ahead of), so
 * `password` is read defensively rather than assumed to be a string —
 * anything that is not a non-empty string is left for Better Auth's own
 * `INVALID_PASSWORD`/`PASSWORD_TOO_SHORT` checks to handle, rather than
 * duplicated here.
 */
const enforceSignUpPasswordPolicy = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-up/email') return;

  const password: unknown = (ctx.body as Record<string, unknown> | undefined)?.password;
  if (typeof password !== 'string' || password.length === 0) return;

  const policy = evaluatePasswordPolicy(password);
  if (policy.valid) return;

  // Sanitized, stable error: no password value, no per-category detail that
  // could help an attacker fingerprint the policy beyond what the public
  // registration form already discloses in its own checklist copy.
  throw new APIError('BAD_REQUEST', {
    code: 'WEAK_PASSWORD',
    message: 'Password does not meet the required complexity policy.',
  });
});

/**
 * Best-effort locale for an outbound auth email. Mirrors
 * `ensurePersonalWorkspace`'s `readPreLoginCookiePreferences`
 * (`src/server/services/workspace-provisioning.ts`) — the `NEXT_LOCALE`
 * cookie next-intl's middleware already manages is the one "request locale"
 * signal available inside a Better Auth callback, which runs as part of
 * handling the sign-up/forget-password HTTP request itself. Falls back to
 * English on any error (e.g. called outside a request scope) rather than
 * failing the send.
 */
async function resolveRequestEmailLocale() {
  try {
    const cookieStore = await cookies();
    return resolveSupportedEmailLocale(cookieStore.get('NEXT_LOCALE')?.value);
  } catch {
    return resolveSupportedEmailLocale(undefined);
  }
}

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
    // Better Auth wraps sign-up in runWithTransaction(). Without adapter
    // transaction support, the user-create hook runs before the credential
    // account insert; a provisioning failure then strands a user who cannot
    // sign in or register again. With this enabled, user + account commit
    // atomically and the after-hook runs afterward, so the DAL repair path
    // can recover on the next sign-in.
    transaction: true,
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
  const env = getServerEnv();
  const baseUrl = resolveAuthBaseUrl(env.BETTER_AUTH_URL, env.NODE_ENV);
  const isE2eTestMode = env.E2E_TEST_MODE === 'true' && isLoopbackUrl(new URL(baseUrl));

  if (isE2eTestMode) {
    return {
      '/sign-in/email': { window: 60, max: 50 },
      '/sign-up/email': { window: 60, max: 50 },
      '/forget-password': { window: 60, max: 50 },
      '/reset-password': { window: 60, max: 50 },
      '/send-verification-email': { window: RESEND_VERIFICATION_WINDOW_SECONDS, max: 50 },
      '/sign-in/social': { window: 60, max: 50 },
    };
  }

  return {
    '/sign-in/email': { window: 60, max: 5 },
    '/sign-up/email': { window: 60, max: 5 },
    '/forget-password': { window: 60, max: 3 },
    '/reset-password': { window: 60, max: 5 },
    '/send-verification-email': { window: RESEND_VERIFICATION_WINDOW_SECONDS, max: 3 },
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
export function buildAuth(options?: {
  readonly afterUserCreated?: ((userId: string) => Promise<void>) | undefined;
}) {
  const env = getServerEnv();
  const baseURL = resolveAuthBaseUrl(env.BETTER_AUTH_URL, env.NODE_ENV);

  return betterAuth({
    database: buildDatabaseAdapter(),
    secret: resolveAuthSecret(),
    baseURL,
    trustedOrigins: resolveTrustedOrigins(env.BETTER_AUTH_TRUSTED_ORIGINS, env.NODE_ENV),

    // Replaces Better Auth's own built-in `/api/auth/error` page (unstyled,
    // English-only) with the app's localized one — this is what a cancelled
    // or denied Google OAuth attempt actually redirects to.
    onAPIError: {
      errorURL: '/auth-error',
    },

    advanced: {
      // Better Auth 1.6.25 otherwise derives this from baseURL. Keeping the
      // decision explicit makes the production invariant reviewable while
      // still permitting the loopback HTTP server used by Playwright.
      useSecureCookies: shouldUseSecureCookies(baseURL),
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
      // Deliberately OFF (Phase 2.1's registration-hardening follow-up).
      // Confirmed against the installed better-auth@1.6.25 source
      // (`dist/api/routes/sign-up.mjs`): this block only runs after a REAL
      // `internalAdapter.createUser` — the synthetic-duplicate-response
      // branch (`shouldReturnGenericDuplicateResponse`, active because
      // `requireEmailVerification` is on) returns long before reaching it.
      // That means `sendOnSignUp` could NEVER redeliver a verification email
      // to someone re-registering an existing-but-unverified address —
      // exactly the "I lost the first email, let me just register again"
      // case this follow-up exists to fix.
      //
      // The fix moves dispatch to the CLIENT: `AuthForm`
      // (`src/components/auth/auth-form.tsx`) calls the public,
      // already-anti-enumeration-safe `sendVerificationEmail` client action
      // itself immediately after ANY accepted `signUp.email` response (a
      // real new signup or a synthetic-duplicate one — the browser cannot
      // tell them apart, and does not need to). That action hits
      // `/send-verification-email` through the real HTTP router — the same
      // endpoint `resend-verification-button.tsx` already calls — which
      // decides silently whether a real message goes out: yes for a
      // brand-new or still-unverified existing account, a no-op (identical
      // 200 shape, identical ~500ms timing floor) for an already-verified
      // one. Leaving `sendOnSignUp` on here as well would double-send for a
      // genuine first-time signup, since the client now dispatches
      // unconditionally for every accepted outcome.
      sendOnSignUp: false,
      // Recovery path for an expired verification link: since sign-in itself
      // is refused for an unverified user (requireEmailVerification below),
      // retrying sign-in is the natural next action, and this makes that
      // retry also issue a fresh link rather than requiring a separate
      // "resend" step the user has to find.
      sendOnSignIn: true,
      // The one authoritative callback: both automatic dispatch
      // (sendOnSignUp/sendOnSignIn) and the explicit resend endpoint
      // (`/send-verification-email`, called by
      // `src/components/auth/resend-verification-button.tsx`) invoke this
      // exact function — Better Auth does not have a second hook for either
      // path. `user` and `url` both come from Better Auth itself; `user.email`
      // is the ONLY recipient source here and is never replaced by the
      // configured sender address, which `getEmailAdapter()` uses solely as
      // its `from` header (see `src/lib/auth/email.ts`).
      sendVerificationEmail: async ({ user, url }) => {
        logDispatchStage('verification.callback.enter');
        if (typeof user.email !== 'string' || user.email.trim().length === 0) {
          throw new Error('Better Auth invoked sendVerificationEmail without a user email.');
        }
        logDispatchStage('verification.callback.recipient-valid');
        const locale = await resolveRequestEmailLocale();
        await getEmailAdapter().sendVerificationEmail({ to: user.email, url, locale });
      },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Kept in sync with src/lib/auth/password-policy.ts's own
      // PASSWORD_MIN_LENGTH/PASSWORD_MAX_LENGTH constants — this is only
      // the length floor/ceiling Better Auth itself enforces inside
      // signUpEmail; character-class complexity (upper/lower/number/
      // special) is NOT something Better Auth checks natively, which is
      // exactly what `enforceSignUpPasswordPolicy` above adds.
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const locale = await resolveRequestEmailLocale();
        await getEmailAdapter().sendPasswordResetEmail({ to: user.email, url, locale });
      },
      // `onExistingUserSignUp` (confirmed present in better-auth@1.6.25,
      // dist/api/routes/sign-up.mjs — fires only on the synthetic-duplicate
      // path, backgrounded via the same runInBackgroundOrAwait helper the
      // verification email already uses) remains DELIBERATELY unimplemented.
      // It is no longer needed to redeliver a verification email to the
      // legitimate owner of an unverified duplicate — `sendOnSignUp`'s
      // comment above explains that gap is now closed client-side via the
      // public `/send-verification-email` endpoint instead, which already
      // reaches the real account safely regardless of which signup attempt
      // (first-time or duplicate) prompted it.
      //
      // The only remaining hypothetical use of this hook is a DIFFERENT
      // feature: a "someone attempted to sign up with your (already
      // registered) email" SECURITY notice to the account owner. That is
      // explicitly out of scope here and has its own unresolved problem:
      // Better Auth's `/sign-up/email` rate limit is keyed by IP, not by the
      // targeted recipient, so an attacker could rotate source IPs (or wait
      // out each window) and repeatedly trigger such a notification —
      // sending one safely needs a per-recipient throttle this phase does
      // not build. Tracked as a follow-up alongside the real production
      // email provider (docs/email-delivery-setup.md).
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
            // The adapter commits Better Auth's user + credential account
            // transaction before this after-hook runs. Workspace provisioning
            // owns its own transaction and stays idempotent so a hook failure
            // is repaired on the next authoritative DAL session lookup.
            await (options?.afterUserCreated ?? ensurePersonalWorkspace)(user.id);
          },
        },
      },
    },

    hooks: {
      before: enforceSignUpPasswordPolicy,
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
