/**
 * Demo fixtures — fictional data for the Phase 01 visual prototype.
 *
 * THE NUMBERS BELOW ARE INVENTED. They are not a backtest, not a customer
 * account, and not a performance claim. Every surface that renders them
 * carries a visible "Demo data" marker; see docs/design-system.md §11 for the
 * demo-data policy.
 *
 * The scenario is chosen because it is the product's thesis in one dataset: a
 * strategy with a real edge (+37.8R over 90 trades) being handed back through
 * execution (+9.9R actually captured). A journal that only recorded profit
 * would show a winning account and reveal nothing.
 *
 * Internal consistency is maintained by hand, and the two relationships worth
 * checking are asserted in `fixtures.test.ts`:
 *   - executionGapR === actualTotalR − systemTotalR (Phase 13H sign)
 *   - the mistake costs sum to the magnitude of the Execution Gap
 */

import type { Money } from '@/lib/money';

import type { DemoAccount, DemoBundle, DemoRange, DemoRangeId, DemoTrade } from './types';

const usd = (amountMinor: bigint): Money => ({ amountMinor, currency: 'USD' });

export const DEMO_RANGES: readonly DemoRange[] = [
  { id: '30d', label: '30 days', description: 'Last 30 days' },
  { id: '90d', label: '90 days', description: 'Last 90 days' },
  { id: 'all', label: 'All time', description: 'All recorded trades' },
];

export const DEMO_DEFAULT_RANGE: DemoRangeId = 'all';

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'all', name: 'All accounts', broker: 'Combined', currency: 'USD' },
  { id: 'acc-prop', name: 'Prop challenge — 100K', broker: 'Prop firm', currency: 'USD' },
  { id: 'acc-live', name: 'Personal — live', broker: 'Retail broker', currency: 'USD' },
  { id: 'acc-swing', name: 'Swing account', broker: 'Retail broker', currency: 'USD' },
];

export const DEMO_DEFAULT_ACCOUNT = 'all';

/**
 * Recent closed trades.
 *
 * Deliberately covers all four cells of the outcome matrix, because the two
 * unusual ones are the entire reason the product stores system and actual
 * outcome as independent fields:
 *
 *   - system win  / trader loss  -> `t-2`, `t-5`  (a working setup, damaged)
 *   - system loss / trader win   -> `t-4`         (paid for breaking a rule)
 */
