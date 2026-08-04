/**
 * The authoritative paid-plan entitlement catalogue.
 *
 * Plans differ only by their active trading-account allowance. Prices live
 * in `src/lib/billing/price-book.ts`; keeping money out of this catalogue
 * prevents account entitlements and billing configuration from becoming one
 * coupled subsystem. No plan-level feature flags belong here because every
 * paid plan unlocks the same product and analytics functionality.
 */

export const PLAN_KEYS = Object.freeze(['starter', 'trader', 'professional'] as const);

export type PlanKey = (typeof PLAN_KEYS)[number];

export interface PlanDefinition {
  readonly id: PlanKey;
  /** Stable presentation name. Product features must never branch on it. */
  readonly name: string;
  /** The only product entitlement that differs between paid plans. */
  readonly activeTradingAccountLimit: number;
  /** Stable display order, independent of object-key enumeration. */
  readonly order: number;
  /** Marketing emphasis only; it grants no additional entitlement. */
  readonly featured: boolean;
}

const PLAN_DEFINITION_BY_KEY: Readonly<Record<PlanKey, PlanDefinition>> = Object.freeze({
  starter: Object.freeze({
    id: 'starter',
    name: 'Starter',
    activeTradingAccountLimit: 1,
    order: 1,
    featured: false,
  }),
  trader: Object.freeze({
    id: 'trader',
    name: 'Trader',
    activeTradingAccountLimit: 5,
    order: 2,
    featured: true,
  }),
  professional: Object.freeze({
    id: 'professional',
    name: 'Professional',
    activeTradingAccountLimit: 15,
    order: 3,
    featured: false,
  }),
});

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = Object.freeze(
  PLAN_KEYS.map((planKey) => PLAN_DEFINITION_BY_KEY[planKey]),
);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && Object.hasOwn(PLAN_DEFINITION_BY_KEY, value);
}

export function getPlanDefinition(planKey: PlanKey): PlanDefinition {
  if (!isPlanKey(planKey)) {
    throw new RangeError(`Unsupported plan key: ${String(planKey)}`);
  }
  return PLAN_DEFINITION_BY_KEY[planKey];
}
