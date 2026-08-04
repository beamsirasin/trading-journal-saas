import { describe, expect, expectTypeOf, it } from 'vitest';

import { PLANS } from '@/config/plans';
import { MAX_SAFE_MINOR } from '@/lib/money';

import {
  assertSupportedBillingCurrency,
  calculateExclusiveVat,
  getDefaultBillingCurrency,
  getPlanDefinition,
  getPlanPrice,
  isSupportedBillingCurrency,
  PLAN_DEFINITIONS,
  PLAN_KEYS,
  PRICE_BOOK,
  quoteCheckout,
  type BillingCurrency,
  type PlanKey,
  type QuoteCheckoutInput,
  type VatConfiguration,
} from './index';

const VAT_DISABLED: VatConfiguration = Object.freeze({ enabled: false, rateBasisPoints: 700 });
const VAT_ENABLED: VatConfiguration = Object.freeze({ enabled: true, rateBasisPoints: 700 });

describe('paid-plan entitlement catalogue', () => {
  it('contains exactly Starter, Trader, and Professional with 1/5/15 active-account limits', () => {
    expect(PLAN_KEYS).toEqual(['starter', 'trader', 'professional']);
    expect(Object.isFrozen(PLAN_KEYS)).toBe(true);
    expect(PLAN_DEFINITIONS.map((plan) => [plan.id, plan.activeTradingAccountLimit])).toEqual([
      ['starter', 1],
      ['trader', 5],
      ['professional', 15],
    ]);
  });

  it('contains no per-tier feature entitlement data', () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(plan).not.toHaveProperty('features');
      expect(plan).not.toHaveProperty('analytics');
      expect(plan).not.toHaveProperty('strategyLimit');
      expect(plan).not.toHaveProperty('tradeLimit');
      expect(Object.keys(plan).sort()).toEqual(
        ['activeTradingAccountLimit', 'featured', 'id', 'name', 'order'].sort(),
      );
    }
  });

  it('rejects an unsupported plan key at runtime', () => {
    expect(() => getPlanDefinition('elite' as PlanKey)).toThrow(/unsupported plan key/i);
  });
});

describe('fixed monthly price book', () => {
  it.each([
    ['starter', 'THB', 14_900n],
    ['trader', 'THB', 29_900n],
    ['professional', 'THB', 49_900n],
    ['starter', 'USD', 500n],
    ['trader', 'USD', 900n],
    ['professional', 'USD', 1_500n],
  ] as const)('prices %s in %s at %s minor units', (planKey, currency, amountMinor) => {
    expect(getPlanPrice(planKey, currency, 'monthly')).toEqual({
      planKey,
      currency,
      billingInterval: 'monthly',
      amountMinor,
    });
  });

  it('supports monthly billing only', () => {
    expect(() => getPlanPrice('starter', 'USD', 'annual' as 'monthly')).toThrow(
      /unsupported billing interval/i,
    );
  });

  it('rejects unsupported plans and currencies at runtime', () => {
    expect(() => getPlanPrice('enterprise' as PlanKey, 'USD', 'monthly')).toThrow(
      /unsupported plan key/i,
    );
    expect(() => getPlanPrice('starter', 'EUR' as BillingCurrency, 'monthly')).toThrow(
      /unsupported billing currency/i,
    );
    expect(isSupportedBillingCurrency('THB')).toBe(true);
    expect(isSupportedBillingCurrency('USD')).toBe(true);
    expect(isSupportedBillingCurrency('EUR')).toBe(false);
    expect(() => assertSupportedBillingCurrency('EUR')).toThrow(/unsupported billing currency/i);
  });

  it('uses locale only to choose the default currency', () => {
    expect(getDefaultBillingCurrency('th')).toBe('THB');
    expect(getDefaultBillingCurrency('en')).toBe('USD');
    expect(getPlanPrice('starter', 'THB', 'monthly').amountMinor).toBe(14_900n);
    expect(getPlanPrice('starter', 'USD', 'monthly').amountMinor).toBe(500n);
  });

  it('deep-freezes the price book and returned prices', () => {
    expect(Object.isFrozen(PRICE_BOOK)).toBe(true);
    expect(Object.isFrozen(PRICE_BOOK.starter)).toBe(true);
    expect(Object.isFrozen(PRICE_BOOK.starter.monthly)).toBe(true);
    expect(Object.isFrozen(getPlanPrice('starter', 'USD', 'monthly'))).toBe(true);
  });

  it('derives the legacy UI major-unit prices from the canonical price book', () => {
    for (const plan of PLANS) {
      expect(BigInt(plan.priceThb) * 100n).toBe(
        getPlanPrice(plan.id, 'THB', 'monthly').amountMinor,
      );
      expect(BigInt(plan.priceUsd) * 100n).toBe(
        getPlanPrice(plan.id, 'USD', 'monthly').amountMinor,
      );
    }
  });
});

describe('VAT-disabled checkout quotation', () => {
  it('applies no rate or amount and leaves total equal to subtotal', () => {
    const quote = quoteCheckout({
      planKey: 'starter',
      currency: 'THB',
      billingInterval: 'monthly',
      vatConfiguration: VAT_DISABLED,
    });

    expect(quote).toEqual({
      planKey: 'starter',
      currency: 'THB',
      billingInterval: 'monthly',
      subtotalMinor: 14_900n,
      vatEnabled: false,
      appliedVatRateBasisPoints: 0,
      vatAmountMinor: 0n,
      totalMinor: 14_900n,
      taxMode: 'disabled',
    });
  });
});

