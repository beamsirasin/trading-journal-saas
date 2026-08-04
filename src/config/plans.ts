/**
 * Subscription plan definitions — the one registry for plan IDs, names,
 * account limits, and prices. Locked product decision (superseding the
 * earlier starter/pro/elite 1/3/10 draft this file originally shipped
 * with): every entitlement check (`src/lib/entitlements/resolve.ts`) and
 * every plan-display surface (public `/pricing`, authenticated `/app/plan`,
 * the trial banner) reads this file. No second, duplicated registry exists.
 *
 * PRICES ARE REAL AND TAX-EXCLUSIVE. VAT collection is disabled because the
 * business is not yet VAT-registered — `taxExclusive: true` is what every
 * price-displaying surface reads to append the "excludes tax" notice, rather
 * than each one re-deciding whether to show it. Do not add VAT calculation,
 * invoicing, checkout, or payment-provider integration in this phase — that
 * is Phase 04's job, once a provider is actually wired in.
 *
 * ALL PAID PLANS SHARE THE EXACT SAME FEATURE SET. The only entitlement
 * difference between them is `tradingAccounts` — the maximum number of
 * active (non-archived) trading accounts. Feature copy is therefore a
 * single shared list (`messages/{locale}.json`'s `pricing.sharedFeatures`),
 * never a per-plan array — see `src/components/marketing/pricing-card.tsx`.
 */

export const TRIAL_DAYS = 7;

/**
 * The trial's account limit is an explicit, authoritative constant — never
 * derived from `PLANS` (not `Math.max(...)`, not the highest or lowest
 * configured plan, not array order). A trial workspace gets exactly one
 * active trading account, matching Starter exactly, so there is no
 * trial-to-Starter downgrade problem when a trial converts: the same one
 * account simply continues.
 */
export const TRIAL_ACCOUNT_LIMIT = 1;

export interface Plan {
  readonly id: 'starter' | 'trader' | 'professional';
  /** Never translated — see the file header. */
  readonly name: string;
  /** Maximum active (non-archived) trading accounts. The only entitlement axis plans differ on. */
  readonly tradingAccounts: number;
  /** Monthly price in Thai Baht, tax-exclusive. */
  readonly priceThb: number;
  /** Monthly price in US Dollars, tax-exclusive. */
  readonly priceUsd: number;
  /** `true` for every plan — no VAT is currently collected (not yet VAT-registered). Every price display reads this rather than assuming it. */
  readonly taxExclusive: true;
  /** Display position, ascending. Independent of array order so a future reorder of `PLANS` cannot silently change display order without the change being visible in a diff. */
  readonly order: number;
  /** Visually emphasised as "Most popular". Exactly one plan may set this — a marketing choice, unrelated to entitlement or feature differences. */
  readonly featured: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    tradingAccounts: 1,
    priceThb: 149,
    priceUsd: 5,
    taxExclusive: true,
    order: 1,
    featured: false,
  },
  {
    id: 'trader',
    name: 'Trader',
    tradingAccounts: 5,
    priceThb: 299,
    priceUsd: 9,
    taxExclusive: true,
    order: 2,
    featured: true,
  },
  {
    id: 'professional',
    name: 'Professional',
    tradingAccounts: 15,
    priceThb: 499,
    priceUsd: 15,
    taxExclusive: true,
    order: 3,
    featured: false,
  },
];
