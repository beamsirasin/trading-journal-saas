import 'server-only';

import { and, asc, eq, ne } from 'drizzle-orm';

import type { EntitlementBlockReason } from '@/lib/entitlements/resolve';
import { systemClock, type Clock } from '@/lib/time';
import type {
  AccountFieldsData,
  CreateAccountData,
  UpdateAccountData,
} from '@/lib/trading-accounts/schema';
import { getDb } from '@/server/db/client';
import { tradingAccounts, userPreferences, workspaceMembers, workspaces } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { lockAndResolveEntitlement } from './entitlement';

/**
 * Phase 3B's account-management mutations — creating additional accounts,
 * editing, activating, archiving, and restoring. Deliberately a separate
 * file from `trading-account.ts` (Phase 3A's `completeOnboarding`): that
 * function is a single, one-shot "workspace's first account" transaction,
 * while these operate on any number of accounts throughout a workspace's
 * life. They share validation and constants (`src/lib/trading-accounts/`)
 * but not a transaction shape.
 *
 * Every function here takes `workspaceId`/`userId` already resolved from the
 * session (`getActiveWorkspaceContext()`, never a client-supplied value —
 * see each server action in `src/server/actions/trading-accounts.ts`) and
 * re-verifies active membership itself, the same defense-in-depth posture
 * `completeOnboarding` established.
 */

class MembershipError extends Error {
  constructor(workspaceId: string, userId: string) {
    super(`Not an active member of workspace ${workspaceId}: user ${userId}`);
    this.name = 'MembershipError';
  }
}

export type ArchiveErrorCode = 'not_found' | 'last_account';
export type ActivateErrorCode = 'not_found' | 'archived';
export type UpdateErrorCode = 'not_found' | 'archived';

export type CreateTradingAccountResult =
  | { readonly ok: true; readonly accountId: string; readonly alreadyCreated: boolean }
  | { readonly ok: false; readonly code: EntitlementBlockReason };

/**
 * Idempotency check runs FIRST, entitlement enforcement second (Phase 3C
 * brief's required step ordering) — a replayed submission of the SAME
 * `mutationKey` always returns the original account, even if the workspace
 * is now at or over its limit, since no new slot is being consumed.
 *
 * Both the idempotency lookup and the entitlement check are serialized by
 * the workspace-row lock taken immediately below: two concurrent
 * `createTradingAccount` calls for the SAME workspace fully serialize from
 * that point on, so there is no window for two callers to both observe "one
 * slot remaining" and both create. `lockAndResolveEntitlement`'s own row
 * lock on `workspace_entitlements` is defence-in-depth on top of that, not
 * the sole guarantee.
 *
 * `setActive` is only ever applied on the branch that actually inserted a
 * fresh row — a replay (same key, already created) returns the prior result
 * untouched, matching standard idempotency-key semantics: the key
 * represents "this exact mutation already happened," not "reapply these
 * parameters."
 */
