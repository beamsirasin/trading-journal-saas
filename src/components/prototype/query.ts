/**
 * THE PROTOTYPE'S RETRIEVAL LAYER — in memory, over 124 fixture rows.
 *
 * This is NOT the full-history search/filter/sort backend the specification
 * calls a P0 prerequisite, and it must not be mistaken for a head start on one.
 * It exists so the redesigned toolbar can be judged as an interaction rather
 * than as a screenshot: typing in Search really narrows the journal, Filters
 * really produce removable chips, Sort really reorders, and the summary really
 * describes the whole matching population rather than the visible page.
 *
 * WHAT IS BORROWED FROM THE REAL ENGINE, AND WHY. The two aggregate figures go
 * through `totalR` (`src/lib/calc/aggregate.ts`) and `sum` (`src/lib/money`)
 * rather than through a `reduce` written here. Both already encode the rules
 * this strip has to demonstrate — an empty population is `no_trades` and never
 * a fabricated `0.00R`; a mixed-currency population is `currency_mismatch` and
 * never a silently converted total — and re-deriving them locally would have
 * produced a summary that looked right and told a different truth.
 */

import { totalR } from '@/lib/calc/aggregate';
import { isCurrencyCode, sum, type CurrencyCode, type Money } from '@/lib/money';

import type { ActualOutcome, Direction, PrototypeTrade } from './fixtures';
import { PROTOTYPE_POPULATION } from './population';
import { deriveFollowUp, signedMoney, signedR, type FollowUp } from './presentation';

export const PAGE_SIZE = 25;

export type JournalState = 'all' | 'open' | 'closed';

export type SortKey = 'newest' | 'oldest' | 'symbol' | 'actual_r_high' | 'actual_r_low';

/**
 * The sort options, in menu order. KEYS ONLY — the wording lives in the copy
 * dictionary (`sortLabel`), so there is one place a sort option is named and it
 * is the place that knows which language is being read.
 */
export const SORT_KEYS: readonly SortKey[] = [
  'newest',
  'oldest',
  'symbol',
  'actual_r_high',
  'actual_r_low',
];

/** The four follow-up dimensions the Filters popover offers (spec §C). */
export type FollowUpFilter =
  'needs_details' | 'system_pending' | 'no_strategy' | 'review_note_missing';

export const FOLLOW_UP_FILTER_LABEL: Record<FollowUpFilter, string> = {
  needs_details: 'Needs details',
  system_pending: 'System result pending',
  no_strategy: 'No strategy',
  review_note_missing: 'Review note missing',
};

export const OUTCOME_FILTER_LABEL: Record<ActualOutcome, string> = {
  win: 'Win',
  loss: 'Loss',
  break_even: 'Break-even',
  unresolved: 'Unresolved',
};

export interface JournalQuery {
  /** An account name, or `all`. Account is scope, never a removable refinement. */
  readonly account: string;
  readonly state: JournalState;
  readonly search: string;
  readonly directions: readonly Direction[];
  readonly outcomes: readonly ActualOutcome[];
  readonly strategy: string | null;
  readonly setup: string | null;
  readonly followUps: readonly FollowUpFilter[];
  readonly sort: SortKey;
  readonly page: number;
}

export const DEFAULT_QUERY: JournalQuery = {
  account: 'Live · FTMO 100K',
  state: 'all',
  search: '',
  directions: [],
  outcomes: [],
  strategy: null,
  setup: null,
  followUps: [],
  sort: 'newest',
  page: 1,
};

/** Everything the "Clear filters" action removes — never Account, Date range or state. */
export function hasRefinements(query: JournalQuery): boolean {
  return (
    query.search.trim() !== '' ||
    query.directions.length > 0 ||
    query.outcomes.length > 0 ||
    query.strategy !== null ||
    query.setup !== null ||
    query.followUps.length > 0
  );
}

