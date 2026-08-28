import { describe, expect, it } from 'vitest';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from '@/lib/analytics/filters';

import {
  composeRiskPerformance,
  type ComposeRiskPerformanceInput,
  type ModeledBalanceTradeInput,
  type RiskPerformanceScopeInput,
} from './risk-performance';

const ACCOUNT_ID = '019c43dc-8c6c-7000-8000-000000000001';
const AS_OF = new Date('2026-09-01T00:00:00.000Z');

function bounds(start: string, endExclusive = AS_OF.toISOString()): AnalyticsDateBounds {
  return { kind: 'bounded', start, endExclusive };
}

function scope(
  datePreset: AnalyticsDatePreset = 'all',
  dateBounds: AnalyticsDateBounds = { kind: 'all', start: null, endExclusive: null },
): RiskPerformanceScopeInput {
  return {
    datePreset,
    dateBounds,
    account: {
      kind: 'account',
      accountId: ACCOUNT_ID,
      source: 'explicit',
      baseCurrency: 'USD',
      startingBalance: '10000.0000000000',
    },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
  };
}

function trade(
  tradeId: string,
  actualExitedAt: string,
  netPnlMinor: bigint | string | null,
  baseCurrency = 'USD',
): ModeledBalanceTradeInput {
  return { tradeId, actualExitedAt, netPnlMinor, baseCurrency };
}

function compose(overrides: Partial<ComposeRiskPerformanceInput> = {}) {
  return composeRiskPerformance({ scope: scope(), asOf: AS_OF, trades: [], ...overrides });
}

function available(result: ReturnType<typeof composeRiskPerformance>) {
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error(`Expected available, got ${result.status}`);
  return result;
}

describe('Modeled Account Balance definition', () => {
  it('converts the declared starting balance with the currency registry and sums authoritative net money once', () => {
    const result = available(
      compose({
        trades: [
          trade('one', '2026-07-01T10:00:00Z', 125_00n),
          trade('two', '2026-07-02T10:00:00Z', -25_00n),
        ],
      }),
    );
    expect(result).toMatchObject({
      currency: 'USD',
      startingBalanceMinor: '1000000',
      openingBalanceMinor: '1000000',
      endingBalanceMinor: '1010000',
      periodNetPnlMinor: '10000',
      closedTradeCount: 2,
    });
    expect(result.basis.effectiveAt).toBeNull();
    expect(result.basis.limitations).toEqual([
      'no_cash_ledger',
      'no_unrealized_pnl',
      'starting_balance_changes_are_retroactive',
    ]);
  });

  it('respects zero-decimal currencies instead of assuming cents', () => {
    const jpy = scope();
    if (jpy.account.kind !== 'account') throw new Error('unreachable');
    const result = available(
      compose({
        scope: {
          ...jpy,
          account: { ...jpy.account, baseCurrency: 'JPY', startingBalance: '10000.0000000000' },
        },
        trades: [trade('jpy', '2026-08-01T00:00:00Z', 500n, 'JPY')],
      }),
    );
    expect(result.startingBalanceMinor).toBe('10000');
    expect(result.endingBalanceMinor).toBe('10500');
  });

  it('does not subtract gross/cost fields or derive money from R because neither is an input', () => {
    const row = {
      ...trade('net-only', '2026-08-01T00:00:00Z', 1_000n),
      actualR: '9.9999',
      grossPnlMinor: 9_999n,
      commissionMinor: 500n,
      feesMinor: 500n,
      swapMinor: 500n,
    };
    expect(available(compose({ trades: [row] })).endingBalanceMinor).toBe('1001000');
  });

  it('returns a real flat balance and zero drawdown when there are no closed Trades', () => {
    const result = available(compose());
    expect(result).toMatchObject({
      openingBalanceMinor: '1000000',
      endingBalanceMinor: '1000000',
      periodNetPnlMinor: '0',
      peakBalanceMinor: '1000000',
      currentDrawdown: {
        amountMinor: '0',
        percentage: { status: 'available', value: '0.0000' },
      },
      maxDrawdown: {
        amountMinor: '0',
        percentage: { status: 'available', value: '0.0000' },
      },
      closedTradeCount: 0,
      completeness: { checkedClosedTradeCount: 0 },
    });
    expect(result.series.map((point) => point.kind)).toEqual(['opening', 'as_of']);
  });
});