export async function createTradingAccount(
  workspaceId: string,
  userId: string,
  input: CreateAccountData,
  clock: Clock = systemClock,
): Promise<CreateTradingAccountResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    await requireActiveMembership(tx, workspaceId, userId);

    // Locks the workspace row so this serializes with concurrent
    // activate/archive/restore/create operations for this workspace —
    // including the idempotency lookup and entitlement check below, not
    // only the `setActive` write.
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');

    const existingByKey = await tx.query.tradingAccounts.findFirst({
      where: and(
        eq(tradingAccounts.workspaceId, workspaceId),
        eq(tradingAccounts.mutationKey, input.mutationKey),
      ),
    });
    if (existingByKey !== undefined) {
      return { ok: true, accountId: existingByKey.id, alreadyCreated: true };
    }

    const entitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
    if (!entitlement.ok) {
      return { ok: false, code: entitlement.code };
    }
    if (entitlement.effective.blockReason !== null) {
      return { ok: false, code: entitlement.effective.blockReason };
    }

    const inserted = await tx
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: input.name,
        brokerName: input.brokerName,
        platformName: input.platformName,
        accountMode: input.accountMode,
        baseCurrency: input.baseCurrency,
        startingBalance: input.startingBalance,
        timezone: input.timezone,
        riskPerTradePercent: input.riskPerTradePercent,
        maximumDailyLossPercent: input.maximumDailyLossPercent,
        mutationKey: input.mutationKey,
      })
      .onConflictDoNothing({
        target: [tradingAccounts.workspaceId, tradingAccounts.mutationKey],
      })
      .returning({ id: tradingAccounts.id });

    const created = inserted[0];
    if (created === undefined) {
      // Unreachable given the serialized idempotency check above — kept as a
      // defensive re-read rather than a thrown error on an impossible
      // conflict, matching the codebase's existing posture elsewhere.
      const existing = await tx.query.tradingAccounts.findFirst({
        where: and(
          eq(tradingAccounts.workspaceId, workspaceId),
          eq(tradingAccounts.mutationKey, input.mutationKey),
        ),
      });
      if (existing === undefined) {
        throw new Error(
          `createTradingAccount: conflict reported but no row found for mutation key in workspace ${workspaceId}`,
        );
      }
      return { ok: true, accountId: existing.id, alreadyCreated: true };
    }

    // Never the balance, risk values, broker, or platform — only a safe
    // identifier, matching completeOnboarding's own audit call.
    await insertAuditLog(tx, {
      action: 'trading_account.created',
      workspaceId,
      actorUserId: userId,
      entityType: 'trading_account',
      entityId: created.id,
    });

    if (input.setActive) {
      const previous = await tx
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);

      await tx
        .update(userPreferences)
        .set({ activeTradingAccountId: created.id })
        .where(eq(userPreferences.userId, userId));

      const previousActiveId = previous[0]?.activeTradingAccountId ?? null;
      await insertAuditLog(tx, {
        action: 'trading_account.activated',
        workspaceId,
        actorUserId: userId,
        entityType: 'trading_account',
        entityId: created.id,
        metadata: {
          ...(previousActiveId === null
            ? {}
            : { previousActiveTradingAccountId: previousActiveId }),
          newActiveTradingAccountId: created.id,
        },
      });
    }

    return { ok: true, accountId: created.id, alreadyCreated: false };
  });
}

export type UpdateTradingAccountResult = { ok: true } | { ok: false; code: UpdateErrorCode };

const FIELD_COMPARISON_KEYS: readonly (keyof AccountFieldsData)[] = [
  'name',
  'brokerName',
  'platformName',
  'accountMode',
  'baseCurrency',
  'startingBalance',
  'timezone',
  'riskPerTradePercent',
  'maximumDailyLossPercent',
];

/**
 * Edits the fixed set of Phase 3A account fields. Deliberately cannot touch
 * `isArchived` or "which account is active" — those are exclusively
 * `archiveTradingAccount`/`restoreTradingAccount`/`setActiveTradingAccount`'s
 * job, and `UpdateAccountSchema.strict()` already rejects a payload that
 * tries to smuggle either in before this function ever runs.
 *
 * Rejects an archived account outright (Phase 3B brief: "no Edit action
 * unless the service explicitly supports safe editing of archived
 * accounts; prefer restore-before-edit") — enforced here, not only by the
 * list page hiding the Edit link, since a direct POST to a stale edit-page
 * URL must not silently succeed against an account the user can no longer
 * see as editable.
 *
 * Audits only which field NAMES changed, never old or new values — a
 * starting balance or risk percentage is exactly the kind of financial
 * figure CLAUDE.md's audit-metadata rules forbid recording.
 */
