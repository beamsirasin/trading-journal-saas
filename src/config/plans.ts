import { getPlanPrice } from '@/lib/billing/price-book';
import { minorUnitScale, type CurrencyCode } from '@/lib/money';

import { PLAN_DEFINITIONS, type PlanDefinition, type PlanKey } from './plan-catalog';

export { getPlanDefinition, isPlanKey, PLAN_DEFINITIONS, PLAN_KEYS } from './plan-catalog';
export type { PlanDefinition, PlanKey } from './plan-catalog';

export const TRIAL_DAYS = 7;

/**
 * The trial allowance is explicit and independent from every paid plan.
 * Changing a paid-plan allowance must never silently change the trial.
 */
export const TRIAL_ACCOUNT_LIMIT = 1;

/**
 * Temporary Phase 04B presentation compatibility.
 *
 * Existing pricing components consume whole-major-unit numbers and the
 * legacy `taxExclusive` notice switch. Values here are derived from the
 * canonical bigint price book; billing calculations never read this facade.
 * Remove these compatibility fields when Phase 04F updates pricing UI and
 * conditional VAT presentation.
 */
export interface Plan {
  readonly id: PlanKey;
  readonly name: PlanDefinition['name'];
  readonly tradingAccounts: number;
  readonly priceThb: number;
  readonly priceUsd: number;
  /** Legacy presentation-only switch. It is not VAT configuration. */
  readonly taxExclusive: true;
  readonly order: number;
  readonly featured: boolean;
}

export const PLANS: readonly Plan[] = Object.freeze(
  PLAN_DEFINITIONS.map((definition) =>
    Object.freeze({
      id: definition.id,
      name: definition.name,
      tradingAccounts: definition.activeTradingAccountLimit,
      priceThb: toLegacyWholeMajorUnits(definition.id, 'THB'),
      priceUsd: toLegacyWholeMajorUnits(definition.id, 'USD'),
      taxExclusive: true as const,
      order: definition.order,
      featured: definition.featured,
    }),
  ),
);

function toLegacyWholeMajorUnits(planKey: PlanKey, currency: CurrencyCode): number {
  if (currency !== 'THB' && currency !== 'USD') {
    throw new RangeError(`Unsupported legacy billing currency: ${currency}`);
  }

  const amountMinor = getPlanPrice(planKey, currency, 'monthly').amountMinor;
  const scale = minorUnitScale(currency);
  if (amountMinor % scale !== 0n) {
    throw new RangeError(
      `Legacy pricing UI cannot display fractional major units for ${currency}.`,
    );
  }

  const amountMajor = amountMinor / scale;
  if (amountMajor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Legacy major-unit price exceeds the JavaScript safe-integer range.');
  }
  return Number(amountMajor);
}