describe('range and completeness semantics', () => {
  const history = [
    trade('old-win', '2026-05-01T00:00:00Z', 150_000n),
    trade('ninety', '2026-06-15T00:00:00Z', -20_000n),
    trade('thirty', '2026-08-15T00:00:00Z', 30_000n),
  ];

  it.each([
    {
      label: 'All',
      preset: 'all' as const,
      dateBounds: { kind: 'all' as const, start: null, endExclusive: null },
      opening: '1000000',
      ending: '1160000',
      period: '160000',
      count: 3,
    },
    {
      label: '90D',
      preset: '90d' as const,
      dateBounds: bounds('2026-06-03T00:00:00Z'),
      opening: '1150000',
      ending: '1160000',
      period: '10000',
      count: 2,
    },
    {
      label: '30D',
      preset: '30d' as const,
      dateBounds: bounds('2026-08-03T00:00:00Z'),
      opening: '1130000',
      ending: '1160000',
      period: '30000',
      count: 1,
    },
  ])('$label carries all prior money into the opening balance', (vector) => {
    const result = available(
      compose({ scope: scope(vector.preset, vector.dateBounds), trades: history }),
    );
    expect(result.openingBalanceMinor).toBe(vector.opening);
    expect(result.endingBalanceMinor).toBe(vector.ending);
    expect(result.periodNetPnlMinor).toBe(vector.period);
    expect(result.closedTradeCount).toBe(vector.count);
    expect(result.completeness.checkedClosedTradeCount).toBe(3);
  });

  it('marks a later 30D view incomplete when pre-range history lacks authoritative money', () => {
    const result = compose({
      scope: scope('30d', bounds('2026-08-03T00:00:00Z')),
      trades: [
        trade('historical-price-mode', '2026-05-01T00:00:00Z', null),
        trade('visible-money', '2026-08-15T00:00:00Z', 10_000n),
      ],
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'incomplete_money_history' });
  });

  it('ignores rows after the requested as-of boundary', () => {
    const result = available(
      compose({
        trades: [
          trade('known', '2026-08-01T00:00:00Z', 10_000n),
          trade('future', '2026-09-02T00:00:00Z', null),
        ],
      }),
    );
    expect(result.endingBalanceMinor).toBe('1010000');
    expect(result.completeness.checkedClosedTradeCount).toBe(1);
  });

  it('Strategy/Setup/Version changes are explicit scope metadata but never redefine the Account balance universe', () => {
    const trades = [trade('one', '2026-08-01T00:00:00Z', 10_000n)];
    const base = available(compose({ trades }));
    const filteredScope = scope();
    const filtered = available(
      compose({
        scope: {
          ...filteredScope,
          strategyId: '019c43dc-8c6c-7000-8000-000000000002',
          setupId: '019c43dc-8c6c-7000-8000-000000000003',
          strategyVersionId: '019c43dc-8c6c-7000-8000-000000000004',
        },
        trades,
      }),
    );
    expect({
      opening: filtered.openingBalanceMinor,
      ending: filtered.endingBalanceMinor,
      period: filtered.periodNetPnlMinor,
      current: filtered.currentDrawdown,
      max: filtered.maxDrawdown,
      series: filtered.series,
    }).toEqual({
      opening: base.openingBalanceMinor,
      ending: base.endingBalanceMinor,
      period: base.periodNetPnlMinor,
      current: base.currentDrawdown,
      max: base.maxDrawdown,
      series: base.series,
    });
    expect(filtered.scope.analyticalFilters.effect).toBe('not_applied_to_account_balance');
  });
});

