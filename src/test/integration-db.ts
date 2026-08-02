import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/server/db/schema';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';

let resolvedTestUrl: string | undefined;
let testClient: ReturnType<typeof postgres> | undefined;

/**
 * Validate the destructive target before binding real application queries to
 * it. Vitest invokes this from setupFiles before importing any test module.
 */
export function configureIntegrationTestDatabase(): string {
  resolvedTestUrl ??= validateTestDatabaseEnvironment().testUrl;
  process.env.DATABASE_URL = resolvedTestUrl;
  return resolvedTestUrl;
}

export function resolveTestDatabaseUrl(): string {
  return resolvedTestUrl ?? validateTestDatabaseEnvironment().testUrl;
}

/** A Drizzle handle against the guarded test database. */
export function getTestDb() {
  testClient ??= postgres(resolveTestDatabaseUrl(), { max: 5 });
  return drizzle(testClient, { schema });
}

export async function closeTestDb(): Promise<void> {
  if (testClient !== undefined) {
    await testClient.end();
    testClient = undefined;
  }
}
