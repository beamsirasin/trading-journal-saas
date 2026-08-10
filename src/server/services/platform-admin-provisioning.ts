import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import type { AdminAuditReasonCode } from '@/config/admin-audit-actions';
import { systemClock, type Clock } from '@/lib/time';
import { getDb, type Database } from '@/server/db/client';
import { platformAdmins, users } from '@/server/db/schema';

import { insertAdminAuditLog, type AdminAuditActorInput } from './admin-audit-log';

/**
 * The testable core of platform-admin grant/revoke — CLAUDE.md's own "Extract
 * testable service logic where appropriate" for the operational bootstrap
 * path (Phase 11's own instruction to avoid exercising a destructive script
 * process inside ordinary unit/integration tests when a service can be
 * tested directly). `scripts/platform-admin.mjs` mirrors these exact
 * invariants in raw SQL rather than calling this module — see that script's
 * header comment for why (plain Node ESM has no TypeScript/path-alias
 * resolution, the same constraint every other real-database script in this
 * repository already works under).
 */

export type PlatformAdminProvisioningErrorCode = 'user_not_found' | 'user_not_verified';

export class PlatformAdminProvisioningError extends Error {
  readonly code: PlatformAdminProvisioningErrorCode;

  constructor(code: PlatformAdminProvisioningErrorCode, message: string) {
    super(message);
    this.name = 'PlatformAdminProvisioningError';
    this.code = code;
  }
}

/** Structurally matches both Database and a Drizzle transaction handle. */
type Executor = Pick<Database, 'select' | 'insert' | 'update'>;

export interface GrantPlatformAdminInput {
  readonly userId: string;
  readonly actor: AdminAuditActorInput;
  readonly reasonCode: AdminAuditReasonCode;
  readonly reasonNote?: string;
}

export interface GrantPlatformAdminResult {
  readonly grantId: string;
  /** `false` when an active grant already existed — idempotent no-op, no new row and no new audit entry. */
  readonly created: boolean;
}

async function findActiveGrant(
  tx: Executor,
  userId: string,
): Promise<{ readonly id: string } | undefined> {
  const [row] = await tx
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), isNull(platformAdmins.revokedAt)))
    .limit(1)
    .for('update');
  return row;
}

/**
 * Grants platform-admin authority to an EXACT, already-resolved `userId` —
 * exact lookup by email or id is the caller's job (`scripts/platform-
 * admin.mjs`'s own exact-match query), never a prefix or fuzzy match here.
 * Re-verifies the target user exists and is email-verified from inside this
 * same transaction regardless of what the caller already checked — the
 * authoritative enforcement point, not merely a courtesy.
 *
 * Idempotent: a user with an already-active grant gets `created: false` and
 * no new row, no new audit entry, and no change to `granted_at`/`granted_by`
 * — re-running a grant is always safe to retry.
 */
export async function grantPlatformAdmin(
  input: GrantPlatformAdminInput,
  clock: Clock = systemClock,
): Promise<GrantPlatformAdminResult> {
  return getDb().transaction((tx) => grantPlatformAdminInTransaction(tx, input, clock.now()));
}

export async function grantPlatformAdminInTransaction(
  tx: Executor,
  input: GrantPlatformAdminInput,
  now: Date,
): Promise<GrantPlatformAdminResult> {
  const [user] = await tx
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (user === undefined) {
    throw new PlatformAdminProvisioningError('user_not_found', `No user with id ${input.userId}`);
  }
  if (!user.emailVerified) {
    throw new PlatformAdminProvisioningError(
      'user_not_verified',
      `User ${input.userId} has not verified their email; a new platform-admin grant requires a verified account`,
    );
  }

  const existing = await findActiveGrant(tx, input.userId);
  if (existing !== undefined) {
    return { grantId: existing.id, created: false };
  }

  const [inserted] = await tx
    .insert(platformAdmins)
    .values({
      userId: input.userId,
      grantedAt: now,
      grantedByAdminId:
        input.actor.actorKind === 'platform_admin' ? input.actor.actorAdminId : null,
    })
    .returning({ id: platformAdmins.id });
  if (inserted === undefined) {
    throw new Error('grantPlatformAdminInTransaction: insert returned no row');
  }

  await insertAdminAuditLog(tx, {
    actor: input.actor,
    action: 'platform_admin.granted',
    subjectUserId: input.userId,
    reasonCode: input.reasonCode,
    ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
  });

  return { grantId: inserted.id, created: true };
}

export interface RevokePlatformAdminInput {
  readonly userId: string;
  readonly actor: AdminAuditActorInput;
  readonly reasonCode: AdminAuditReasonCode;
  readonly reasonNote?: string;
}

export interface RevokePlatformAdminResult {
  /** `false` when no active grant existed — safe, idempotent no-op. */
  readonly changed: boolean;
  readonly grantId: string | null;
}

/**
 * Revokes an EXACT user's active grant, if one exists. Safe to call on a
 * user with no active grant (idempotent no-op, `changed: false`) — matching
 * `grantPlatformAdmin`'s own idempotency posture. Never deletes the
 * historical row; only sets `revoked_at`/`revoked_by_admin_id`, so a
 * subsequent `grantPlatformAdmin` call for the same user always inserts a
 * brand-new grant lifecycle row rather than resurrecting this one.
 */
export async function revokePlatformAdmin(
  input: RevokePlatformAdminInput,
  clock: Clock = systemClock,
): Promise<RevokePlatformAdminResult> {
  return getDb().transaction((tx) => revokePlatformAdminInTransaction(tx, input, clock.now()));
}

export async function revokePlatformAdminInTransaction(
  tx: Executor,
  input: RevokePlatformAdminInput,
  now: Date,
): Promise<RevokePlatformAdminResult> {
  const existing = await findActiveGrant(tx, input.userId);
  if (existing === undefined) {
    return { changed: false, grantId: null };
  }

  await tx
    .update(platformAdmins)
    .set({
      revokedAt: now,
      revokedByAdminId:
        input.actor.actorKind === 'platform_admin' ? input.actor.actorAdminId : null,
    })
    .where(eq(platformAdmins.id, existing.id));

  await insertAdminAuditLog(tx, {
    actor: input.actor,
    action: 'platform_admin.revoked',
    subjectUserId: input.userId,
    reasonCode: input.reasonCode,
    ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
  });

  return { changed: true, grantId: existing.id };
}
