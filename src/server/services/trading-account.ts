import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { assertWorkspaceMutationAllowed } from '@/lib/entitlements/resolve';
import { systemClock, type Clock } from '@/lib/time';
import type { OnboardingSubmitData } from '@/lib/trading-accounts/schema';
import { getDb } from '@/server/db/client';
import { tradingAccounts, userPreferences, workspaceMembers, workspaces } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';
import { lockAndResolveEntitlement, startTrialInTx } from './entitlement';

export interface CompleteOnboardingResult {
  readonly accountId: string;
  /** `true` when this call reused already-completed state rather than creating anything new — the caller does not need to distinguish this from a fresh completion in its own response. */
  readonly alreadyCompleted: boolean;
}

/**
 * The one authoritative onboarding-completion transaction (Phase 3A brief's
 * "Concurrency and idempotency" section).
 *
 * `SELECT ... FOR UPDATE` on the workspace row is what actually serializes
 * two rapid or concurrent submissions — a real database lock, not an
 * in-memory one (which cannot serialize across server instances/processes)
 * and not merely a disabled submit button (a client concern the server must
 * never depend on). Under PostgreSQL's default READ COMMITTED isolation, a
 * transaction blocked on this lock re-reads the row's latest COMMITTED
 * version once unblocked, rather than an earlier snapshot — so the second
 * of two concurrent callers always observes the first caller's result and
 * takes the "already complete" branch below instead of racing it.
 *
 * Never trusts `workspaceId`/`userId` as caller-supplied-from-client values
 * — `src/server/actions/onboarding.ts` derives both from
 * `getActiveWorkspaceContext()`, never from the submitted form payload, so a
 * forged workspace ID in a request body has no path to reach this function.
 *
 * Also re-verifies active membership itself (CLAUDE.md §4: every server
 * read and write verifies workspace membership, not only the caller one
 * layer up) — belt-and-suspenders alongside `getActiveWorkspaceContext`'s
 * own guarantee, since a membership check this cheap costs one indexed
 * query and closes the door on any future second call site that might not
 * derive `(workspaceId, userId)` from the same session-resolved pair.
 */
export async function completeOnboarding(
  workspaceId: string,
  userId: string,
  input: OnboardingSubmitData,
  clock: Clock = systemClock,
): Promise<CompleteOnboardingResult> {
  const db = getDb();

  return db.transaction(async (tx) => {
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
      throw new Error(
        `completeOnboarding: user ${userId} is not an active member of workspace ${workspaceId}`,
      );
    }

    const [lockedWorkspace] = await tx
      .select({ id: workspaces.id, onboardingCompletedAt: workspaces.onboardingCompletedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');

    if (lockedWorkspace === undefined) {
      throw new Error(`completeOnboarding: workspace ${workspaceId} not found`);
    }

    if (lockedWorkspace.onboardingCompletedAt !== null) {
      // Already completed — by this same request racing itself under the
      // row lock above, or by a genuinely repeated submission. Resolve the
      // account to keep active rather than creating a second one: the
      // stored preference if it still resolves in this workspace,
      // otherwise the workspace's oldest account, repairing the preference
      // to match.
      const existingPreference = await tx
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1);
      const preferredId = existingPreference[0]?.activeTradingAccountId ?? null;

      const preferredAccount =
        preferredId === null
          ? undefined
          : await tx.query.tradingAccounts.findFirst({
              where: and(
                eq(tradingAccounts.id, preferredId),
                eq(tradingAccounts.workspaceId, workspaceId),
              ),
            });

      const resolvedAccount =
        preferredAccount ??
        (await tx.query.tradingAccounts.findFirst({
          where: eq(tradingAccounts.workspaceId, workspaceId),
          orderBy: [asc(tradingAccounts.createdAt)],
        }));

      if (resolvedAccount !== undefined) {
        if (preferredAccount === undefined) {
          const entitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
          assertWorkspaceMutationAllowed(
            entitlement.ok ? entitlement.effective : null,
            'ordinary_write',
          );
          await tx
            .update(userPreferences)
            .set({ activeTradingAccountId: resolvedAccount.id })
            .where(eq(userPreferences.userId, userId));
        }
        return { accountId: resolvedAccount.id, alreadyCompleted: true };
      }
      const entitlement = await lockAndResolveEntitlement(tx, workspaceId, clock);
      assertWorkspaceMutationAllowed(
        entitlement.ok ? entitlement.effective : null,
        'ordinary_write',
      );
      // Marked complete but genuinely no account exists in the workspace —
      // an inconsistent state no normal flow produces. Falls through to
      // create one rather than leaving the workspace permanently stuck.
    }

    // Partial-state repair: an earlier attempt may have created an account
    // but failed before onboarding was marked complete (e.g. a crash
    // between steps). Reuse it instead of creating a second one.
    const existingAccount = await tx.query.tradingAccounts.findFirst({
      where: eq(tradingAccounts.workspaceId, workspaceId),
      orderBy: [asc(tradingAccounts.createdAt)],
    });

    let accountId: string;
    if (existingAccount !== undefined) {
      accountId = existingAccount.id;
    } else {
      const [created] = await tx
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
        })
        .returning({ id: tradingAccounts.id });
      if (created === undefined) {
        throw new Error('completeOnboarding: failed to create the first trading account');
      }
      accountId = created.id;

      // Never the balance, risk values, broker, or platform — only a safe
      // identifier and the account-mode dimension the phase brief allows.
      await insertAuditLog(tx, {
        action: 'trading_account.created',
        workspaceId,
        actorUserId: userId,
        entityType: 'trading_account',
        entityId: accountId,
      });
    }

    await tx
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));

    await tx
      .update(workspaces)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    await insertAuditLog(tx, {
      action: 'workspace.onboarding_completed',
      workspaceId,
      actorUserId: userId,
    });

    // Only on this fresh-completion branch, never the "already completed"
    // replay above — a repeated onboarding completion must never restart or
    // extend the trial (Phase 3C brief).
    await startTrialInTx(tx, workspaceId, userId, clock);

    return { accountId, alreadyCompleted: false };
  });
}
