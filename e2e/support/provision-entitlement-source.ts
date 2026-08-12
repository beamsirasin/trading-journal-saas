import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';
import { workspaceEntitlements, workspaces } from '../../src/server/db/schema';

/**
 * Sets `workspace_entitlements.source` directly for an already-provisioned
 * user's personal Workspace (Phase 11E) — `provision-user.ts`'s own
 * `entitlement` option has no `source` field (every existing E2E fixture
 * relies on the column's `.default('trial')`), and adding one there would
 * touch a fixture every prior phase's E2E suite depends on. This is the
 * narrow, additive way to construct a `source: 'paid'` Workspace for the
 * Phase 11E paid-boundary E2E test specifically. Mirrors `provision-
 * platform-admin.ts`'s exact posture: a raw `postgres`/`drizzle` connection
 * (not `@/server/db/client`, which carries the `server-only` marker
 * Playwright specs cannot import), guarded against anything but the
 * disposable TEST database.
 */
/** Looks up an already-provisioned user's personal Workspace ID — used to filter the Admin Audit list precisely in a shared E2E database. */
export async function getPersonalWorkspaceId(
  connectionUrl: string,
  ownerUserId: string,
): Promise<string> {
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error('Refusing to query outside the guarded TEST_DATABASE_URL.');
  }

  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaces } });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, ownerUserId));
    if (workspace === undefined) {
      throw new Error(`No personal workspace found for user ${ownerUserId}.`);
    }
    return workspace.id;
  } finally {
    await client.end();
  }
}

export async function setWorkspaceEntitlementSourceForUser(
  connectionUrl: string,
  ownerUserId: string,
  source: 'trial' | 'paid' | 'complimentary',
): Promise<void> {
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (connectionUrl !== guardedUrl) {
    throw new Error('Refusing to set entitlement source outside the guarded TEST_DATABASE_URL.');
  }

  const client = postgres(connectionUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaceEntitlements, workspaces } });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, ownerUserId));
    if (workspace === undefined) {
      throw new Error(`No personal workspace found for user ${ownerUserId}.`);
    }
    await db
      .update(workspaceEntitlements)
      .set({ source })
      .where(eq(workspaceEntitlements.workspaceId, workspace.id));
  } finally {
    await client.end();
  }
}
