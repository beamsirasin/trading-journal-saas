import { z } from 'zod';

/**
 * Environment schemas — pure, with no runtime side effects.
 *
 * Kept separate from `env.server.ts` so they can be unit-tested. `env.server`
 * imports `server-only`, which throws by design outside a server context and
 * would therefore be untestable in a jsdom test runner.
 *
 * PHASE NOTE: every integration variable is OPTIONAL, because nothing consumes
 * one yet. Each moves to required in the phase that needs it, so a
 * misconfigured deployment fails at boot with a readable message rather than
 * deep inside a request. Making them required now would break builds and
 * preview deployments for integrations that do not exist.
 */

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/** Safe to expose to the browser. Must be prefixed `NEXT_PUBLIC_`. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl,
});

/**
 * Server-only. Never import into a client component — `env.server.ts` enforces
 * that at build time.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Phase 00b/02 — database.
  DATABASE_URL: optionalString,
  /**
   * Direct (unpooled) connection, used only for migrations and database
   * administration. Pooled endpoints can break DDL and advisory locks; see
   * docs/architecture.md §9. Named for what it is used FOR (migrations), not
   * for the connection topology (unpooled) — the topology is an
   * implementation detail of *why* migrations need it, not what a reader
   * reaches for this variable to do.
   */
  DATABASE_MIGRATION_URL: optionalString,

  // Phase 02 — Better Auth.
  /** Session/cookie signing key. Rejected if weak or placeholder-shaped in production — see src/lib/auth/server.ts. */
  BETTER_AUTH_SECRET: optionalString,
  /** Canonical URL Better Auth uses to build callback and cookie URLs. */
  BETTER_AUTH_URL: optionalUrl,
  /** Comma-separated additional origins, beyond BETTER_AUTH_URL, allowed to receive auth responses (e.g. a Vercel preview domain). */
  BETTER_AUTH_TRUSTED_ORIGINS: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /**
   * Relaxes the per-route auth rate limits (never disables them — see
   * src/lib/auth/server.ts). Better Auth keys its database-backed rate
   * limiter by IP + route only, not by account, so an e2e suite driving many
   * legitimate sign-ins from one CI runner shares the exact same bucket a
   * real attacker would — the production limit is deliberately too strict
   * for that traffic pattern to also work as a security control. Set only in
   * `.github/workflows/ci.yml`'s `e2e` job; a real deployment must never set
   * this.
   */
  E2E_TEST_MODE: optionalString,
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Formats a Zod failure into something actionable: one line per variable,
 * naming it and what was wrong. The message never echoes the offending
 * VALUE — an invalid secret is still a secret, and this text reaches logs.
 */
export function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  - ${name}: ${issue.message}`;
  });
  return [
    'Invalid environment configuration:',
    ...lines,
    '',
    'See .env.example for the full reference.',
  ].join('\n');
}

export function parseEnvOrThrow<T extends z.ZodType>(schema: T, source: unknown): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

/**
 * Reads a variable that a later phase will make required. Callers get a clear
 * failure naming the variable and how to set it, instead of a null-reference
 * error somewhere downstream.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Add it to .env.local for development, or to the deployment environment. ` +
        `See .env.example.`,
    );
  }
  return value;
}
