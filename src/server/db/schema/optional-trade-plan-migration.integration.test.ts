import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Migration-integrity checks for
 * `drizzle/0016_optional_trade_plan.sql` (Phase 14C.1 — Quick Capture
 * Persistence Completion) — the same two-part structure every prior
 * phase-defining migration's own test file established: static assertions
 * against the committed SQL text, plus live-database assertions against the
 * shared, already-migrated test database. "Migrates cleanly from empty" is
 * re-proven on every push by CI's fresh `postgres:17-alpine` container, not
 * re-asserted here. DB-level acceptance of a genuinely no-Plan Trade (with
 * and without Strategy/Setup) is proven in
 * `trade-domain.integration.test.ts`'s "Price/Money plan independence"
 * describe block, not duplicated here.
 */
describe('migration 0016 — Optional Trade Plan integrity (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0016_optional_trade_plan.sql'),
    'utf8',
  );

  describe('migrations 0000-0015 are unchanged', () => {
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
      '0008_trade_domain_and_discipline.sql':
        'bbf9c8771bac7cb10660af2f5f38f874a60962de0ba25292e3370b05a72615b6',
      '0009_platform_admin_foundation.sql':
        '1c9637ebd04f3c8cef359a1740f82a986cf0628323f6a8485e11b7bb9a41bc54',
      '0010_trade_plan_price_money_confidence.sql':
        '00880c0637a21571eb2f99fb8a204a521b51704393c4792d0b4afaedd66ded1d',
      '0011_setup_conditions_domain.sql':
        '17d20bc15bc661a65fe9d1e44f2caa89e0d1c3a4e6addba78cc5edd2b1b8ab21',
      '0012_emotions_and_review.sql':
        '63e3a8f9e52bf293f97e5b26c63663fd67c979c45f3034fc6c29d7c817bb6af6',
      '0013_actual_execution_v2.sql':
        '6c82862c34586b6add329ae691af91c9a684fc851e063a14d01f06cd4855b5ab',
      '0014_system_money_resolution.sql':
        '5d8896e8b20578b2612424cbee21063138d808ba06b51b64efd47be8c4e9423a',
      '0015_independent_trade_classification.sql':
        'da47bf9a2b5353e138ba3e039d3d110a96b050e7a3830b3838ba93bb4b96d1fe',
    };

    it.each(Object.entries(expectedHashes))(
      '%s matches its recorded pre-0016 hash',
      (file, hash) => {
        const buf = readFileSync(join(process.cwd(), 'drizzle', file));
        expect(createHash('sha256').update(buf).digest('hex')).toBe(hash);
      },
    );
  });

  describe('migration file content', () => {
    it('touches only the trades table, and only via ALTER', () => {
      const alterMatches = migrationSql.match(/ALTER TABLE "([a-z_]+)"/g) ?? [];
      const tables = new Set(alterMatches.map((m) => m.replace(/ALTER TABLE "|"/g, '')));
      expect(Array.from(tables)).toEqual(['trades']);
    });

    it('drops exactly one constraint and nothing else — no column, table, or data change', () => {
      const ddlStatements = migrationSql
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      const dropConstraintMatches = ddlStatements.match(/DROP CONSTRAINT/g) ?? [];
      expect(dropConstraintMatches).toHaveLength(1);
      expect(ddlStatements).toMatch(/DROP CONSTRAINT "trades_plan_minimum_check"/);
      expect(ddlStatements).not.toMatch(/ADD CONSTRAINT/);
      expect(ddlStatements).not.toMatch(/ADD COLUMN/);
      expect(ddlStatements).not.toMatch(/DROP COLUMN/);
      expect(ddlStatements).not.toMatch(/ALTER COLUMN/);
      expect(ddlStatements).not.toMatch(/CREATE TABLE/);
      expect(ddlStatements).not.toMatch(/\bUPDATE\b/);
      expect(ddlStatements).not.toMatch(/\bDELETE\b/);
      expect(ddlStatements).not.toMatch(/\bINSERT\b/);
    });
  });

  describe('applied state matches the committed journal', () => {
    it('the journal records migration 0016, in order, right after 0015', () => {
      const journal = JSON.parse(
        readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { idx: number; tag: string }[] };
      const entry = journal.entries.find((e) => e.idx === 16);
      expect(entry?.tag).toBe('0016_optional_trade_plan');
      const previous = journal.entries.find((e) => e.idx === 15);
      expect(previous?.tag).toBe('0015_independent_trade_classification');
    });

    it('trades_plan_minimum_check no longer exists in the live database', async () => {
      const rows = await db.execute<{ conname: string }>(
        sql`select conname from pg_constraint
            where conrelid = 'trades'::regclass and contype = 'c'`,
      );
      const names = new Set(rows.map((r) => r.conname));
      expect(names.has('trades_plan_minimum_check')).toBe(false);
    });

    it('every other Plan/System/Actual/classification CHECK constraint still exists — this migration removed exactly one, nothing more', async () => {
      const rows = await db.execute<{ conname: string }>(
        sql`select conname from pg_constraint
            where conrelid = 'trades'::regclass and contype = 'c'`,
      );
      const names = new Set(rows.map((r) => r.conname));
      for (const stillPresent of [
        'trades_planned_price_shape_check',
        'trades_planned_money_check',
        'trades_system_status_consistency_check',
        'trades_status_consistency_check',
        'trades_actual_price_shape_check',
        'trades_strategy_identity_version_pairing_check',
        'trades_setup_identity_version_pairing_check',
        'trades_setup_requires_strategy_check',
        'trades_chart_attachment_check',
        'trades_confidence_check',
      ]) {
        expect(names.has(stillPresent)).toBe(true);
      }
    });
  });

  describe('cleanup', () => {
    it('closes the shared test database connection', async () => {
      await closeTestDb();
    });
  });
});