export const DEMO_TRADES: readonly DemoTrade[] = [
  {
    id: 't-1',
    accountId: 'acc-prop',
    symbol: 'EURUSD',
    direction: 'long',
    strategy: 'London breakout',
    strategyVersion: 'v3',
    closedAt: '2026-07-30T14:20:00+00:00',
    systemOutcome: 'win',
    actualOutcome: 'win',
    systemR: '2.0000',
    actualR: '1.6000',
    net: usd(32000n),
    mistakes: [],
    chartUrl: 'https://www.tradingview.com/chart/',
  },
  {
    id: 't-2',
    accountId: 'acc-prop',
    symbol: 'GBPUSD',
    direction: 'short',
    strategy: 'London breakout',
    strategyVersion: 'v3',
    closedAt: '2026-07-29T09:05:00+00:00',
    systemOutcome: 'win',
    actualOutcome: 'loss',
    systemR: '3.0000',
    actualR: '-0.4000',
    net: usd(-8000n),
    mistakes: ['Moved stop', 'Exited early'],
    chartUrl: 'https://www.tradingview.com/chart/',
  },
  {
    id: 't-3',
    accountId: 'acc-live',
    symbol: 'XAUUSD',
    direction: 'long',
    strategy: 'New York reversal',
    strategyVersion: 'v2',
    closedAt: '2026-07-29T18:40:00+00:00',
    systemOutcome: 'loss',
    actualOutcome: 'loss',
    systemR: '-1.0000',
    actualR: '-1.0000',
    net: usd(-20000n),
    mistakes: [],
  },
  {
    id: 't-4',
    accountId: 'acc-live',
    symbol: 'USDJPY',
    direction: 'short',
    strategy: 'New York reversal',
    strategyVersion: 'v2',
    closedAt: '2026-07-28T13:15:00+00:00',
    systemOutcome: 'loss',
    actualOutcome: 'win',
    systemR: '-1.0000',
    actualR: '0.9000',
    net: usd(18000n),
    mistakes: ['Ignored exit rule'],
    chartUrl: 'https://www.tradingview.com/chart/',
  },
  {
    id: 't-5',
    accountId: 'acc-prop',
    symbol: 'EURUSD',
    direction: 'short',
    strategy: 'Asia range fade',
    strategyVersion: 'v1',
    closedAt: '2026-07-28T02:50:00+00:00',
    systemOutcome: 'win',
    actualOutcome: 'break_even',
    systemR: '1.5000',
    actualR: '0.0200',
    net: usd(400n),
    mistakes: ['Exited early'],
  },
  {
    id: 't-6',
    accountId: 'acc-swing',
    symbol: 'NAS100',
    direction: 'long',
    strategy: 'Momentum continuation',
    strategyVersion: 'v4',
    closedAt: '2026-07-27T20:00:00+00:00',
    systemOutcome: 'win',
    actualOutcome: 'win',
    systemR: '2.4000',
    actualR: '2.4000',
    net: usd(48000n),
    mistakes: [],
    chartUrl: 'https://www.tradingview.com/chart/',
  },
  {
    id: 't-7',
    accountId: 'acc-live',
    symbol: 'AUDUSD',
    direction: 'long',
    strategy: 'Asia range fade',
    strategyVersion: 'v1',
    closedAt: '2026-07-27T04:30:00+00:00',
    systemOutcome: 'loss',
    actualOutcome: 'loss',
    systemR: '-1.0000',
    actualR: '-1.8000',
    net: usd(-36000n),
    mistakes: ['Oversized', 'Revenge trade'],
  },
  {
    id: 't-8',
    accountId: 'acc-swing',
    symbol: 'XAUUSD',
    direction: 'short',
    strategy: 'Momentum continuation',
    strategyVersion: 'v4',
    closedAt: '2026-07-26T16:10:00+00:00',
    systemOutcome: 'win',
    actualOutcome: 'win',
    systemR: '1.2000',
    actualR: '0.5000',
    net: usd(10000n),
    mistakes: ['Chased entry'],
  },
  {
    id: 't-9',
    accountId: 'acc-prop',
    symbol: 'GBPJPY',
    direction: 'long',
    strategy: 'London breakout',
    strategyVersion: 'v3',
    closedAt: '2026-07-24T08:45:00+00:00',
    systemOutcome: 'win',
    actualOutcome: 'win',
    systemR: '2.6000',
    actualR: '1.1000',
    net: usd(22000n),
    mistakes: ['Exited early'],
  },
  {
    id: 't-10',
    accountId: 'acc-swing',
    symbol: 'US30',
    direction: 'short',
    strategy: 'New York reversal',
    strategyVersion: 'v2',
    closedAt: '2026-07-23T19:25:00+00:00',
    systemOutcome: 'loss',
    actualOutcome: 'loss',
    systemR: '-1.0000',
    actualR: '-1.0000',
    net: usd(-20000n),
    mistakes: [],
  },
];