export async function updateTradingAccount(
  workspaceId: string,
  userId: string,
  accountId: string,
  input: UpdateAccountData,
): Promise<UpdateTradingAccountResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    await requireActiveMembership(tx, workspaceId, userId);

    const existing = await tx.query.tradingAccounts.findFirst({
      where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.workspaceId, workspaceId)),
    });
    if (existing === undefined) {
      return { ok: false, code: 'not_found' };
    }
    if (existing.isArchived) {
      return { ok: false, code: 'archived' };
    }

    const changedFields = FIELD_COMPARISON_KEYS.filter((key) => existing[key] !== input[key]);

    await tx
      .update(tradingAccounts)
      .set({
        name: input.name,
        brokerName: input.brokerName ?? null,
        platformName: input.platformName ?? null,
        accountMode: input.accountMode,
        baseCurrency: input.baseCurrency,
        startingBalance: input.startingBalance,
        timezone: input.timezone,
        riskPerTradePercent: input.riskPerTradePercent ?? null,
        maximumDailyLossPercent: input.maximumDailyLossPercent ?? null,
        updatedAt: new Date(),
      })
      .where(eq(tradingAccounts.id, accountId));

    if (changedFields.length > 0) {
      await insertAuditLog(tx, {
        action: 'trading_account.updated',
        workspaceId,
        actorUserId: userId,
        entityType: 'trading_account',
        entityId: accountId,
        metadata: { changedFields },
      });
    }

    return { ok: true };
  });
}

export type SetActiveTradingAccountResult = { ok: true } | { ok: false; code: ActivateErrorCode };

/**
 * Locks the workspace row so this cannot interleave with a concurrent
 * archive of the SAME account — without the lock, a set-active and an
 * archive racing each other could each read "not archived" before the other
 * commits, leaving an archived account as the stored active preference.
 */
export async function setActiveTradingAccount(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<SetActiveTradingAccountResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    await requireActiveMembership(tx, workspaceId, userId);
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');

    const account = await tx.query.tradingAccounts.findFirst({
      where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.workspaceId, workspaceId)),
    });
    if (account === undefined) {
      return { ok: false, code: 'not_found' };
    }
    if (account.isArchived) {
      return { ok: false, code: 'archived' };
    }

    const previous = await tx
      .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const previousId = previous[0]?.activeTradingAccountId ?? null;

    if (previousId === accountId) {
      return { ok: true };
    }

    await tx
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));

    await insertAuditLog(tx, {
      action: 'trading_account.activated',
      workspaceId,
      actorUserId: userId,
      entityType: 'trading_account',
      entityId: accountId,
      metadata: {
        ...(previousId === null ? {} : { previousActiveTradingAccountId: previousId }),
        newActiveTradingAccountId: accountId,
      },
    });

    return { ok: true };
  });
}

export type ArchiveTradingAccountResult = { ok: true } | { ok: false; code: ArchiveErrorCode };

/**
 * Phase 3B's archive-with-fallback transaction.
 *
 * Locks the workspace row first — the same real database lock
 * `completeOnboarding` uses, for the same reason: it is what actually
 * serializes two concurrent archive attempts (or an archive racing a
 * restore/set-active/create-and-activate) rather than an in-memory guard
 * that cannot serialize across server instances.
 *
 * Idempotent: archiving an already-archived account is a successful no-op,
 * not an error — a repeated submission (double-click, retried request) must
 * never fail or re-run the fallback selection a second time.
 *
 * The "last usable account" invariant is checked BEFORE any write — a
 * workspace can never be left with zero non-archived accounts, preserving
 * Phase 3A's guarantee that a completed workspace always has one.
 *
 * The fallback, when this account is the ACTING USER's own active one, is
 * deterministic: the workspace's oldest remaining non-archived account by
 * `(createdAt, id)` — the same ordering `getActiveTradingAccount`'s own
 * repair path and `listWorkspaceTradingAccounts` use, so "which account
 * becomes active" is one rule everywhere, not a phase-specific variant.
 * Other members' independent active-account preferences (a future
 * shared-workspace concern) are left to `getActiveTradingAccount`'s existing
 * per-user repair-on-read behavior rather than proactively rewritten here.
 */