export function clearRefinements(query: JournalQuery): JournalQuery {
  return {
    ...query,
    search: '',
    directions: [],
    outcomes: [],
    strategy: null,
    setup: null,
    followUps: [],
    page: 1,
  };
}

function matchesState(trade: PrototypeTrade, state: JournalState): boolean {
  if (state === 'all') return true;
  if (state === 'open') return trade.lifecycle === 'open' || trade.lifecycle === 'partially_closed';
  return trade.lifecycle === 'closed' || trade.lifecycle === 'needs_details';
}

/**
 * Multiple whitespace-separated terms are ANDed; each term may match any of the
 * searchable fields (spec §C).
 */
function matchesSearch(trade: PrototypeTrade, search: string): boolean {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [trade.symbol, trade.entryReason, trade.notes, trade.reviewNote]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function matchesFollowUp(trade: PrototypeTrade, filters: readonly FollowUpFilter[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => {
    switch (filter) {
      case 'needs_details':
        return trade.legacy || trade.lifecycle === 'needs_details';
      case 'system_pending':
        return trade.lifecycle === 'closed' && trade.systemState === 'pending';
      case 'no_strategy':
        return trade.strategy === null;
      case 'review_note_missing':
        return trade.lifecycle === 'closed' && !trade.hasReviewNote;
    }
  });
}

/**
 * Newest-first position in the population, which is already ordered by activity.
 *
 * A POSITION, not the id, and not a re-parse of the display date. The ids are a
 * display convention (`t-01`, `t-026`) and comparing them as strings put the
 * generated history above the authored page — the kind of ordering bug that
 * looks like a design decision in a screenshot. The population's own order is
 * the one fact here that cannot disagree with what the rows say.
 */
const ACTIVITY_ORDER = new Map<string, number>(
  PROTOTYPE_POPULATION.map((trade, index) => [trade.id, index]),
);

function activityKey(trade: PrototypeTrade): number {
  return ACTIVITY_ORDER.get(trade.id) ?? Number.MAX_SAFE_INTEGER;
}

function compareR(a: string | null, b: string | null, direction: 1 | -1): number {
  // Null R sorts last in BOTH directions — it is an absent measurement, not a
  // very small one.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (Number(b) - Number(a)) * direction;
}

export function applyQuery(query: JournalQuery): {
  readonly matching: readonly PrototypeTrade[];
  readonly page: readonly PrototypeTrade[];
  readonly pageFrom: number;
  readonly pageTo: number;
} {
  const matching = PROTOTYPE_POPULATION.filter((trade) => {
    if (query.account !== 'all' && trade.accountName !== query.account) return false;
    if (!matchesState(trade, query.state)) return false;
    if (!matchesSearch(trade, query.search)) return false;
    if (query.directions.length > 0 && !query.directions.includes(trade.direction)) return false;
    if (query.outcomes.length > 0) {
      // A result filter matches CLOSED actual outcomes only. Combined with Open
      // it produces an honest zero-match state rather than switching the state.
      if (trade.outcome === null || !query.outcomes.includes(trade.outcome)) return false;
    }
    if (query.strategy !== null && trade.strategy !== query.strategy) return false;
    if (query.setup !== null && trade.setup !== query.setup) return false;
    if (!matchesFollowUp(trade, query.followUps)) return false;
    return true;
  });

  const sorted = [...matching].sort((a, b) => {
    switch (query.sort) {
      case 'newest':
        return activityKey(a) - activityKey(b);
      case 'oldest':
        return activityKey(b) - activityKey(a);
      case 'symbol':
        return a.symbol.localeCompare(b.symbol) || activityKey(a) - activityKey(b);
      case 'actual_r_high':
        return compareR(a.actualR, b.actualR, 1) || activityKey(a) - activityKey(b);
      case 'actual_r_low':
        return compareR(a.actualR, b.actualR, -1) || activityKey(a) - activityKey(b);
    }
  });

  const start = (query.page - 1) * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);

  return {
    matching: sorted,
    page,
    pageFrom: sorted.length === 0 ? 0 : start + 1,
    pageTo: start + page.length,
  };
}

