import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  setupConditions,
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { snapshotTradeSetupConditionsInTx } from './setup-condition-snapshots';

type Db = ReturnType<typeof getTestDb>;

async function seedPinnedTrade(db: Db, label: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: label, slug: `p13b-${crypto.randomUUID()}`, kind: 'personal' })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace seed failed');
  const [account] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId: workspace.id,
      name: `${label} account`,
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '10000',
      timezone: 'UTC',
    })
    .returning({ id: tradingAccounts.id });
  const [strategy] = await db
    .insert(strategies)
    .values({ workspaceId: workspace.id })
    .returning({ id: strategies.id });
  if (account === undefined || strategy === undefined) throw new Error('framework seed failed');
  const [version] = await db
    .insert(strategyVersions)
    .values({
      workspaceId: workspace.id,
      strategyId: strategy.id,
      versionNumber: 1,
      name: `${label} strategy`,
    })
    .returning({ id: strategyVersions.id });
  if (version === undefined) throw new Error('version seed failed');
  await db
    .update(strategies)
    .set({ currentVersionId: version.id })
    .where(eq(strategies.id, strategy.id));
  const [setup] = await db
    .insert(setups)
    .values({ workspaceId: workspace.id, strategyId: strategy.id })
    .returning({ id: setups.id });
  if (setup === undefined) throw new Error('setup seed failed');
  const [setupVersion] = await db
    .insert(strategySetupVersions)
    .values({
      workspaceId: workspace.id,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      name: `${label} setup`,
    })
    .returning({ id: strategySetupVersions.id });
  if (setupVersion === undefined) throw new Error('setup version seed failed');
  const conditions = await db
    .insert(setupConditions)
    .values([
      {
        workspaceId: workspace.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        label: 'Second in source order',
        sortOrder: 2,
      },
      {
        workspaceId: workspace.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        label: 'First in source order',
        sortOrder: 1,
      },
    ])
    .returning({
      id: setupConditions.id,
      conditionKey: setupConditions.conditionKey,
      label: setupConditions.label,
      sortOrder: setupConditions.sortOrder,
    });
  const [trade] = await db
    .insert(trades)
    .values({
      workspaceId: workspace.id,
      tradingAccountId: account.id,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      setupVersionId: setupVersion.id,
      symbol: 'EURUSD',
      direction: 'long',
      plannedEntry: '1.1000000000',
      plannedStop: '1.0900000000',
      plannedTarget: '1.1200000000',
      plannedR: '2.0000',
    })
    .returning({ id: trades.id });
  if (trade === undefined || conditions.length !== 2) throw new Error('trade seed failed');
  return { workspace, setupVersion, trade, conditions };
}

