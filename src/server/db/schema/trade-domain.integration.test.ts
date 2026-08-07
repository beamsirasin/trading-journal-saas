import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradingAccounts,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Phase 07B schema verification against a real, disposable PostgreSQL
 * database — no service layer exists yet (Phase 08's job), so every
 * mutation here goes directly through Drizzle against the tables, CHECK
 * constraints, composite foreign keys, and the one trigger
 * `drizzle/0008_trade_domain_and_discipline.sql` installs. This is what
 * proves the database itself enforces the locked Phase 07B product
 * decisions, not merely that the TypeScript schema types look right.
 */
describe('Phase 07B trade domain (real database)', () => {
  const db = getTestDb();
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    const [ws] = await db
      .insert(workspaces)
      .values({
        name: 'Phase 07B test workspace',
        slug: `p07b-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    const [ws2] = await db
      .insert(workspaces)
      .values({
        name: 'Phase 07B other test workspace',
        slug: `p07b-other-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    if (ws === undefined || ws2 === undefined) throw new Error('failed to insert test workspaces');
    workspaceId = ws.id;
    otherWorkspaceId = ws2.id;
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
    await closeTestDb();
  });

  async function createWorkspace(name = 'Phase 07B extra test workspace') {
    const [ws] = await db
      .insert(workspaces)
      .values({ name, slug: `p07b-extra-${crypto.randomUUID()}`, kind: 'personal' })
      .returning({ id: workspaces.id });
    if (ws === undefined) throw new Error('failed to insert workspace');
    return ws.id;
  }

  async function createAccount(ws: string = workspaceId) {
    const [row] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId: ws,
        name: 'Test account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      })
      .returning({ id: tradingAccounts.id });
    if (row === undefined) throw new Error('failed to insert trading account');
    return row.id;
  }

  async function createStrategy(ws: string = workspaceId) {
    const [row] = await db
      .insert(strategies)
      .values({ workspaceId: ws, mutationKey: crypto.randomUUID() })
      .returning({ id: strategies.id });
    if (row === undefined) throw new Error('failed to insert strategy');
    return row.id;
  }

  async function createVersion(strategyId: string, versionNumber = 1, ws: string = workspaceId) {
    const [row] = await db
      .insert(strategyVersions)
      .values({ workspaceId: ws, strategyId, versionNumber, name: `v${versionNumber}` })
      .returning({ id: strategyVersions.id });
    if (row === undefined) throw new Error('failed to insert strategy version');
    return row.id;
  }

  async function createSetup(strategyId: string, ws: string = workspaceId) {
    const [row] = await db
      .insert(setups)
      .values({ workspaceId: ws, strategyId, mutationKey: crypto.randomUUID() })
      .returning({ id: setups.id });
    if (row === undefined) throw new Error('failed to insert setup');
    return row.id;
  }

  async function createSetupVersion(
    strategyId: string,
    strategyVersionId: string,
    setupId: string,
    ws: string = workspaceId,
    name = 'General Setup',
  ) {
    const [row] = await db
      .insert(strategySetupVersions)
      .values({ workspaceId: ws, strategyId, strategyVersionId, setupId, name })
      .returning({ id: strategySetupVersions.id });
    if (row === undefined) throw new Error('failed to insert setup version');
    return row.id;
  }

  async function createRule(
    strategyVersionId: string,
    ws: string = workspaceId,
    overrides: Partial<{
      setupVersionId: string | null;
      category: string;
      title: string;
      ruleKey: string;
    }> = {},
  ) {
    const [row] = await db
      .insert(strategyRules)
      .values({
        workspaceId: ws,
        strategyVersionId,
        setupVersionId: overrides.setupVersionId ?? null,
        ruleKey: overrides.ruleKey ?? crypto.randomUUID(),
        category: overrides.category ?? 'entry',
        title: overrides.title ?? 'Confirm setup',
      })
      .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
    if (row === undefined) throw new Error('failed to insert strategy rule');
    return row;
  }

  interface Framework {
    readonly tradingAccountId: string;
    readonly strategyId: string;
    readonly strategyVersionId: string;
    readonly setupId: string;
    readonly setupVersionId: string;
  }

  /** The full pinned framework a normal Trade requires — account, Strategy+Version, Setup+Version. */
  async function createFramework(ws: string = workspaceId): Promise<Framework> {
    const tradingAccountId = await createAccount(ws);
    const strategyId = await createStrategy(ws);
    const strategyVersionId = await createVersion(strategyId, 1, ws);
    const setupId = await createSetup(strategyId, ws);
    const setupVersionId = await createSetupVersion(strategyId, strategyVersionId, setupId, ws);
    return { tradingAccountId, strategyId, strategyVersionId, setupId, setupVersionId };
  }

  function basePlannedTrade(fw: Framework, ws: string = workspaceId) {
    return {
      workspaceId: ws,
      tradingAccountId: fw.tradingAccountId,
      strategyId: fw.strategyId,
      strategyVersionId: fw.strategyVersionId,
      setupId: fw.setupId,
      setupVersionId: fw.setupVersionId,
      symbol: 'EURUSD',
      direction: 'long',
      plannedEntry: '1.1000000000',
      plannedStop: '1.0950000000',
      plannedTarget: '1.1100000000',
    };
  }

  async function insertTrade(values: typeof trades.$inferInsert) {
    return db.insert(trades).values(values).returning();
  }

  describe('valid trade lifecycle states', () => {
    it('accepts a valid planned trade', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade(basePlannedTrade(fw));
      expect(row?.status).toBe('planned');
      expect(row?.systemStatus).toBe('pending');
    });

    it('accepts a valid open trade', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade({
        ...basePlannedTrade(fw),
        status: 'open',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-01-01T00:00:00Z'),
      });
      expect(row?.status).toBe('open');
    });

    it('accepts a valid closed trade', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade({
        ...basePlannedTrade(fw),
        status: 'closed',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-01-01T00:00:00Z'),
        actualExit: '1.1050000000',
        netPnlMinor: 4500n,
        exitedAt: new Date('2026-01-01T01:00:00Z'),
        actualR: '0.9000',
        traderOutcome: 'win',
      });
      expect(row?.status).toBe('closed');
      expect(row?.netPnlMinor).toBe(4500n);
    });

    it('accepts a valid canceled trade with no actual data', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade({ ...basePlannedTrade(fw), status: 'canceled' });
      expect(row?.status).toBe('canceled');
    });
  });

  describe('planned-price and direction integrity', () => {
    it('rejects an invalid direction value', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), direction: 'sideways' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a long Stop above Entry', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), plannedStop: '1.1050000000' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a short Stop below Entry', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          direction: 'short',
          plannedStop: '1.0950000000',
          plannedTarget: '1.0900000000',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a Target on the wrong side of Entry when present', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), plannedTarget: '1.0900000000' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects zero planned risk (Stop equals Entry)', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          plannedStop: '1.1000000000',
          plannedTarget: undefined,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a closed trade missing required actual data', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), status: 'closed' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });

  describe('system status consistency', () => {
    it('accepts a pending trade with system_cost_r defaulted to zero', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade(basePlannedTrade(fw));
      expect(row?.systemStatus).toBe('pending');
      expect(row?.systemCostR).toBe('0.0000');
    });

    it('accepts a resolved System outcome with all required fields, including System R and outcome', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade({
        ...basePlannedTrade(fw),
        systemStatus: 'resolved',
        systemCostR: '0.2000',
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-01-02T00:00:00Z'),
        systemExitReason: 'target_hit',
        systemResolvedAt: new Date('2026-01-02T00:00:00Z'),
        systemR: '1.8000',
        systemOutcome: 'win',
      });
      expect(row?.systemStatus).toBe('resolved');
      expect(row?.systemR).toBe('1.8000');
      expect(row?.systemOutcome).toBe('win');
    });

    it('accepts a no_trade System outcome with setup_invalidated, no exit price, and zero system_cost_r', async () => {
      const fw = await createFramework();
      const [row] = await insertTrade({
        ...basePlannedTrade(fw),
        systemStatus: 'no_trade',
        systemExitReason: 'setup_invalidated',
        systemResolvedAt: new Date('2026-01-02T00:00:00Z'),
      });
      expect(row?.systemStatus).toBe('no_trade');
      expect(row?.systemExitPrice).toBeNull();
      expect(row?.systemCostR).toBe('0.0000');
    });

    it('rejects pending with a non-null terminal field', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), systemExitReason: 'target_hit' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects pending with a non-zero system_cost_r', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), systemCostR: '0.5000' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects resolved missing required fields', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), systemStatus: 'resolved' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects resolved missing System R and outcome even when exit fields are present', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          systemStatus: 'resolved',
          systemExitPrice: '1.1100000000',
          systemExitedAt: new Date(),
          systemExitReason: 'target_hit',
          systemResolvedAt: new Date(),
          // systemR / systemOutcome deliberately omitted
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects resolved with exit reason setup_invalidated', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          systemStatus: 'resolved',
          systemExitPrice: '1.1100000000',
          systemExitedAt: new Date(),
          systemExitReason: 'setup_invalidated',
          systemResolvedAt: new Date(),
          systemR: '1.0000',
          systemOutcome: 'win',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects no_trade with a reason other than setup_invalidated', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          systemStatus: 'no_trade',
          systemExitReason: 'target_hit',
          systemResolvedAt: new Date(),
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects no_trade with a non-null exit price', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          systemStatus: 'no_trade',
          systemExitPrice: '1.1100000000',
          systemExitReason: 'setup_invalidated',
          systemResolvedAt: new Date(),
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects no_trade with a non-zero system_cost_r', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          systemStatus: 'no_trade',
          systemExitReason: 'setup_invalidated',
          systemResolvedAt: new Date(),
          systemCostR: '0.1000',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects an invalid system_exit_reason value', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({
          ...basePlannedTrade(fw),
          systemStatus: 'resolved',
          systemExitPrice: '1.1100000000',
          systemExitedAt: new Date(),
          systemExitReason: 'bogus_reason',
          systemResolvedAt: new Date(),
          systemR: '1.0000',
          systemOutcome: 'win',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects negative system_cost_r', async () => {
      const fw = await createFramework();
      await expect(
        insertTrade({ ...basePlannedTrade(fw), systemCostR: '-0.1000' }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });

  describe('bounded-field constraints', () => {
    it('rejects an out-of-range confidence value', async () => {
      const fw = await createFramework();
      await expect(insertTrade({ ...basePlannedTrade(fw), confidence: 6 })).rejects.toMatchObject({
        cause: { code: '23514' },
      });
    });

    it('rejects a non-positive calc_version', async () => {
      const fw = await createFramework();
      await expect(insertTrade({ ...basePlannedTrade(fw), calcVersion: 0 })).rejects.toMatchObject({
        cause: { code: '23514' },
      });
    });
  });

  describe('tenant integrity', () => {
    it('rejects a trade referencing a Trading Account in another workspace', async () => {
      const fw = await createFramework(workspaceId);
      const otherAccountId = await createAccount(otherWorkspaceId);
      await expect(
        insertTrade({ ...basePlannedTrade(fw), tradingAccountId: otherAccountId }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a trade referencing a Strategy in another workspace', async () => {
      const fw = await createFramework(workspaceId);
      const otherStrategyId = await createStrategy(otherWorkspaceId);
      await expect(
        insertTrade({ ...basePlannedTrade(fw), strategyId: otherStrategyId }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a strategy_version_id belonging to a different Strategy', async () => {
      const fw = await createFramework();
      const strategyB = await createStrategy();
      const versionB = await createVersion(strategyB, 1);
      await expect(
        insertTrade({ ...basePlannedTrade(fw), strategyVersionId: versionB }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a setup_id belonging to a different Strategy', async () => {
      const fw = await createFramework();
      const strategyB = await createStrategy();
      const setupB = await createSetup(strategyB);
      await expect(insertTrade({ ...basePlannedTrade(fw), setupId: setupB })).rejects.toMatchObject(
        { cause: { code: '23503' } },
      );
    });

    it('rejects a setup_version_id belonging to a different Strategy Version', async () => {
      const fw = await createFramework();
      const versionB = await createVersion(fw.strategyId, 2);
      const setupVersionB = await createSetupVersion(fw.strategyId, versionB, fw.setupId);
      await expect(
        insertTrade({ ...basePlannedTrade(fw), setupVersionId: setupVersionB }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a setup_version_id that snapshots a different Setup within the same Version', async () => {
      const fw = await createFramework();
      const otherSetupId = await createSetup(fw.strategyId);
      const otherSetupVersionId = await createSetupVersion(
        fw.strategyId,
        fw.strategyVersionId,
        otherSetupId,
        workspaceId,
        'Other setup',
      );
      await expect(
        insertTrade({ ...basePlannedTrade(fw), setupVersionId: otherSetupVersionId }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });

  describe('rule check identity and snapshots', () => {
    it('accepts all four check_status values', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');

      for (const status of ['followed', 'violated', 'not_applicable', 'not_checked'] as const) {
        const rule = await createRule(fw.strategyVersionId);
        const [row] = await db
          .insert(tradeRuleChecks)
          .values({
            workspaceId,
            tradeId: trade.id,
            strategyRuleId: rule.id,
            strategyVersionId: fw.strategyVersionId,
            ruleKey: rule.ruleKey,
            checkStatus: status,
            title: 'Confirm setup',
            category: 'entry',
            isRequired: true,
            isPreTradeCheck: false,
          })
          .returning();
        expect(row?.checkStatus).toBe(status);
      }
    });

    it('rejects an invalid check_status', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const rule = await createRule(fw.strategyVersionId);
      await expect(
        db.insert(tradeRuleChecks).values({
          workspaceId,
          tradeId: trade.id,
          strategyRuleId: rule.id,
          strategyVersionId: fw.strategyVersionId,
          ruleKey: rule.ruleKey,
          checkStatus: 'maybe',
          title: 'Confirm setup',
          category: 'entry',
          isRequired: true,
          isPreTradeCheck: false,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a duplicate Rule check for the same Trade and logical rule', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const rule = await createRule(fw.strategyVersionId);
      const values = {
        workspaceId,
        tradeId: trade.id,
        strategyRuleId: rule.id,
        strategyVersionId: fw.strategyVersionId,
        ruleKey: rule.ruleKey,
        title: 'Confirm setup',
        category: 'entry',
        isRequired: true,
        isPreTradeCheck: false,
      };
      await db.insert(tradeRuleChecks).values(values);
      await expect(db.insert(tradeRuleChecks).values(values)).rejects.toMatchObject({
        cause: { code: '23505' },
      });
    });

    it('rejects a Rule check referencing a Trade in another workspace', async () => {
      const fw = await createFramework(workspaceId);
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const rule = await createRule(fw.strategyVersionId);
      await expect(
        db.insert(tradeRuleChecks).values({
          workspaceId: otherWorkspaceId,
          tradeId: trade.id,
          strategyRuleId: rule.id,
          strategyVersionId: fw.strategyVersionId,
          ruleKey: rule.ruleKey,
          title: 'Confirm setup',
          category: 'entry',
          isRequired: true,
          isPreTradeCheck: false,
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a Rule check where strategy_rule_id/version/rule_key do not match one real row', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const ruleA = await createRule(fw.strategyVersionId);
      const ruleB = await createRule(fw.strategyVersionId);
      await expect(
        db.insert(tradeRuleChecks).values({
          workspaceId,
          tradeId: trade.id,
          strategyRuleId: ruleA.id,
          strategyVersionId: fw.strategyVersionId,
          ruleKey: ruleB.ruleKey,
          title: 'Confirm setup',
          category: 'entry',
          isRequired: true,
          isPreTradeCheck: false,
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('preserves snapshot fields unchanged when the source Rule is later edited', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const rule = await createRule(fw.strategyVersionId, workspaceId, { title: 'Original title' });
      await db.insert(tradeRuleChecks).values({
        workspaceId,
        tradeId: trade.id,
        strategyRuleId: rule.id,
        strategyVersionId: fw.strategyVersionId,
        ruleKey: rule.ruleKey,
        title: 'Original title',
        category: 'entry',
        isRequired: true,
        isPreTradeCheck: false,
      });

      // Edit the live rule directly — allowed since this Version is unlocked.
      await db
        .update(strategyRules)
        .set({ title: 'Edited title' })
        .where(eq(strategyRules.id, rule.id));

      const [check] = await db
        .select()
        .from(tradeRuleChecks)
        .where(eq(tradeRuleChecks.strategyRuleId, rule.id));
      expect(check?.title).toBe('Original title');
    });
  });

  describe('mistake snapshots', () => {
    it('accepts a reference to a shared system mistake type from any workspace', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const [systemMistake] = await db
        .select()
        .from(mistakeTypes)
        .where(eq(mistakeTypes.key, 'no_stop'));
      if (systemMistake === undefined) throw new Error('seed mistake type missing');

      const [row] = await db
        .insert(tradeMistakes)
        .values({
          tradeId: trade.id,
          mistakeTypeId: systemMistake.id,
          workspaceId,
          severityAtTime: systemMistake.severity,
          weightAtTime: systemMistake.defaultWeight,
        })
        .returning();
      expect(row?.mistakeTypeId).toBe(systemMistake.id);
    });

    it('preserves snapshotted severity/weight when the taxonomy default later changes', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const [systemMistake] = await db
        .select()
        .from(mistakeTypes)
        .where(eq(mistakeTypes.key, 'moved_stop'));
      if (systemMistake === undefined) throw new Error('seed mistake type missing');
      const originalWeight = systemMistake.defaultWeight;

      await db.insert(tradeMistakes).values({
        tradeId: trade.id,
        mistakeTypeId: systemMistake.id,
        workspaceId,
        severityAtTime: systemMistake.severity,
        weightAtTime: originalWeight,
      });

      await db
        .update(mistakeTypes)
        .set({ defaultWeight: '0.99' })
        .where(eq(mistakeTypes.id, systemMistake.id));

      const [row] = await db
        .select()
        .from(tradeMistakes)
        .where(
          and(
            eq(tradeMistakes.tradeId, trade.id),
            eq(tradeMistakes.mistakeTypeId, systemMistake.id),
          ),
        );
      expect(row?.weightAtTime).toBe(originalWeight);

      // Restore the seed's canonical value so later tests in this file see the original default.
      await db
        .update(mistakeTypes)
        .set({ defaultWeight: originalWeight })
        .where(eq(mistakeTypes.id, systemMistake.id));
    });

    it('rejects a cross-workspace reference to a custom (workspace-scoped) mistake type', async () => {
      const fw = await createFramework(workspaceId);
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      const [customMistake] = await db
        .insert(mistakeTypes)
        .values({
          workspaceId: otherWorkspaceId,
          key: `custom-${crypto.randomUUID()}`,
          label: 'Custom mistake',
          severity: 'minor',
          defaultWeight: '0.15',
          isSystem: false,
        })
        .returning();
      if (customMistake === undefined) throw new Error('failed to insert custom mistake type');

      await expect(
        db.insert(tradeMistakes).values({
          tradeId: trade.id,
          mistakeTypeId: customMistake.id,
          workspaceId, // the trade's own workspace — different from the custom mistake type's workspace
          severityAtTime: 'minor',
          weightAtTime: '0.15',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });

  describe('historical lifecycle', () => {
    it('preserves a Trade reference after its Trading Account is archived', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      await db
        .update(tradingAccounts)
        .set({ isArchived: true })
        .where(eq(tradingAccounts.id, fw.tradingAccountId));
      const [row] = await db.select().from(trades).where(eq(trades.id, trade.id));
      expect(row?.tradingAccountId).toBe(fw.tradingAccountId);
    });

    it('preserves a Trade reference after its Strategy and Setup are archived', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      await db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, fw.strategyId));
      await db.update(setups).set({ isArchived: true }).where(eq(setups.id, fw.setupId));
      const [row] = await db.select().from(trades).where(eq(trades.id, trade.id));
      expect(row?.strategyId).toBe(fw.strategyId);
      expect(row?.setupId).toBe(fw.setupId);
    });

    it('a soft-deleted Trade row remains present', async () => {
      const fw = await createFramework();
      const [trade] = await insertTrade(basePlannedTrade(fw));
      if (trade === undefined) throw new Error('failed to insert trade');
      await db.update(trades).set({ deletedAt: new Date() }).where(eq(trades.id, trade.id));
      const [row] = await db.select().from(trades).where(eq(trades.id, trade.id));
      expect(row).toBeDefined();
      expect(row?.deletedAt).not.toBeNull();
    });

    it('deleting the owning workspace cascades away its Trade-domain rows', async () => {
      const ws = await createWorkspace();
      const fw = await createFramework(ws);
      const [trade] = await insertTrade(basePlannedTrade(fw, ws));
      if (trade === undefined) throw new Error('failed to insert trade');
      const rule = await createRule(fw.strategyVersionId, ws);
      await db.insert(tradeRuleChecks).values({
        workspaceId: ws,
        tradeId: trade.id,
        strategyRuleId: rule.id,
        strategyVersionId: fw.strategyVersionId,
        ruleKey: rule.ruleKey,
        title: 'Confirm setup',
        category: 'entry',
        isRequired: true,
        isPreTradeCheck: false,
      });
      const [systemMistake] = await db
        .select()
        .from(mistakeTypes)
        .where(eq(mistakeTypes.key, 'no_setup'));
      if (systemMistake === undefined) throw new Error('seed mistake type missing');
      await db.insert(tradeMistakes).values({
        tradeId: trade.id,
        mistakeTypeId: systemMistake.id,
        workspaceId: ws,
        severityAtTime: systemMistake.severity,
        weightAtTime: systemMistake.defaultWeight,
      });

      await db.delete(workspaces).where(eq(workspaces.id, ws));

      const [tradeRow] = await db.select().from(trades).where(eq(trades.id, trade.id));
      const [checkRow] = await db
        .select()
        .from(tradeRuleChecks)
        .where(eq(tradeRuleChecks.tradeId, trade.id));
      const [mistakeRow] = await db
        .select()
        .from(tradeMistakes)
        .where(eq(tradeMistakes.tradeId, trade.id));
      expect(tradeRow).toBeUndefined();
      expect(checkRow).toBeUndefined();
      expect(mistakeRow).toBeUndefined();
    });
  });
});
