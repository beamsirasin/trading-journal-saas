import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { trades, tradingAccounts, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

describe('migration 0020 - historical outcome decoupling (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(join(process.cwd(), 'drizzle', '0020_mean_turbo.sql'), 'utf8');
  let workspaceId: string;
  let tradingAccountId: string;

  beforeAll(async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Pass 8C-1.1 migration tests',
        slug: `pass-8c11-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('workspace insert failed');
    workspaceId = workspace.id;

    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Historical outcome test account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      })
      .returning({ id: tradingAccounts.id });
    if (account === undefined) throw new Error('account insert failed');
    tradingAccountId = account.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await closeTestDb();
  });

  function closedTrade(
    overrides: Partial<typeof trades.$inferInsert> = {},
  ): typeof trades.$inferInsert {
    return {
      workspaceId,
      tradingAccountId,
      mutationKey: crypto.randomUUID(),
      symbol: 'XAUUSD',
      direction: 'long',
      status: 'closed',
      ...overrides,
    };
  }

  async function insertClosed(overrides: Partial<typeof trades.$inferInsert> = {}) {
    const [row] = await db.insert(trades).values(closedTrade(overrides)).returning();
    if (row === undefined) throw new Error('closed Trade insert failed');
    return row;
  }

  it('records a constraint-only migration without rewriting financial history or System rules', () => {
    expect(migrationSql).toMatch(/DROP CONSTRAINT "trades_status_consistency_check"/);
    expect(migrationSql).toMatch(/ADD CONSTRAINT "trades_status_consistency_check"/);
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\b/);
    expect(migrationSql).not.toMatch(/system_(?:status|r|outcome|gross_r|cost_r)/);

    const journal = JSON.parse(
      readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((entry) => entry.idx === 20)?.tag).toBe('0020_mean_turbo');
  });

  it('accepts known Money P&L with known risk, Actual R, and outcome', async () => {
    await expect(
      insertClosed({
        actualResultMode: 'money',
        actualInitialRiskMinor: 500n,
        netPnlMinor: 125n,
        actualR: '0.2500',
        traderOutcome: 'win',
      }),
    ).resolves.toMatchObject({ actualR: '0.2500', traderOutcome: 'win' });
  });

  it.each([
    [125n, 'win'],
    [-125n, 'loss'],
    [0n, 'break_even'],
  ] as const)(
    'accepts Money P&L %s with unknown risk, NULL Actual R, and %s outcome',
    async (netPnlMinor, traderOutcome) => {
      await expect(
        insertClosed({
          actualResultMode: 'money',
          actualInitialRiskMinor: null,
          netPnlMinor,
          finalPnlSource: 'manual_total',
          actualR: null,
          traderOutcome,
        }),
      ).resolves.toMatchObject({
        actualInitialRiskMinor: null,
        netPnlMinor,
        actualR: null,
        traderOutcome,
      });
    },
  );

  it('accepts unknown Money P&L and risk only with NULL Actual R and outcome', async () => {
    await expect(
      insertClosed({
        actualResultMode: 'money',
        actualInitialRiskMinor: null,
        netPnlMinor: null,
        actualR: null,
        traderOutcome: null,
      }),
    ).resolves.toMatchObject({ netPnlMinor: null, actualR: null, traderOutcome: null });
  });

  it.each([
    [
      'Actual R without risk/result evidence',
      { actualResultMode: 'money', actualR: '1.0000', traderOutcome: 'win' as const },
    ],
    [
      'Actual R without an outcome',
      {
        actualResultMode: 'money',
        actualInitialRiskMinor: 100n,
        netPnlMinor: 100n,
        actualR: '1.0000',
      },
    ],
    [
      'outcome without authoritative P&L',
      { actualResultMode: 'money', traderOutcome: 'win' as const },
    ],
    [
      'outcome with a mismatched P&L sign',
      {
        actualResultMode: 'money',
        netPnlMinor: -100n,
        traderOutcome: 'win' as const,
      },
    ],
    [
      'known risk and P&L without the required Actual R',
      {
        actualResultMode: 'money',
        actualInitialRiskMinor: 100n,
        netPnlMinor: 100n,
        traderOutcome: 'win' as const,
      },
    ],
  ])('rejects %s', async (_label, overrides) => {
    await expect(insertClosed(overrides)).rejects.toThrow();
  });

  it('preserves the existing valid Price-mode closed shape', async () => {
    await expect(
      insertClosed({
        actualResultMode: 'price',
        actualEntry: '100',
        actualInitialStop: '90',
        actualExit: '110',
        actualInitialRiskMinor: null,
        netPnlMinor: null,
        actualR: '1.0000',
        traderOutcome: 'win',
      }),
    ).resolves.toMatchObject({
      actualResultMode: 'price',
      actualR: '1.0000',
      traderOutcome: 'win',
    });
  });

  it('leaves the existing System Assessment constraint enforced', async () => {
    await expect(insertClosed({ systemOutcome: 'win' })).rejects.toThrow();
  });
});
