/**
 * PROTOTYPE FIXTURES — fictional trades, for visual review only.
 *
 * Nothing here touches the database, the DAL, the calculation engine or the
 * canonical `trades` schema. These are hand-authored records shaped to
 * exercise every presentation state the redesigned Trade Log has to survive:
 * the ordinary win, the large signed amount, the price-only Trade with no
 * money, the partially-closed position, the legacy record, the long strategy
 * name, and the second currency.
 *
 * The NUMBERS are already-resolved figures, exactly as a real row arrives at
 * the table from the DAL — `net_pnl_minor` as a minor-unit string and
 * `actual_r` as a NUMERIC string. This file never divides, sums or averages,
 * for the same reason the production table does not: R is the Trade's own
 * canonical figure, and a prototype that recomputed it would be showing a
 * second, unverified arithmetic.
 */

export type Direction = 'long' | 'short';

/** Lifecycle as the redesigned Status column presents it (spec §C). */
export type Lifecycle = 'open' | 'partially_closed' | 'closed' | 'needs_details' | 'canceled';

/** Canonical actual outcome. `unresolved` is a closed Trade whose result is not classifiable. */
export type ActualOutcome = 'win' | 'loss' | 'break_even' | 'unresolved';

/**
 * The independent system record. `pending` is UNAVAILABLE, never zero, and is
 * never inferred from the actual exit (spec §H).
 */
export type SystemState = 'pending' | 'resolved' | 'no_trade';

export type RecordingBasis = 'money' | 'price';

export type ConditionState = 'met' | 'not_met' | 'unknown';

export interface PrototypeExit {
  readonly sequence: number;
  /** Percent of the ORIGINAL position, two decimals. */
  readonly percent: string;
  readonly netPnlMinor: string | null;
  readonly exitPrice: string | null;
  readonly at: string;
  /** The leg carries no explicitly entered time and falls back to the final exit time. */
  readonly usesFinalExitTime?: boolean;
  readonly reason?: string;
}

export interface PrototypeCondition {
  readonly label: string;
  readonly state: ConditionState;
}

export interface PrototypeTrade {
  readonly id: string;
  readonly symbol: string;
  readonly direction: Direction;
  readonly accountName: string;
  readonly currency: string;

  readonly lifecycle: Lifecycle;
  /** `null` while the position is open — a Trade with no settled result has no outcome. */
  readonly outcome: ActualOutcome | null;

  /** Locale-formatted activity date, e.g. `7 Sep 2026`. */
  readonly activityDate: string;
  /** `Closed 14:32` / `Opened 09:10` — the second line of the Activity column. */
  readonly activityTime: string;
  /** `7 Sep, 14:32` — the mobile row's compact form. */
  readonly activityShort: string;

  /**
   * Full opening / closing instants, for Trade details.
   *
   * SEPARATE FROM `activity*`, which is ONE instant — the exit for a closed
   * trade, the entry for an open one. Details needs both, and deriving the
   * missing one from the activity line printed the same timestamp in both
   * slots, which reads as a zero-duration trade rather than as a gap in the
   * fixture. `null` renders the panel's ordinary unavailable dash.
   */
  readonly enteredAt: string | null;
  readonly exitedAt: string | null;

  /**
   * The entry context was recalled after the result was known.
   *
   * A FACT ABOUT THE RECORD, not something to be guessed from the lifecycle. A
   * closed trade whose confidence was captured at entry must not be labelled
   * "Recorded after the trade" merely because it has since closed.
   */
  readonly contextRecalled: boolean;

  /** Account-currency minor units, or `null` when money was never recorded. */
  readonly netPnlMinor: string | null;
  /** Canonical R as a NUMERIC string, or `null` when unavailable. */
  readonly actualR: string | null;
  /** Basis points of the original position that are closed. 10000 = fully closed. */
  readonly closedBps: number;

  readonly strategy: string | null;
  readonly setup: string | null;

  readonly systemState: SystemState;
  readonly systemR: string | null;
  readonly systemOutcome: string | null;

  readonly hasReviewNote: boolean;
  readonly reviewNote: string | null;

  readonly actualBasis: RecordingBasis;
  readonly actualRiskMinor: string | null;
  readonly entryPrice: string | null;
  readonly initialStop: string | null;
  readonly exitPrice: string | null;
  readonly positionSize: string | null;

