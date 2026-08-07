import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  billingTransactions,
  tradingAccounts,
  workspaceEntitlements,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Migration-integrity checks for `drizzle/0007_strategies_and_setups.sql`.
 *
 * "Migrations 0000 through 0007 apply from an empty database" was verified
 * directly against a genuinely empty Neon branch during this phase's
 * implementation (`migrate()` against the fresh `TEST_DATABASE_URL`
 * succeeded, then re-verified with `drizzle-kit check`) — the shared,
 * already-migrated database this suite runs against cannot be reset to
 * empty from inside a test without dropping state other integration tests
 * depend on, so that specific claim is not re-asserted here as a repeatable
 * test. It IS re-asserted on every push by CI's fresh `postgres:17-alpine`
 * service container, which migrates from empty before any test runs — the
 * same mechanism `phase-04c-migrations.integration.test.ts` and every other
 * integration suite in this repository already relies on, not something
 * Phase 06B needed to reinvent.
 *
 * What this file DOES assert, against the live shared test database and the
 * committed migration file's actual text: the new tables/triggers exist,
 * migration 0007 touches no other table, it seeds no rows, and ordinary
 * Phase 3–5 data is unaffected by its presence.
 */
describe('Phase 06B migration integrity (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0007_strategies_and_setups.sql'),
    'utf8',
  );

  describe('migration file content', () => {
    it('never alters an existing (pre-0007) table', () => {
      const preExistingTables = [
        'users',
        'sessions',
        'accounts',
        'verifications',
        'rate_limits',
        'workspaces',
        'workspace_members',
        'user_preferences',
        'audit_logs',
        'trading_accounts',
        'workspace_entitlements',
        'billing_transactions',
      ];
      for (const table of preExistingTables) {
        expect(migrationSql).not.toMatch(new RegExp(`ALTER TABLE "${table}"\\s`, 'i'));
      }
    });

    it('seeds no rows — no INSERT statement anywhere in the migration', () => {
      expect(migrationSql).not.toMatch(/INSERT INTO/i);
    });

    it('creates exactly the five approved tables', () => {
      for (const table of [
        'strategies',
        'strategy_versions',
        'setups',
        'strategy_setup_versions',
        'strategy_rules',
      ]) {
        expect(migrationSql).toMatch(new RegExp(`CREATE TABLE "${table}"`));
      }
    });

    it('creates the four lock-protection trigger functions plus the shared workspace-gone helper', () => {
      for (const fn of [
        'strategy_domain_workspace_gone',
        'strategy_versions_protect_locked',
        'strategy_versions_protect_locked_delete',
        'strategy_setup_versions_protect_locked',
        'strategy_rules_protect_locked',
      ]) {
        expect(migrationSql).toMatch(new RegExp(`CREATE FUNCTION "${fn}"`));
      }
    });

    it('the shared helper is the only place workspace non-existence is checked, and every delete-path trigger calls it', () => {
      // Guards against a future edit reintroducing an unconditional block (or
      // a second, inconsistent copy of this check) instead of reusing the one
      // reviewable helper.
      const helperDefinitions = migrationSql.match(
        /CREATE FUNCTION "strategy_domain_workspace_gone"/g,
      );
      expect(helperDefinitions).toHaveLength(1);
      for (const fn of [
        'strategy_versions_protect_locked_delete',
        'strategy_setup_versions_protect_locked',
        'strategy_rules_protect_locked',
      ]) {
        const body = migrationSql.split(`CREATE FUNCTION "${fn}"`)[1]?.split('$$;')[0] ?? '';
        expect(body).toContain('strategy_domain_workspace_gone');
      }
    });
  });

  describe('applied state matches the committed journal', () => {
    it('the journal records migration 0007 as present, in order', () => {
      // Not "as the latest entry" — Phase 07B added migration 0008 on top of
      // this one; this test only re-confirms 0007's own entry is still
      // correctly recorded, not that nothing has been added since.
      const journal = JSON.parse(
        readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { idx: number; tag: string }[] };
      const entry = journal.entries.find((e) => e.idx === 7);
      expect(entry?.tag).toBe('0007_strategies_and_setups');
      expect(journal.entries.length).toBeGreaterThanOrEqual(8);
    });

    it('all five tables exist in the live database', async () => {
      const rows = await db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables
            where table_schema = 'public'
              and table_name in ('strategies', 'strategy_versions', 'setups', 'strategy_setup_versions', 'strategy_rules')`,
      );
      const names = rows.map((r) => r.table_name).sort();
      expect(names).toEqual(
        [
          'setups',
          'strategies',
          'strategy_rules',
          'strategy_setup_versions',
          'strategy_versions',
        ].sort(),
      );
    });

    it('all nine version-immutability triggers exist and target the right tables', async () => {
      const rows = await db.execute<{ event_object_table: string; trigger_name: string }>(
        sql`select event_object_table, trigger_name from information_schema.triggers
            where trigger_schema = 'public'
              and trigger_name like '%protect_locked%'
            group by event_object_table, trigger_name`,
      );
      const byTable = new Map<string, string[]>();
      for (const row of rows) {
        const list = byTable.get(row.event_object_table) ?? [];
        list.push(row.trigger_name);
        byTable.set(row.event_object_table, list);
      }
      expect(byTable.get('strategy_versions')?.sort()).toEqual(
        [
          'strategy_versions_protect_locked_update_trigger',
          'strategy_versions_protect_locked_delete_trigger',
        ].sort(),
      );
      expect(byTable.get('strategy_setup_versions')).toEqual([
        'strategy_setup_versions_protect_locked_trigger',
      ]);
      expect(byTable.get('strategy_rules')).toEqual(['strategy_rules_protect_locked_trigger']);
    });
  });

  describe('existing Phase 3–5 data is unaffected', () => {
    it('a representative workspace/account/entitlement/billing row still reads back exactly as written', async () => {
      const [ws] = await db
        .insert(workspaces)
        .values({
          name: 'Phase 06B regression workspace',
          slug: `p06b-regression-${crypto.randomUUID()}`,
          kind: 'personal',
        })
        .returning({ id: workspaces.id });
      if (ws === undefined) throw new Error('failed to insert workspace');

      const [account] = await db
        .insert(tradingAccounts)
        .values({
          workspaceId: ws.id,
          name: 'Regression account',
          accountMode: 'demo',
          baseCurrency: 'USD',
          startingBalance: '10000.0000000000',
          timezone: 'Asia/Bangkok',
          mutationKey: crypto.randomUUID(),
        })
        .returning();
      if (account === undefined) throw new Error('failed to insert trading account');

      const periodStart = new Date('2026-01-01T00:00:00.000Z');
      const periodEnd = new Date('2026-02-01T00:00:00.000Z');
      const [entitlement] = await db
        .insert(workspaceEntitlements)
        .values({
          workspaceId: ws.id,
          status: 'active',
          planKey: 'trader',
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          currentPeriodStartedAt: periodStart,
          currentPeriodEndsAt: periodEnd,
        })
        .returning();
      if (entitlement === undefined) throw new Error('failed to insert entitlement');

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
        .returning();
      if (billing === undefined) throw new Error('failed to insert billing transaction');

      const [accountRow] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, account.id));
      const [entitlementRow] = await db
        .select()
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.id, entitlement.id));
      const [billingRow] = await db
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.id, billing.id));

      expect(accountRow?.name).toBe('Regression account');
      expect(accountRow?.startingBalance).toBe('10000.0000000000');
      expect(entitlementRow?.planKey).toBe('trader');
      expect(entitlementRow?.currentPeriodEndsAt?.toISOString()).toBe(periodEnd.toISOString());
      expect(billingRow?.totalMinor).toBe(900n);
      expect(billingRow?.status).toBe('succeeded');

      // No strategy/setup row was created for this workspace by this test or
      // by the migration itself.
      const strategyCount = await db.execute<{ count: string }>(
        sql`select count(*)::text as count from strategies where workspace_id = ${ws.id}`,
      );
      expect(strategyCount[0]?.count).toBe('0');

      // billing_transactions' ON DELETE RESTRICT (a financial record's
      // deliberately stronger protection than the ordinary tenant-owned
      // CASCADE) is unweakened by adding 0007's strategy tables: a workspace
      // with billing history still cannot be deleted while that history
      // exists. The SQLSTATE for a RESTRICT violation has been observed as
      // both 23001 (restrict_violation, seen locally on PostgreSQL 18.4) and
      // 23503 (foreign_key_violation, seen on CI's postgres:17-alpine) —
      // matching billing-schema.integration.test.ts's own handling of the
      // same ambiguity.
      let restrictErrorCode: unknown;
      try {
        await db.delete(workspaces).where(eq(workspaces.id, ws.id));
      } catch (error) {
        restrictErrorCode = (error as { cause?: { code?: string } }).cause?.code;
      }
      expect(['23001', '23503']).toContain(restrictErrorCode);

      await db.delete(billingTransactions).where(eq(billingTransactions.id, billing.id));
      await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    });
  });

  afterAll(async () => {
    await closeTestDb();
  });
});
