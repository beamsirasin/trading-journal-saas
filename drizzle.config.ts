import { defineConfig } from 'drizzle-kit';

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
 * Read directly from process.env rather than through the validated env module:
 * drizzle-kit is a standalone CLI outside the Next.js runtime, and importing
 * `server-only` from it would throw.
 */

const migrationUrlSource =
  process.env.DATABASE_MIGRATION_URL !== undefined && process.env.DATABASE_MIGRATION_URL !== ''
    ? 'DATABASE_MIGRATION_URL'
    : 'DATABASE_URL';
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (url === undefined || url === '') {
  // A clear message beats drizzle-kit's own failure, which is opaque about
  // which variable it wanted.
  throw new Error(
    'drizzle-kit requires DATABASE_URL (or DATABASE_MIGRATION_URL) to be set.\n' +
      'For local development: copy .env.example to .env.local and start Postgres with `docker compose up -d`.\n' +
      'See docs/migration-runbook.md.',
  );
}

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
