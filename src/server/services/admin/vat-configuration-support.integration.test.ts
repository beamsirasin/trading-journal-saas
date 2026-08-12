import { and, desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createFixedClock } from '@/lib/time';
import { adminAuditLog, platformAdmins, platformVatConfiguration, users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * `platform_vat_configuration` is global, append-only, and has no per-test
 * workspace to scope inserts to. Two isolation measures make this file safe
 * to run repeatedly against the shared TEST database, and safe alongside
 * every other integration test file in the same suite run:
 *
 * 1. Each test gets its OWN non-overlapping simulated time window
 *    (`nextTestWindow()`, 10,000 real seconds apart) — so two tests'
 *    `effectiveAt` values can never tie or interleave with each other, and
 *    a leftover row from a PREVIOUS run of this same file (using the exact
 *    same fixed windows) is always superseded by the current run's rows,
 *    which have a strictly later `createdAt`.
 * 2. `afterEach` inserts a baseline-restoring row effective one hour after
 *    that test's own window, so the true "current" configuration is back to
 *    baseline before the next test (or any other test file) runs.
 *
 * Audit-row assertions are additionally scoped to the specific admin actor
 * each test creates, since `admin_audit_log` accumulates across tests and
 * runs with no isolation of its own (by design — it is append-only).
 */
type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => currentSession,
    },
  }),
}));

const { changeVatConfiguration, VatConfigurationMutationError } =
  await import('./vat-configuration-support');
const { PlatformAdminRequiredError } = await import('@/server/auth/admin-dal');
const { getEffectivePlatformVatConfiguration } = await import('../platform-vat-configuration');

