import { and, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trades, tradingAccounts, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { entryContextAnalyticsEligible } from './trade-recording-model';

describe('entry-context analytics eligibility (real database)', () => {
  const db = getTestDb();
  let workspaceId: string;
  let tradingAccountId: string;

  beforeAll(async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Entry context eligibility',
        slug: `entry-context-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('workspace insert failed');
    workspaceId = workspace.id;
    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Eligibility account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
      })
      .returning({ id: tradingAccounts.id });
    if (account === undefined) throw new Error('account insert failed');
    tradingAccountId = account.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
    await closeTestDb();
  });

  it('excludes undated closed history without excluding genuinely open Trades', async () => {
    const common = {
      workspaceId,
      tradingAccountId,
      symbol: 'EURUSD',
      direction: 'long',
    } as const;
    const inserted = await db
      .insert(trades)
      .values([
        {
          ...common,
          mutationKey: crypto.randomUUID(),
          status: 'closed',
          createdAt: new Date('2026-08-01T12:00:00Z'),
        },
        {
          ...common,
          mutationKey: crypto.randomUUID(),
          status: 'closed',
          createdAt: new Date('2026-08-01T10:00:00Z'),
          exitedAt: new Date('2026-08-01T12:00:00Z'),
        },
        {
          ...common,
          mutationKey: crypto.randomUUID(),
          status: 'open',
          actualResultMode: 'money',
          actualInitialRiskMinor: 500n,
          enteredAt: new Date('2026-08-01T12:00:00Z'),
        },
      ])
      .returning({ id: trades.id, status: trades.status, exitedAt: trades.exitedAt });

    const eligible = await db
      .select({ id: trades.id })
      .from(trades)
      .where(
        and(
          inArray(
            trades.id,
            inserted.map((row) => row.id),
          ),
          entryContextAnalyticsEligible(),
        ),
      );
    const eligibleIds = new Set(eligible.map((row) => row.id));
    expect(eligibleIds.has(inserted[0]!.id)).toBe(false);
    expect(eligibleIds.has(inserted[1]!.id)).toBe(true);
    expect(eligibleIds.has(inserted[2]!.id)).toBe(true);
  });
});
