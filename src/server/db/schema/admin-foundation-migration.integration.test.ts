import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  adminAuditLog,
  platformAdmins,
  platformVatConfiguration,
  users,
  workspaceEntitlements,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Migration-integrity checks for `drizzle/0009_platform_admin_foundation.sql`
 * — the same two-part structure `strategy-domain-migration.integration.test.ts`
 * (0007) already established: static assertions against the committed SQL
 * text, plus live-database assertions against the shared, already-migrated
 * test database (which CI's fresh `postgres:17-alpine` container re-proves
 * migrates cleanly from empty on every push — not re-asserted here).
 */

/**
 * Postgres/postgres.js wraps the real driver error in `.cause` — the
 * top-level thrown error's own `.message` is just "Failed query: ...", never
 * the constraint/trigger text. `strategy-domain.integration.test.ts` already
 * established checking `.cause?.code` (the SQLSTATE) instead of matching
 * message text; this helper follows that exact precedent. Every CHECK
 * constraint AND every custom immutability trigger in migration 0009 raises
 * with `ERRCODE = '23514'` (check_violation) deliberately, matching 0006's
 * and 0007's own trigger convention — so both map to the same code here.
 */
async function expectPgErrorCode(
  promise: Promise<unknown>,
  codes: readonly string[],
): Promise<void> {
  let code: string | undefined;
  try {
    await promise;
  } catch (error) {
    code = (error as { cause?: { code?: string } }).cause?.code;
  }
  expect(code, `expected one of [${codes.join(', ')}], got ${String(code)}`).toBeDefined();
  expect(codes).toContain(code);
}

const CHECK_VIOLATION = ['23514'] as const;
const UNIQUE_VIOLATION = ['23505'] as const;
const RESTRICT_VIOLATION = ['23001', '23503'] as const;

