import { describe, expect, it } from 'vitest';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from '@/lib/analytics/filters';

import {
  composeRiskPerformance,
  type ModeledBalanceTradeInput,
  type RiskPerformanceData,
  type RiskPerformanceScopeInput,
} from './risk-performance';
import {
  composeRiskPerformanceView,
  riskPerformanceServiceError,
  type RiskPerformanceAvailableView,
} from './risk-performance-presentation';

const ACCOUNT_ID = '019c43dc-8c6c-7000-8000-000000000001';
const AS_OF = new Date('2026-09-01T00:00:00.000Z');
const TIMEZONE = 'Asia/Bangkok';
const LOCALE = 'en-GB';

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

/** Real D7A output, never a hand-shaped payload — the contract is the input. */
function domain(
  trades: readonly ModeledBalanceTradeInput[] = [],
  scopeInput: RiskPerformanceScopeInput = scope(),
): RiskPerformanceData {
  return composeRiskPerformance({ scope: scopeInput, asOf: AS_OF, trades });
}

function view(
  trades: readonly ModeledBalanceTradeInput[] = [],
  scopeInput: RiskPerformanceScopeInput = scope(),
) {
  return composeRiskPerformanceView({
    data: domain(trades, scopeInput),
    timezone: TIMEZONE,
    dateLocale: LOCALE,
  });
}

function available(result: ReturnType<typeof view>): RiskPerformanceAvailableView {
  expect(result.status).toBe('available');
  if (result.status !== 'available') throw new Error(`Expected available, got ${result.status}`);
  return result;
}

describe('Risk Performance presentation — available state', () => {
  it('formats the canonical modeled balance, period P&L, drawdowns and peak once', () => {
    const model = available(
      view([
        trade('a', '2026-07-01T10:00:00Z', 200_00n),
        trade('b', '2026-07-02T10:00:00Z', -50_00n),
      ]),
    );

    expect(model.modeledBalanceText).toBe('$10,150.00');
    expect(model.periodNetPnl).toEqual({ text: '+$150.00', tone: 'positive' });
    expect(model.peakBalanceText).toBe('$10,200.00');
    expect(model.currentDrawdown).toEqual({
      amountText: '$50.00',
      percentageText: '0.49%',
      isZero: false,
    });
    expect(model.maxDrawdown.amountText).toBe('$50.00');
    expect(model.closedTradeCount).toBe(2);
    expect(model.hasClosedTrades).toBe(true);
    expect(model.currency).toBe('USD');
  });

  /**
   * The single most load-bearing assertion in D7B (§5/§27). A bounded window
   * carries real history into its opening state, so the ending balance MUST
   * come from D7A and must never be re-derived as "Starting Balance + the
   * period P&L on screen". Reading the 30D card as "$10,000 grew to $10,150 in
   * the last 30 days" has to be impossible, and the carried opening figure is
   * what makes it impossible.
   */
  it('carries the bounded opening balance from history rather than the starting balance', () => {
    const trades = [
      trade('old', '2026-01-05T10:00:00Z', 1_000_00n),
      trade('recent', '2026-08-20T10:00:00Z', 150_00n),
    ];
    const bounded = scope('30d', {
      kind: 'bounded',
      start: '2026-08-02T00:00:00.000Z',
      endExclusive: AS_OF.toISOString(),
    });
    const model = available(view(trades, bounded));

    expect(model.opening).toEqual({ kind: 'carried', balanceText: '$11,000.00' });
    expect(model.modeledBalanceText).toBe('$11,150.00');
    expect(model.periodNetPnl.text).toBe('+$150.00');
    // The opening is NOT the starting balance, and the two hero figures do
    // not reconcile without it.
    expect(model.opening.balanceText).not.toBe('$10,000.00');
    expect(model.closedTradeCount).toBe(1);
  });

  /**
   * Caught by the D7B UAT, not by review: a brand-new Account rendered
   * `This range opened at $10,000.00, carried in from Trades closed before
   * it` — a history that does not exist. A bounded range that carried
   * nothing is its own case, distinct from one that carried something and
   * from the All range, so the copy can say the true thing in all three.
   */
  it('does not claim a carried history for a bounded range that carried nothing', () => {
    const bounded = scope('30d', {
      kind: 'bounded',
      start: '2026-08-02T00:00:00.000Z',
      endExclusive: AS_OF.toISOString(),
    });
    const nothingBefore = available(view([trade('a', '2026-08-20T10:00:00Z', 150_00n)], bounded));
    expect(nothingBefore.opening).toEqual({
      kind: 'at_starting_balance',
      balanceText: '$10,000.00',
    });

    const somethingBefore = available(
      view(
        [
          trade('old', '2026-01-05T10:00:00Z', 1_000_00n),
          trade('a', '2026-08-20T10:00:00Z', 150_00n),
        ],
        bounded,
      ),
    );
    expect(somethingBefore.opening).toEqual({ kind: 'carried', balanceText: '$11,000.00' });
  });

  it('marks the All range opening as having no inception instant to claim', () => {
    const model = available(view([trade('a', '2026-07-01T10:00:00Z', 100_00n)]));
    expect(model.opening.kind).toBe('all');
    expect(model.opening.balanceText).toBe('$10,000.00');
    // D7A publishes no timestamp for it, so no label invents one.
    expect(model.points[0]).toMatchObject({
      kind: 'opening',
      dateLabel: null,
      dateTimeLabel: null,
    });
  });

  it('renders an exactly-zero period as unsigned and neutral, never as a gain', () => {
    const model = available(
      view([
        trade('a', '2026-07-01T10:00:00Z', 100_00n),
        trade('b', '2026-07-02T10:00:00Z', -100_00n),
      ]),
    );
    expect(model.periodNetPnl).toEqual({ text: '$0.00', tone: 'neutral' });
  });

  it('tones a losing period negative and keeps the amount signed', () => {
    const model = available(view([trade('a', '2026-07-01T10:00:00Z', -250_00n)]));
    expect(model.periodNetPnl).toEqual({ text: '-$250.00', tone: 'negative' });
  });
});

