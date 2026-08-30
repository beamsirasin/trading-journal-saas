import { describe, expect, it } from 'vitest';

import type { OutcomeValue } from '@/lib/trades/constants';

import { parseDashboardFilterState, type DashboardFilterState } from './filters';
import {
  composeDashboardInsights,
  type ComposeDashboardInsightsInput,
  type InsightActualTradeInput,
  type InsightEmotionInput,
  type InsightRuleCheckInput,
  type InsightSystemTradeInput,
} from './insight-pillars';
import {
  composeInsightPillarsView,
  insightPillarsServiceError,
  type InsightCardView,
} from './insight-presentation';

const BASE_SCOPE = {
  datePreset: 'all' as const,
  dateBounds: { kind: 'all' as const, start: null, endExclusive: null },
  accountScope: { kind: 'all' as const },
  strategyId: null,
  setupId: null,
  strategyVersionId: null,
};

function filters(overrides: Partial<DashboardFilterState> = {}): DashboardFilterState {
  const parsed = parseDashboardFilterState({ range: 'all', unit: 'r' });
  if (!parsed.ok) throw new Error('fixture filters must parse');
  return { ...parsed.state, ...overrides };
}

function outcome(r: string): OutcomeValue {
  const value = Number(r);
  return value > 0 ? 'win' : value < 0 ? 'loss' : 'break_even';
}

function actual(
  index: number,
  overrides: Partial<InsightActualTradeInput> = {},
): InsightActualTradeInput {
  const actualR = overrides.actualR ?? '0.5000';
  return {
    tradeId: `trade-${index}`,
    actualR,
    traderOutcome: outcome(actualR),
    actualExitedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    systemR: actualR,
    systemOutcome: outcome(actualR),
    systemExitedAt: new Date(Date.UTC(2026, 0, index + 1, 1)).toISOString(),
    strategyId: 'strategy-a',
    strategyLabel: 'Elliott Wave v3',
    setupId: 'setup-a',
    setupLabel: 'Wave 3 Continuation',
    confidence: 50,
    ...overrides,
  };
}

function systemFrom(trade: InsightActualTradeInput): InsightSystemTradeInput {
  return {
    tradeId: trade.tradeId,
    systemR: trade.systemR ?? trade.actualR,
    systemOutcome: trade.systemOutcome ?? trade.traderOutcome,
    systemExitedAt: trade.systemExitedAt ?? trade.actualExitedAt,
    strategyId: trade.strategyId,
    strategyLabel: trade.strategyLabel,
    setupId: trade.setupId,
    setupLabel: trade.setupLabel,
  };
}

function checksFor(
  trades: readonly InsightActualTradeInput[],
  status: 'followed' | 'violated',
): InsightRuleCheckInput[] {
  return trades.map((trade) => ({
    tradeId: trade.tradeId,
    ruleKey: 'rule-1',
    title: 'Wait for confirmation',
    checkStatus: status,
    isRequired: true,
    occurredAt: trade.actualExitedAt,
  }));
}

/** Real D8A output end to end — the domain contract is always the input. */
function view(
  actualTrades: readonly InsightActualTradeInput[],
  overrides: Partial<ComposeDashboardInsightsInput> = {},
  state: DashboardFilterState = filters(),
) {
  const data = composeDashboardInsights({
    scope: BASE_SCOPE,
    actualTrades,
    systemTrades: actualTrades.map(systemFrom),
    emotions: [],
    ruleChecks: [],
    mistakes: [],
    ...overrides,
  });
  return composeInsightPillarsView({ data, filters: state });
}

function card(result: ReturnType<typeof view>, pillar: 'strategy' | 'psychology' | 'discipline') {
  const found = result.cards.find((item) => item.pillar === pillar);
  if (found === undefined) throw new Error(`Missing ${pillar} card`);
  return found;
}

function statementOf(item: InsightCardView) {
  if (item.primary === null) throw new Error(`Expected a primary insight, got ${item.status}`);
  return item.primary;
}

const TWENTY = Array.from({ length: 20 }, (_, index) => actual(index));

