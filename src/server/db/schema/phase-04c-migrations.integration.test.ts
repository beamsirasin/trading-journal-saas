import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveTestDatabaseUrl } from '@/test/integration-db';

const SUFFIX = Date.now().toString(36);
const ENTITLEMENTS_TABLE = `tmp_workspace_entitlements_0005_${SUFFIX}`;
const BILLING_TABLE = `tmp_billing_transactions_0006_${SUFFIX}`;

function loadMigrationStatements(fileName: string, replacements: Record<string, string>): string[] {
  const raw = readFileSync(join(process.cwd(), 'drizzle', fileName), 'utf8');
  return raw
    .split('--> statement-breakpoint')
    .map((statement) => {
      let migrated = statement;
      for (const [from, to] of Object.entries(replacements)) {
        migrated = migrated.replaceAll(from, to);
      }
      return migrated.trim();
    })
    .filter((statement) => statement.length > 0);
}

describe('Phase 04C forward migrations (real migration SQL)', () => {
  const sql = postgres(resolveTestDatabaseUrl(), { max: 1 });
  const trialingWorkspaceId = crypto.randomUUID();
  const expiredWorkspaceId = crypto.randomUUID();
  const paidWorkspaceId = crypto.randomUUID();

  const trialingStartedAt = new Date('2026-01-01T01:02:03.000Z');
  const trialingEndsAt = new Date('2026-01-08T01:02:03.000Z');
  const expiredStartedAt = new Date('2025-12-01T04:05:06.000Z');
  const expiredEndsAt = new Date('2025-12-08T04:05:06.000Z');
  const paidPeriodEndsAt = new Date('2026-02-01T00:00:00.000Z');
  const originalCreatedAt = new Date('2025-11-01T00:00:00.000Z');
  const originalUpdatedAt = new Date('2025-11-02T00:00:00.000Z');

  beforeAll(async () => {
    const migration0003 = loadMigrationStatements('0003_add_workspace_entitlements.sql', {
      workspace_entitlements: ENTITLEMENTS_TABLE,
    });
    const createTable = migration0003[0];
    const createUniqueIndex = migration0003[2];
    if (createTable === undefined || createUniqueIndex === undefined) {
      throw new Error('expected migration 0003 table and unique-index statements');
    }
    await sql.unsafe(createTable);
    await sql.unsafe(createUniqueIndex);

    for (const statement of loadMigrationStatements(
      '0004_rename_plan_keys_trader_professional.sql',
      { workspace_entitlements: ENTITLEMENTS_TABLE },
    )) {
      await sql.unsafe(statement);
    }

    await sql.unsafe(
      `INSERT INTO "${ENTITLEMENTS_TABLE}"
        (id, workspace_id, status, plan_key, trial_started_at, trial_ends_at,
         current_period_ends_at, created_at, updated_at)
       VALUES
        (gen_random_uuid(), $1, 'trialing', NULL, $4, $5, NULL, $9, $10),
        (gen_random_uuid(), $2, 'expired', NULL, $6, $7, NULL, $9, $10),
        (gen_random_uuid(), $3, 'active', 'trader', NULL, NULL, $8, $9, $10)`,
      [
        trialingWorkspaceId,
        expiredWorkspaceId,
        paidWorkspaceId,
        trialingStartedAt,
        trialingEndsAt,
        expiredStartedAt,
        expiredEndsAt,
        paidPeriodEndsAt,
        originalCreatedAt,
        originalUpdatedAt,
      ],
    );

    for (const statement of loadMigrationStatements(
      '0005_extend_workspace_entitlements_for_billing.sql',
      { workspace_entitlements: ENTITLEMENTS_TABLE },
    )) {
      await sql.unsafe(statement);
    }

    for (const statement of loadMigrationStatements(
      '0006_create_billing_transaction_snapshots.sql',
      { billing_transactions: BILLING_TABLE },
    )) {
      await sql.unsafe(statement);
    }
  });

  afterAll(async () => {
    await sql.unsafe(`DROP TABLE IF EXISTS "${BILLING_TABLE}" CASCADE`);
    await sql.unsafe(`DROP FUNCTION IF EXISTS "${BILLING_TABLE}_protect_snapshot"()`);
    await sql.unsafe(`DROP TABLE IF EXISTS "${ENTITLEMENTS_TABLE}" CASCADE`);
    await sql.end();
  });

  it('preserves historical entitlement identity, state, periods, and original timestamps', async () => {
    const rows = await sql.unsafe<
      {
        workspace_id: string;
        status: string;
        plan_key: string | null;
        trial_started_at: Date | null;
        trial_ends_at: Date | null;
        current_period_ends_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >(
      `SELECT workspace_id, status, plan_key, trial_started_at, trial_ends_at,
              current_period_ends_at, created_at, updated_at
       FROM "${ENTITLEMENTS_TABLE}"`,
    );
    const byWorkspace = new Map(rows.map((row) => [row.workspace_id, row]));

    expect(rows).toHaveLength(3);
    expect(byWorkspace.get(trialingWorkspaceId)).toMatchObject({
      status: 'trialing',
      plan_key: null,
    });
    expect(byWorkspace.get(expiredWorkspaceId)).toMatchObject({
      status: 'expired',
      plan_key: null,
    });
    expect(byWorkspace.get(paidWorkspaceId)).toMatchObject({
      status: 'active',
      plan_key: 'trader',
    });
    expect(byWorkspace.get(trialingWorkspaceId)?.trial_started_at?.toISOString()).toBe(
      trialingStartedAt.toISOString(),
    );
    expect(byWorkspace.get(trialingWorkspaceId)?.trial_ends_at?.toISOString()).toBe(
      trialingEndsAt.toISOString(),
    );
    expect(byWorkspace.get(expiredWorkspaceId)?.trial_started_at?.toISOString()).toBe(
      expiredStartedAt.toISOString(),
    );
    expect(byWorkspace.get(expiredWorkspaceId)?.trial_ends_at?.toISOString()).toBe(
      expiredEndsAt.toISOString(),
    );
    expect(byWorkspace.get(paidWorkspaceId)?.current_period_ends_at?.toISOString()).toBe(
      paidPeriodEndsAt.toISOString(),
    );
    for (const row of rows) {
      expect(row.created_at.toISOString()).toBe(originalCreatedAt.toISOString());
      expect(row.updated_at.toISOString()).toBe(originalUpdatedAt.toISOString());
    }
  });

  it('does not restart or extend trials and does not invent paid billing metadata', async () => {
    const rows = await sql.unsafe<
      {
        current_period_started_at: Date | null;
        cancel_at_period_end: boolean;
        canceled_at: Date | null;
        billing_currency: string | null;
        billing_interval: string | null;
        pending_plan_key: string | null;
        pending_plan_effective_at: Date | null;
        provider_kind: string | null;
        provider_customer_id: string | null;
        provider_subscription_id: string | null;
      }[]
    >(
      `SELECT current_period_started_at, cancel_at_period_end, canceled_at,
              billing_currency, billing_interval, pending_plan_key,
              pending_plan_effective_at, provider_kind, provider_customer_id,
              provider_subscription_id
       FROM "${ENTITLEMENTS_TABLE}"`,
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toEqual({
        current_period_started_at: null,
        cancel_at_period_end: false,
        canceled_at: null,
        billing_currency: null,
        billing_interval: null,
        pending_plan_key: null,
        pending_plan_effective_at: null,
        provider_kind: null,
        provider_customer_id: null,
        provider_subscription_id: null,
      });
    }
  });

  it('retains the one-row-per-workspace invariant', async () => {
    await expect(
      sql.unsafe(
        `INSERT INTO "${ENTITLEMENTS_TABLE}" (id, workspace_id, status)
         VALUES (gen_random_uuid(), $1, 'trialing')`,
        [trialingWorkspaceId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('creates no billing transaction for any historical workspace', async () => {
    const [row] = await sql.unsafe<{ count: string }[]>(`SELECT count(*) FROM "${BILLING_TABLE}"`);
    expect(row?.count).toBe('0');
  });
});
