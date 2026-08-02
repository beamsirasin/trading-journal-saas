import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

import { resolveMigrationUrl } from './src/config/migration-env';

/**
 * Drizzle Kit configuration.
 *
 * Migrations use the DIRECT (unpooled) connection. Transaction poolers such
 * as PgBouncer — which is what Neon's pooled endpoint is — break DDL:
 * advisory locks are not held across a pooled connection, so two concurrent
 * migration runs can interleave and corrupt the journal. Application queries
 * use the pooled endpoint; migrations must not.
 *
 * `DATABASE_MIGRATION_URL` falls back to `DATABASE_URL`, because a plain
 * PostgreSQL server (the VPS target) has only one endpoint and requiring both
 * there would be pointless ceremony. See docs/migration-runbook.md — Neon
 * deployments must set `DATABASE_MIGRATION_URL` explicitly rather than rely
 * on the fallback.
 *
 * Read from `process.env` rather than through the validated env module:
 * drizzle-kit is a standalone CLI outside the Next.js runtime, and importing
 * `server-only` from it would throw.
 *
 * That same "outside the Next.js runtime" fact is also why `.env.local`
 * needs to be loaded explicitly here. `next dev`/`next build`/`next start`
 * load it (and `.env`, `.env.production(.local)`, etc.) automatically via
 * `@next/env` before any application code runs; `drizzle-kit` has no such
 * bootstrap, so without this call `process.env` here is exactly what the
 * invoking shell already had — never what a developer's `.env.local` says —
 * and every `pnpm db:migrate`/`db:generate`/`db:check` would silently miss
 * it. `loadEnvConfig` is the identical mechanism and file precedence Next.js
 * itself uses, not a reimplementation of it.
 */

loadEnvConfig(process.cwd());

const { source: migrationUrlSource, url } = resolveMigrationUrl(process.env);

// Never logs the URL itself (it carries a password) — only which variable
// resolved, so a fallback to DATABASE_URL is visible rather than silent.
console.log(`[drizzle.config] using ${migrationUrlSource}`);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  // Generated SQL is committed and reviewed. `drizzle-kit push` is never used
  // against a shared database: it diffs and applies without a migration file,
  // so there is no artefact to review and no way to roll back deliberately.
  strict: true,
  verbose: true,
});