  /** The ORIGINAL plan. `null` is a legitimate, fully saveable state (spec §G). */
  readonly plan: {
    readonly basis: RecordingBasis;
    readonly riskMinor: string | null;
    readonly rewardMinor: string | null;
    readonly plannedR: string | null;
    readonly entry: string | null;
    readonly stop: string | null;
    readonly target: string | null;
  } | null;

  readonly costs: {
    readonly commissionMinor: string;
    readonly feesMinor: string;
    readonly swapMinor: string;
  } | null;

  /** 0 / 25 / 50 / 75 / 100, mapping exactly to the existing stored values. `null` is Not recorded. */
  readonly confidence: number | null;
  /** `null` = never answered. `[]` = the explicit "None of these". */
  readonly emotions: readonly string[] | null;

  readonly entryReason: string | null;
  readonly notes: string | null;
  readonly chartUrl: string | null;

  readonly mistakes: readonly string[];
  /** The SETUP's own checklist — shown with the Setup it belongs to. */
  readonly conditions: readonly PrototypeCondition[];
  /**
   * The STRATEGY's execution rules — a different question from a setup's entry
   * checklist, and reviewed in a different place. A setup condition asks "was
   * this true when I entered?"; an execution rule asks "did I manage the trade
   * the way the system says to?".
   */
  readonly executionRules: readonly PrototypeCondition[];
  readonly exits: readonly PrototypeExit[];

  /** A record created before the current contract; details are genuinely missing. */
  readonly legacy: boolean;
}

const BASE: PrototypeTrade = {
  id: '',
  symbol: '',
  direction: 'long',
  accountName: 'Live · FTMO 100K',
  currency: 'USD',
  lifecycle: 'closed',
  outcome: 'win',
  activityDate: '7 Sep 2026',
  activityTime: 'Closed 14:32',
  activityShort: '7 Sep, 14:32',
  enteredAt: null,
  exitedAt: null,
  contextRecalled: false,
  netPnlMinor: null,
  actualR: null,
  closedBps: 10000,
  strategy: null,
  setup: null,
  systemState: 'pending',
  systemR: null,
  systemOutcome: null,
  hasReviewNote: false,
  reviewNote: null,
  actualBasis: 'money',
  actualRiskMinor: null,
  entryPrice: null,
  initialStop: null,
  exitPrice: null,
  positionSize: null,
  plan: null,
  costs: null,
  confidence: null,
  emotions: null,
  entryReason: null,
  notes: null,
  chartUrl: null,
  mistakes: [],
  conditions: [],
  executionRules: [],
  exits: [],
  legacy: false,
};

function trade(
  overrides: Partial<PrototypeTrade> & { id: string; symbol: string },
): PrototypeTrade {
  return { ...BASE, ...overrides };
}

/**
 * One page of the journal — 25 records, matching the retained page size.
 *
 * Ordered by Newest activity, the default sort, so the list a reviewer sees is
 * the list the default scope produces rather than a curated showcase order.
 */