const BUNDLE_ALL: DemoBundle = {
  range: 'all',
  closedTrades: 90,
  netPnl: usd(418250n),
  attribution: {
    systemWinRatePct: '48.9',
    actualWinRatePct: '41.1',
    systemAvgR: '0.42',
    actualAvgR: '0.11',
    systemExpectancyR: '0.42',
    actualExpectancyR: '0.11',
    systemProfitFactor: '2.35',
    actualProfitFactor: '1.28',
    systemTotalR: '37.8',
    actualTotalR: '9.9',
    systemMaxDrawdownR: '4.2',
    actualMaxDrawdownR: '4.9',
    executionGapR: '-27.9',
    executionEfficiencyPct: '26.2',
    disciplineScore: '68',
  },
  equityCurve: [
    { label: 'W1', systemR: '0.0', actualR: '0.0' },
    { label: 'W2', systemR: '1.8', actualR: '1.2' },
    { label: 'W3', systemR: '3.4', actualR: '2.1' },
    { label: 'W4', systemR: '2.9', actualR: '0.8' },
    { label: 'W5', systemR: '5.2', actualR: '2.6' },
    { label: 'W6', systemR: '7.1', actualR: '3.9' },
    { label: 'W7', systemR: '6.4', actualR: '2.2' },
    { label: 'W8', systemR: '9.0', actualR: '4.1' },
    { label: 'W9', systemR: '11.3', actualR: '5.6' },
    { label: 'W10', systemR: '10.1', actualR: '3.4' },
    { label: 'W11', systemR: '13.2', actualR: '5.0' },
    { label: 'W12', systemR: '15.6', actualR: '6.3' },
    { label: 'W13', systemR: '14.8', actualR: '4.1' },
    { label: 'W14', systemR: '17.9', actualR: '5.8' },
    { label: 'W15', systemR: '20.4', actualR: '7.2' },
    { label: 'W16', systemR: '19.1', actualR: '5.1' },
    { label: 'W17', systemR: '22.6', actualR: '6.4' },
    { label: 'W18', systemR: '25.3', actualR: '7.9' },
    { label: 'W19', systemR: '24.0', actualR: '5.6' },
    { label: 'W20', systemR: '27.8', actualR: '6.8' },
    { label: 'W21', systemR: '30.5', actualR: '8.2' },
    { label: 'W22', systemR: '29.2', actualR: '6.1' },
    { label: 'W23', systemR: '33.6', actualR: '8.4' },
    { label: 'W24', systemR: '35.9', actualR: '9.3' },
    { label: 'W25', systemR: '37.8', actualR: '9.9' },
  ],
  mistakes: [
    { id: 'moved-stop', label: 'Moved stop', severity: 'severe', occurrences: 11, costR: '8.4' },
    {
      id: 'early-exit',
      label: 'Exited early',
      severity: 'moderate',
      occurrences: 14,
      costR: '7.1',
    },
    { id: 'oversized', label: 'Oversized', severity: 'severe', occurrences: 6, costR: '5.2' },
    { id: 'revenge', label: 'Revenge trade', severity: 'severe', occurrences: 4, costR: '4.8' },
    { id: 'chased', label: 'Chased entry', severity: 'minor', occurrences: 9, costR: '2.4' },
  ],
};

