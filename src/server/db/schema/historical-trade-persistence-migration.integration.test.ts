import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { tradeExits, trades, tradingAccounts, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

describe('migration 0019 - historical trade persistence (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0019_abnormal_wendigo.sql'),
    'utf8',
  );
  let workspaceId: string;
  let tradingAccountId: string;

  beforeAll(async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Pass 8C-1 migration tests',
        slug: `pass-8c1-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('workspace insert failed');
    workspaceId = workspace.id;

    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Historical test account',
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

  it('records 0019 without rewriting or inferring legacy financial semantics', async () => {
    expect(migrationSql).not.toMatch(/\b(?:UPDATE|INSERT INTO) "trades"/);
    expect(migrationSql).not.toMatch(/\bUPDATE "trade_exits"/);

    const journal = JSON.parse(
      readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find((entry) => entry.idx === 19)?.tag).toBe('0019_abnormal_wendigo');

    const legacy = await insertClosed({
      actualResultMode: 'money',
      actualInitialRiskMinor: 500n,
      netPnlMinor: 125n,
      actualR: '0.2500',
      traderOutcome: 'win',
      enteredAt: new Date('2026-08-01T10:00:00Z'),
      exitedAt: new Date('2026-08-01T11:00:00Z'),
    });
    expect(legacy).toMatchObject({
      netPnlMinor: 125n,
      actualR: '0.2500',
      traderOutcome: 'win',
      exitHistoryCompleteness: null,
      finalPnlSource: null,
    });
  });

  it.each([
    ['zero exits', {}],
    ['NULL entry timestamp', { exitedAt: new Date('2026-08-01T11:00:00Z') }],
    ['NULL final exit timestamp', { enteredAt: new Date('2026-08-01T10:00:00Z') }],
    [
      'NULL risk with known P&L and sign-derived outcome',
      { netPnlMinor: 125n, finalPnlSource: 'manual_total', traderOutcome: 'win' as const },
    ],
    ['NULL final P&L', { actualInitialRiskMinor: 500n }],
  ])('allows a closed Trade with %s', async (_label, overrides) => {
    await expect(insertClosed(overrides)).resolves.toMatchObject({ status: 'closed' });
  });

  it('allows partial history plus unknown exit allocation and timestamp', async () => {
    const trade = await insertClosed({ exitHistoryCompleteness: 'incomplete' });
    const [exit] = await db
      .insert(tradeExits)
      .values({
        workspaceId,
        tradeId: trade.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: null,
        exitedAt: null,
        realizedPnlMinor: 100n,
        exitScope: 'part',
      })
      .returning();
    expect(exit).toMatchObject({
      closedBps: null,
      exitedAt: null,
      realizedPnlMinor: 100n,
      exitScope: 'part',
    });
  });

  it('rejects a completely empty exit shell', async () => {
    const trade = await insertClosed();
    await expect(
      db.insert(tradeExits).values({
        workspaceId,
        tradeId: trade.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
      }),
    ).rejects.toThrow();
  });

  it('allows manual total P&L to differ from the supporting exit subtotal', async () => {
    const trade = await insertClosed({
      netPnlMinor: 500n,
      finalPnlSource: 'manual_total',
      exitHistoryCompleteness: 'incomplete',
    });
    await expect(
      db.insert(tradeExits).values({
        workspaceId,
        tradeId: trade.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        realizedPnlMinor: 100n,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects exit-history provenance for incomplete or mismatched history', async () => {
    await expect(
      db.transaction(async (tx) => {
        const [trade] = await tx
          .insert(trades)
          .values(
            closedTrade({
              netPnlMinor: 100n,
              exitHistoryCompleteness: 'incomplete',
            }),
          )
          .returning({ id: trades.id });
        if (trade === undefined) throw new Error('trade insert failed');
        await tx.insert(tradeExits).values({
          workspaceId,
          tradeId: trade.id,
          mutationKey: crypto.randomUUID(),
          sequence: 1,
          realizedPnlMinor: 100n,
        });
        await tx
          .update(trades)
          .set({ finalPnlSource: 'exit_history' })
          .where(eq(trades.id, trade.id));
      }),
    ).rejects.toThrow();

    await expect(
      db.transaction(async (tx) => {
        const [trade] = await tx
          .insert(trades)
          .values(
            closedTrade({
              netPnlMinor: 200n,
              exitHistoryCompleteness: 'complete',
            }),
          )
          .returning({ id: trades.id });
        if (trade === undefined) throw new Error('trade insert failed');
        await tx.insert(tradeExits).values({
          workspaceId,
          tradeId: trade.id,
          mutationKey: crypto.randomUUID(),
          sequence: 1,
          realizedPnlMinor: 100n,
        });
        await tx
          .update(trades)
          .set({ finalPnlSource: 'exit_history' })
          .where(eq(trades.id, trade.id));
      }),
    ).rejects.toThrow();
  });

  it('accepts complete matching exit-history provenance', async () => {
    await expect(
      db.transaction(async (tx) => {
        const [trade] = await tx
          .insert(trades)
          .values(
            closedTrade({
              netPnlMinor: 300n,
              exitHistoryCompleteness: 'complete',
            }),
          )
          .returning({ id: trades.id });
        if (trade === undefined) throw new Error('trade insert failed');
        await tx.insert(tradeExits).values([
          {
            workspaceId,
            tradeId: trade.id,
            mutationKey: crypto.randomUUID(),
            sequence: 1,
            realizedPnlMinor: 100n,
          },
          {
            workspaceId,
            tradeId: trade.id,
            mutationKey: crypto.randomUUID(),
            sequence: 2,
            realizedPnlMinor: 200n,
          },
        ]);
        await tx
          .update(trades)
          .set({ finalPnlSource: 'exit_history' })
          .where(eq(trades.id, trade.id));
      }),
    ).resolves.toBeUndefined();
  });

  it('retains strict live/open allocation, timestamp, and result evidence', async () => {
    const [open] = await db
      .insert(trades)
      .values({
        workspaceId,
        tradingAccountId,
        mutationKey: crypto.randomUUID(),
        symbol: 'EURUSD',
        direction: 'long',
        status: 'open',
        actualResultMode: 'money',
        actualInitialRiskMinor: 500n,
        enteredAt: new Date('2026-08-01T10:00:00Z'),
      })
      .returning({ id: trades.id });
    if (open === undefined) throw new Error('open Trade insert failed');

    await expect(
      db.insert(tradeExits).values({
        workspaceId,
        tradeId: open.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: null,
        exitedAt: new Date('2026-08-01T11:00:00Z'),
        realizedPnlMinor: 100n,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(tradeExits).values({
        workspaceId,
        tradeId: open.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: 2_500,
        exitedAt: null,
        realizedPnlMinor: 100n,
      }),
    ).rejects.toThrow();
  });
});