describe('exclusive VAT checkout quotation', () => {
  it.each([
    ['starter', 'THB', 14_900n, 1_043n, 15_943n],
    ['trader', 'THB', 29_900n, 2_093n, 31_993n],
    ['professional', 'THB', 49_900n, 3_493n, 53_393n],
    ['starter', 'USD', 500n, 35n, 535n],
    ['trader', 'USD', 900n, 63n, 963n],
    ['professional', 'USD', 1_500n, 105n, 1_605n],
  ] as const)(
    'quotes %s in %s with exact 7%% exclusive VAT',
    (planKey, currency, subtotalMinor, vatAmountMinor, totalMinor) => {
      const quote = quoteCheckout({
        planKey,
        currency,
        billingInterval: 'monthly',
        vatConfiguration: VAT_ENABLED,
      });

      expect(quote).toMatchObject({
        subtotalMinor,
        vatEnabled: true,
        appliedVatRateBasisPoints: 700,
        vatAmountMinor,
        totalMinor,
        taxMode: 'exclusive',
      });
      expect(quote.totalMinor).toBe(quote.subtotalMinor + quote.vatAmountMinor);
    },
  );
});

describe('VAT rounding and BIGINT safety', () => {
  it('rounds immediately below, exactly at, and immediately above half a minor unit', () => {
    expect(calculateExclusiveVat(4_999n, 1).vatAmountMinor).toBe(0n);
    expect(calculateExclusiveVat(5_000n, 1).vatAmountMinor).toBe(1n);
    expect(calculateExclusiveVat(5_001n, 1).vatAmountMinor).toBe(1n);
  });

  it('handles zero subtotal, zero rate, and the maximum valid rate', () => {
    expect(calculateExclusiveVat(0n, 700)).toEqual({ vatAmountMinor: 0n, totalMinor: 0n });
    expect(calculateExclusiveVat(123n, 0)).toEqual({
      vatAmountMinor: 0n,
      totalMinor: 123n,
    });
    expect(calculateExclusiveVat(123n, 10_000)).toEqual({
      vatAmountMinor: 123n,
      totalMinor: 246n,
    });
  });

  it('accepts a large calculation whose VAT and total remain within PostgreSQL BIGINT', () => {
    const subtotalMinor = MAX_SAFE_MINOR / 2n;
    expect(calculateExclusiveVat(subtotalMinor, 10_000)).toEqual({
      vatAmountMinor: subtotalMinor,
      totalMinor: subtotalMinor * 2n,
    });
  });

  it('rejects negative, out-of-range, and overflowing stored values', () => {
    expect(() => calculateExclusiveVat(-1n, 700)).toThrow(/cannot be negative/i);
    expect(() => calculateExclusiveVat(MAX_SAFE_MINOR + 1n, 0)).toThrow(/subtotal exceeds/i);
    expect(() => calculateExclusiveVat(MAX_SAFE_MINOR, 1)).toThrow(/total exceeds/i);
  });

  it.each([-1, 10_001, 7.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid VAT rate %s',
    (rateBasisPoints) => {
      expect(() => calculateExclusiveVat(100n, rateBasisPoints)).toThrow(/VAT rate must/i);
    },
  );
});

describe('checkout quote integrity', () => {
  it('ignores caller-supplied monetary fields and derives every amount internally', () => {
    const tamperedInput = {
      planKey: 'starter' as const,
      currency: 'USD' as const,
      billingInterval: 'monthly' as const,
      vatConfiguration: VAT_DISABLED,
      subtotalMinor: 1n,
      vatAmountMinor: 1n,
      totalMinor: 2n,
      appliedVatRateBasisPoints: 10_000,
    };

    expect(quoteCheckout(tamperedInput)).toMatchObject({
      subtotalMinor: 500n,
      vatAmountMinor: 0n,
      totalMinor: 500n,
      appliedVatRateBasisPoints: 0,
    });
  });

  it('fails closed for invalid trusted VAT configuration', () => {
    expect(() =>
      quoteCheckout({
        planKey: 'starter',
        currency: 'USD',
        billingInterval: 'monthly',
        vatConfiguration: { enabled: false, rateBasisPoints: -1 },
      }),
    ).toThrow(/VAT rate must/i);
  });

  it('returns a runtime-frozen object with readonly monetary fields', () => {
    const quote = quoteCheckout({
      planKey: 'professional',
      currency: 'USD',
      billingInterval: 'monthly',
      vatConfiguration: VAT_ENABLED,
    });

    expect(Object.isFrozen(quote)).toBe(true);
    expect(Reflect.set(quote, 'subtotalMinor', 1n)).toBe(false);

    type CustomerMoneyOverride = Extract<
      keyof QuoteCheckoutInput,
      'subtotalMinor' | 'vatAmountMinor' | 'totalMinor' | 'activeTradingAccountLimit'
    >;
    expectTypeOf<CustomerMoneyOverride>().toEqualTypeOf<never>();
  });
});