const db = getTestDb();
// Real wall-clock time at file-load, NOT a hardcoded constant: a fixed
// constant would make every SEPARATE run of this file reuse the exact same
// simulated windows, so a second run would see the first run's leftover
// rows as "already current" at those same instants (this table is global,
// append-only, and shared across runs against the persistent TEST
// database). Deriving the base from real time makes every invocation of
// this file get a fresh set of windows, while `createFixedClock` still
// keeps each individual test's own assertions deterministic.
const BASE = new Date();
const WINDOW_SPAN_MS = 10_000_000; // ~2.78 hours — far wider than any single test needs
let windowIndex = 0;

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'VAT support test admin',
      email: 'vat-support-test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('Admin VAT configuration mutation (real database)', () => {
  const userIds: string[] = [];
  let windowStart: Date;
  let windowRestoreAt: Date;

  /** A fresh, non-overlapping simulated time window for the calling test — see the module comment. */
  function nextTestWindow(): { readonly now: Date; readonly plus1s: Date } {
    windowIndex += 1;
    windowStart = new Date(BASE.getTime() + windowIndex * WINDOW_SPAN_MS);
    windowRestoreAt = new Date(windowStart.getTime() + 3_600_000);
    return { now: windowStart, plus1s: new Date(windowStart.getTime() + 1000) };
  }

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'VAT support fixture user',
        email: `vat-support-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to insert test user');
    userIds.push(user.id);
    return user.id;
  }

  /** Mirrors `subscription-support.integration.test.ts`'s own helper: once a grant is used as `admin_audit_log.actor_admin_id` or `platform_vat_configuration.created_by_admin_id`, it becomes RESTRICT-locked and can never be deleted again. */
  async function grantAdmin(userId: string): Promise<string> {
    const index = userIds.indexOf(userId);
    if (index !== -1) userIds.splice(index, 1);
    const [row] = await db
      .insert(platformAdmins)
      .values({ userId })
      .returning({ id: platformAdmins.id });
    if (row === undefined) throw new Error('failed to insert admin grant');
    return row.id;
  }

  async function revokeAdmin(adminGrantId: string): Promise<void> {
    await db
      .update(platformAdmins)
      .set({ revokedAt: new Date() })
      .where(eq(platformAdmins.id, adminGrantId));
  }

  /** Scoped to the given actor — see the module comment on why an unscoped "latest" query is unsafe here. */
  async function latestAuditRow(adminGrantId: string) {
    const [row] = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.action, 'vat.configuration_changed'),
          eq(adminAuditLog.actorAdminId, adminGrantId),
        ),
      )
      .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
      .limit(1);
    return row;
  }

  afterEach(async () => {
    currentSession = null;
    await db.insert(platformVatConfiguration).values({
      enabled: false,
      rateBasisPoints: 700,
      effectiveAt: windowRestoreAt,
      reasonCode: 'configuration_change',
    });
    for (const userId of userIds.splice(0)) {
      await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('a non-admin caller is denied', async () => {
    const { now } = nextTestWindow();
    const userId = await createUser();
    currentSession = sessionFor(userId);

    await expect(
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 700, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
    ).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('a revoked admin is denied by the DB-level check, not a stale cache', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    const adminGrantId = await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);
    await revokeAdmin(adminGrantId);

    await expect(
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 700, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
    ).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('enables VAT at 7% from the baseline, atomically with exactly one audit event', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    const adminGrantId = await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    const result = await changeVatConfiguration(
      { enabled: true, rateBasisPoints: 700, reasonCode: 'configuration_change' },
      createFixedClock(now),
    );
    expect(result.changed).toBe(true);

    const effective = await getEffectivePlatformVatConfiguration(now);
    expect(effective).toEqual({ enabled: true, rateBasisPoints: 700 });

    const audit = await latestAuditRow(adminGrantId);
    expect(audit).toBeDefined();
    expect(audit?.reasonCode).toBe('configuration_change');
    expect(audit?.subjectUserId).toBeNull();
    expect(audit?.subjectWorkspaceId).toBeNull();
    expect(audit?.beforeState).toMatchObject({ vatEnabled: false, vatRateBasisPoints: 700 });
    expect(audit?.afterState).toMatchObject({ vatEnabled: true, vatRateBasisPoints: 700 });
  });

  it('disables VAT while retaining the configured rate — the rate is never erased merely because VAT is off', async () => {
    const { now, plus1s } = nextTestWindow();
    const adminUserId = await createUser();
    await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    await changeVatConfiguration(
      { enabled: true, rateBasisPoints: 725, reasonCode: 'configuration_change' },
      createFixedClock(now),
    );
    const result = await changeVatConfiguration(
      { enabled: false, rateBasisPoints: 725, reasonCode: 'configuration_change' },
      createFixedClock(plus1s),
    );
    expect(result.changed).toBe(true);

    const effective = await getEffectivePlatformVatConfiguration(plus1s);
    expect(effective).toEqual({ enabled: false, rateBasisPoints: 725 });
  });

  it('changes the rate while enabled', async () => {
    const { now, plus1s } = nextTestWindow();
    const adminUserId = await createUser();
    await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    await changeVatConfiguration(
      { enabled: true, rateBasisPoints: 700, reasonCode: 'configuration_change' },
      createFixedClock(now),
    );
    await changeVatConfiguration(
      { enabled: true, rateBasisPoints: 1000, reasonCode: 'configuration_change' },
      createFixedClock(plus1s),
    );

    const effective = await getEffectivePlatformVatConfiguration(plus1s);
    expect(effective).toEqual({ enabled: true, rateBasisPoints: 1000 });
  });

  it('an identical repeated request is a no-op: no new row, no new audit event', async () => {
    const { now, plus1s } = nextTestWindow();
    const adminUserId = await createUser();
    const adminGrantId = await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    const first = await changeVatConfiguration(
      { enabled: false, rateBasisPoints: 700, reasonCode: 'configuration_change' },
      createFixedClock(now),
    );
    expect(first.changed).toBe(false); // already the baseline

    const rowsBefore = await db
      .select({ id: platformVatConfiguration.id })
      .from(platformVatConfiguration);
    const retry = await changeVatConfiguration(
      { enabled: false, rateBasisPoints: 700, reasonCode: 'configuration_change' },
      createFixedClock(plus1s),
    );
    expect(retry.changed).toBe(false);

    const rowsAfter = await db
      .select({ id: platformVatConfiguration.id })
      .from(platformVatConfiguration);
    expect(rowsAfter).toHaveLength(rowsBefore.length);

    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.action, 'vat.configuration_changed'),
          eq(adminAuditLog.actorAdminId, adminGrantId),
        ),
      );
    expect(auditRows).toHaveLength(0);
  });

  it('rejects a reason code outside the Phase 11F vocabulary', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    await expect(
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 700, reasonCode: 'access_grant' },
        createFixedClock(now),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects an out-of-range basis-points value defensively, independent of the action-layer parser', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    await expect(
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 10_001, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('two concurrent identical changes result in exactly one state change and one audit row', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    const adminGrantId = await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    const [a, b] = await Promise.all([
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 800, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 800, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
    ]);

    const changedCount = [a, b].filter((r) => r.changed).length;
    expect(changedCount).toBe(1);

    const effective = await getEffectivePlatformVatConfiguration(now);
    expect(effective).toEqual({ enabled: true, rateBasisPoints: 800 });

    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.action, 'vat.configuration_changed'),
          eq(adminAuditLog.actorAdminId, adminGrantId),
        ),
      );
    expect(auditRows).toHaveLength(1);
  });

  it('two competing different changes serialize into a coherent final state, never a corrupted one', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    const adminGrantId = await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    const results = await Promise.allSettled([
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 500, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
      changeVatConfiguration(
        { enabled: true, rateBasisPoints: 900, reasonCode: 'configuration_change' },
        createFixedClock(now),
      ),
    ]);

    const effective = await getEffectivePlatformVatConfiguration(now);
    expect([500, 900]).toContain(effective.rateBasisPoints);
    expect(effective.enabled).toBe(true);

    const fulfilledChanged = results.filter(
      (r) => r.status === 'fulfilled' && r.value.changed,
    ).length;
    const auditRows = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.action, 'vat.configuration_changed'),
          eq(adminAuditLog.actorAdminId, adminGrantId),
        ),
      );
    expect(auditRows.length).toBe(fulfilledChanged);
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    expect(auditRows.length).toBeLessThanOrEqual(2);
  });

  it('the mutation error class is the only thing thrown for a known failure — never leaking Postgres internals', async () => {
    const { now } = nextTestWindow();
    const adminUserId = await createUser();
    await grantAdmin(adminUserId);
    currentSession = sessionFor(adminUserId);

    try {
      await changeVatConfiguration(
        { enabled: true, rateBasisPoints: 10_001, reasonCode: 'configuration_change' },
        createFixedClock(now),
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(VatConfigurationMutationError);
      const message = (error as Error).message;
      expect(message).not.toMatch(/select|insert|update|constraint|relation/i);
    }
  });
});