describe('Risk Performance presentation — drawdown', () => {
  /**
   * D7A's percentage is ALREADY a percentage: `0.8857` means 0.8857%. The
   * shared analytics `percent` style multiplies by 100 and would have printed
   * `88.57%` for an 0.89% drawdown, which is why this module formats its own.
   */
  it('rounds the canonical percentage for display without rescaling it', () => {
    const model = available(
      view([
        trade('a', '2026-07-01T10:00:00Z', 2_420_00n),
        trade('b', '2026-07-02T10:00:00Z', -110_00n),
      ]),
    );
    expect(model.peakBalanceText).toBe('$12,420.00');
    expect(model.currentDrawdown).toEqual({
      amountText: '$110.00',
      percentageText: '0.89%',
      isZero: false,
    });
  });

  it('presents a drawdown of exactly zero as zero, neutrally, with a real percentage', () => {
    const model = available(view([trade('a', '2026-07-01T10:00:00Z', 500_00n)]));
    expect(model.currentDrawdown).toEqual({
      amountText: '$0.00',
      percentageText: '0.00%',
      isZero: true,
    });
    expect(model.maxDrawdown.isZero).toBe(true);
  });

  it('never invents a percentage D7A declined to publish for a non-positive peak', () => {
    const data = domain([], {
      ...scope(),
      account: {
        kind: 'account',
        accountId: ACCOUNT_ID,
        source: 'explicit',
        baseCurrency: 'USD',
        startingBalance: '0',
      },
    });
    if (data.status !== 'available') throw new Error('Expected available');
    expect(data.currentDrawdown.percentage).toEqual({
      status: 'unavailable',
      reason: 'non_positive_peak',
    });

    const model = available(
      composeRiskPerformanceView({ data, timezone: TIMEZONE, dateLocale: LOCALE }),
    );
    // `null`, so the card can say "not available" rather than assert `0%`.
    expect(model.currentDrawdown.percentageText).toBeNull();
    expect(model.maxDrawdown.percentageText).toBeNull();
  });
});

