import { describe, expect, it } from 'vitest';

import { netPnl } from './net-pnl';

describe('netPnl', () => {
  it('sums a complete same-currency Money population', () => {
    expect(
      netPnl([
        { netPnlMinor: 12_345n, baseCurrency: 'USD' },
        { netPnlMinor: '-2345', baseCurrency: 'USD' },
      ]),
    ).toEqual({ status: 'available', currency: 'USD', totalMinor: '10000' });
  });

  it('marks a Price-mode Trade mixed into the Actual population incomplete', () => {
    expect(
      netPnl([
        { netPnlMinor: 100n, baseCurrency: 'USD', actualResultMode: 'money' },
        { netPnlMinor: null, baseCurrency: 'USD', actualResultMode: 'price' },
      ]),
    ).toEqual({ status: 'unavailable', reason: 'incomplete' });
  });

  it('marks a Money record with a missing authoritative result incomplete', () => {
    expect(netPnl([{ netPnlMinor: null, baseCurrency: 'USD', actualResultMode: 'money' }])).toEqual(
      { status: 'unavailable', reason: 'incomplete' },
    );
  });

  it('marks complete all-account USD + THB results mixed currency', () => {
    expect(
      netPnl([
        { netPnlMinor: 100n, baseCurrency: 'USD' },
        { netPnlMinor: 100n, baseCurrency: 'THB' },
      ]),
    ).toEqual({ status: 'unavailable', reason: 'mixed_currency' });
  });

  it('rejects a currency whose minor-unit scale is not in the registry', () => {
    expect(netPnl([{ netPnlMinor: 100n, baseCurrency: 'BTC' }])).toEqual({
      status: 'unavailable',
      reason: 'unsupported_currency_scale',
    });
  });

  it('never double-subtracts informational commission, fees, or swap', () => {
    const storedResults = [
      {
        netPnlMinor: 1_000n,
        baseCurrency: 'USD',
        grossPnlMinor: 1_500n,
        commissionMinor: 200n,
        feesMinor: 200n,
        swapMinor: 100n,
      },
    ];
    const result = netPnl(storedResults);
    expect(result).toEqual({ status: 'available', currency: 'USD', totalMinor: '1000' });
  });

  it('distinguishes an empty eligible population from an incomplete one', () => {
    expect(netPnl([])).toEqual({ status: 'empty' });
    expect(netPnl([{ netPnlMinor: null, baseCurrency: 'USD' }])).toEqual({
      status: 'unavailable',
      reason: 'incomplete',
    });
  });
});