describe('Phase 13B Setup Condition snapshots (real PostgreSQL)', () => {
  const db = getTestDb();
  const workspaceIds: string[] = [];

  afterAll(async () => {
    for (const workspaceId of workspaceIds) {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    await closeTestDb();
  });

  it('validates against the pinned Setup Version and snapshots server-authoritative content', async () => {
    const fixture = await seedPinnedTrade(db, 'authoritative snapshot');
    workspaceIds.push(fixture.workspace.id);
    const bySort = [...fixture.conditions].sort((a, b) => a.sortOrder - b.sortOrder);

    const result = await db.transaction((tx) =>
      snapshotTradeSetupConditionsInTx(tx, {
        workspaceId: fixture.workspace.id,
        tradeId: fixture.trade.id,
        setupVersionId: fixture.setupVersion.id,
        answers: [
          { conditionKey: bySort[1]!.conditionKey, status: 'not_met' },
          { conditionKey: bySort[0]!.conditionKey, status: 'met' },
        ],
      }),
    );
    expect(result).toEqual({ ok: true, count: 2 });

    const rows = await db
      .select()
      .from(tradeSetupConditionChecks)
      .where(eq(tradeSetupConditionChecks.tradeId, fixture.trade.id))
      .orderBy(tradeSetupConditionChecks.sortOrder);
    expect(
      rows.map((row) => [row.conditionKey, row.label, row.sortOrder, row.checkStatus]),
    ).toEqual([
      [bySort[0]!.conditionKey, 'First in source order', 1, 'met'],
      [bySort[1]!.conditionKey, 'Second in source order', 2, 'not_met'],
    ]);
  });

  it('rejects foreign workspace/trade IDs and foreign Condition keys', async () => {
    const local = await seedPinnedTrade(db, 'local snapshot');
    const foreign = await seedPinnedTrade(db, 'foreign snapshot');
    workspaceIds.push(local.workspace.id, foreign.workspace.id);

    const wrongWorkspace = await db.transaction((tx) =>
      snapshotTradeSetupConditionsInTx(tx, {
        workspaceId: foreign.workspace.id,
        tradeId: local.trade.id,
        setupVersionId: local.setupVersion.id,
        answers: [],
      }),
    );
    expect(wrongWorkspace).toEqual({ ok: false, code: 'trade_not_found' });

    const foreignKey = await db.transaction((tx) =>
      snapshotTradeSetupConditionsInTx(tx, {
        workspaceId: local.workspace.id,
        tradeId: local.trade.id,
        setupVersionId: local.setupVersion.id,
        answers: [
          { conditionKey: local.conditions[0]!.conditionKey, status: 'met' },
          { conditionKey: foreign.conditions[0]!.conditionKey, status: 'not_met' },
        ],
      }),
    );
    expect(foreignKey).toEqual({ ok: false, code: 'unknown_condition_answer' });
  });

  it('enforces binary status, one snapshot per Trade/key, and snapshot immutability in PostgreSQL', async () => {
    const fixture = await seedPinnedTrade(db, 'snapshot constraints');
    workspaceIds.push(fixture.workspace.id);
    const condition = fixture.conditions[0]!;
    const valid = {
      workspaceId: fixture.workspace.id,
      tradeId: fixture.trade.id,
      setupConditionId: condition.id,
      setupVersionId: fixture.setupVersion.id,
      conditionKey: condition.conditionKey,
      label: condition.label,
      sortOrder: condition.sortOrder,
      checkStatus: 'met' as const,
    };
    await expect(
      db.insert(tradeSetupConditionChecks).values({
        ...valid,
        conditionKey: fixture.conditions[1]!.conditionKey,
        setupConditionId: fixture.conditions[1]!.id,
        label: fixture.conditions[1]!.label,
        sortOrder: fixture.conditions[1]!.sortOrder,
        checkStatus: 'not_checked' as 'met',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    const [snapshot] = await db.insert(tradeSetupConditionChecks).values(valid).returning();
    if (snapshot === undefined) throw new Error('snapshot insert failed');
    await expect(db.insert(tradeSetupConditionChecks).values(valid)).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    await expect(
      db
        .update(tradeSetupConditionChecks)
        .set({ label: 'Illegal rewrite' })
        .where(eq(tradeSetupConditionChecks.id, snapshot.id)),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      db.delete(tradeSetupConditionChecks).where(eq(tradeSetupConditionChecks.id, snapshot.id)),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('cascades Conditions and immutable snapshots when their Workspace is deleted', async () => {
    const fixture = await seedPinnedTrade(db, 'workspace cascade');
    const condition = fixture.conditions[0]!;
    await db.insert(tradeSetupConditionChecks).values({
      workspaceId: fixture.workspace.id,
      tradeId: fixture.trade.id,
      setupConditionId: condition.id,
      setupVersionId: fixture.setupVersion.id,
      conditionKey: condition.conditionKey,
      label: condition.label,
      sortOrder: condition.sortOrder,
      checkStatus: 'met',
    });

    await db.delete(workspaces).where(eq(workspaces.id, fixture.workspace.id));
    const [conditionRows, snapshotRows] = await Promise.all([
      db
        .select()
        .from(setupConditions)
        .where(eq(setupConditions.workspaceId, fixture.workspace.id)),
      db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.workspaceId, fixture.workspace.id)),
    ]);
    expect(conditionRows).toHaveLength(0);
    expect(snapshotRows).toHaveLength(0);
  });

  it('returns zero snapshots for a pinned Setup Version with zero configured Conditions', async () => {
    const fixture = await seedPinnedTrade(db, 'zero conditions');
    workspaceIds.push(fixture.workspace.id);
    await db.delete(setupConditions).where(eq(setupConditions.workspaceId, fixture.workspace.id));
    const result = await db.transaction((tx) =>
      snapshotTradeSetupConditionsInTx(tx, {
        workspaceId: fixture.workspace.id,
        tradeId: fixture.trade.id,
        setupVersionId: fixture.setupVersion.id,
        answers: [],
      }),
    );
    expect(result).toEqual({ ok: true, count: 0 });
    const snapshots = await db
      .select()
      .from(tradeSetupConditionChecks)
      .where(eq(tradeSetupConditionChecks.tradeId, fixture.trade.id));
    expect(snapshots).toHaveLength(0);
  });

  it('rejects a Setup Version that is not the Trade pinned version', async () => {
    const fixture = await seedPinnedTrade(db, 'pinned mismatch');
    const foreign = await seedPinnedTrade(db, 'other pinned version');
    workspaceIds.push(fixture.workspace.id, foreign.workspace.id);
    const result = await db.transaction((tx) =>
      snapshotTradeSetupConditionsInTx(tx, {
        workspaceId: fixture.workspace.id,
        tradeId: fixture.trade.id,
        setupVersionId: foreign.setupVersion.id,
        answers: [],
      }),
    );
    expect(result).toEqual({ ok: false, code: 'trade_setup_version_mismatch' });
  });
});
