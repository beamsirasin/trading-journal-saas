/**
 * Subscription plan definitions — PRESENTATION ONLY.
 *
 * Phase 01 renders these on the marketing site. They are not entitlements:
 * nothing here is enforced, no payment provider is connected, and no server
 * check reads this file. Phase 04 owns real entitlement checks, which must be
 * server-side and evaluated in the same transaction as the write they gate
 * (CLAUDE.md §4).
 *
 * PRICES ARE DELIBERATELY ABSENT. No amounts have been approved, and an
 * invented number on a public pricing page is a commitment the product has
 * not made. `price: null` renders as "Pricing to be confirmed" rather than a
 * placeholder figure that could be screenshotted out of context.
 *
 * Account limits come from the open product question in
 * docs/product-spec.md §9 (1 / 3 / 10) and are marked provisional until
 * Phase 04 validates them against real usage.
 *
 * PHASE 1.1 CHANGE — `tagline` and `features` moved to
 * `messages/{locale}.json` under `pricing.plans.{id}`, since they are
 * user-facing copy that must be translated. `name` stays here, untranslated,
 * in both locales: the terminology glossary records product plan names as a
 * deliberate exception to translation ("Starter", "Pro" and "Elite" are
 * proper nouns, not descriptions).
 */

export const TRIAL_DAYS = 7;

export interface Plan {
  readonly id: 'starter' | 'pro' | 'elite';
  /** Never translated — see the file header. */
  readonly name: string;
  /** Maximum trading accounts. The primary axis plans gate on. */
  readonly tradingAccounts: number;
  /** Renders a "provisional" marker next to the limit. */
  readonly limitProvisional: boolean;
  /** `null` until amounts are approved — never a placeholder number. */
  readonly price: null;
  /** Visually emphasised. Exactly one plan may set this. */
  readonly featured: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tradingAccounts: 1,
    limitProvisional: false,
    price: null,
    featured: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    tradingAccounts: 3,
    limitProvisional: false,
    price: null,
    featured: true,
  },
  {
    id: 'elite',
    name: 'Elite',
    tradingAccounts: 10,
    limitProvisional: true,
    price: null,
    featured: false,
  },
];