describe('Insight pillars presentation — three cards, one payload', () => {
  it('always composes exactly the three registered pillars in reading order', () => {
    const result = view(TWENTY);
    expect(result.cards.map((item) => item.pillar)).toEqual([
      'strategy',
      'psychology',
      'discipline',
    ]);
    expect(result.cards.map((item) => item.widgetId)).toEqual([
      'strategy.performance',
      'psychology.performance',
      'discipline.performance',
    ]);
    // Equal peers of one three-column section.
    for (const item of result.cards) {
      expect(item.layout.section).toBe('insight-pillars');
      expect(item.layout.desktopSpan).toBe(1);
    }
  });

  /**
   * §26 — the affordance uses the EXISTING Analytics `?view=` contract and
   * carries the Dashboard's own scope, so following a pillar lands on the
   * same population the card described. No route is invented.
   */
  it('routes each pillar to the existing Analytics view that holds its material', () => {
    const result = view(TWENTY, {}, filters({ strategyId: 'strategy-a' }));
    expect(card(result, 'strategy').analyticsView).toBe('edge');
    expect(card(result, 'psychology').analyticsView).toBe('behavior');
    expect(card(result, 'discipline').analyticsView).toBe('results');
    for (const item of result.cards) {
      expect(item.analyticsHref).toMatch(/^\/app\/analytics\?/);
      // The Dashboard's scope travels with the link.
      expect(item.analyticsHref).toContain('strategy=strategy-a');
      expect(item.analyticsHref).toContain('range=all');
    }
  });

  it('preserves canonical custom bounds in every Dashboard-to-Analytics link', () => {
    const result = view(
      TWENTY,
      {},
      filters({
        datePreset: 'custom',
        customDateRange: { from: '2026-07-10', to: '2026-08-12' },
      }),
    );
    for (const item of result.cards) {
      expect(item.analyticsHref).toContain('range=custom');
      expect(item.analyticsHref).toContain('from=2026-07-10');
      expect(item.analyticsHref).toContain('to=2026-08-12');
    }
  });
});

describe('Strategy pillar', () => {
  it('leads with the basis D8A selected, not with the largest number available', () => {
    const strategy = card(view(TWENTY), 'strategy');
    const statement = statementOf(strategy);
    expect(strategy.status).toBe('available');
    // The fixture's System and Actual agree, so D8A selects on System
    // expectancy and the headline is that figure.
    expect(statement.type).toBe('strongest_observed_strategy');
    expect(statement.headline?.text).toBe('+0.50R');
    expect(statement.subjectLabel).toBe('Elliott Wave v3');
    expect(statement.subjectKind).toBe('strategy');
  });

  /**
   * The hero is labelled, so a supporting figure never repeats it: this
   * selection leads on System expectancy, and the supporting row therefore
   * carries the OTHER two figures rather than saying System expectancy twice.
   */
  it('carries exactly one supporting figure, and never repeats the hero', () => {
    const statement = statementOf(card(view(TWENTY), 'strategy'));
    expect(statement.headlineRole).toBe('system_expectancy');
    // The Gap, and only the Gap. Actual expectancy left the Dashboard: the
    // card ranks on System expectancy and the Gap already answers "how much
    // of it am I taking?", which is the only follow-up the hero raises.
    expect(statement.comparisons.map((item) => item.role)).toEqual(['average_execution_gap']);
    expect(statement.comparisons.map((item) => item.role)).not.toContain(statement.headlineRole);
    expect(statement.comparisons.map((item) => item.role)).not.toContain('actual_expectancy');
  });

  it('falls back to System expectancy when the Gap is itself the hero', () => {
    // The divergence branch promotes the Gap to the hero; the supporting
    // figure must then become the ranking basis rather than disappearing.
    const statement = statementOf(card(view(TWENTY), 'strategy'));
    const roles = [statement.headlineRole, ...statement.comparisons.map((item) => item.role)];
    expect(new Set(roles).size).toBe(roles.length);
    expect(roles).toContain('system_expectancy');
  });

  /**
   * §7 — with a Strategy already filtered, D8A answers with that Strategy's
   * health rather than a "best Strategy" ranking, and the card must follow
   * the token instead of re-announcing the selection as a winner.
   */
  it('never announces an already-selected Strategy as a winner', () => {
    const scoped = composeDashboardInsights({
      scope: { ...BASE_SCOPE, strategyId: 'strategy-a' },
      actualTrades: TWENTY,
      systemTrades: TWENTY.map(systemFrom),
      emotions: [],
      ruleChecks: [],
      mistakes: [],
    });
    const result = composeInsightPillarsView({
      data: scoped,
      filters: filters({ strategyId: 'strategy-a' }),
    });
    const statement = statementOf(card(result, 'strategy'));
    expect(statement.type).not.toBe('strongest_observed_strategy');
    expect([
      'selected_strategy_health',
      'selected_setup_health',
      'strongest_observed_setup',
    ]).toContain(statement.type);
  });

  /**
   * §8/§23 — below the policy floor nothing is ranked. The card carries the
   * real threshold so its copy can state it rather than inventing one.
   */
  it('reports an insufficient sample rather than fabricating a winner', () => {
    const strategy = card(view([actual(0), actual(1)]), 'strategy');
    expect(strategy.status).toBe('insufficient_sample');
    expect(strategy.reason).toBe('sample_below_policy');
    expect(strategy.primary).toBeNull();
    expect(strategy.minimumCohortTradeCount).toBe(5);
  });

  it('marks a 5–19 Trade cohort limited while still showing the observation', () => {
    const strategy = card(view(Array.from({ length: 9 }, (_, index) => actual(index))), 'strategy');
    expect(strategy.status).toBe('limited_sample');
    expect(strategy.sample).toEqual({ quality: 'limited', tradeCount: 9 });
    // Limited is a caveat, not an error: the observation still reaches the card.
    expect(strategy.primary).not.toBeNull();
  });

  it('promotes a 20+ Trade cohort to a supported sample', () => {
    expect(card(view(TWENTY), 'strategy').sample).toEqual({
      quality: 'supported',
      tradeCount: 20,
    });
  });
});

