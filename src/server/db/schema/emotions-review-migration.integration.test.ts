import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { CANONICAL_SYSTEM_EMOTION_TYPES } from '@/config/emotions';
import { closeTestDb, getTestDb } from '@/test/integration-db';

const root = process.cwd();
const migrationPath = resolve(root, 'drizzle/0012_emotions_and_review.sql');
const migrationSql = readFileSync(migrationPath, 'utf8');

function sha256(path: string): string {
  return createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex')
    .toUpperCase();
}

describe('migration 0012 — Emotions and post-trade review', () => {
  const db = getTestDb();

  afterAll(async () => closeTestDb());

  it('leaves migrations 0010 and 0011 byte-identical', () => {
    expect(sha256('drizzle/0010_trade_plan_price_money_confidence.sql')).toBe(
      '00880C0637A21571EB2F99FB8A204A521B51704393C4792D0B4AFAEDD66DED1D',
    );
    expect(sha256('drizzle/0011_setup_conditions_domain.sql')).toBe(
      '17D20BC15BC661A65FE9D1E44F2CAA89E0D1C3A4E6ADDBA78CC5EDD2B1B8AB21',
    );
  });

  it('contains only the approved tables, nullable Trade fields, scope trigger, and ten-row seed', () => {
    expect(migrationSql.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(migrationSql).toMatch(/CREATE TABLE "emotion_types"/);
    expect(migrationSql).toMatch(/CREATE TABLE "trade_emotions"/);
    expect(migrationSql).toMatch(/ADD COLUMN "review_notes" text/);
    expect(migrationSql).toMatch(/ADD COLUMN "emotions_recorded_at" timestamp with time zone/);
    expect(migrationSql).toMatch(/CREATE TRIGGER "trade_emotions_workspace_scope_trigger"/);
    expect(migrationSql.match(/\('[0-9a-f-]{36}', NULL,/g)).toHaveLength(10);
    expect(migrationSql).not.toMatch(/actual_result_mode|trade_executions|execution_gap/i);
  });

  it('is present on the guarded database with the exact canonical taxonomy and truthful nullable marker', async () => {
    const taxonomy = await db.execute<{
      key: string;
      label: string;
      sort_order: number;
    }>(sql`
      SELECT key, label, sort_order
      FROM emotion_types
      WHERE is_system = true AND workspace_id IS NULL
      ORDER BY sort_order, key
    `);
    expect(taxonomy).toEqual(
      CANONICAL_SYSTEM_EMOTION_TYPES.map(({ key, label, sortOrder }) => ({
        key,
        label,
        sort_order: sortOrder,
      })),
    );

    const columns = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'trades'
        AND column_name IN ('review_notes', 'emotions_recorded_at')
      ORDER BY column_name
    `);
    expect(columns).toEqual([
      { column_name: 'emotions_recorded_at', is_nullable: 'YES' },
      { column_name: 'review_notes', is_nullable: 'YES' },
    ]);

    const trigger = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM pg_trigger
      WHERE tgname = 'trade_emotions_workspace_scope_trigger' AND NOT tgisinternal
    `);
    expect(trigger[0]?.count).toBe('1');
  });
});