describe('money balance drawdown', () => {
  it('matches the canonical obvious sequence with peak-specific percentages', () => {
    const deltas = [100_000n, -50_000n, -150_000n, 200_000n, -30_000n];
    const trades = deltas.map((delta, index) =>
      trade(`trade-${index}`, `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`, delta),
    );
    const result = available(compose({ trades }));
    expect(result.series.map((point) => point.balanceMinor)).toEqual([
      '1000000',
      '1100000',
      '1050000',
      '900000',
      '1100000',
      '1070000',
      '1070000',
    ]);
    expect(result.currentDrawdown).toEqual({
      amountMinor: '30000',
      percentage: { status: 'available', value: '2.7273' },
      referencePeakMinor: '1100000',
    });
    expect(result.maxDrawdown).toEqual({
      amountMinor: '200000',
      percentage: { status: 'available', value: '18.1818' },
      referencePeakMinor: '1100000',
    });
  });

  it.each([
    ['monotonically rising', [10_000n, 20_000n, 0n], '0'],
    ['monotonically falling', [-10_000n, -20_000n, -30_000n], '60000'],
    ['recovery to exact peak', [30_000n, -20_000n, 20_000n], '20000'],
    ['new high after drawdown', [30_000n, -20_000n, 20_000n, 10_000n], '20000'],
  ] as const)('%s handles zero/recovery/high-water behavior', (_label, deltas, max) => {
    const result = available(
      compose({
        trades: deltas.map((delta, index) =>
          trade(`case-${index}`, `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`, delta),
        ),
      }),
    );
    expect(result.maxDrawdown.amountMinor).toBe(max);
  });

  it('carries a pre-range peak and measures an opening trough inside the bounded range', () => {
    const result = available(
      compose({
        scope: scope('30d', bounds('2026-08-01T00:00:00Z')),
        trades: [
          trade('peak', '2026-06-01T00:00:00Z', 400_000n),
          trade('pre-range-loss', '2026-07-01T00:00:00Z', -150_000n),
          trade('visible-loss', '2026-08-10T00:00:00Z', -50_000n),
        ],
      }),
    );
    expect(result.openingBalanceMinor).toBe('1250000');
    expect(result.peakBalanceMinor).toBe('1400000');
    expect(result.maxDrawdown).toEqual({
      amountMinor: '200000',
      percentage: { status: 'available', value: '14.2857' },
      referencePeakMinor: '1400000',
    });
  });

  it('keeps zero/negative balances exact, exposes an ill-defined percentage, and never clamps to 100%', () => {
    const zeroScope = scope();
    if (zeroScope.account.kind !== 'account') throw new Error('unreachable');
    const result = available(
      compose({
        scope: { ...zeroScope, account: { ...zeroScope.account, startingBalance: '0' } },
        trades: [trade('loss', '2026-08-01T00:00:00Z', -12_500n)],
      }),
    );
    expect(result.endingBalanceMinor).toBe('-12500');
    expect(result.currentDrawdown).toEqual({
      amountMinor: '12500',
      percentage: { status: 'unavailable', reason: 'non_positive_peak' },
      referencePeakMinor: '0',
    });

    const positivePeak = available(
      compose({ trades: [trade('large-loss', '2026-08-01T00:00:00Z', -1_500_000n)] }),
    );
    expect(positivePeak.endingBalanceMinor).toBe('-500000');
    expect(positivePeak.currentDrawdown.percentage).toEqual({
      status: 'available',
      value: '150.0000',
    });
  });

  it('groups exact-identical Actual exit instants before advancing balance', () => {
    const result = available(
      compose({
        trades: [
          trade('winner', '2026-08-10T12:00:00.123Z', 100_000n),
          trade('loser', '2026-08-10T12:00:00.123Z', -200_000n),
        ],
      }),
    );
    const closePoints = result.series.filter((point) => point.kind === 'trade_close');
    expect(closePoints).toEqual([
      {
        kind: 'trade_close',
        occurredAt: '2026-08-10T12:00:00.123Z',
        tradeIds: ['loser', 'winner'],
        deltaMinor: '-100000',
        balanceMinor: '900000',
      },
    ]);
    expect(result.maxDrawdown.amountMinor).toBe('100000');
    expect(result.closedTradeCount).toBe(2);
  });

  it('does not group distinct PostgreSQL microsecond instants that share one JavaScript millisecond', () => {
    const result = available(
      compose({
        trades: [
          trade('first', '2026-08-10T12:00:00.123001Z', 100_000n),
          trade('second', '2026-08-10T12:00:00.123999Z', -200_000n),
        ],
      }),
    );
    const closePoints = result.series.filter((point) => point.kind === 'trade_close');
    expect(closePoints).toHaveLength(2);
    expect(closePoints.map((point) => point.occurredAt)).toEqual([
      '2026-08-10T12:00:00.123001Z',
      '2026-08-10T12:00:00.123999Z',
    ]);
    expect(result.maxDrawdown.amountMinor).toBe('200000');
  });
});

