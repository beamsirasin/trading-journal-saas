import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import type { PlanKey } from '@/config/plan-catalog';
import type {
  DowngradeOption,
  SubscriptionManagementPresentation,
  SubscriptionPlanOption,
} from '@/lib/billing/subscription-management-types';
import type { EffectiveEntitlement } from '@/lib/entitlements/resolve';
import { formatInstant } from '@/lib/time';
import { getActiveWorkspaceContext, getWorkspaceEntitlement } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { billingTransactions } from '@/server/db/schema';

import { getBillingPresentation } from './presentation';

type BillingLocale = 'en' | 'th';

function datePresentation(
  date: Date | null,
  timezone: string,
  locale: BillingLocale,
): string | null {
  if (date === null) return null;
  const formatted = formatInstant(date, timezone, {
    style: 'date',
    locale: locale === 'th' ? 'th-TH' : 'en-GB',
  });
  return formatted.ok ? formatted.value : date.toISOString();
}

export function buildSubscriptionManagementPresentation(
  entitlement: EffectiveEntitlement,
  locale: BillingLocale,
  timezone: string,
  hasNonTerminalCheckout: boolean,
): SubscriptionManagementPresentation {
  const billing = getBillingPresentation(locale);
  const currency = entitlement.billingCurrency ?? billing.defaultCurrency;
  const option = (planKey: PlanKey): SubscriptionPlanOption => {
    const plan = billing.plans.find((candidate) => candidate.id === planKey);
    if (plan === undefined) throw new RangeError(`Unsupported plan key: ${planKey}`);
    return Object.freeze({
      id: plan.id,
      name: plan.name,
      activeTradingAccountLimit: plan.activeTradingAccountLimit,
      priceFormatted: plan.prices[currency].formatted,
    });
  };

  const currentPlan =
    entitlement.effectivePlanKey === null ? null : option(entitlement.effectivePlanKey);
  const malformed =
    entitlement.denialReason === 'malformed_entitlement' ||
    entitlement.denialReason === 'unknown_plan';
  const blockReason =
    entitlement.persistedStatus === 'past_due'
      ? ('past_due' as const)
      : malformed
        ? ('malformed' as const)
        : hasNonTerminalCheckout
          ? ('checkout_in_progress' as const)
          : null;
  const paidActive =
    entitlement.persistedStatus === 'active' &&
    entitlement.effectiveStatus === 'active' &&
    currentPlan !== null &&
    entitlement.currentPeriodEndsAt !== null;
  const canMutateLifecycle = paidActive && !hasNonTerminalCheckout && !malformed;
  const currentLimit = currentPlan?.activeTradingAccountLimit ?? 0;

  const upgradeOptions =
    blockReason !== null
      ? []
      : billing.plans
          .filter((plan) => !paidActive || plan.activeTradingAccountLimit > currentLimit)
          .map((plan) => option(plan.id));
  const effectiveAt = datePresentation(entitlement.currentPeriodEndsAt, timezone, locale);
  const downgradeOptions: DowngradeOption[] =
    canMutateLifecycle &&
    !entitlement.cancelAtPeriodEnd &&
    entitlement.pendingPlanKey === null &&
    effectiveAt !== null
      ? billing.plans
          .filter((plan) => plan.activeTradingAccountLimit < currentLimit)
          .map((plan) =>
            Object.freeze({
              ...option(plan.id),
              effectiveAt,
              willBeOverLimit: entitlement.activeAccountCount > plan.activeTradingAccountLimit,
            }),
          )
      : [];
  const pendingDowngrade =
    entitlement.pendingPlanKey === null || entitlement.pendingPlanEffectiveAt === null
      ? null
      : Object.freeze({
          plan: option(entitlement.pendingPlanKey),
          effectiveAt:
            datePresentation(entitlement.pendingPlanEffectiveAt, timezone, locale) ??
            entitlement.pendingPlanEffectiveAt.toISOString(),
          willBeOverLimit:
            entitlement.activeAccountCount >
            option(entitlement.pendingPlanKey).activeTradingAccountLimit,
        });

  return Object.freeze({
    persistedStatus: entitlement.persistedStatus,
    effectiveStatus: entitlement.effectiveStatus,
    accessMode: entitlement.accessMode,
    currentPlan,
    billingCurrency: entitlement.billingCurrency,
    billingInterval: entitlement.billingInterval,
    trialEndsAt: datePresentation(entitlement.trialEndsAt, timezone, locale),
    currentPeriodEndsAt: effectiveAt,
    activeAccountCount: entitlement.activeAccountCount,
    accountLimit: entitlement.accountLimit,
    overLimit: entitlement.overLimit,
    hasNonTerminalCheckout,
    blockReason,
    upgradeOptions: Object.freeze(upgradeOptions),
    downgradeOptions: Object.freeze(downgradeOptions),
    pendingDowngrade,
    cancellationScheduled: entitlement.cancelAtPeriodEnd,
    canCancelPendingDowngrade: canMutateLifecycle && entitlement.pendingPlanKey !== null,
    canScheduleCancellation: canMutateLifecycle && !entitlement.cancelAtPeriodEnd,
    canReverseCancellation: canMutateLifecycle && entitlement.cancelAtPeriodEnd,
  });
}

export async function getSubscriptionManagementPresentation(
  locale: BillingLocale,
  timezone: string,
): Promise<SubscriptionManagementPresentation | null> {
  const { workspaceId } = await getActiveWorkspaceContext();
  const [entitlement, nonTerminal] = await Promise.all([
    getWorkspaceEntitlement(),
    getDb()
      .select({ id: billingTransactions.id })
      .from(billingTransactions)
      .where(
        and(
          eq(billingTransactions.workspaceId, workspaceId),
          inArray(billingTransactions.status, ['created', 'pending', 'processing']),
        ),
      )
      .limit(1),
  ]);
  if (entitlement === null) return null;

  return buildSubscriptionManagementPresentation(
    entitlement,
    locale,
    timezone,
    nonTerminal.length > 0,
  );
}
