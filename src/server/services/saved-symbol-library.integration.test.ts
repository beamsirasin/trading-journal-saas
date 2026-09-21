/**
 * SAVED SYMBOL LIBRARY against a real database.
 *
 * The component tests drive the picker against an in-memory stand-in for the
 * server. These are the ones that prove the server actually keeps the promises
 * that stand-in makes: one row per symbol whatever its case, the first
 * spelling kept, newest first, an old browser list merged behind the library
 * without duplicates, and no workspace ever reading or writing another's.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  savedSymbols,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  importSavedSymbols,
  listSavedSymbols,
  removeSymbol,
  saveSymbol,
} from './saved-symbol-library';

type Db = ReturnType<typeof getTestDb>;

async function createUser(db: Db, label: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('failed to insert test user');
  return user.id;
}

async function createWorkspace(db: Db, ownerUserId: string): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Saved Symbols test workspace',
      slug: `saved-symbols-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return workspace.id;
}

/** A clock that advances a second per read, so "newest first" is never a tie. */
function tickingClock(start = Date.now()) {
  let now = start;
  return {
    now: () => {
      now += 1000;
      return new Date(now);
    },
  };
}

describe('Saved Symbol library', () => {
  const db = getTestDb();
  let userId = '';
  let otherUserId = '';
  let workspaceId = '';
  let otherWorkspaceId = '';

  beforeAll(async () => {
    userId = await createUser(db, 'saved-symbols-actor');
    otherUserId = await createUser(db, 'saved-symbols-other');
    workspaceId = await createWorkspace(db, userId);
    otherWorkspaceId = await createWorkspace(db, otherUserId);
  });

  afterEach(async () => {
    await db
      .delete(savedSymbols)
      .where(inArray(savedSymbols.workspaceId, [workspaceId, otherWorkspaceId]));
  });

  afterAll(async () => {
    await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]));
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await closeTestDb();
  });

  it('keeps each symbol exactly as typed, newest first, trimmed only', async () => {
    const clock = tickingClock();
    for (const symbol of ['  US30.cash ', 'XAUUSD.m', 'GER40']) {
      const result = await saveSymbol(workspaceId, userId, symbol, clock);
      expect(result.ok).toBe(true);
    }
    expect(await listSavedSymbols(workspaceId)).toEqual(['GER40', 'XAUUSD.m', 'US30.cash']);
  });

  it('refuses a duplicate whatever its case, keeping the first spelling', async () => {
    const clock = tickingClock();
    await saveSymbol(workspaceId, userId, 'BTCUSD', clock);
    const again = await saveSymbol(workspaceId, userId, 'btcusd', clock);
    expect(again).toEqual({ ok: true, symbols: ['BTCUSD'] });
    const rows = await db
      .select()
      .from(savedSymbols)
      .where(eq(savedSymbols.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
  });

  it('holds that rule in the database itself, not only in the service', async () => {
    await db.insert(savedSymbols).values({ workspaceId, symbol: 'NAS100' });
    await expect(
      db.insert(savedSymbols).values({ workspaceId, symbol: 'nas100' }),
    ).rejects.toThrow();
    // And a symbol with surrounding whitespace, or none at all, is not storable.
    await expect(
      db.insert(savedSymbols).values({ workspaceId, symbol: ' NAS100 ' }),
    ).rejects.toThrow();
    await expect(db.insert(savedSymbols).values({ workspaceId, symbol: '' })).rejects.toThrow();
  });

  it('removes a symbol matched ignoring case, and removing nothing is not an error', async () => {
    const clock = tickingClock();
    await saveSymbol(workspaceId, userId, 'US30.cash', clock);
    await saveSymbol(workspaceId, userId, 'GER40', clock);
    expect(await removeSymbol(workspaceId, userId, 'us30.CASH', clock)).toEqual({
      ok: true,
      symbols: ['GER40'],
    });
    expect(await removeSymbol(workspaceId, userId, 'EURUSD', clock)).toEqual({
      ok: true,
      symbols: ['GER40'],
    });
  });

  it('refuses a blank symbol before touching the database', async () => {
    expect(await saveSymbol(workspaceId, userId, '   ')).toEqual({
      ok: false,
      code: 'blank_symbol',
    });
  });

  it('never reads or writes another workspace’s library', async () => {
    const clock = tickingClock();
    await saveSymbol(otherWorkspaceId, otherUserId, 'EURUSD', clock);
    await saveSymbol(workspaceId, userId, 'eurusd', clock);
    expect(await listSavedSymbols(workspaceId)).toEqual(['eurusd']);
    expect(await listSavedSymbols(otherWorkspaceId)).toEqual(['EURUSD']);

    // A member of neither is refused, and nothing is written.
    const outsider = await saveSymbol(workspaceId, otherUserId, 'GBPUSD', clock);
    expect(outsider).toEqual({ ok: false, code: 'workspace_access_denied' });
    expect(await listSavedSymbols(workspaceId)).toEqual(['eurusd']);
  });

  it('refuses writes to a workspace that has become read-only', async () => {
    await db
      .update(workspaceEntitlements)
      .set({ status: 'expired' })
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    try {
      const result = await saveSymbol(workspaceId, userId, 'GER40');
      expect(result.ok).toBe(false);
      expect(await listSavedSymbols(workspaceId)).toEqual([]);
    } finally {
      await db
        .update(workspaceEntitlements)
        .set({ status: 'active' })
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    }
  });

  describe('the one-time move from a browser', () => {
    it('merges a browser list behind the library, in its own order, without duplicates', async () => {
      const clock = tickingClock();
      await saveSymbol(workspaceId, userId, 'BTCUSD', clock);
      // Newest first, as the browser stored it, with one the server already has.
      const result = await importSavedSymbols(
        workspaceId,
        userId,
        ['US30.cash', 'btcusd', 'XAUUSD.m', 'us30.CASH'],
        clock,
      );
      expect(result).toEqual({ ok: true, symbols: ['BTCUSD', 'US30.cash', 'XAUUSD.m'] });
    });

    it('lets anything saved afterwards sit above the imported list', async () => {
      const clock = tickingClock();
      await importSavedSymbols(workspaceId, userId, ['GER40', 'NAS100'], clock);
      await saveSymbol(workspaceId, userId, 'EURUSD', clock);
      expect(await listSavedSymbols(workspaceId)).toEqual(['EURUSD', 'GER40', 'NAS100']);
    });

    it('changes nothing when repeated', async () => {
      const clock = tickingClock();
      await importSavedSymbols(workspaceId, userId, ['GER40', 'NAS100'], clock);
      const again = await importSavedSymbols(workspaceId, userId, ['GER40', 'NAS100'], clock);
      expect(again).toEqual({ ok: true, symbols: ['GER40', 'NAS100'] });
    });

    it('drops entries no Trade could use instead of refusing the list', async () => {
      const result = await importSavedSymbols(workspaceId, userId, [
        'GER40',
        '   ',
        'X'.repeat(200),
      ]);
      expect(result).toEqual({ ok: true, symbols: ['GER40'] });
    });
  });
});
