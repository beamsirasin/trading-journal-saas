import 'server-only';

import { parseEnvOrThrow, requireEnv, serverEnvSchema, type ServerEnv } from './env.schema';

/**
 * Server-only environment access.
 *
 * The `server-only` import above is the enforcement: if any client component
 * imports this module, even transitively, the build FAILS. That matters more
 * than it might appear — a leaked DATABASE_URL or AUTH_SECRET cannot be
 * un-leaked once it ships in a client bundle, and a convention ("don't import
 * this") is not enforcement.
 *
 * Parsing is lazy. Doing it at module scope would run during static
 * generation and at import time in tooling, turning a missing optional
 * variable into a build failure.
 */

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseEnvOrThrow(serverEnvSchema, process.env);
  return cached;
}

/**
 * The pooled connection string, for ordinary application queries.
 * Throws a readable error until Phase 01 configures it.
 */
export function getDatabaseUrl(): string {
  return requireEnv('DATABASE_URL', getServerEnv().DATABASE_URL);
}

/**
 * The direct (unpooled) connection string, for migrations and database
 * administration only.
 *
 * Falls back to `DATABASE_URL` because a plain PostgreSQL server — the VPS
 * target — has no separate pooled endpoint, and requiring both there would be
 * pointless ceremony. On Neon the two genuinely differ, and this fallback
 * must never be silent in a context where it matters: `docs/migration-runbook.md`
 * documents that Neon deployments MUST set `DATABASE_MIGRATION_URL` explicitly,
 * and `drizzle.config.ts` prints which variable it resolved before running.
 */
export function getMigrationDatabaseUrl(): string {
  const env = getServerEnv();
  return requireEnv('DATABASE_MIGRATION_URL', env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL);
}

/** Test seam: clears the memoised parse so a test can vary `process.env`. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

/**
 * `undefined` when Chart-attachment upload is unconfigured — never throws.
 * Callers (`src/lib/storage/chart-attachment-storage.ts`) treat this as the
 * capability check itself, not merely a missing-config error.
 */
export function getBlobReadWriteToken(): string | undefined {
  return getServerEnv().BLOB_READ_WRITE_TOKEN;
}
