import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createFixedClock } from '@/lib/time';
import { adminAuditLog, platformAdmins, users } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  grantPlatformAdmin,
  PlatformAdminProvisioningError,
  revokePlatformAdmin,
} from './platform-admin-provisioning';

/**
 * The testable core `scripts/platform-admin.mjs` mirrors in raw SQL (see
 * that script's header comment) — Phase 11B's "avoid spawning a destructive
 * script process inside ordinary tests when a service can be tested
 * directly" instruction. Every grant/revoke invariant the operational script
 * must uphold is proven here against a real database instead.
 */
const NOW = new Date('2026-08-10T00:00:00Z');
const SYSTEM_ACTOR = { actorKind: 'system' as const };

describe('grantPlatformAdmin / revokePlatformAdmin (real database)', () => {
  const userIds: string[] = [];

  async function createUser(emailVerified = true): Promise<string> {
    const db = getTestDb();
    const [user] = await db
      .insert(users)
      .values({
        name: 'Provisioning test user',
        email: `provisioning-${crypto.randomUUID()}@example.test`,
        emailVerified,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to insert test user');
    userIds.push(user.id);
    return user.id;
  }

  afterEach(async () => {
    const db = getTestDb();
    // platform_admins.user_id is RESTRICT — a grant's mere EXISTENCE blocks
    // deleting its user, regardless of revocation state (Phase 11B's
    // retention-safe contract). Test teardown deletes its own fixture grant
    // rows directly rather than revoking them.
    for (const userId of userIds.splice(0)) {
      await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('grants a new admin, writing exactly one grant row and one audit row atomically', async () => {
    const userId = await createUser();
    const result = await grantPlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
      createFixedClock(NOW),
    );
    expect(result.created).toBe(true);

    const db = getTestDb();
    const grants = await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.revokedAt).toBeNull();

    const audits = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.subjectUserId, userId));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorKind: 'system',
      actorAdminId: null,
      action: 'platform_admin.granted',
      reasonCode: 'bootstrap',
    });
  });

  it('granting an already-active admin is idempotent: no new row, no new audit entry', async () => {
    const userId = await createUser();
    const first = await grantPlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
      createFixedClock(NOW),
    );
    const second = await grantPlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'access_grant' },
      createFixedClock(NOW),
    );
    expect(second.created).toBe(false);
    expect(second.grantId).toBe(first.grantId);

    const db = getTestDb();
    expect(
      await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(adminAuditLog).where(eq(adminAuditLog.subjectUserId, userId)),
    ).toHaveLength(1);
  });

  it('refuses to grant a user that does not exist', async () => {
    await expect(
      grantPlatformAdmin(
        { userId: crypto.randomUUID(), actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
        createFixedClock(NOW),
      ),
    ).rejects.toMatchObject({ code: 'user_not_found' });
  });

  it('refuses to grant a user whose email is not verified', async () => {
    const userId = await createUser(false);
    await expect(
      grantPlatformAdmin(
        { userId, actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
        createFixedClock(NOW),
      ),
    ).rejects.toMatchObject({ code: 'user_not_verified' });

    const db = getTestDb();
    expect(
      await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)),
    ).toHaveLength(0);
  });

  it('grantPlatformAdminInTransaction errors are instances of PlatformAdminProvisioningError', async () => {
    await expect(
      grantPlatformAdmin(
        { userId: crypto.randomUUID(), actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
        createFixedClock(NOW),
      ),
    ).rejects.toBeInstanceOf(PlatformAdminProvisioningError);
  });

  it('revokes an active grant, writing the revocation and an audit row, never deleting the row', async () => {
    const userId = await createUser();
    const granted = await grantPlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
      createFixedClock(NOW),
    );
    const revoked = await revokePlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'access_revoke' },
      createFixedClock(NOW),
    );
    expect(revoked).toEqual({ changed: true, grantId: granted.grantId });

    const db = getTestDb();
    const [row] = await db
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.id, granted.grantId));
    expect(row?.revokedAt).not.toBeNull();

    const audits = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.subjectUserId, userId));
    expect(audits.map((a) => a.action).sort()).toEqual(
      ['platform_admin.granted', 'platform_admin.revoked'].sort(),
    );
  });

  it('revoking a user with no active grant is a safe, idempotent no-op', async () => {
    const userId = await createUser();
    const result = await revokePlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'access_revoke' },
      createFixedClock(NOW),
    );
    expect(result).toEqual({ changed: false, grantId: null });

    const db = getTestDb();
    expect(
      await db.select().from(adminAuditLog).where(eq(adminAuditLog.subjectUserId, userId)),
    ).toHaveLength(0);
  });

  it('re-granting after a revoke creates a brand-new grant row, not a resurrection of the old one', async () => {
    const userId = await createUser();
    const first = await grantPlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'bootstrap' },
      createFixedClock(NOW),
    );
    await revokePlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'access_revoke' },
      createFixedClock(NOW),
    );
    const second = await grantPlatformAdmin(
      { userId, actor: SYSTEM_ACTOR, reasonCode: 'access_grant' },
      createFixedClock(NOW),
    );

    expect(second.created).toBe(true);
    expect(second.grantId).not.toBe(first.grantId);

    const db = getTestDb();
    const rows = await db.select().from(platformAdmins).where(eq(platformAdmins.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === second.grantId)?.revokedAt).toBeNull();
  });

  it('audit rows carry only stable IDs — no email or name is ever written', async () => {
    const userId = await createUser();
    await grantPlatformAdmin(
      {
        userId,
        actor: SYSTEM_ACTOR,
        reasonCode: 'bootstrap',
        reasonNote: 'initial operator bootstrap',
      },
      createFixedClock(NOW),
    );

    const db = getTestDb();
    const [audit] = await db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.subjectUserId, userId));
    // The schema itself has no email/name column on this table at all —
    // this assertion proves the row's actual keys match that closed shape.
    expect(Object.keys(audit ?? {}).sort()).toEqual(
      [
        'id',
        'actorKind',
        'actorAdminId',
        'action',
        'subjectUserId',
        'subjectWorkspaceId',
        'reasonCode',
        'reasonNote',
        'beforeState',
        'afterState',
        'createdAt',
      ].sort(),
    );
  });
});