export const PROTOTYPE_TRADES: readonly PrototypeTrade[] = [
  trade({
    id: 't-01',
    enteredAt: '7 Sep 2026, 09:41',
    exitedAt: '7 Sep 2026, 14:32',
    symbol: 'XAUUSD',
    direction: 'long',
    activityDate: '7 Sep 2026',
    activityTime: 'Closed 14:32',
    activityShort: '7 Sep, 14:32',
    outcome: 'win',
    netPnlMinor: '42000',
    actualR: '2.1000',
    actualRiskMinor: '20000',
    strategy: 'Elliott Wave',
    setup: 'Wave 3 Continuation',
    systemState: 'pending',
    entryPrice: '3421.4500',
    initialStop: '3412.2000',
    exitPrice: '3440.8000',
    positionSize: '2.0000',
    plan: {
      basis: 'money',
      riskMinor: '20000',
      rewardMinor: '100000',
      plannedR: '5.0000',
      entry: null,
      stop: null,
      target: null,
    },
    costs: { commissionMinor: '1400', feesMinor: '0', swapMinor: '-320' },
    confidence: 75,
    emotions: ['calm', 'focused'],
    entryReason:
      'Third push out of the London range with the 4H trend. Waited for the 15m close back above 3420 rather than anticipating it.',
    notes:
      'Size was correct. Took profit into the New York open instead of holding for the measured move.',
    chartUrl: 'https://www.tradingview.com/x/2fJk9Qha/',
    executionRules: [
      { label: 'Stop left at its initial level', state: 'met' },
      { label: 'No size added after entry', state: 'met' },
      { label: 'Exited on the rule, not on feel', state: 'unknown' },
    ],
    conditions: [
      { label: 'Higher-timeframe trend aligned', state: 'met' },
      { label: 'Wave 2 retracement held above 50%', state: 'met' },
      { label: 'Entry taken on a closed candle', state: 'unknown' },
      { label: 'Risk at or below 1% of account', state: 'met' },
    ],
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: '42000',
        exitPrice: '3440.8000',
        at: '7 Sep 2026, 14:32',
      },
    ],
  }),
  trade({
    id: 't-02',
    enteredAt: '6 Sep 2026, 18:52',
    exitedAt: '6 Sep 2026, 21:10',
    symbol: 'BTCUSD',
    direction: 'short',
    activityDate: '6 Sep 2026',
    activityTime: 'Closed 21:10',
    activityShort: '6 Sep, 21:10',
    outcome: 'loss',
    netPnlMinor: '-8500',
    actualR: '-1.0000',
    actualRiskMinor: '8500',
    systemState: 'pending',
    entryPrice: '111420.00',
    initialStop: '112900.00',
    exitPrice: '112900.00',
    confidence: 25,
    emotions: ['fomo'],
    entryReason: 'Shorted into the weekend without a level. No setup — I wanted a trade.',
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: '-8500',
        exitPrice: '112900.00',
        at: '6 Sep 2026, 21:10',
      },
    ],
  }),
  trade({
    id: 't-03',
    enteredAt: '6 Sep 2026, 16:05',
    symbol: 'NAS100',
    direction: 'short',
    lifecycle: 'open',
    outcome: null,
    activityDate: '6 Sep 2026',
    activityTime: 'Opened 16:05',
    activityShort: '6 Sep, 16:05',
    netPnlMinor: null,
    actualR: null,
    closedBps: 0,
    strategy: 'Opening Range Fade',
    setup: 'First 30-minute failure',
    systemState: 'pending',
    actualRiskMinor: '25000',
    entryPrice: '24118.50',
    initialStop: '24196.00',
    plan: {
      basis: 'money',
      riskMinor: '25000',
      rewardMinor: '62500',
      plannedR: '2.5000',
      entry: null,
      stop: null,
      target: null,
    },
    confidence: 50,
    emotions: [],
    entryReason: 'Gap failed to hold the prior high in the first 30 minutes.',
  }),
  trade({
    id: 't-04',
    enteredAt: '5 Sep 2026, 09:12',
    symbol: 'XAUUSD',
    direction: 'long',
    lifecycle: 'partially_closed',
    outcome: null,
    activityDate: '5 Sep 2026',
    activityTime: 'Opened 09:12',
    activityShort: '5 Sep, 09:12',
    netPnlMinor: '18000',
    actualR: '0.9000',
    closedBps: 4000,
    strategy: 'Elliott Wave',
    setup: 'Wave 3 Continuation',
    systemState: 'pending',
    actualRiskMinor: '20000',
    entryPrice: '3402.1000',
    initialStop: '3392.6000',
    positionSize: '2.0000',
    plan: {
      basis: 'money',
      riskMinor: '20000',
      rewardMinor: '80000',
      plannedR: '4.0000',
      entry: null,
      stop: null,
      target: null,
    },
    confidence: 75,
    emotions: ['calm'],
    entryReason: 'Continuation off the Asian session low, with the daily trend.',
    exits: [
      {
        sequence: 1,
        percent: '40.00',
        netPnlMinor: '18000',
        exitPrice: '3421.0000',
        at: '5 Sep 2026, 13:44',
        reason: 'First target',
      },
    ],
  }),
  trade({
    id: 't-05',
    enteredAt: '4 Sep 2026, 15:20',
    exitedAt: '4 Sep 2026, 20:58',
    symbol: 'US30',
    direction: 'long',
    activityDate: '4 Sep 2026',
    activityTime: 'Closed 20:58',
    activityShort: '4 Sep, 20:58',
    outcome: 'win',
    netPnlMinor: '1248000',
    actualR: '6.2400',
    actualRiskMinor: '200000',
    strategy: 'Institutional Order Flow Continuation',
    setup: 'London open sweep and reclaim of the prior day low',
    systemState: 'resolved',
    systemR: '4.8000',
    systemOutcome: 'Target reached',
    plan: {
      basis: 'money',
      riskMinor: '200000',
      rewardMinor: '960000',
      plannedR: '4.8000',
      entry: null,
      stop: null,
      target: null,
    },
    costs: { commissionMinor: '4200', feesMinor: '0', swapMinor: '0' },
    confidence: 100,
    emotions: ['calm', 'focused'],
    entryReason:
      'Sweep of the prior day low, reclaimed within two candles, then continuation into the New York session.',
    chartUrl: 'https://www.tradingview.com/x/8kQm2Wpa/',
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: '1248000',
        exitPrice: '46812.00',
        at: '4 Sep 2026, 20:58',
      },
    ],
  }),
  trade({
    id: 't-06',
    enteredAt: '4 Sep 2026, 08:05',
    exitedAt: '4 Sep 2026, 11:20',
    symbol: 'EURUSD',
    direction: 'short',
    activityDate: '4 Sep 2026',
    activityTime: 'Closed 11:20',
    activityShort: '4 Sep, 11:20',
    outcome: 'win',
    netPnlMinor: null,
    actualR: '1.3500',
    actualBasis: 'price',
    strategy: 'Price Action',
    setup: 'Liquidity sweep',
    systemState: 'pending',
    entryPrice: '1.16420',
    initialStop: '1.16780',
    exitPrice: '1.15934',
    plan: {
      basis: 'price',
      riskMinor: null,
      rewardMinor: null,
      plannedR: '2.0000',
      entry: '1.16420',
      stop: '1.16780',
      target: '1.15700',
    },
    confidence: 50,
    entryReason: 'Swept the Asian high and closed back inside the range.',
    notes: 'Recorded from prices only — no broker statement for this account.',
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: null,
        exitPrice: '1.15934',
        at: '4 Sep 2026, 11:20',
      },
    ],
  }),
  trade({
    id: 't-07',
    enteredAt: '3 Sep 2026, 16:30',
    exitedAt: '3 Sep 2026, 23:41',
    contextRecalled: true,
    symbol: 'BTCUSD',
    direction: 'long',
    activityDate: '3 Sep 2026',
    activityTime: 'Closed 23:41',
    activityShort: '3 Sep, 23:41',
    outcome: 'loss',
    netPnlMinor: '-427550',
    actualR: '-3.1500',
    actualRiskMinor: '135730',
    strategy: 'Mean Reversion',
    setup: 'Deviation band',
    systemState: 'resolved',
    systemR: '-1.0000',
    systemOutcome: 'Stop reached',
    hasReviewNote: true,
    reviewNote:
      'Moved the stop twice. The system took one stop; I took three. Repeat: no manual stop moves below the entry candle.',
    executionRules: [
      { label: 'Stop left at its initial level', state: 'not_met' },
      { label: 'No size added after entry', state: 'not_met' },
      { label: 'Exited on the rule, not on feel', state: 'not_met' },
    ],
    mistakes: ['Moved stop', 'Averaged down'],
    plan: {
      basis: 'money',
      riskMinor: '135730',
      rewardMinor: '271460',
      plannedR: '2.0000',
      entry: null,
      stop: null,
      target: null,
    },
    confidence: 25,
    emotions: ['frustrated', 'revenge'],
    entryReason: 'Two standard deviations below the 20 EMA on the 4H.',
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: '-427550',
        exitPrice: '104120.00',
        at: '3 Sep 2026, 23:41',
      },
    ],
  }),
  trade({
    id: 't-08',
    symbol: 'GBPJPY',
    direction: 'long',
    lifecycle: 'needs_details',
    outcome: null,
    activityDate: '3 Sep 2026',
    activityTime: 'Opened 08:00',
    activityShort: '3 Sep, 08:00',
    netPnlMinor: null,
    actualR: null,
    closedBps: 0,
    systemState: 'pending',
    legacy: true,
    notes: 'Imported from the old spreadsheet.',
  }),
  trade({
    id: 't-09',
    enteredAt: '2 Sep 2026, 14:02',
    exitedAt: '2 Sep 2026, 19:26',
    contextRecalled: true,
    symbol: 'XAUUSD',
    direction: 'short',
    accountName: 'Personal · Thai broker',
    currency: 'THB',
    activityDate: '2 Sep 2026',
    activityTime: 'Closed 19:26',
    activityShort: '2 Sep, 19:26',
    outcome: 'loss',
    netPnlMinor: '-325000',
    actualR: '-1.0000',
    actualRiskMinor: '325000',
    strategy: 'Elliott Wave',
    setup: 'Wave C exhaustion',
    systemState: 'resolved',
    systemR: '-1.0000',
    systemOutcome: 'Stop reached',
    hasReviewNote: true,
    reviewNote: 'System stop and my stop were the same. Nothing to change.',
    confidence: 50,
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: '-325000',
        exitPrice: '3388.4000',
        at: '2 Sep 2026, 19:26',
      },
    ],
  }),
  trade({
    id: 't-10',
    enteredAt: '2 Sep 2026, 13:35',
    exitedAt: '2 Sep 2026, 15:03',
    symbol: 'EURUSD',
    direction: 'long',
    activityDate: '2 Sep 2026',
    activityTime: 'Closed 15:03',
    activityShort: '2 Sep, 15:03',
    outcome: 'break_even',
    netPnlMinor: '200',
    actualR: '0.0200',
    actualRiskMinor: '10000',
    strategy: 'London Session Reversal',
    setup: 'Failed breakout of the Asian range',
    systemState: 'resolved',
    systemR: '1.0000',
    systemOutcome: 'Target reached',
    hasReviewNote: true,
    reviewNote: 'Scratched it at the first pullback. The system held to target.',
    confidence: 50,
    emotions: ['hesitant'],
    exits: [
      {
        sequence: 1,
        percent: '100.00',
        netPnlMinor: '200',
        exitPrice: '1.16031',
        at: '2 Sep 2026, 15:03',
      },
    ],
  }),
  trade({
    id: 't-11',
    symbol: 'SOLUSD',
    direction: 'long',
    activityDate: '1 Sep 2026',
    activityTime: 'Closed 22:15',
    activityShort: '1 Sep, 22:15',
    outcome: 'win',
    netPnlMinor: '6420',
    actualR: '0.6400',
    actualRiskMinor: '10000',
    systemState: 'resolved',
    systemR: '2.0000',
    systemOutcome: 'Target reached',
    hasReviewNote: true,
    reviewNote: 'Closed early on a wick. The rule was to hold to the level.',
  }),
  trade({
    id: 't-12',
    enteredAt: '1 Sep 2026, 10:48',
    symbol: 'ETHUSD',
    direction: 'short',
    lifecycle: 'partially_closed',
    outcome: null,
    activityDate: '1 Sep 2026',
    activityTime: 'Opened 10:48',
    activityShort: '1 Sep, 10:48',
    netPnlMinor: '-12000',
    actualR: '-0.6000',
    closedBps: 6500,
    strategy: 'Mean Reversion',
    setup: 'Deviation band',
    systemState: 'pending',
    actualRiskMinor: '20000',
    entryPrice: '4128.50',
    initialStop: '4212.00',
    exits: [
      {
        sequence: 1,
        percent: '25.00',
        netPnlMinor: '-4000',
        exitPrice: '4155.00',
        at: '1 Sep 2026, 12:02',
      },
      {
        sequence: 2,
        percent: '40.00',
        netPnlMinor: '-8000',
        exitPrice: '4162.40',
        at: '1 Sep 2026, 16:30',
      },
    ],
  }),
  trade({
    id: 't-13',
    symbol: 'NAS100',
    direction: 'long',
    lifecycle: 'canceled',
    outcome: null,
    activityDate: '31 Aug 2026',
    activityTime: 'Opened 14:30',
    activityShort: '31 Aug, 14:30',
    netPnlMinor: null,
    actualR: null,
    closedBps: 0,
    strategy: 'Opening Range Fade',
    setup: 'First 30-minute failure',
    systemState: 'pending',
    notes: 'Entry never filled.',
  }),
  trade({
    id: 't-14',
    symbol: 'USDJPY',
    direction: 'short',
    activityDate: '31 Aug 2026',
    activityTime: 'Closed 13:12',
    activityShort: '31 Aug, 13:12',
    outcome: 'unresolved',
    netPnlMinor: null,
    actualR: null,
    strategy: 'Price Action',
    systemState: 'pending',
    legacy: true,
  }),
  trade({
    id: 't-15',
    symbol: 'BTCUSD',
    direction: 'short',
    accountName: 'Personal · Thai broker',
    currency: 'THB',
    activityDate: '30 Aug 2026',
    activityTime: 'Closed 18:44',
    activityShort: '30 Aug, 18:44',
    outcome: 'win',
    netPnlMinor: '1860000',
    actualR: '2.4800',
    actualRiskMinor: '750000',
    strategy: 'Institutional Order Flow Continuation',
    setup: 'London open sweep and reclaim of the prior day low',
    systemState: 'resolved',
    systemR: '3.0000',
    systemOutcome: 'Target reached',
    hasReviewNote: true,
    reviewNote: 'Took two thirds of the move. Acceptable.',
    confidence: 75,
  }),
  trade({
    id: 't-16',
    symbol: 'XAUUSD',
    direction: 'long',
    lifecycle: 'open',
    outcome: null,
    activityDate: '30 Aug 2026',
    activityTime: 'Opened 07:55',
    activityShort: '30 Aug, 07:55',
    netPnlMinor: null,
    actualR: null,
    closedBps: 0,
    systemState: 'pending',
    actualRiskMinor: '15000',
  }),
  trade({
    id: 't-17',
    symbol: 'NAS100',
    direction: 'short',
    activityDate: '29 Aug 2026',
    activityTime: 'Closed 17:02',
    activityShort: '29 Aug, 17:02',
    outcome: 'win',
    netPnlMinor: '91500',
    actualR: '1.8300',
    actualRiskMinor: '50000',
    strategy: 'Elliott Wave',
    setup: 'Wave 3 Continuation',
    systemState: 'resolved',
    systemR: '1.8300',
    systemOutcome: 'Target reached',
    hasReviewNote: true,
    reviewNote: 'Followed the plan exactly.',
    confidence: 75,
  }),
  trade({
    id: 't-18',
    symbol: 'EURUSD',
    direction: 'long',
    activityDate: '29 Aug 2026',
    activityTime: 'Closed 09:40',
    activityShort: '29 Aug, 09:40',
    outcome: 'break_even',
    netPnlMinor: '0',
    actualR: '0.0000',
    actualRiskMinor: '10000',
    strategy: 'London Session Reversal',
    setup: 'Failed breakout of the Asian range',
    systemState: 'no_trade',
    systemOutcome: 'System would not enter',
    hasReviewNote: true,
    reviewNote: 'The system had no signal here. This one was mine.',
    mistakes: ['Traded outside the plan'],
  }),
  trade({
    id: 't-19',
    symbol: 'XAUUSD',
    direction: 'short',
    activityDate: '28 Aug 2026',
    activityTime: 'Closed 20:11',
    activityShort: '28 Aug, 20:11',
    outcome: 'loss',
    netPnlMinor: '-20000',
    actualR: '-1.0000',
    actualRiskMinor: '20000',
    strategy: 'Elliott Wave',
    setup: 'Wave C exhaustion',
    systemState: 'pending',
    confidence: 0,
    emotions: ['fearful'],
  }),
  trade({
    id: 't-20',
    symbol: 'US30',
    direction: 'short',
    activityDate: '28 Aug 2026',
    activityTime: 'Closed 15:35',
    activityShort: '28 Aug, 15:35',
    outcome: 'win',
    netPnlMinor: '63400',
    actualR: '3.1700',
    actualRiskMinor: '20000',
    systemState: 'resolved',
    systemR: '3.1700',
    systemOutcome: 'Target reached',
    hasReviewNote: true,
    reviewNote: 'Clean.',
  }),
  trade({
    id: 't-21',
    symbol: 'EURUSD',
    direction: 'short',
    activityDate: '27 Aug 2026',
    activityTime: 'Closed 14:08',
    activityShort: '27 Aug, 14:08',
    outcome: 'loss',
    netPnlMinor: '-10000',
    actualR: '-1.0000',
    actualRiskMinor: '10000',
    strategy: 'Price Action',
    setup: 'Liquidity sweep',
    systemState: 'resolved',
    systemR: '-1.0000',
    systemOutcome: 'Stop reached',
    hasReviewNote: true,
    reviewNote: 'Same stop as the system. No gap.',
  }),
  trade({
    id: 't-22',
    symbol: 'BTCUSD',
    direction: 'long',
    activityDate: '27 Aug 2026',
    activityTime: 'Closed 02:19',
    activityShort: '27 Aug, 02:19',
    outcome: 'win',
    netPnlMinor: '215000',
    actualR: '2.1500',
    actualRiskMinor: '100000',
    strategy: 'Mean Reversion',
    setup: 'Deviation band',
    systemState: 'pending',
    confidence: 75,
  }),
  trade({
    id: 't-23',
    symbol: 'NAS100',
    direction: 'long',
    activityDate: '26 Aug 2026',
    activityTime: 'Closed 19:47',
    activityShort: '26 Aug, 19:47',
    outcome: 'loss',
    netPnlMinor: '-50000',
    actualR: '-1.0000',
    actualRiskMinor: '50000',
    systemState: 'resolved',
    systemR: '2.0000',
    systemOutcome: 'Target reached',
  }),
  trade({
    id: 't-24',
    symbol: 'XAUUSD',
    direction: 'long',
    activityDate: '26 Aug 2026',
    activityTime: 'Closed 10:22',
    activityShort: '26 Aug, 10:22',
    outcome: 'win',
    netPnlMinor: '31500',
    actualR: '1.5700',
    actualRiskMinor: '20000',
    strategy: 'Elliott Wave',
    setup: 'Wave 3 Continuation',
    systemState: 'resolved',
    systemR: '1.5700',
    systemOutcome: 'Target reached',
    hasReviewNote: true,
    reviewNote: 'Held to the level.',
  }),
  trade({
    id: 't-25',
    symbol: 'ETHUSD',
    direction: 'long',
    activityDate: '25 Aug 2026',
    activityTime: 'Closed 21:03',
    activityShort: '25 Aug, 21:03',
    outcome: 'break_even',
    netPnlMinor: '-150',
    actualR: '-0.0150',
    actualRiskMinor: '10000',
    strategy: 'Price Action',
    setup: 'Liquidity sweep',
    systemState: 'pending',
  }),
];

