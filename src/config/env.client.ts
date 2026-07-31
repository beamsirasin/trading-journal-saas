import { clientEnvSchema, parseEnvOrThrow, type ClientEnv } from './env.schema';

/**
 * Client-safe environment.
 *
 * Values are referenced LITERALLY below. Next.js inlines `NEXT_PUBLIC_*` at
 * build time by static analysis, so a dynamic lookup such as
 * `process.env[name]` would silently produce `undefined` in the browser.
 * Do not refactor this into a loop.
 *
 * Only variables that are safe for anyone to read belong here. Everything
 * else goes in `env.server.ts`.
 */
export const clientEnv: ClientEnv = parseEnvOrThrow(clientEnvSchema, {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

/**
 * Base URL for building absolute links.
 * Falls back to a relative base so preview deployments work unconfigured.
 */
export function getAppUrl(): string {
  return clientEnv.NEXT_PUBLIC_APP_URL ?? '';
}
