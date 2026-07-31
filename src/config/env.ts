import { z } from 'zod';

/**
 * Environment validation — CLAUDE.md §2 (Zod at every boundary).
 *
 * Phase 00 note: every variable is OPTIONAL, because nothing in the app
 * consumes one yet. As each phase lands, its variables move from `.optional()`
 * to required, so a misconfigured deployment fails fast at boot with a
 * readable message instead of throwing somewhere deep in a request.
 *
 * Server secrets must never reach the browser. Next.js only inlines
 * `NEXT_PUBLIC_*`, and `serverEnv` additionally refuses to be read on the
 * client — belt and braces, because a leaked DATABASE_URL is unrecoverable.
 */

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/** Variables safe to expose to the browser. Must be `NEXT_PUBLIC_*`. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl,
});

/** Server-only variables. Never import this into a client component. */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Phase 01
  DATABASE_URL: optionalString,

  // Phase 02
  AUTH_SECRET: optionalString,
  AUTH_URL: optionalUrl,
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  AUTH_EMAIL_FROM: optionalString,
  AUTH_RESEND_KEY: optionalString,
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Formats a Zod failure into something a human can act on: one line per
 * variable, naming the variable and what was wrong with it.
 */
export function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  - ${name}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.join('\n')}\n\nSee .env.example for the full reference.`;
}

function parseOrThrow<T extends z.ZodType>(schema: T, source: unknown): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

/**
 * Client-safe environment. Values are referenced literally so that Next.js can
 * inline them at build time — do not rewrite this as a dynamic lookup.
 */
export const clientEnv: ClientEnv = parseOrThrow(clientEnvSchema, {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

let cachedServerEnv: ServerEnv | undefined;

/** Server-only environment, parsed on first access. */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() was called in the browser. Server env must stay server-side.');
  }
  cachedServerEnv ??= parseOrThrow(serverEnvSchema, process.env);
  return cachedServerEnv;
}
