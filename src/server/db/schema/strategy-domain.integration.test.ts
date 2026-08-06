import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  billingTransactions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Phase 06B schema verification against a real, disposable PostgreSQL
 * database — no service layer exists yet (that is Phase 06C), so every
 * mutation here goes directly through Drizzle against the tables and
 * triggers `drizzle/0007_strategies_and_setups.sql` installs. This is what
 * proves the database itself enforces version immutability and tenant
 * integrity, not merely that the TypeScript schema types look right
 * (TypeScript `readonly` is not database immutability — see that migration's
 * comments).
 */
describe('Phase 06B strategy domain (real database)', () => {
  const db = getTestDb();
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    const [ws] = await db
      .insert(workspaces)
      .values({
        name: 'Phase 06B test workspace',
        slug: `p06b-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    const [ws2] = await db
      .insert(workspaces)
      .values({
        name: 'Phase 06B other test workspace',
        slug: `p06b-other-${crypto.randomUUID()}`,
        kind: 'personal',
      })
      .returning({ id: workspaces.id });
    if (ws === undefined || ws2 === undefined) throw new Error('failed to insert test workspaces');
    workspaceId = ws.id;
    otherWorkspaceId = ws2.id;
  });

  afterAll(async () => {
    // This suite deliberately locks several strategy_versions rows (that is
    // the whole point of the immutability tests). Deleting the owning
    // workspace directly is now the approved way to remove them — the
    // delete-protection triggers allow a locked row to be removed only as a
    // direct consequence of its own workspace being deleted (see the
    // migration's `strategy_domain_workspace_gone` comment) — so ordinary
    // cascade cleanup here doubles as a general regression check of that
    // behavior, not a special-cased workaround.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
    await closeTestDb();
  });

  async function createStrategy(ws: string = workspaceId) {
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: ws, mutationKey: crypto.randomUUID() })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('failed to insert strategy');
    return strategy.id;
  }

  async function createVersion(
    strategyId: string,
    versionNumber: number,
    ws: string = workspaceId,
    name = `v${versionNumber}`,
  ) {
    const [version] = await db
      .insert(strategyVersions)
      .values({ workspaceId: ws, strategyId, versionNumber, name })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('failed to insert strategy version');
    return version.id;
  }

  async function createSetup(strategyId: string, ws: string = workspaceId) {
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: ws, strategyId, mutationKey: crypto.randomUUID() })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('failed to insert setup');
    return setup.id;
  }

  async function createSetupVersion(
    strategyId: string,
    strategyVersionId: string,
    setupId: string,
    ws: string = workspaceId,
    name = 'Wave 2 Reversal',
    sortOrder = 0,
  ) {
    const [row] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId: ws,
        strategyId,
        strategyVersionId,
        setupId,
        name,
        sortOrder,
      })
      .returning({ id: strategySetupVersions.id });
    if (row === undefined) throw new Error('failed to insert strategy_setup_version');
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
        title: overrides.title ?? 'Must confirm RSI divergence',
      })
      .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
    if (row === undefined) throw new Error('failed to insert strategy_rule');
    return row;
  }

  describe('basic constraints', () => {
    it('accepts a valid strategy identity and first version shape', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      await db
        .update(strategies)
        .set({ currentVersionId: versionId })
        .where(eq(strategies.id, strategyId));

      const [row] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
      expect(row?.currentVersionId).toBe(versionId);
    });

    it('rejects a non-positive version number', async () => {
      const strategyId = await createStrategy();
      await expect(
        db.insert(strategyVersions).values({
          workspaceId,
          strategyId,
          versionNumber: 0,
          name: 'zero',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a blank (whitespace-only) version name', async () => {
      const strategyId = await createStrategy();
      await expect(
        db.insert(strategyVersions).values({
          workspaceId,
          strategyId,
          versionNumber: 1,
          name: '   ',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a duplicate version number within the same strategy', async () => {
      const strategyId = await createStrategy();
      await createVersion(strategyId, 1);
      await expect(
        db.insert(strategyVersions).values({
          workspaceId,
          strategyId,
          versionNumber: 1,
          name: 'dup',
        }),
      ).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    it('accepts a valid setup identity', async () => {
      const strategyId = await createStrategy();
      const setupId = await createSetup(strategyId);
      const [row] = await db.select().from(setups).where(eq(setups.id, setupId));
      expect(row?.strategyId).toBe(strategyId);
    });

    it('rejects an orphan setup (no strategy)', async () => {
      await expect(
        db.insert(setups).values({
          workspaceId,
          strategyId: crypto.randomUUID(),
          mutationKey: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a blank setup-version name', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      const setupId = await createSetup(strategyId);
      await expect(
        db.insert(strategySetupVersions).values({
          workspaceId,
          strategyId,
          strategyVersionId: versionId,
          setupId,
          name: '',
          sortOrder: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('rejects a negative sort order', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      const setupId = await createSetup(strategyId);
      await expect(
        db.insert(strategySetupVersions).values({
          workspaceId,
          strategyId,
          strategyVersionId: versionId,
          setupId,
          name: 'X',
          sortOrder: -1,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('accepts every approved rule category', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      for (const category of ['entry', 'invalidation', 'risk', 'management', 'exit']) {
        const row = await createRule(versionId, workspaceId, { category });
        expect(row.id).toBeDefined();
      }
    });

    it('rejects an unsupported rule category', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      await expect(
        createRule(versionId, workspaceId, { category: 'confirmation' }),
      ).rejects.toMatchObject({
        cause: { code: '23514' },
      });
    });

    it('rejects a blank rule title', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      await expect(createRule(versionId, workspaceId, { title: '  ' })).rejects.toMatchObject({
        cause: { code: '23514' },
      });
    });

    it('rejects a duplicate rule_key within one version', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      const first = await createRule(versionId);
      await expect(
        createRule(versionId, workspaceId, { ruleKey: first.ruleKey }),
      ).rejects.toMatchObject({
        cause: { code: '23505' },
      });
    });

    it('allows the same rule_key in a different version', async () => {
      const strategyId = await createStrategy();
      const version1 = await createVersion(strategyId, 1);
      const version2 = await createVersion(strategyId, 2);
      const first = await createRule(version1);
      const second = await createRule(version2, workspaceId, { ruleKey: first.ruleKey });
      expect(second.ruleKey).toBe(first.ruleKey);
    });
  });

  describe('tenant integrity', () => {
    it('rejects a strategy_versions row scoped to another workspace than its strategy', async () => {
      const strategyId = await createStrategy(workspaceId);
      await expect(
        db.insert(strategyVersions).values({
          workspaceId: otherWorkspaceId,
          strategyId,
          versionNumber: 1,
          name: 'cross-workspace',
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it("rejects strategies.current_version_id pointing at another strategy's version", async () => {
      const strategyA = await createStrategy();
      const strategyB = await createStrategy();
      const versionA = await createVersion(strategyA, 1);
      await expect(
        db
          .update(strategies)
          .set({ currentVersionId: versionA })
          .where(eq(strategies.id, strategyB)),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a setup scoped to a different workspace than its strategy', async () => {
      const strategyId = await createStrategy(workspaceId);
      await expect(
        db.insert(setups).values({
          workspaceId: otherWorkspaceId,
          strategyId,
          mutationKey: crypto.randomUUID(),
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a strategy_setup_version combining a setup and version from different strategies', async () => {
      const strategyA = await createStrategy();
      const strategyB = await createStrategy();
      const versionA = await createVersion(strategyA, 1);
      const setupB = await createSetup(strategyB);
      await expect(
        db.insert(strategySetupVersions).values({
          workspaceId,
          strategyId: strategyA,
          strategyVersionId: versionA,
          setupId: setupB,
          name: 'cross-strategy setup version',
          sortOrder: 0,
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a rule scoped to a setup version belonging to a different strategy version', async () => {
      const strategyId = await createStrategy();
      const versionA = await createVersion(strategyId, 1);
      const versionB = await createVersion(strategyId, 2);
      const setupId = await createSetup(strategyId);
      const setupVersionUnderA = await createSetupVersion(strategyId, versionA, setupId);
      await expect(
        createRule(versionB, workspaceId, { setupVersionId: setupVersionUnderA }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });
  });

  describe('archive policy', () => {
    it('archiving a strategy does not change its setups.is_archived', async () => {
      const strategyId = await createStrategy();
      const setupId = await createSetup(strategyId);

      await db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, strategyId));

      const [setupRow] = await db.select().from(setups).where(eq(setups.id, setupId));
      expect(setupRow?.isArchived).toBe(false);
    });

    it('restoring a strategy does not restore an individually archived setup', async () => {
      const strategyId = await createStrategy();
      const setupId = await createSetup(strategyId);
      await db.update(setups).set({ isArchived: true }).where(eq(setups.id, setupId));
      await db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, strategyId));

      // restore the strategy
      await db.update(strategies).set({ isArchived: false }).where(eq(strategies.id, strategyId));

      const [setupRow] = await db.select().from(setups).where(eq(setups.id, setupId));
      expect(setupRow?.isArchived).toBe(true);
    });

    it('archiving identity rows does not alter historical version snapshots', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(
        strategyId,
        1,
        workspaceId,
        'archived-strategy-version',
      );
      const setupId = await createSetup(strategyId);
      const setupVersionId = await createSetupVersion(strategyId, versionId, setupId);

      await db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, strategyId));
      await db.update(setups).set({ isArchived: true }).where(eq(setups.id, setupId));

      const [versionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, versionId));
      const [setupVersionRow] = await db
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.id, setupVersionId));
      expect(versionRow?.name).toBe('archived-strategy-version');
      expect(setupVersionRow?.name).toBe('Wave 2 Reversal');
    });
  });

  describe('version immutability', () => {
    it('an unlocked strategy version can be updated', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      await db
        .update(strategyVersions)
        .set({ name: 'renamed while unlocked' })
        .where(eq(strategyVersions.id, versionId));
      const [row] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, versionId));
      expect(row?.name).toBe('renamed while unlocked');
    });

    it('an unlocked setup version can be inserted, updated, and deleted', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      const setupId = await createSetup(strategyId);
      const setupVersionId = await createSetupVersion(strategyId, versionId, setupId);

      await db
        .update(strategySetupVersions)
        .set({ name: 'renamed' })
        .where(eq(strategySetupVersions.id, setupVersionId));
      const [updated] = await db
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.id, setupVersionId));
      expect(updated?.name).toBe('renamed');

      await db.delete(strategySetupVersions).where(eq(strategySetupVersions.id, setupVersionId));
      const afterDelete = await db
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.id, setupVersionId));
      expect(afterDelete).toHaveLength(0);
    });

    it('an unlocked rule can be inserted, updated, and deleted', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      const rule = await createRule(versionId);

      await db
        .update(strategyRules)
        .set({ title: 'renamed rule' })
        .where(eq(strategyRules.id, rule.id));
      const [updated] = await db.select().from(strategyRules).where(eq(strategyRules.id, rule.id));
      expect(updated?.title).toBe('renamed rule');

      await db.delete(strategyRules).where(eq(strategyRules.id, rule.id));
      const afterDelete = await db
        .select()
        .from(strategyRules)
        .where(eq(strategyRules.id, rule.id));
      expect(afterDelete).toHaveLength(0);
    });

    it('locking a version (null -> non-null) succeeds', async () => {
      const strategyId = await createStrategy();
      const versionId = await createVersion(strategyId, 1);
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, versionId));
      const [row] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, versionId));
      expect(row?.lockedAt).not.toBeNull();
    });

    describe('once locked', () => {
      async function createLockedFixture() {
        const strategyId = await createStrategy();
        const versionId = await createVersion(strategyId, 1);
        const setupId = await createSetup(strategyId);
        const setupVersionId = await createSetupVersion(strategyId, versionId, setupId);
        const rule = await createRule(versionId, workspaceId, { setupVersionId });
        await db
          .update(strategyVersions)
          .set({ lockedAt: new Date() })
          .where(eq(strategyVersions.id, versionId));
        return { strategyId, versionId, setupId, setupVersionId, ruleId: rule.id };
      }

      it('locked_at cannot be cleared back to null', async () => {
        const { versionId } = await createLockedFixture();
        await expect(
          db
            .update(strategyVersions)
            .set({ lockedAt: null })
            .where(eq(strategyVersions.id, versionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('locked_at cannot be replaced with a different timestamp', async () => {
        const { versionId } = await createLockedFixture();
        await expect(
          db
            .update(strategyVersions)
            .set({ lockedAt: new Date(Date.now() + 60_000) })
            .where(eq(strategyVersions.id, versionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('locked strategy version content update is rejected', async () => {
        const { versionId } = await createLockedFixture();
        await expect(
          db
            .update(strategyVersions)
            .set({ name: 'edited after lock' })
            .where(eq(strategyVersions.id, versionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('locked version deletion is rejected', async () => {
        const { versionId } = await createLockedFixture();
        await expect(
          db.delete(strategyVersions).where(eq(strategyVersions.id, versionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('child setup-version insert is rejected after lock', async () => {
        const { strategyId, versionId, setupId } = await createLockedFixture();
        await expect(
          db.insert(strategySetupVersions).values({
            workspaceId,
            strategyId,
            strategyVersionId: versionId,
            setupId,
            name: 'inserted after lock',
            sortOrder: 1,
          }),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('child setup-version update is rejected after lock', async () => {
        const { setupVersionId } = await createLockedFixture();
        await expect(
          db
            .update(strategySetupVersions)
            .set({ name: 'edited after lock' })
            .where(eq(strategySetupVersions.id, setupVersionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('child setup-version delete is rejected after lock', async () => {
        const { setupVersionId } = await createLockedFixture();
        await expect(
          db.delete(strategySetupVersions).where(eq(strategySetupVersions.id, setupVersionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('child rule insert is rejected after lock', async () => {
        const { versionId } = await createLockedFixture();
        await expect(createRule(versionId)).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('child rule update is rejected after lock', async () => {
        const { ruleId } = await createLockedFixture();
        await expect(
          db
            .update(strategyRules)
            .set({ title: 'edited after lock' })
            .where(eq(strategyRules.id, ruleId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('child rule delete is rejected after lock', async () => {
        const { ruleId } = await createLockedFixture();
        await expect(
          db.delete(strategyRules).where(eq(strategyRules.id, ruleId)),
        ).rejects.toMatchObject({
          cause: { code: '23514' },
        });
      });

      it('a child setup-version row cannot be reassigned out of a locked version', async () => {
        const { strategyId, setupVersionId } = await createLockedFixture();
        const otherVersionId = await createVersion(strategyId, 2);
        await expect(
          db
            .update(strategySetupVersions)
            .set({ strategyVersionId: otherVersionId })
            .where(eq(strategySetupVersions.id, setupVersionId)),
        ).rejects.toMatchObject({ cause: { code: '23514' } });
      });

      it('identity archive state may still change after lock', async () => {
        const { strategyId, setupId } = await createLockedFixture();
        await db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, strategyId));
        await db.update(setups).set({ isArchived: true }).where(eq(setups.id, setupId));
        const [strategyRow] = await db
          .select()
          .from(strategies)
          .where(eq(strategies.id, strategyId));
        const [setupRow] = await db.select().from(setups).where(eq(setups.id, setupId));
        expect(strategyRow?.isArchived).toBe(true);
        expect(setupRow?.isArchived).toBe(true);
      });

      it('the historical version row remains present after identity archiving', async () => {
        const { strategyId, versionId } = await createLockedFixture();
        await db.update(strategies).set({ isArchived: true }).where(eq(strategies.id, strategyId));
        const [row] = await db
          .select()
          .from(strategyVersions)
          .where(eq(strategyVersions.id, versionId));
        expect(row).toBeDefined();
      });

      it('deleting the Strategy identity is rejected while its workspace remains, because its cascade would delete a locked version', async () => {
        const { strategyId, versionId } = await createLockedFixture();
        await expect(
          db.delete(strategies).where(eq(strategies.id, strategyId)),
        ).rejects.toMatchObject({
          cause: { code: '23514' },
        });
        // Nothing was removed by the rejected attempt.
        const [row] = await db
          .select()
          .from(strategyVersions)
          .where(eq(strategyVersions.id, versionId));
        expect(row).toBeDefined();
      });
    });
  });

  describe('workspace deletion', () => {
    it('deleting the owning workspace cascades away locked strategy history completely', async () => {
      const [ws] = await db
        .insert(workspaces)
        .values({
          name: 'Phase 06B cascade-delete workspace',
          slug: `p06b-cascade-${crypto.randomUUID()}`,
          kind: 'personal',
        })
        .returning({ id: workspaces.id });
      if (ws === undefined) throw new Error('failed to insert workspace');

      const strategyId = await createStrategy(ws.id);
      const versionId = await createVersion(strategyId, 1, ws.id);
      const setupId = await createSetup(strategyId, ws.id);
      const setupVersionId = await createSetupVersion(strategyId, versionId, setupId, ws.id);
      await createRule(versionId, ws.id, { category: 'entry', title: 'strategy-level rule' });
      await createRule(versionId, ws.id, {
        setupVersionId,
        category: 'entry',
        title: 'setup-level rule',
      });
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, versionId));

      await expect(db.delete(workspaces).where(eq(workspaces.id, ws.id))).resolves.not.toThrow();

      const counts = await db.execute<{
        strategies: string;
        strategy_versions: string;
        setups: string;
        strategy_setup_versions: string;
        strategy_rules: string;
      }>(
        sql`select
          (select count(*) from strategies where workspace_id = ${ws.id}) as strategies,
          (select count(*) from strategy_versions where workspace_id = ${ws.id}) as strategy_versions,
          (select count(*) from setups where workspace_id = ${ws.id}) as setups,
          (select count(*) from strategy_setup_versions where workspace_id = ${ws.id}) as strategy_setup_versions,
          (select count(*) from strategy_rules where workspace_id = ${ws.id}) as strategy_rules`,
      );
      expect(counts[0]).toEqual({
        strategies: '0',
        strategy_versions: '0',
        setups: '0',
        strategy_setup_versions: '0',
        strategy_rules: '0',
      });
    });

    it('a workspace with an immutable billing transaction still cannot be deleted, even with locked strategy history', async () => {
      const [ws] = await db
        .insert(workspaces)
        .values({
          name: 'Phase 06B billing-protected workspace',
          slug: `p06b-billing-${crypto.randomUUID()}`,
          kind: 'personal',
        })
        .returning({ id: workspaces.id });
      if (ws === undefined) throw new Error('failed to insert workspace');

      const strategyId = await createStrategy(ws.id);
      const versionId = await createVersion(strategyId, 1, ws.id);
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, versionId));

      const [billing] = await db
        .insert(billingTransactions)
        .values({
          workspaceId: ws.id,
          idempotencyKey: crypto.randomUUID(),
          planKey: 'trader',
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          subtotalMinor: 900n,
          vatEnabled: false,
          appliedVatRateBasisPoints: 0,
          vatAmountMinor: 0n,
          totalMinor: 900n,
          taxMode: 'disabled',
          status: 'succeeded',
        })
        .returning({ id: billingTransactions.id });
      if (billing === undefined) throw new Error('failed to insert billing transaction');

      // billing_transactions.workspace_id is deliberately ON DELETE RESTRICT
      // (a financial record), unweakened by Phase 06B's tables. The SQLSTATE
      // has been observed as both 23001 (restrict_violation, local PostgreSQL
      // 18.4) and 23503 (foreign_key_violation, CI's postgres:17-alpine) —
      // only those repository-approved codes are accepted.
      let restrictErrorCode: unknown;
      try {
        await db.delete(workspaces).where(eq(workspaces.id, ws.id));
      } catch (error) {
        restrictErrorCode = (error as { cause?: { code?: string } }).cause?.code;
      }
      expect(['23001', '23503']).toContain(restrictErrorCode);

      const [workspaceRow] = await db.select().from(workspaces).where(eq(workspaces.id, ws.id));
      const [billingRow] = await db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.id, billing.id));
      const [versionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, versionId));
      expect(workspaceRow).toBeDefined();
      expect(billingRow).toBeDefined();
      expect(versionRow).toBeDefined();

      // Clean up without weakening RESTRICT: delete the billing row
      // explicitly first (its own real lifecycle path), then the workspace.
      await db.delete(billingTransactions).where(eq(billingTransactions.id, billing.id));
      await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    });
  });
});
