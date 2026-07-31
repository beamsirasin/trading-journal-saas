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
 */

export const TRIAL_DAYS = 7;

export interface Plan {
  readonly id: 'starter' | 'pro' | 'elite';
  readonly name: string;
  readonly tagline: string;
  /** Maximum trading accounts. The primary axis plans gate on. */
  readonly tradingAccounts: number;
  /** Renders a "provisional" marker next to the limit. */
  readonly limitProvisional: boolean;
  /** `null` until amounts are approved — never a placeholder number. */
  readonly price: null;
  readonly features: readonly string[];
  /** Visually emphasised. Exactly one plan may set this. */
  readonly featured: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Prove whether your strategy has an edge.',
    tradingAccounts: 1,
    limitProvisional: false,
    price: null,
    features: [
      'One trading account',
      'Manual trade journal',
      'TradingView chart links',
      'Strategy playbooks with versions',
      'System versus trader analytics',
      'Mistake and discipline tracking',
    ],
    featured: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Separate edge from execution across several accounts.',
    tradingAccounts: 3,
    limitProvisional: false,
    price: null,
    features: [
      'Three trading accounts',
      'Everything in Starter',
      'Per-account attribution',
      'Mistake cost ranked in R',
      'Full analytics history',
    ],
    featured: true,
  },
  {
    id: 'elite',
    name: 'Elite',
    tagline: 'For traders running many accounts or a prop programme.',
    tradingAccounts: 10,
    limitProvisional: true,
    price: null,
    features: [
      'Ten trading accounts',
      'Everything in Pro',
      'Cross-account comparison',
      'Data export',
    ],
    featured: false,
  },
];