export async function archiveTradingAccount(
  workspaceId: string,
  userId: string,
  accountId: string,
): Promise<ArchiveTradingAccountResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    await requireActiveMembership(tx, workspaceId, userId);

    const [lockedWorkspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');
    if (lockedWorkspace === undefined) {
      throw new Error(`archiveTradingAccount: workspace ${workspaceId} not found`);
    }

    const account = await tx.query.tradingAccounts.findFirst({
      where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.workspaceId, workspaceId)),
    });
    if (account === undefined) {
      return { ok: false, code: 'not_found' };
    }
    if (account.isArchived) {
      return { ok: true };
    }

    const remainingUsable = await tx.query.tradingAccounts.findMany({
      where: and(
        eq(tradingAccounts.workspaceId, workspaceId),
        eq(tradingAccounts.isArchived, false),
        ne(tradingAccounts.id, accountId),
      ),
      orderBy: [asc(tradingAccounts.createdAt), asc(tradingAccounts.id)],
    });
    if (remainingUsable.length === 0) {
      return { ok: false, code: 'last_account' };
    }

    const preference = await tx
      .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (preference[0]?.activeTradingAccountId === accountId) {
      const fallback = remainingUsable[0];
      if (fallback === undefined) {
        throw new Error(
          'archiveTradingAccount: unreachable — remainingUsable was checked non-empty',
        );
      }

      await tx
        .update(userPreferences)
        .set({ activeTradingAccountId: fallback.id })
        .where(eq(userPreferences.userId, userId));

      await insertAuditLog(tx, {
        action: 'trading_account.activated',
        workspaceId,
        actorUserId: userId,
        entityType: 'trading_account',
        entityId: fallback.id,
        metadata: {
          previousActiveTradingAccountId: accountId,
          newActiveTradingAccountId: fallback.id,
        },
      });
    }

    await tx
      .update(tradingAccounts)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(tradingAccounts.id, accountId));

    await insertAuditLog(tx, {
      action: 'trading_account.archived',
      workspaceId,
      actorUserId: userId,
      entityType: 'trading_account',
      entityId: accountId,
    });

    return { ok: true };
  });
}

export type RestoreTradingAccountResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not_found' | EntitlementBlockReason };

/**
 * Restoring never automatically reactivates the account (Phase 3B brief) —
 * a user explicitly archived it and reaching for "restore" is not the same
 * intent as "and also make this my active account again." If the workspace
 * currently has no usable active account at all, `getActiveTradingAccount`'s
 * existing repair-on-read logic already picks a fallback the next time it
 * runs, which may naturally be this restored account — no special-case
 * activation logic is duplicated here for that.
 *
 * Restoring is idempotent BEFORE the entitlement check (Phase 3C brief): an
 * already-restored account returns success unconditionally, since nothing
 * about the account count changes. Entitlement is only evaluated when this
 * call would actually increase the active-account count.
 */
export async function restoreTradingAccount(
  workspaceId: string,
  userId: string,
  accountId: string,
  clock: Clock = systemClock,
): Promise<RestoreTradingAccountResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
    await requireActiveMembership(tx, workspaceId, userId);
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');

    const account = await tx.query.tradingAccounts.findFirst({
      where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.workspaceId, workspaceId)),
    });
    if (account === undefined) {
      return { ok: false, code: 'not_found' };
    }
    if (!account.isArchived) {
      return { ok: true };
    }

    const entitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
    if (!entitlement.ok) {
      return { ok: false, code: entitlement.code };
    }
    if (entitlement.effective.blockReason !== null) {
      return { ok: false, code: entitlement.effective.blockReason };
    }

    await tx
      .update(tradingAccounts)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(eq(tradingAccounts.id, accountId));

    await insertAuditLog(tx, {
      action: 'trading_account.restored',
      workspaceId,
      actorUserId: userId,
      entityType: 'trading_account',
      entityId: accountId,
    });

    return { ok: true };
  });
}

/** Structurally matches both a Drizzle transaction handle and the plain database — same shape `insertAuditLog` relies on. */
type Executor = Pick<ReturnType<typeof getDb>, 'select'>;

async function requireActiveMembership(
  tx: Executor,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const membership = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (membership.length === 0) {
    throw new MembershipError(workspaceId, userId);
  }
}