describe('Risk Performance presentation — chart series', () => {
  it('passes the canonical D7A series through with a coordinate beside every exact figure', () => {
    const model = available(
      view([
        trade('a', '2026-07-01T10:00:00Z', 120_00n),
        trade('b', '2026-07-02T10:00:00Z', -20_00n),
      ]),
    );

    expect(model.points).toHaveLength(4);
    expect(model.points.map((point) => point.kind)).toEqual([
      'opening',
      'trade_close',
      'trade_close',
      'as_of',
    ]);
    expect(model.points.map((point) => point.balanceText)).toEqual([
      '$10,000.00',
      '$10,120.00',
      '$10,100.00',
      '$10,100.00',
    ]);
    expect(model.points.map((point) => point.balance)).toEqual([10000, 10120, 10100, 10100]);
    // Anchors are not Trades and carry no P&L delta.
    expect(model.points[0]?.deltaText).toBeNull();
    expect(model.points[3]?.deltaText).toBeNull();
    expect(model.points[1]?.deltaText).toBe('+$120.00');
    expect(model.points[2]?.deltaText).toBe('-$20.00');
    expect(model.points[2]?.deltaTone).toBe('negative');
    // Unique keys: several Trades may share a calendar date, so the chart's
    // category axis cannot be keyed on the label.
    expect(new Set(model.points.map((point) => point.key)).size).toBe(4);
  });

  it('labels realization instants in the workspace timezone, not UTC and not the server zone', () => {
    // 23:30 UTC on 30 June is 06:30 on 1 July in Bangkok. The label must
    // follow the workspace zone (CLAUDE.md §7).
    const model = available(view([trade('a', '2026-06-30T23:30:00Z', 100_00n)]));
    const close = model.points[1];
    expect(close?.kind).toBe('trade_close');
    expect(close?.dateLabel).toBe('01 Jul 2026');
    expect(close?.dateTimeLabel).toBe('01 Jul 2026, 06:30');
  });

  it('reports one balance realization per parent Trade even when several close together', () => {
    const model = available(
      view([
        trade('a', '2026-07-01T10:00:00.000Z', 100_00n),
        trade('b', '2026-07-01T10:00:00.000Z', 50_00n),
      ]),
    );
    const closes = model.points.filter((point) => point.kind === 'trade_close');
    expect(closes).toHaveLength(1);
    expect(closes[0]?.tradeCount).toBe(2);
    expect(closes[0]?.deltaText).toBe('+$150.00');
  });
});

describe('Risk Performance presentation — availability and scope', () => {
  it('keeps an Account with no closed Trades available at its starting balance', () => {
    const model = available(view([]));
    expect(model.hasClosedTrades).toBe(false);
    expect(model.closedTradeCount).toBe(0);
    expect(model.modeledBalanceText).toBe('$10,000.00');
    expect(model.periodNetPnl).toEqual({ text: '$0.00', tone: 'neutral' });
    expect(model.currentDrawdown.amountText).toBe('$0.00');
    expect(model.maxDrawdown.amountText).toBe('$0.00');
  });

  it('refuses to combine Accounts rather than showing an aggregate of zero', () => {
    const result = view([], { ...scope(), account: { kind: 'all' } });
    expect(result).toEqual({ status: 'unavailable', reason: 'select_single_account' });
  });

  it('surfaces a missing starting balance as its own limitation', () => {
    const result = view([], {
      ...scope(),
      account: {
        kind: 'account',
        accountId: ACCOUNT_ID,
        source: 'explicit',
        baseCurrency: 'USD',
        startingBalance: null,
      },
    });
    expect(result).toEqual({ status: 'unavailable', reason: 'missing_starting_balance' });
  });

  it('surfaces incomplete money history rather than silently dropping the Trade', () => {
    const result = view([
      trade('a', '2026-07-01T10:00:00Z', 100_00n),
      trade('b', '2026-07-02T10:00:00Z', null),
    ]);
    expect(result).toEqual({ status: 'unavailable', reason: 'incomplete_money_history' });
  });

  it('surfaces a currency mismatch rather than converting anything', () => {
    const result = view([
      trade('a', '2026-07-01T10:00:00Z', 100_00n),
      trade('b', '2026-07-02T10:00:00Z', 100_00n, 'THB'),
    ]);
    expect(result).toEqual({ status: 'unavailable', reason: 'currency_mismatch' });
  });

  it('keeps an integrity failure distinct from a product limitation', () => {
    const result = view([trade('a', 'not-a-timestamp', 100_00n)]);
    expect(result).toEqual({ status: 'error', reason: 'invalid_actual_exit_timestamp' });
  });

  it('keeps a failed Risk read distinct from every domain outcome', () => {
    expect(riskPerformanceServiceError()).toEqual({ status: 'error', reason: 'service_error' });
  });

  /**
   * §13. Strategy/Setup/Version are authorized and validated by the shared
   * resolver but never filter the Account Balance universe, so the section
   * has to SAY so — and only when one is actually applied, or the note is
   * standing clutter explaining a filter nobody set.
   */
  it('raises the scope note only while an analytical filter is applied', () => {
    expect(available(view([])).showsAnalyticalScopeNote).toBe(false);
    const filtered = available(
      view([], { ...scope(), strategyId: '019c43dc-8c6c-7000-8000-000000000009' }),
    );
    expect(filtered.showsAnalyticalScopeNote).toBe(true);
    // And the figures are identical either way — the filter changed nothing.
    expect(filtered.modeledBalanceText).toBe(available(view([])).modeledBalanceText);
  });

  it('carries the selected range through for labelling without owning a control', () => {
    const bounded = scope('90d', {
      kind: 'bounded',
      start: '2026-06-03T00:00:00.000Z',
      endExclusive: AS_OF.toISOString(),
    });
    expect(available(view([], bounded)).datePreset).toBe('90d');
  });
});