/**
 * Why a figure is unavailable, as a CODE rather than a sentence.
 *
 * The reasons used to be pre-baked English strings produced right here, which
 * put product copy in the retrieval layer and left three untranslated sentences
 * sitting in the middle of the Thai journal. The code travels; the wording is
 * chosen by the component that draws it, from the copy dictionary.
 */
export type SummaryUnavailableReason =
  'no_closed_results' | 'multiple_currencies' | 'pnl_incomplete' | 'unsupported_currency';

export type SummaryFigure =
  | {
      readonly status: 'available';
      readonly text: string;
      readonly tone: 'positive' | 'negative' | 'flat';
    }
  | {
      readonly status: 'unavailable';
      readonly reason: SummaryUnavailableReason;
      /** How many trades the reason applies to, where the reason names a count. */
      readonly count?: number;
    };

export interface JournalSummary {
  readonly totalMatching: number;
  readonly closedEligible: number;
  readonly openCount: number;
  readonly partiallyClosedCount: number;
  readonly netPnl: SummaryFigure;
  readonly totalR: SummaryFigure;
}

export function summarize(matching: readonly PrototypeTrade[]): JournalSummary {
  const closed = matching.filter((trade) => trade.lifecycle === 'closed');
  const openCount = matching.filter((trade) => trade.lifecycle === 'open').length;
  const partiallyClosedCount = matching.filter(
    (trade) => trade.lifecycle === 'partially_closed',
  ).length;

  return {
    totalMatching: matching.length,
    closedEligible: closed.filter((trade) => trade.actualR !== null).length,
    openCount,
    partiallyClosedCount,
    netPnl: summarizeMoney(closed),
    totalR: summarizeR(closed),
  };
}

function summarizeMoney(closed: readonly PrototypeTrade[]): SummaryFigure {
  if (closed.length === 0) {
    return { status: 'unavailable', reason: 'no_closed_results' };
  }

  const currencies = new Set(closed.map((trade) => trade.currency));
  if (currencies.size > 1) {
    return { status: 'unavailable', reason: 'multiple_currencies' };
  }

  const [currency] = [...currencies];
  if (currency === undefined || !isCurrencyCode(currency)) {
    return { status: 'unavailable', reason: 'unsupported_currency' };
  }

  const missing = closed.filter((trade) => trade.netPnlMinor === null).length;
  if (missing > 0) {
    return { status: 'unavailable', reason: 'pnl_incomplete', count: missing };
  }

  const amounts: Money[] = closed.map((trade) => ({
    amountMinor: BigInt(trade.netPnlMinor ?? '0'),
    currency: currency as CurrencyCode,
  }));
  const total = sum(amounts, currency as CurrencyCode);
  if (!total.ok) {
    return { status: 'unavailable', reason: 'unsupported_currency' };
  }

  const text = signedMoney(total.value.amountMinor.toString(), currency);
  if (text === null) return { status: 'unavailable', reason: 'unsupported_currency' };
  return {
    status: 'available',
    text,
    tone:
      total.value.amountMinor > 0n
        ? 'positive'
        : total.value.amountMinor < 0n
          ? 'negative'
          : 'flat',
  };
}

function summarizeR(closed: readonly PrototypeTrade[]): SummaryFigure {
  const values = closed
    .map((trade) => trade.actualR)
    .filter((value): value is string => value !== null);

  const result = totalR(values);
  if (!result.ok) {
    return { status: 'unavailable', reason: 'no_closed_results' };
  }
  const text = signedR(result.value);
  if (text === null) return { status: 'unavailable', reason: 'no_closed_results' };
  const numeric = Number(result.value);
  return {
    status: 'available',
    text,
    tone: numeric > 0 ? 'positive' : numeric < 0 ? 'negative' : 'flat',
  };
}

export function followUpOf(trade: PrototypeTrade): FollowUp {
  return deriveFollowUp(trade);
}
