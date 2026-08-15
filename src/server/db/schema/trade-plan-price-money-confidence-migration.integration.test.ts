import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Migration-integrity checks for
 * `drizzle/0010_trade_plan_price_money_confidence.sql` (Founder-UAT Trade
 * Plan UX correction slice) — the same two-part structure
 * `admin-foundation-migration.integration.test.ts` (0009) established:
 * static assertions against the committed SQL text, plus live-database
 * assertions against the shared, already-migrated test database. "Migrates
 * cleanly from empty" is re-proven on every push by CI's fresh
 * `postgres:17-alpine` container, not re-asserted here.
 */
describe('migration 0010 — Trade Plan Price/Money/Confidence integrity (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0010_trade_plan_price_money_confidence.sql'),
    'utf8',
  );

  describe('migrations 0000-0009 are unchanged', () => {
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
    };

    it.each(Object.entries(expectedHashes))(
      '%s matches its recorded pre-0010 hash',
      (file, hash) => {
        const buf = readFileSync(join(process.cwd(), 'drizzle', file));
        expect(createHash('sha256').update(buf).digest('hex')).toBe(hash);
      },
    );
  });

  describe('migration file content', () => {
    it('touches only the trades table via ALTER', () => {
      const alterMatches = migrationSql.match(/ALTER TABLE "([a-z_]+)"/g) ?? [];
      const tables = new Set(alterMatches.map((m) => m.replace(/ALTER TABLE "|"/g, '')));
      expect(Array.from(tables)).toEqual(['trades']);
    });

    it('creates no new table and drops no existing column', () => {
      expect(migrationSql).not.toMatch(/CREATE TABLE/);
      expect(migrationSql).not.toMatch(/DROP COLUMN/);
    });

    it('adds exactly the four approved columns — no public URL column (Founder review: private storage)', () => {
      for (const column of [
        'chart_attachment_storage_key',
        'chart_attachment_uploaded_at',
        'planned_risk_minor',
        'planned_reward_minor',
      ]) {
        expect(migrationSql).toMatch(new RegExp(`ADD COLUMN "${column}"`));
      }
      expect(migrationSql).not.toMatch(/"chart_attachment_url"/);
    });

    it('drops the old direction-only price check and confidence check, replacing both', () => {
      expect(migrationSql).toMatch(/DROP CONSTRAINT "trades_planned_price_direction_check"/);
      expect(migrationSql).toMatch(/DROP CONSTRAINT "trades_confidence_check"/);
      expect(migrationSql).toMatch(/ADD CONSTRAINT "trades_planned_price_shape_check"/);
      expect(migrationSql).toMatch(/ADD CONSTRAINT "trades_confidence_check"/);
    });

    it('adds exactly the three new Money/minimum/attachment CHECK constraints', () => {
      for (const constraint of [
        'trades_planned_money_check',
        'trades_plan_minimum_check',
        'trades_chart_attachment_check',
      ]) {
        expect(migrationSql).toMatch(new RegExp(`ADD CONSTRAINT "${constraint}"`));
      }
    });

    it('restricts the confidence CHECK to exactly five steps (Founder-UAT Confidence redesign — updated in place, no 0011)', () => {
      expect(migrationSql).toMatch(
        /"confidence" IS NULL OR "trades"\."confidence" IN \(0, 25, 50, 75, 100\)/,
      );
      expect(migrationSql).not.toMatch(/BETWEEN 0 AND 100/);
    });

    it('backfills existing 1-5 confidence values via the exact locked mapping (1→0, 2→25, 3→50, 4→75, 5→100)', () => {
      expect(migrationSql).toMatch(/UPDATE "trades" SET "confidence" = CASE "confidence"/);
      expect(migrationSql).toMatch(/WHEN 1 THEN 0/);
      expect(migrationSql).toMatch(/WHEN 2 THEN 25/);
      expect(migrationSql).toMatch(/WHEN 3 THEN 50/);
      expect(migrationSql).toMatch(/WHEN 4 THEN 75/);
      expect(migrationSql).toMatch(/WHEN 5 THEN 100/);
      // The superseded interim 10/30/50/70/90 midpoint mapping must never
      // reappear — this exact assertion is what would catch a regression to
      // that earlier uncommitted draft.
      expect(migrationSql).not.toMatch(/WHEN 1 THEN 10\b/);
      expect(migrationSql).not.toMatch(/WHEN 2 THEN 30\b/);
      expect(migrationSql).not.toMatch(/WHEN 4 THEN 70\b/);
      expect(migrationSql).not.toMatch(/WHEN 5 THEN 90\b/);
      // The backfill must run before the new five-step check is added, and
      // after the old 1-5 check is dropped, so it is never evaluated against
      // either constraint mid-flight.
      const dropIdx = migrationSql.indexOf('DROP CONSTRAINT "trades_confidence_check"');
      const updateIdx = migrationSql.indexOf('UPDATE "trades" SET "confidence"');
      const addIdx = migrationSql.lastIndexOf('ADD CONSTRAINT "trades_confidence_check"');
      expect(dropIdx).toBeGreaterThan(-1);
      expect(updateIdx).toBeGreaterThan(dropIdx);
      expect(addIdx).toBeGreaterThan(updateIdx);
    });

    it('makes planned_entry/planned_stop nullable rather than dropping or retyping them', () => {
      expect(migrationSql).toMatch(/ALTER COLUMN "planned_entry" DROP NOT NULL/);
      expect(migrationSql).toMatch(/ALTER COLUMN "planned_stop" DROP NOT NULL/);
      expect(migrationSql).not.toMatch(/ALTER COLUMN "planned_entry" TYPE/);
      expect(migrationSql).not.toMatch(/ALTER COLUMN "planned_stop" TYPE/);
    });
  });

  describe('applied state matches the committed journal', () => {
    it('the journal records migration 0010, in order', () => {
      const journal = JSON.parse(
        readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { idx: number; tag: string }[] };
      const entry = journal.entries.find((e) => e.idx === 10);
      expect(entry?.tag).toBe('0010_trade_plan_price_money_confidence');
    });

    it('planned_entry/planned_stop are nullable in the live database', async () => {
      const rows = await db.execute<{ column_name: string; is_nullable: string }>(
        sql`select column_name, is_nullable from information_schema.columns
            where table_name = 'trades' and column_name in ('planned_entry', 'planned_stop')`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.is_nullable).toBe('YES');
    });

    it('the four new columns exist with the correct data types — no chart_attachment_url column exists', async () => {
      const rows = await db.execute<{ column_name: string; data_type: string }>(
        sql`select column_name, data_type from information_schema.columns
            where table_name = 'trades' and column_name in (
              'chart_attachment_url', 'chart_attachment_storage_key',
              'chart_attachment_uploaded_at', 'planned_risk_minor', 'planned_reward_minor'
            )`,
      );
      const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
      expect(byName['chart_attachment_url']).toBeUndefined();
      expect(byName['chart_attachment_storage_key']).toBe('text');
      expect(byName['chart_attachment_uploaded_at']).toBe('timestamp with time zone');
      expect(byName['planned_risk_minor']).toBe('bigint');
      expect(byName['planned_reward_minor']).toBe('bigint');
    });

    it('the old direction-only price constraint is gone and the new shape/money/minimum/attachment constraints exist', async () => {
      const rows = await db.execute<{ conname: string }>(
        sql`select conname from pg_constraint
            where conrelid = 'trades'::regclass and contype = 'c'`,
      );
      const names = new Set(rows.map((r) => r.conname));
      expect(names.has('trades_planned_price_direction_check')).toBe(false);
      expect(names.has('trades_planned_price_shape_check')).toBe(true);
      expect(names.has('trades_planned_money_check')).toBe(true);
      expect(names.has('trades_plan_minimum_check')).toBe(true);
      expect(names.has('trades_chart_attachment_check')).toBe(true);
      expect(names.has('trades_confidence_check')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('closes the shared test database connection', async () => {
      await closeTestDb();
    });
  });
});
