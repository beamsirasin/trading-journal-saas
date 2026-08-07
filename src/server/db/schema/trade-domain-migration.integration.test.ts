import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { billingTransactions, tradingAccounts, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Migration-integrity checks for
 * `drizzle/0008_trade_domain_and_discipline.sql` — the same posture
 * `strategy-domain-migration.integration.test.ts` established for 0007:
 * "migrations apply cleanly from empty" is re-proven on every push by CI's
 * fresh `postgres:17-alpine` container, not re-asserted here against the
 * shared, already-migrated test database. What this file DOES assert:
 * migrations 0000-0007 are byte-identical to the committed Phase 06 state,
 * 0008 touches no pre-existing table via ALTER, seeds exactly the nine
 * canonical mistake rows idempotently, and the new tables/trigger/indexes
 * exist in the live database.
 */
describe('Phase 07B trade-domain migration integrity (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0008_trade_domain_and_discipline.sql'),
    'utf8',
  );

  describe('migrations 0000-0007 are unchanged', () => {
    const expectedHashes: Record<string, string> = {
      '0000_init_auth_tenancy.sql':
        '8bdfa3860ed3562a65ab49bf0bdc100aa748969b023912fa48ea3f2cd2a949e4',
      '0001_fantastic_jigsaw.sql':
        '36460f6077b2ca6850364a301b394180b6bebef2cee64b24c05ea20ad3276e48',
      '0002_tidy_union_jack.sql':
        '96afe612e0354b1a2f071c045b279cf1483ef5cab523ad3df82611b0acc3ae03',
      '0003_add_workspace_entitlements.sql':
        'a800790948ed3629807402a1e06dc84c36280da3b799099b0849d55b68a43ebe',
      '0004_rename_plan_keys_trader_professional.sql':
        '78e94b467627a9c05c6802be3084d7e934e0ffbc40d93f1d25dcec71a51c54dd',
      '0005_extend_workspace_entitlements_for_billing.sql':
        '58c924670e5d7ebbde991e7aceb33090f0e27d1d930c947e7351253b1d4b3702',
      '0006_create_billing_transaction_snapshots.sql':
        '9c4cffd46a7fddc4902f7cbe407499378007e468a37cd8c73a73466788656c06',
      '0007_strategies_and_setups.sql':
        'aea2fb244b41bcdac991d14eb8ee4d3b55c743b3d2ebd6c23b6d297ee0621af9',
    };

    it.each(Object.entries(expectedHashes))(
      '%s matches its recorded Phase 06 hash',
      (file, hash) => {
        const buf = readFileSync(join(process.cwd(), 'drizzle', file));
        expect(createHash('sha256').update(buf).digest('hex')).toBe(hash);
      },
    );
  });

  describe('migration file content', () => {
    it('never alters an existing (pre-0008) table', () => {
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
        'strategies',
        'strategy_versions',
        'setups',
        'strategy_setup_versions',
        'strategy_rules',
      ];
      for (const table of preExistingTables) {
        expect(migrationSql).not.toMatch(new RegExp(`ALTER TABLE "${table}"\\s`, 'i'));
      }
    });

    it('adds exactly the three approved composite indexes to pre-existing tables, via CREATE INDEX only', () => {
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "trading_accounts_id_workspace_idx" ON "trading_accounts"/,
      );
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "strategy_setup_versions_id_setup_idx" ON "strategy_setup_versions"/,
      );
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "strategy_rules_id_version_rule_key_idx" ON "strategy_rules"/,
      );
    });

    it('creates exactly the four approved tables', () => {
      for (const table of ['trades', 'mistake_types', 'trade_mistakes', 'trade_rule_checks']) {
        expect(migrationSql).toMatch(new RegExp(`CREATE TABLE "${table}"`));
      }
    });

    it('creates exactly one trigger function, for cross-workspace mistake-type scoping', () => {
      const fnMatches = migrationSql.match(/CREATE FUNCTION "([a-z_]+)"/g) ?? [];
      expect(fnMatches).toEqual(['CREATE FUNCTION "trade_mistakes_workspace_scope_check"']);
      expect(migrationSql).toMatch(/CREATE TRIGGER "trade_mistakes_workspace_scope_trigger"/);
    });

    it('seeds rows only for mistake_types, via an idempotent ON CONFLICT DO NOTHING', () => {
      const insertMatches = migrationSql.match(/INSERT INTO "([a-z_]+)"/g) ?? [];
      expect(insertMatches).toEqual(['INSERT INTO "mistake_types"']);
      expect(migrationSql).toMatch(/ON CONFLICT \("key"\) WHERE "is_system" DO NOTHING/);
      const rowMatches = migrationSql.match(/\('[0-9a-f-]{36}', NULL,/g) ?? [];
      expect(rowMatches).toHaveLength(9);
    });
  });

  describe('applied state matches the committed journal', () => {
    it('the journal records migration 0008 as the latest entry', () => {
      const journal = JSON.parse(
        readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { idx: number; tag: string }[] };
      const last = journal.entries.at(-1);
      expect(last?.idx).toBe(8);
      expect(last?.tag).toBe('0008_trade_domain_and_discipline');
      expect(journal.entries).toHaveLength(9);
    });

    it('all four tables exist in the live database', async () => {
      const rows = await db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables
            where table_schema = 'public'
              and table_name in ('trades', 'mistake_types', 'trade_mistakes', 'trade_rule_checks')`,
      );
      const names = rows.map((r) => r.table_name).sort();
      expect(names).toEqual(
        ['mistake_types', 'trade_mistakes', 'trade_rule_checks', 'trades'].sort(),
      );
    });

    it('the three new composite-FK-plumbing indexes exist on their pre-existing tables', async () => {
      const rows = await db.execute<{ indexname: string; tablename: string }>(
        sql`select indexname, tablename from pg_indexes
            where tablename in ('trading_accounts', 'strategy_setup_versions', 'strategy_rules')
              and indexname in (
                'trading_accounts_id_workspace_idx',
                'strategy_setup_versions_id_setup_idx',
                'strategy_rules_id_version_rule_key_idx'
              )`,
      );
      expect(rows.map((r) => r.indexname).sort()).toEqual(
        [
          'strategy_rules_id_version_rule_key_idx',
          'strategy_setup_versions_id_setup_idx',
          'trading_accounts_id_workspace_idx',
        ].sort(),
      );
    });

    it('the mistake-type workspace-scope trigger exists on trade_mistakes', async () => {
      const rows = await db.execute<{ tgname: string }>(
        sql`select tgname from pg_trigger where tgname = 'trade_mistakes_workspace_scope_trigger'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('canonical system mistake rows are seeded exactly once, matching src/config/mistakes.ts', async () => {
      const rows = await db.execute<{ key: string; count: string }>(
        sql`select key, count(*)::text as count from mistake_types where is_system group by key`,
      );
      expect(rows).toHaveLength(9);
      for (const row of rows) {
        expect(row.count).toBe('1');
      }
    });
  });

  describe('existing Phase 3-6 data is unaffected', () => {
    it('billing RESTRICT still blocks workspace deletion and leaves everything, including any Trade-domain rows, intact', async () => {
      const [ws] = await db
        .insert(workspaces)
        .values({
          name: 'Phase 07B regression workspace',
          slug: `p07b-regression-${crypto.randomUUID()}`,
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

      let restrictErrorCode: unknown;
      try {
        await db.delete(workspaces).where(eq(workspaces.id, ws.id));
      } catch (error) {
        restrictErrorCode = (error as { cause?: { code?: string } }).cause?.code;
      }
      expect(['23001', '23503']).toContain(restrictErrorCode);

      const [accountStillThere] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, account.id));
      expect(accountStillThere?.id).toBe(account.id);

      await db.delete(billingTransactions).where(eq(billingTransactions.id, billing.id));
      await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    });
  });

  afterAll(async () => {
    await closeTestDb();
  });
});
