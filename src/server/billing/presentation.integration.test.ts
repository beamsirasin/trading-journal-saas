import { describe, expect, it } from 'vitest';

import { getBillingPresentation, getCheckoutQuotePresentation } from './presentation';

describe('safe billing presentation', () => {
  it('derives all prices and locale defaults without exposing bigint', () => {
    const en = getBillingPresentation('en');
    const th = getBillingPresentation('th');
    expect(en.defaultCurrency).toBe('USD');
    expect(th.defaultCurrency).toBe('THB');
    expect(en.plans.map((plan) => [plan.id, plan.activeTradingAccountLimit])).toEqual([
      ['starter', 1],
      ['trader', 5],
      ['professional', 15],
    ]);
    expect(en.plans.map((plan) => plan.prices.USD.formatted)).toEqual(['$5.00', '$9.00', '$15.00']);
    expect(th.plans.map((plan) => plan.prices.THB.formatted)).toEqual([
      '฿149.00',
      '฿299.00',
      '฿499.00',
    ]);
    expect(() => JSON.stringify(en)).not.toThrow();
    expect(JSON.stringify(en)).not.toContain('14900n');
  });

  it('keeps VAT disabled at launch and presents trusted exclusive VAT when enabled', () => {
    const launch = getCheckoutQuotePresentation('en', 'starter', 'THB');
    expect(launch).toMatchObject({
      subtotal: { amountMinor: '14900' },
      vat: { enabled: false, amount: { amountMinor: '0' } },
      total: { amountMinor: '14900' },
    });

    const enabled = getCheckoutQuotePresentation('th', 'starter', 'THB', {
      enabled: true,
      rateBasisPoints: 700,
    });
    expect(enabled).toMatchObject({
      subtotal: { amountMinor: '14900' },
      vat: { enabled: true, ratePercent: '7', amount: { amountMinor: '1043' } },
      total: { amountMinor: '15943' },
    });
  });
});