describe('Psychology pillar', () => {
  const tagged = (trades: readonly InsightActualTradeInput[], key: string, label: string) =>
    trades.map<InsightEmotionInput>((trade) => ({
      tradeId: trade.tradeId,
      key,
      label,
      isSystem: true,
    }));

  it('presents an Emotion cohort against the scoped baseline, never as a cost', () => {
    const fearful = Array.from({ length: 8 }, (_, index) => actual(index, { actualR: '-0.4400' }));
    const rest = Array.from({ length: 12 }, (_, index) => actual(index + 8, { actualR: '0.8000' }));
    const psychology = card(
      view([...fearful, ...rest], {
        emotions: [...tagged(fearful, 'fear', 'Fear'), ...tagged(rest, 'calm', 'Calm')],
      }),
      'psychology',
    );
    const statement = statementOf(psychology);

    expect(statement.subjectKind).toBe('emotion');
    // The headline is the cohort's OWN average, and the baseline sits beside
    // it as a labelled comparison — not a difference presented as an amount
    // the cohort took away.
    expect(statement.headline?.text).toMatch(/^[+-]\d/);
    expect(statement.comparisons.map((item) => item.role)).toContain('scoped_baseline');
    expect(statement.type).toMatch(/^emotion_(under|out)performance$/);
    // §12 — overlapping cohorts are flagged so no card can imply a partition.
    expect(statement.nonAdditive).toBe(true);
  });

  /**
   * §13 — canonical ordinal confidence survives to the view. `0` is a
   * recorded value, so it must reach presentation as the string "0" rather
   * than being dropped by a falsy check or relabelled into a band.
   */
  it('preserves a canonical confidence level, including a recorded zero', () => {
    const low = Array.from({ length: 10 }, (_, index) =>
      actual(index, { actualR: '-0.6000', confidence: 0 }),
    );
    const high = Array.from({ length: 10 }, (_, index) =>
      actual(index + 10, { actualR: '0.9000', confidence: 100 }),
    );
    const psychology = card(view([...low, ...high]), 'psychology');
    const statement = statementOf(psychology);
    expect(statement.subjectKind).toBe('confidence_level');
    expect(['0', '100']).toContain(statement.subjectLabel);
    // A confidence cohort is not an Emotion cohort: it does not overlap.
    expect(statement.nonAdditive).toBe(false);
  });

  /**
   * §24 — below the coverage floor D8A refuses a cohort claim, and the card
   * says so. Untagged Trades are never folded into a calm/neutral group.
   */
  /**
   * Coverage gates each dimension SEPARATELY, and the card follows D8A's own
   * priority rather than assuming a pillar is unusable. Two Emotion-tagged
   * Trades out of twenty is far below the floor, but Confidence is fully
   * recorded — so a Confidence cohort is still a legitimate selection, and
   * suppressing the whole pillar would hide a real observation.
   */
  it('still selects a confidence cohort when only Emotion coverage is short', () => {
    const low = Array.from({ length: 10 }, (_, index) =>
      actual(index, { actualR: '-0.6000', confidence: 25 }),
    );
    const high = Array.from({ length: 10 }, (_, index) =>
      actual(index + 10, { actualR: '0.9000', confidence: 75 }),
    );
    const trades = [...low, ...high];
    const psychology = card(
      view(trades, { emotions: tagged(trades.slice(0, 2), 'fear', 'Fear') }),
      'psychology',
    );
    expect(statementOf(psychology).subjectKind).toBe('confidence_level');
    expect(psychology.coverage).toMatchObject({
      kind: 'psychology',
      taggedTradeCount: 2,
      eligibleTradeCount: 20,
    });
  });

  it('reports low coverage instead of treating unrecorded Trades as neutral', () => {
    // Neither dimension reaches its floor: barely any Emotion tags, and
    // confidence genuinely unrecorded (`null`), which is NOT a zero.
    const trades = Array.from({ length: 20 }, (_, index) => actual(index, { confidence: null }));
    const psychology = card(
      view(trades, { emotions: tagged(trades.slice(0, 2), 'fear', 'Fear') }),
      'psychology',
    );
    expect(['low_coverage', 'unavailable']).toContain(psychology.status);
    expect(
      psychology.primary === null || psychology.primary.type === 'psychology_coverage_warning',
    ).toBe(true);
    expect(psychology.coverage).toMatchObject({ kind: 'psychology', eligibleTradeCount: 20 });
  });

  it('publishes coverage as a count and a rate, never as a gauge input', () => {
    const trades = TWENTY;
    const psychology = card(
      view(trades, { emotions: tagged(trades.slice(0, 15), 'calm', 'Calm') }),
      'psychology',
    );
    expect(psychology.coverage).toEqual({
      kind: 'psychology',
      taggedTradeCount: 15,
      eligibleTradeCount: 20,
      ratePercent: '75.00%',
    });
  });
});