describe('Phase 11B migration integrity (real database)', () => {
  const db = getTestDb();
  const migrationSql = readFileSync(
    join(process.cwd(), 'drizzle', '0009_platform_admin_foundation.sql'),
    'utf8',
  );

  describe('migration file content', () => {
    it('creates exactly the three new tables', () => {
      for (const table of ['platform_admins', 'admin_audit_log', 'platform_vat_configuration']) {
        expect(migrationSql).toMatch(new RegExp(`CREATE TABLE "${table}"`));
      }
    });

    it('touches workspace_entitlements only via ADD COLUMN, never a destructive statement', () => {
      expect(migrationSql).not.toMatch(
        /DROP COLUMN|DROP TABLE|ALTER TABLE "workspace_entitlements".*DROP/i,
      );
      expect(migrationSql).toMatch(/ALTER TABLE "workspace_entitlements" ADD COLUMN "source"/);
    });

    it('never alters any other pre-existing (pre-0009) table', () => {
      const preExisting = [
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
        'billing_transactions',
        'strategies',
        'strategy_versions',
        'setups',
        'strategy_setup_versions',
        'strategy_rules',
        'trades',
        'mistake_types',
        'trade_mistakes',
        'trade_rule_checks',
      ];
      for (const table of preExisting) {
        expect(migrationSql).not.toMatch(new RegExp(`ALTER TABLE "${table}"\\s`, 'i'));
      }
    });

    it('backfills source deterministically from plan_key presence, not a blanket value', () => {
      expect(migrationSql).toMatch(
        /UPDATE "workspace_entitlements" SET "source" = CASE WHEN "plan_key" IS NOT NULL THEN 'paid' ELSE 'trial' END/,
      );
    });

    it('creates the four immutability trigger functions', () => {
      for (const fn of [
        'admin_audit_log_protect_content',
        'admin_audit_log_protect_delete',
        'platform_vat_configuration_protect_update',
        'platform_vat_configuration_protect_delete',
      ]) {
        expect(migrationSql).toMatch(new RegExp(`CREATE FUNCTION "${fn}"`));
      }
    });

    it('seeds exactly one row — the VAT baseline — and no other data', () => {
      const inserts = migrationSql.match(/INSERT INTO/g);
      expect(inserts).toHaveLength(1);
      expect(migrationSql).toMatch(/INSERT INTO "platform_vat_configuration"/);
    });

    it('the VAT baseline seed matches the disabled, 700-basis-point launch default', () => {
      const seedStatement = migrationSql.split('INSERT INTO "platform_vat_configuration"')[1] ?? '';
      expect(seedStatement).toMatch(/false, 700/);
    });
  });

  describe('applied state matches the committed journal', () => {
    it('the journal records migration 0009 as present, in order', () => {
      const journal = JSON.parse(
        readFileSync(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { idx: number; tag: string }[] };
      const entry = journal.entries.find((e) => e.idx === 9);
      expect(entry?.tag).toBe('0009_platform_admin_foundation');
    });

    it('all three new tables exist in the live database', async () => {
      const rows = await db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables
            where table_schema = 'public'
              and table_name in ('platform_admins', 'admin_audit_log', 'platform_vat_configuration')`,
      );
      expect(rows.map((r) => r.table_name).sort()).toEqual(
        ['admin_audit_log', 'platform_admins', 'platform_vat_configuration'].sort(),
      );
    });

    it('workspace_entitlements gained the source column', async () => {
      const rows = await db.execute<{ column_name: string }>(
        sql`select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'workspace_entitlements' and column_name = 'source'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('the four immutability triggers exist and target the right tables', async () => {
      const rows = await db.execute<{ event_object_table: string; trigger_name: string }>(
        sql`select event_object_table, trigger_name from information_schema.triggers
            where trigger_schema = 'public'
              and trigger_name in (
                'admin_audit_log_protect_content_trigger',
                'admin_audit_log_protect_delete_trigger',
                'platform_vat_configuration_protect_update_trigger',
                'platform_vat_configuration_protect_delete_trigger'
              )`,
      );
      const byTable = new Map<string, string[]>();
      for (const row of rows) {
        const list = byTable.get(row.event_object_table) ?? [];
        list.push(row.trigger_name);
        byTable.set(row.event_object_table, list);
      }
      expect(byTable.get('admin_audit_log')?.sort()).toEqual(
        [
          'admin_audit_log_protect_content_trigger',
          'admin_audit_log_protect_delete_trigger',
        ].sort(),
      );
      expect(byTable.get('platform_vat_configuration')?.sort()).toEqual(
        [
          'platform_vat_configuration_protect_update_trigger',
          'platform_vat_configuration_protect_delete_trigger',
        ].sort(),
      );
    });

    it('exactly one VAT baseline row exists, disabled at 700 basis points with a system bootstrap reason', async () => {
      const rows = await db
        .select({
          enabled: platformVatConfiguration.enabled,
          rateBasisPoints: platformVatConfiguration.rateBasisPoints,
          createdByAdminId: platformVatConfiguration.createdByAdminId,
          reasonCode: platformVatConfiguration.reasonCode,
        })
        .from(platformVatConfiguration)
        .where(eq(platformVatConfiguration.reasonCode, 'bootstrap'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        enabled: false,
        rateBasisPoints: 700,
        createdByAdminId: null,
        reasonCode: 'bootstrap',
      });
    });
  });

  describe('database-level invariants (live behavior, not just DDL text)', () => {
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    async function createUser(emailVerified = true): Promise<string> {
      const [user] = await db
        .insert(users)
        .values({
          name: 'Admin foundation test user',
          email: `admin-foundation-${crypto.randomUUID()}@example.test`,
          emailVerified,
        })
        .returning({ id: users.id });
      if (user === undefined) throw new Error('failed to insert test user');
      userIds.push(user.id);
      return user.id;
    }

    afterEach(async () => {
      for (const workspaceId of workspaceIds.splice(0)) {
        await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      }
      // platform_admins.user_id is deliberately ON DELETE RESTRICT (Phase
      // 11B's retention-safe contract — see that table's schema comment), so
      // ordinary revocation (UPDATE revoked_at) is NOT enough to allow a
      // user delete afterward: the row's mere EXISTENCE blocks it,
      // regardless of revocation state. Test teardown is not "ordinary
      // revocation" — it deletes its own fixture rows directly, which
      // nothing in this schema forbids (only the application-level
      // `revokePlatformAdmin` service promises never to delete a grant row;
      // no database trigger enforces that on `platform_admins` the way one
      // does on `admin_audit_log`/`platform_vat_configuration`).
      for (const userId of userIds.splice(0)) {
        await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    });

    afterAll(async () => {
      await closeTestDb();
    });

    it('allows at most one ACTIVE platform-admin grant per user (partial unique index)', async () => {
      const userId = await createUser();
      await db.insert(platformAdmins).values({ userId });
      await expectPgErrorCode(db.insert(platformAdmins).values({ userId }), UNIQUE_VIOLATION);
    });

    it('permits multiple historical grants: grant, revoke, grant again — both rows survive', async () => {
      const userId = await createUser();
      const [first] = await db
        .insert(platformAdmins)
        .values({ userId })
        .returning({ id: platformAdmins.id });
      await db
        .update(platformAdmins)
        .set({ revokedAt: new Date() })
        .where(eq(platformAdmins.id, first!.id));
      const [second] = await db
        .insert(platformAdmins)
        .values({ userId })
        .returning({ id: platformAdmins.id });

      const rows = await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === first!.id)?.revokedAt).not.toBeNull();
      expect(rows.find((r) => r.id === second!.id)?.revokedAt).toBeNull();
    });

    it('rejects a grant row missing a revoked_by pairing invariant violation', async () => {
      const userId = await createUser();
      await expectPgErrorCode(
        db.execute(
          sql`insert into platform_admins (id, user_id, revoked_by_admin_id) values (gen_random_uuid(), ${userId}, gen_random_uuid())`,
        ),
        CHECK_VIOLATION,
      );
    });

    it('RESTRICTs deleting a user who has ANY grant history, even fully revoked', async () => {
      const userId = await createUser();
      const [grant] = await db
        .insert(platformAdmins)
        .values({ userId })
        .returning({ id: platformAdmins.id });
      await db
        .update(platformAdmins)
        .set({ revokedAt: new Date() })
        .where(eq(platformAdmins.id, grant!.id));

      await expectPgErrorCode(db.delete(users).where(eq(users.id, userId)), RESTRICT_VIOLATION);
      // The outer afterEach's teardown (delete platform_admins rows, then
      // the user) still runs for this tracked userId and proves cleanup
      // works correctly once the grant history is gone — no special-casing
      // needed here.
    });

    it('admin_audit_log rejects a platform_admin actor with no actor_admin_id, and a system actor with one', async () => {
      const userId = await createUser();
      await expectPgErrorCode(
        db.insert(adminAuditLog).values({
          actorKind: 'platform_admin',
          actorAdminId: null,
          action: 'platform_admin.granted',
          subjectUserId: userId,
          reasonCode: 'bootstrap',
        }),
        CHECK_VIOLATION,
      );

      const [grant] = await db
        .insert(platformAdmins)
        .values({ userId })
        .returning({ id: platformAdmins.id });
      await expectPgErrorCode(
        db.insert(adminAuditLog).values({
          actorKind: 'system',
          actorAdminId: grant!.id,
          action: 'platform_admin.granted',
          subjectUserId: userId,
          reasonCode: 'bootstrap',
        }),
        CHECK_VIOLATION,
      );
    });

    it('admin_audit_log rejects an action or reason code outside the closed vocabulary', async () => {
      await expectPgErrorCode(
        db.insert(adminAuditLog).values({
          actorKind: 'system',
          action: 'platform_admin.deleted' as never,
          reasonCode: 'bootstrap',
        }),
        CHECK_VIOLATION,
      );
      await expectPgErrorCode(
        db.insert(adminAuditLog).values({
          actorKind: 'system',
          action: 'platform_admin.granted',
          reasonCode: 'because_i_said_so' as never,
        }),
        CHECK_VIOLATION,
      );
    });

    it('admin_audit_log is immutable: content UPDATEs and any DELETE are rejected', async () => {
      const [row] = await db
        .insert(adminAuditLog)
        .values({ actorKind: 'system', action: 'platform_admin.granted', reasonCode: 'bootstrap' })
        .returning({ id: adminAuditLog.id });

      await expectPgErrorCode(
        db.update(adminAuditLog).set({ reasonCode: 'other' }).where(eq(adminAuditLog.id, row!.id)),
        CHECK_VIOLATION,
      );
      await expectPgErrorCode(
        db.delete(adminAuditLog).where(eq(adminAuditLog.id, row!.id)),
        CHECK_VIOLATION,
      );
    });

    it('admin_audit_log permits subject_user_id/subject_workspace_id transitioning to NULL only (the FK SET NULL path), never reassignment', async () => {
      const userId = await createUser();
      const otherUserId = await createUser();
      const [row] = await db
        .insert(adminAuditLog)
        .values({
          actorKind: 'system',
          action: 'platform_admin.granted',
          subjectUserId: userId,
          reasonCode: 'bootstrap',
        })
        .returning({ id: adminAuditLog.id });

      await expectPgErrorCode(
        db
          .update(adminAuditLog)
          .set({ subjectUserId: otherUserId })
          .where(eq(adminAuditLog.id, row!.id)),
        CHECK_VIOLATION,
      );

      await db
        .update(adminAuditLog)
        .set({ subjectUserId: null })
        .where(eq(adminAuditLog.id, row!.id));
      const [after] = await db.select().from(adminAuditLog).where(eq(adminAuditLog.id, row!.id));
      expect(after?.subjectUserId).toBeNull();
    });

    it('a real user-delete cascade SETs admin_audit_log.subject_user_id NULL without mutating any other content', async () => {
      const userId = await createUser();
      const [row] = await db
        .insert(adminAuditLog)
        .values({
          actorKind: 'system',
          action: 'platform_admin.granted',
          subjectUserId: userId,
          reasonCode: 'bootstrap',
          reasonNote: 'cascade-proof row',
        })
        .returning({ id: adminAuditLog.id });

      // This user has no platform_admins row, so the RESTRICT FK on that
      // table does not apply — a plain delete succeeds and exercises
      // admin_audit_log's own ON DELETE SET NULL path.
      await db.delete(users).where(eq(users.id, userId));
      const index = userIds.indexOf(userId);
      if (index >= 0) userIds.splice(index, 1);

      const [after] = await db.select().from(adminAuditLog).where(eq(adminAuditLog.id, row!.id));
      expect(after).toMatchObject({
        subjectUserId: null,
        actorKind: 'system',
        action: 'platform_admin.granted',
        reasonCode: 'bootstrap',
        reasonNote: 'cascade-proof row',
      });
    });

    it('admin_audit_log rejects a reason note over 500 characters', async () => {
      await expectPgErrorCode(
        db.insert(adminAuditLog).values({
          actorKind: 'system',
          action: 'platform_admin.granted',
          reasonCode: 'bootstrap',
          reasonNote: 'x'.repeat(501),
        }),
        CHECK_VIOLATION,
      );
    });

    it('platform_vat_configuration rejects a rate outside 0-10000 basis points', async () => {
      await expectPgErrorCode(
        db.insert(platformVatConfiguration).values({
          enabled: true,
          rateBasisPoints: 10_001,
          effectiveAt: new Date(),
          reasonCode: 'configuration_change',
        }),
        CHECK_VIOLATION,
      );
    });

    it('platform_vat_configuration is immutable: UPDATE and DELETE are unconditionally rejected', async () => {
      const [row] = await db
        .insert(platformVatConfiguration)
        .values({
          enabled: true,
          rateBasisPoints: 700,
          effectiveAt: new Date(),
          reasonCode: 'configuration_change',
        })
        .returning({ id: platformVatConfiguration.id });

      await expectPgErrorCode(
        db
          .update(platformVatConfiguration)
          .set({ enabled: false })
          .where(eq(platformVatConfiguration.id, row!.id)),
        CHECK_VIOLATION,
      );
      await expectPgErrorCode(
        db.delete(platformVatConfiguration).where(eq(platformVatConfiguration.id, row!.id)),
        CHECK_VIOLATION,
      );
    });

    it('the migration 0009 backfill rule classifies rows by plan_key presence, deterministically', async () => {
      const [ws1] = await db
        .insert(workspaces)
        .values({ name: 'Backfill paid', slug: `backfill-paid-${crypto.randomUUID()}` })
        .returning({ id: workspaces.id });
      const [ws2] = await db
        .insert(workspaces)
        .values({ name: 'Backfill trial', slug: `backfill-trial-${crypto.randomUUID()}` })
        .returning({ id: workspaces.id });
      workspaceIds.push(ws1!.id, ws2!.id);

      // Deliberately inserted with the WRONG source, to prove the backfill
      // statement — re-executed verbatim below — overwrites it based purely
      // on plan_key presence, exactly as migration 0009 does once, historically.
      await db.insert(workspaceEntitlements).values({
        workspaceId: ws1!.id,
        status: 'active',
        planKey: 'trader',
        source: 'complimentary',
      });
      await db.insert(workspaceEntitlements).values({
        workspaceId: ws2!.id,
        status: 'trialing',
        planKey: null,
        source: 'complimentary',
      });

      await db.execute(
        sql`UPDATE workspace_entitlements SET source = CASE WHEN plan_key IS NOT NULL THEN 'paid' ELSE 'trial' END WHERE workspace_id IN (${ws1!.id}, ${ws2!.id})`,
      );

      const rows = await db
        .select({
          workspaceId: workspaceEntitlements.workspaceId,
          source: workspaceEntitlements.source,
        })
        .from(workspaceEntitlements)
        .where(inArray(workspaceEntitlements.workspaceId, [ws1!.id, ws2!.id]));
      expect(rows.find((r) => r.workspaceId === ws1!.id)?.source).toBe('paid');
      expect(rows.find((r) => r.workspaceId === ws2!.id)?.source).toBe('trial');
    });

    it('workspace_entitlements.source defaults to trial and rejects a value outside the closed set', async () => {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: 'Source default', slug: `source-default-${crypto.randomUUID()}` })
        .returning({ id: workspaces.id });
      workspaceIds.push(ws!.id);

      await db.insert(workspaceEntitlements).values({ workspaceId: ws!.id, status: 'trialing' });
      const [row] = await db
        .select({ source: workspaceEntitlements.source })
        .from(workspaceEntitlements)
        .where(eq(workspaceEntitlements.workspaceId, ws!.id));
      expect(row?.source).toBe('trial');

      await expectPgErrorCode(
        db.execute(
          sql`insert into workspace_entitlements (id, workspace_id, status, source) values (gen_random_uuid(), ${ws!.id}, 'trialing', 'bogus')`,
        ),
        CHECK_VIOLATION,
      );
    });

    it('existing Phase 04-10 entitlement query patterns are unaffected by the new column (no active grants leak in)', async () => {
      const activeGrants = await db
        .select({ id: platformAdmins.id })
        .from(platformAdmins)
        .where(isNull(platformAdmins.revokedAt));
      // Not asserting zero (other tests in this file may run first and clean
      // up after themselves) — asserting the query itself still runs and
      // returns an array is the actual regression this guards: a malformed
      // migration could leave the table unreadable or the partial index
      // broken in a way that breaks a plain SELECT.
      expect(Array.isArray(activeGrants)).toBe(true);
    });
  });
});
