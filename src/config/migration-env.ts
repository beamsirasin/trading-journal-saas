export interface ResolvedMigrationUrl {
  readonly source: 'DATABASE_MIGRATION_URL' | 'DATABASE_URL';
  readonly url: string;
}

/**
 * Resolves which connection string `drizzle-kit` should use for migrations.
 *
 * Pure — takes an environment object rather than reading `process.env`
 * directly, so it is unit-testable against a synthetic environment without
 * a real database connection or this repo's real secrets. `drizzle.config.ts`
 * is the only real caller; it passes `process.env` after `@next/env`'s
 * `loadEnvConfig` has already populated it from `.env.local`/`.env`.
 */
export function resolveMigrationUrl(
  env: Readonly<Record<string, string | undefined>>,
): ResolvedMigrationUrl {
  const source: ResolvedMigrationUrl['source'] =
    env.DATABASE_MIGRATION_URL !== undefined && env.DATABASE_MIGRATION_URL !== ''
      ? 'DATABASE_MIGRATION_URL'
      : 'DATABASE_URL';
  const url = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;

  if (url === undefined || url === '') {
    // A clear message beats drizzle-kit's own failure, which is opaque about
    // which variable it wanted.
    throw new Error(
      'drizzle-kit requires DATABASE_URL (or DATABASE_MIGRATION_URL) to be set.\n' +
        'For local development: copy .env.example to .env.local and start Postgres with `docker compose up -d`.\n' +
        'See docs/migration-runbook.md.',
    );
  }

  return { source, url };
}
