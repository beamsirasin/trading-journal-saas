import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';
import { generateId } from '../../src/lib/identifiers';
import { platformAdmins } from '../../src/server/db/schema';

/**
 * Grants platform-admin authority directly in the guarded TEST database —
 * the canonical, safe E2E provisioning path (Phase 11C's own instruction:
 * "do not use the operational production bootstrap script
 * (`scripts/platform-admin.mjs`) from browser E2E if a canonical guarded
 * test helper can provision grants more safely"). Mirrors
 * `provision-user.ts`'s exact posture: does not import `src/lib/auth/
 * server.ts` or `src/server/db/client.ts` (both carry the `server-only`
 * marker, which throws outside a Next.js RSC context — Playwright specs run
 * as plain Node, not through Next's bundler), connects directly with
 * `postgres`/`drizzle`, and only imports plain schema/id modules.
 *
 * Deliberately a raw insert, not a call into `grantPlatformAdmin`
 * (`src/server/services/platform-admin-provisioning.ts`) — that module also
 * carries `import 'server-only'` transitively (via `@/server/db/client`),
 * the same constraint this file exists to route around.
 */
export async function grantPlatformAdminForE2e(
  connectionUrl: string,
  userId: string,
): Promise<void> {
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error(
      'Refusing to grant platform-admin authority outside the guarded TEST_DATABASE_URL.',
    );
  }

  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, { schema: { platformAdmins } });
  try {
    await db.insert(platformAdmins).values({ id: generateId(), userId });
  } finally {
    await client.end();
  }
}

/** Revokes the user's currently active grant, if any — safe, idempotent no-op otherwise. */
export async function revokePlatformAdminForE2e(
  connectionUrl: string,
  userId: string,
): Promise<void> {
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error(
      'Refusing to revoke platform-admin authority outside the guarded TEST_DATABASE_URL.',
    );
  }

  const client = postgres(connectionUrl, { max: 1 });
  try {
    await client`UPDATE platform_admins SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
  } finally {
    await client.end();
  }
}
