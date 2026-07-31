import 'server-only';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getDatabaseUrl } from '@/config/env.server';

import * as schema from './schema';

/**
 * Database client.
 *
 * NO CONNECTION IS OPENED AT IMPORT TIME. The client is created on first
 * `getDb()` call and memoised. This matters more than it sounds: module-scope
 * connection code runs during `next build` static generation, which would
 * make the build fail on any machine without a reachable database — CI
 * included — for pages that never touch it.
 *
 * Driver choice: postgres.js over `@neondatabase/serverless`. The Neon driver
 * is faster over HTTP on serverless platforms, but it is Neon-specific.
 * postgres.js speaks plain PostgreSQL wire protocol, so the same code runs
 * against Neon, a Docker container, and a VPS Postgres unchanged — which is
 * the portability requirement in CLAUDE.md §2. Revisit only if connection
 * latency is measured to be a real problem.
 *
 * NOTE: no tables exist yet. This is the boundary, ready for Phase 01.
 */

export type Database = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

/**
 * In development, Next.js hot reload re-evaluates modules and would leak a
 * new connection pool on every edit until the database refuses connections.
 * Stashing the client on `globalThis` survives reload.
 */
const globalForDb = globalThis as unknown as {
  __tradingOsPgClient?: ReturnType<typeof postgres>;
};

function getClient(): ReturnType<typeof postgres> {
  if (client !== undefined) {
    return client;
  }

  const existing = globalForDb.__tradingOsPgClient;
  if (existing !== undefined) {
    client = existing;
    return client;
  }

  client = postgres(getDatabaseUrl(), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Numeric and bigint columns are returned as strings by default, which is
    // exactly what the money and price strategy requires — parsing them into
    // JS numbers would reintroduce the floating-point error the whole design
    // avoids. Do not add transforms that coerce them.
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.__tradingOsPgClient = client;
  }

  return client;
}

/** The Drizzle database handle. Connects lazily on first use. */
export function getDb(): Database {
  database ??= drizzle(getClient(), { schema });
  return database;
}

/**
 * Closes the pool. For scripts and tests — a long-running server should keep
 * its pool for its lifetime.
 */
export async function closeDb(): Promise<void> {
  if (client !== undefined) {
    await client.end();
    client = undefined;
    database = undefined;
    delete globalForDb.__tradingOsPgClient;
  }
}