const BUNDLE_90D: DemoBundle = {
  range: '90d',
  closedTrades: 62,
  netPnl: usd(294600n),
  attribution: {
    systemWinRatePct: '50.0',
    actualWinRatePct: '41.9',
    systemAvgR: '0.43',
    actualAvgR: '0.11',
    systemExpectancyR: '0.43',
    actualExpectancyR: '0.11',
    systemProfitFactor: '2.28',
    actualProfitFactor: '1.22',
    systemTotalR: '26.4',
    actualTotalR: '7.1',
    systemMaxDrawdownR: '3.6',
    actualMaxDrawdownR: '3.8',
    executionGapR: '-19.3',
    executionEfficiencyPct: '26.9',
    disciplineScore: '71',
  },
  equityCurve: [
    { label: 'W1', systemR: '0.0', actualR: '0.0' },
    { label: 'W2', systemR: '2.1', actualR: '1.4' },
    { label: 'W3', systemR: '4.0', actualR: '2.3' },
    { label: 'W4', systemR: '3.2', actualR: '1.1' },
    { label: 'W5', systemR: '6.4', actualR: '2.8' },
    { label: 'W6', systemR: '8.9', actualR: '3.6' },
    { label: 'W7', systemR: '7.8', actualR: '2.0' },
    { label: 'W8', systemR: '11.4', actualR: '3.4' },
    { label: 'W9', systemR: '14.2', actualR: '4.6' },
    { label: 'W10', systemR: '12.9', actualR: '2.9' },
    { label: 'W11', systemR: '17.1', actualR: '4.4' },
    { label: 'W12', systemR: '20.3', actualR: '5.7' },
    { label: 'W13', systemR: '23.0', actualR: '6.2' },
    { label: 'W14', systemR: '26.4', actualR: '7.1' },
  ],
  mistakes: [
    { id: 'moved-stop', label: 'Moved stop', severity: 'severe', occurrences: 8, costR: '6.1' },
    {
      id: 'early-exit',
      label: 'Exited early',
      severity: 'moderate',
      occurrences: 10,
      costR: '5.0',
    },
    { id: 'oversized', label: 'Oversized', severity: 'severe', occurrences: 4, costR: '3.6' },
    { id: 'revenge', label: 'Revenge trade', severity: 'severe', occurrences: 3, costR: '3.1' },
    { id: 'chased', label: 'Chased entry', severity: 'minor', occurrences: 6, costR: '1.5' },
  ],
};

const BUNDLE_30D: DemoBundle = {
  range: '30d',
  closedTrades: 24,
  netPnl: usd(118450n),
  attribution: {
    systemWinRatePct: '50.0',
    actualWinRatePct: '41.7',
    systemAvgR: '0.47',
    actualAvgR: '0.12',
    systemExpectancyR: '0.47',
    actualExpectancyR: '0.12',
    systemProfitFactor: '2.41',
    actualProfitFactor: '1.19',
    systemTotalR: '11.2',
    actualTotalR: '2.8',
    systemMaxDrawdownR: '2.4',
    actualMaxDrawdownR: '2.6',
    executionGapR: '-8.4',
    executionEfficiencyPct: '25.0',
    disciplineScore: '74',
  },
  equityCurve: [
    { label: 'W1', systemR: '0.0', actualR: '0.0' },
    { label: 'W2', systemR: '2.4', actualR: '1.1' },
    { label: 'W3', systemR: '4.6', actualR: '1.9' },
    { label: 'W4', systemR: '3.9', actualR: '0.6' },
    { label: 'W5', systemR: '6.8', actualR: '1.7' },
    { label: 'W6', systemR: '9.1', actualR: '2.4' },
    { label: 'W7', systemR: '8.2', actualR: '1.2' },
    { label: 'W8', systemR: '11.2', actualR: '2.8' },
  ],
  mistakes: [
    { id: 'moved-stop', label: 'Moved stop', severity: 'severe', occurrences: 3, costR: '2.6' },
    { id: 'early-exit', label: 'Exited early', severity: 'moderate', occurrences: 5, costR: '2.2' },
    { id: 'oversized', label: 'Oversized', severity: 'severe', occurrences: 2, costR: '1.6' },
    { id: 'revenge', label: 'Revenge trade', severity: 'severe', occurrences: 1, costR: '1.3' },
    { id: 'chased', label: 'Chased entry', severity: 'minor', occurrences: 3, costR: '0.7' },
  ],
};

export const DEMO_BUNDLES: Readonly<Record<DemoRangeId, DemoBundle>> = {
  '30d': BUNDLE_30D,
  '90d': BUNDLE_90D,
  all: BUNDLE_ALL,
};

export function demoBundle(range: DemoRangeId): DemoBundle {
  return DEMO_BUNDLES[range];
}

/** `'all'` is the combined view, so it filters nothing. */
export function demoTradesForAccount(accountId: string): readonly DemoTrade[] {
  if (accountId === 'all') {
    return DEMO_TRADES;
  }
  return DEMO_TRADES.filter((trade) => trade.accountId === accountId);
}