export function findTrade(id: string | null): PrototypeTrade | null {
  if (id === null) return null;
  return PROTOTYPE_TRADES.find((candidate) => candidate.id === id) ?? null;
}

/**
 * The scope's own counts.
 *
 * Stated as data rather than derived from the 25 visible rows, because the
 * summary contract counts the WHOLE matching population across every page and
 * the prototype holds one page of it (spec §C, "Summary contract").
 */
export const PROTOTYPE_SCOPE = {
  totalMatching: 124,
  closedEligible: 98,
  openCount: 8,
  partiallyClosedCount: 3,
  pageFrom: 1,
  pageTo: 25,
  netPnlMinor: '124000',
  totalR: '12.4000',
  currency: 'USD',
} as const;

export const PROTOTYPE_ACCOUNTS = [
  { id: 'a-1', name: 'Live · FTMO 100K', currency: 'USD' },
  { id: 'a-2', name: 'Personal · Thai broker', currency: 'THB' },
] as const;

export const PROTOTYPE_STRATEGIES = [
  { name: 'Elliott Wave', setups: ['Wave 3 Continuation', 'Wave C exhaustion'] },
  { name: 'London Session Reversal', setups: ['Failed breakout of the Asian range'] },
  { name: 'Mean Reversion', setups: ['Deviation band'] },
  { name: 'Price Action', setups: ['Liquidity sweep'] },
  {
    name: 'Institutional Order Flow Continuation',
    setups: ['London open sweep and reclaim of the prior day low'],
  },
] as const;

export const PROTOTYPE_TIMEZONE = 'Asia/Bangkok · GMT+7';