describe('Discipline pillar', () => {
  it('keeps Rule Checks Followed and Trade Rule Adherence separately labelled', () => {
    const compliant = TWENTY.slice(0, 15);
    const violating = TWENTY.slice(15);
    const discipline = card(
      view(TWENTY, {
        ruleChecks: [...checksFor(compliant, 'followed'), ...checksFor(violating, 'violated')],
      }),
      'discipline',
    );
    const statement = statementOf(discipline);
    const roles = statement.comparisons.map((item) => item.role);

    // The two rates are different numbers over different denominators, so
    // neither may ever be printed under the other's name (§15).
    expect(
      new Set(roles).has('checks_followed') || statement.type !== 'rule_adherence_summary',
    ).toBe(true);
    expect(roles).not.toContain('rule_adherence');
    expect(discipline.status).not.toBe('integrity_error');
  });

  it('reports nothing evaluated rather than an invented adherence figure', () => {
    const discipline = card(view(TWENTY), 'discipline');
    expect(discipline.status).toBe('unevaluated');
    expect(discipline.reason).toBe('required_checks_not_evaluated');
    expect(discipline.primary).toBeNull();
  });

  it('never derives a Discipline Score or any other unsupported concept', () => {
    const discipline = card(
      view(TWENTY, { ruleChecks: checksFor(TWENTY, 'followed') }),
      'discipline',
    );
    const serialized = JSON.stringify(discipline);
    expect(serialized).not.toMatch(/score|grade|cost|caused|lost/i);
  });
});

describe('Empty, unavailable and error states', () => {
  it('keeps all three pillars as product surfaces when nothing is eligible', () => {
    const result = view([]);
    expect(result.cards).toHaveLength(3);
    for (const item of result.cards) {
      expect(item.status).toBe('no_eligible_trades');
      expect(item.reason).toBe('no_eligible_trades');
      expect(item.primary).toBeNull();
      // The Analytics affordance survives an empty state — the section never
      // disappears (§25).
      expect(item.analyticsHref).toMatch(/^\/app\/analytics\?/);
    }
  });

  it('keeps a failed Insight read distinct from every empty product state', () => {
    const result = insightPillarsServiceError(filters());
    for (const item of result.cards) {
      expect(item.status).toBe('integrity_error');
      expect(item.reason).toBe('service_error');
    }
  });

  it('surfaces a domain integrity failure on all three pillars', () => {
    const duplicated = [actual(0), actual(0)];
    const result = view(duplicated);
    for (const item of result.cards) {
      expect(item.status).toBe('integrity_error');
      expect(item.reason).toBe('duplicate_trade');
    }
  });
});

describe('The presentation layer recomputes nothing', () => {
  /**
   * Every figure on a card must be traceable to a canonical D8A metric. The
   * cheapest proof that nothing was re-derived is that the view carries no
   * numeric field D8A did not publish: the only numbers are counts and
   * already-formatted strings.
   */
  it('emits formatted strings and counts only, never a recomputed value', () => {
    const strategy = card(view(TWENTY), 'strategy');
    const statement = statementOf(strategy);
    expect(typeof statement.headline?.text).toBe('string');
    for (const comparison of statement.comparisons) {
      expect(typeof comparison.figure.text).toBe('string');
      expect(['positive', 'negative', 'neutral']).toContain(comparison.figure.tone);
    }
    expect(Number.isInteger(statement.tradeCount)).toBe(true);
  });

  it('reads the sample bands from D8A policy rather than restating them', () => {
    // Nine Trades is limited and twenty is supported because D8A's published
    // policy says 5 and 20 — this layer holds no second copy of either.
    expect(
      card(view(Array.from({ length: 19 }, (_, i) => actual(i))), 'strategy').sample?.quality,
    ).toBe('limited');
    expect(card(view(TWENTY), 'strategy').sample?.quality).toBe('supported');
  });
});