describe('truthful availability and integrity states', () => {
  it('fails All Accounts closed because Account balance bases have no trustworthy inception times', () => {
    const allScope = scope();
    const result = compose({ scope: { ...allScope, account: { kind: 'all' } } });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'select_single_account' });
  });

  it('distinguishes missing and invalid starting balances', () => {
    const base = scope();
    if (base.account.kind !== 'account') throw new Error('unreachable');
    expect(
      compose({ scope: { ...base, account: { ...base.account, startingBalance: null } } }),
    ).toMatchObject({ status: 'unavailable', reason: 'missing_starting_balance' });
    expect(
      compose({ scope: { ...base, account: { ...base.account, startingBalance: '10.001' } } }),
    ).toMatchObject({ status: 'integrity_error', reason: 'invalid_starting_balance' });
  });

  it('fails unsupported Account currency scale explicitly', () => {
    const base = scope();
    if (base.account.kind !== 'account') throw new Error('unreachable');
    expect(
      compose({ scope: { ...base, account: { ...base.account, baseCurrency: 'BTC' } } }),
    ).toMatchObject({ status: 'unavailable', reason: 'unsupported_currency_scale' });
  });

  it('fails mixed Account/Trade money currency without FX', () => {
    expect(
      compose({ trades: [trade('mixed', '2026-08-01T00:00:00Z', 100n, 'THB')] }),
    ).toMatchObject({ status: 'unavailable', reason: 'currency_mismatch' });
  });

  it('reports malformed money and Actual exit timestamps as integrity failures', () => {
    expect(compose({ trades: [trade('bad-money', '2026-08-01T00:00:00Z', '10.5')] })).toMatchObject(
      { status: 'integrity_error', reason: 'invalid_money_data' },
    );
    expect(compose({ trades: [trade('bad-date', 'not-a-date', 100n)] })).toMatchObject({
      status: 'integrity_error',
      reason: 'invalid_actual_exit_timestamp',
    });
  });

  it('treats one fully closed partial-close position as one Trade realization', () => {
    const partialPosition = {
      ...trade('partial-position', '2026-08-10T00:00:00Z', 23_100n),
      // Deliberately outside the D7 input contract: child legs may exist on
      // the source object, but only the parent Trade-level net result enters.
      exits: [10_000n, 13_100n],
    };
    const result = available(
      compose({
        trades: [partialPosition],
      }),
    );
    expect(result.closedTradeCount).toBe(1);
    expect(result.periodNetPnlMinor).toBe('23100');
    expect(result.series.filter((point) => point.kind === 'trade_close')).toHaveLength(1);
  });
});
