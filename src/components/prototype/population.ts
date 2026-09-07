/**
 * THE REST OF THE JOURNAL — 99 older records behind the authored 25.
 *
 * The redesign's retrieval contract is explicit that search, counts and
 * summaries describe the WHOLE matching population rather than the loaded page
 * (spec §C), and that a symbol on page 20 must be findable without walking
 * pages 1 through 19 (§N.3). A 25-row fixture cannot show whether that reads
 * correctly; 124 can.
 *
 * These rows are GENERATED rather than authored, deterministically, from a
 * seeded sequence — so the population is identical on every render and in every
 * screenshot, and so nobody mistakes them for hand-designed content. The
 * authored 25 in `fixtures.ts` are the ones the composition was designed
 * against; these fill the history behind them.
 */

import { PROTOTYPE_TRADES, type PrototypeTrade } from './fixtures';

/** mulberry32 — small, deterministic, and adequate for arranging fixture rows. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYMBOLS = ['XAUUSD', 'BTCUSD', 'EURUSD', 'NAS100', 'US30', 'ETHUSD', 'GBPJPY', 'USDJPY'];

const CLASSIFICATIONS: readonly (readonly [string, string])[] = [
  ['Elliott Wave', 'Wave 3 Continuation'],
  ['Elliott Wave', 'Wave C exhaustion'],
  ['London Session Reversal', 'Failed breakout of the Asian range'],
  ['Mean Reversion', 'Deviation band'],
  ['Price Action', 'Liquidity sweep'],
  ['Institutional Order Flow Continuation', 'London open sweep and reclaim of the prior day low'],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NOTES = [
  'Followed the plan.',
  'Entered late, exited early.',
  'Held to the level.',
  'Cut it at the first pullback.',
  'Correct size, wrong session.',
];

function pick<T>(values: readonly T[], random: () => number): T {
  const index = Math.min(values.length - 1, Math.floor(random() * values.length));
  // `noUncheckedIndexedAccess` — the clamp above guarantees the element, but
  // the compiler cannot know that, and a non-null assertion would be the wrong
  // habit to model in a file other people copy from.
  const value = values[index];
  if (value === undefined) throw new Error('empty fixture pool');
  return value;
}

function generate(): readonly PrototypeTrade[] {
  const random = seeded(20260907);
  const rows: PrototypeTrade[] = [];

  // Walks backwards from 24 Aug 2026, one to three days per record.
  let day = 24;
  let month = 7; // August, zero-based

  for (let index = 0; index < 99; index += 1) {
    day -= 1 + Math.floor(random() * 2);
    while (day < 1) {
      month -= 1;
      day += 30;
    }
    const monthName = MONTHS[month] ?? 'Jan';
    const hour = 8 + Math.floor(random() * 12);
    const minute = Math.floor(random() * 60);
    const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    const isThb = random() < 0.05;
    const currency = isThb ? 'THB' : 'USD';
    const accountName = isThb ? 'Personal · Thai broker' : 'Live · FTMO 100K';
    const scale = isThb ? 34 : 1;

    const riskMinor = (isThb ? 300000 : 10000) + Math.floor(random() * 5) * (isThb ? 100000 : 5000);
    const rMultiple = Number((random() * 5 - 1.6).toFixed(2));
    const isBreakEven = Math.abs(rMultiple) <= 0.05;
    const netMinor = Math.round(riskMinor * rMultiple);

    const classification = random() < 0.18 ? null : pick(CLASSIFICATIONS, random);
    const systemResolved = random() < 0.62;
    const systemR = systemResolved ? Number((rMultiple + (random() * 2 - 0.7)).toFixed(2)) : null;
    const hasReviewNote = systemResolved && random() < 0.7;

    rows.push({
      ...(PROTOTYPE_TRADES[0] as PrototypeTrade),
      id: `t-${String(index + 26).padStart(3, '0')}`,
      symbol: pick(SYMBOLS, random),
      direction: random() < 0.5 ? 'long' : 'short',
      accountName,
      currency,
      lifecycle: 'closed',
      outcome: isBreakEven ? 'break_even' : rMultiple > 0 ? 'win' : 'loss',
      activityDate: `${day} ${monthName} 2026`,
      activityTime: `Closed ${clock}`,
      activityShort: `${day} ${monthName}, ${clock}`,
      netPnlMinor: String(netMinor),
      actualR: rMultiple.toFixed(4),
      closedBps: 10000,
      strategy: classification === null ? null : classification[0],
      setup: classification === null ? null : classification[1],
      systemState: systemResolved ? 'resolved' : 'pending',
      systemR: systemR === null ? null : systemR.toFixed(4),
      systemOutcome: systemResolved
        ? systemR !== null && systemR > 0
          ? 'Target reached'
          : 'Stop reached'
        : null,
      hasReviewNote,
      reviewNote: hasReviewNote ? pick(NOTES, random) : null,
      actualBasis: 'money',
      actualRiskMinor: String(riskMinor),
      entryPrice: null,
      initialStop: null,
      exitPrice: null,
      positionSize: null,
      plan: null,
      costs: null,
      confidence: random() < 0.5 ? null : pick([0, 25, 50, 75, 100], random),
      emotions: null,
      entryReason: null,
      notes: null,
      chartUrl: null,
      mistakes: [],
      conditions: [],
      exits: [],
      legacy: false,
    });

    // Keeps the THB currency scale visually plausible without a conversion.
    void scale;
  }

  return rows;
}

/** The authored page-one records, then the generated history. 124 in total. */
export const PROTOTYPE_POPULATION: readonly PrototypeTrade[] = [...PROTOTYPE_TRADES, ...generate()];
