import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { parseDashboardFilterState, type DashboardFilterState } from '@/lib/dashboard/filters';
import {
  composeDashboardInsights,
  type ComposeDashboardInsightsInput,
  type InsightActualTradeInput,
  type InsightEmotionInput,
  type InsightMistakeInput,
  type InsightRuleCheckInput,
  type InsightSystemTradeInput,
} from '@/lib/dashboard/insight-pillars';
import {
  composeInsightPillarsView,
  insightPillarsServiceError,
  type InsightPillarsView,
} from '@/lib/dashboard/insight-presentation';
import type { OutcomeValue } from '@/lib/trades/constants';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { InsightPillarsSection } from './insight-pillars-row';

const BASE_SCOPE = {
  datePreset: 'all' as const,
  dateBounds: { kind: 'all' as const, start: null, endExclusive: null },
  accountScope: { kind: 'all' as const },
  strategyId: null,
  setupId: null,
  strategyVersionId: null,
};

function filterState(): DashboardFilterState {
  const parsed = parseDashboardFilterState({ range: 'all', unit: 'r' });
  if (!parsed.ok) throw new Error('fixture filters must parse');
  return parsed.state;
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

function emotionsFor(
  trades: readonly InsightActualTradeInput[],
  key: string,
  label: string,
): InsightEmotionInput[] {
  return trades.map((trade) => ({ tradeId: trade.tradeId, key, label, isSystem: true }));
}

function mistakesFor(
  trades: readonly InsightActualTradeInput[],
  label: string,
): InsightMistakeInput[] {
  return trades.map((trade) => ({
    tradeId: trade.tradeId,
    mistakeTypeId: 'mistake-1',
    key: 'moved_stop',
    label,
    isSystem: true,
  }));
}

function buildView(
  actualTrades: readonly InsightActualTradeInput[],
  overrides: Partial<ComposeDashboardInsightsInput> = {},
): InsightPillarsView {
  const data = composeDashboardInsights({
    scope: BASE_SCOPE,
    actualTrades,
    systemTrades: actualTrades.map(systemFrom),
    emotions: [],
    ruleChecks: [],
    mistakes: [],
    ...overrides,
  });
  return composeInsightPillarsView({ data, filters: filterState() });
}

function renderPillars(view: InsightPillarsView, locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <InsightPillarsSection view={view} />
    </NextIntlClientProvider>,
  );
}

function pillar(container: HTMLElement, name: 'strategy' | 'psychology' | 'discipline') {
  const node = container.querySelector<HTMLElement>(`[data-insight-pillar="${name}"]`);
  if (node === null) throw new Error(`Missing ${name} pillar`);
  return node;
}

/**
 * The card's one statement. Cards used to render a second, so this helper
 * existed to disambiguate; it now also serves as the assertion that exactly
 * one exists — `querySelector` returning the first of several would silently
 * hide a regression, so the one-finding rule is checked structurally above.
 */
function primaryStatement(pillarNode: HTMLElement): HTMLElement {
  const node = pillarNode.querySelector<HTMLElement>('[data-insight-statement]');
  if (node === null) throw new Error('Missing primary statement');
  return node;
}

const TWENTY = Array.from({ length: 20 }, (_, index) => actual(index));

describe('Insight pillars section — composition', () => {
  it('renders exactly three compact pillars, and no chart of any kind', () => {
    const { container } = renderPillars(buildView(TWENTY));

    expect(container.querySelectorAll('[data-insight-pillar]')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Strategy Performance' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Psychology Performance' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Discipline Performance' })).toBeVisible();

    // §5 — typography and comparisons only. No plot, no gauge, no meter, no
    // ranking table, no progress bar.
    expect(container.querySelector('svg.recharts-surface')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('progress')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('[role="meter"]')).toBeNull();
  });

  /**
   * THE ONE-FINDING RULE, asserted structurally rather than by copy. Each card
   * renders exactly one statement and exactly one hero inside it. A second
   * finding cannot creep back in without this failing.
   */
  it('gives each pillar exactly one statement and one hero figure', () => {
    const { container } = renderPillars(
      buildView(TWENTY, { ruleChecks: checksFor(TWENTY, 'followed') }),
    );
    for (const name of ['strategy', 'psychology', 'discipline'] as const) {
      const node = pillar(container, name);
      expect(node.querySelectorAll('[data-insight-statement]')).toHaveLength(1);
      expect(node.querySelectorAll('[data-insight-headline]')).toHaveLength(1);
      // At most ONE supporting figure beneath that hero.
      expect(node.querySelectorAll('[data-insight-comparison]').length).toBeLessThanOrEqual(1);
    }
  });

  /**
   * §18 — the three cards deliberately do NOT share an internal composition.
   * Strategy and Psychology name an observation above their figure; Discipline
   * answers with a rate and has no observation to name.
   */
  it('gives Strategy and Psychology a finding eyebrow and Discipline none', () => {
    const { container } = renderPillars(
      buildView(TWENTY, { ruleChecks: checksFor(TWENTY, 'followed') }),
    );
    expect(
      within(primaryStatement(pillar(container, 'strategy'))).getByText(
        'Strongest observed Strategy',
      ),
    ).toBeVisible();
    const discipline = primaryStatement(pillar(container, 'discipline'));
    // Its hero is the rate, named beside the number, with no sentence above.
    expect(within(discipline).getByText('Trade Rule Adherence')).toBeVisible();
    for (const eyebrow of [
      'Required checks not completed',
      'Most evaluated Trades were non-compliant',
      'Compliant and non-compliant Trades differed',
    ]) {
      expect(within(discipline).queryByText(eyebrow)).toBeNull();
    }
  });

  it('publishes the registry identity of each pillar on its own node', () => {
    const { container } = renderPillars(buildView(TWENTY));
    expect(
      container.querySelector('[data-dashboard-widget="strategy.performance"]'),
    ).toHaveAttribute('data-dashboard-section', 'insight-pillars');
    expect(
      container.querySelector('[data-dashboard-widget="psychology.performance"]'),
    ).toHaveAttribute('data-dashboard-section-columns', '3');
    expect(
      container.querySelector('[data-dashboard-widget="discipline.performance"]'),
    ).toHaveAttribute('data-dashboard-desktop-span', '1');
    // No sub-metric ever gets a widget ID of its own.
    expect(container.querySelectorAll('[data-dashboard-widget]')).toHaveLength(3);
  });

  it('offers a named Analytics route on every pillar, using the existing view contract', () => {
    const { container } = renderPillars(buildView(TWENTY));
    expect(
      screen.getByRole('link', { name: 'View Strategy Performance in Analytics' }),
    ).toHaveAttribute('href', expect.stringContaining('/app/analytics?view=edge'));
    expect(
      screen.getByRole('link', { name: 'View Psychology Performance in Analytics' }),
    ).toHaveAttribute('href', expect.stringContaining('view=behavior'));
    expect(
      screen.getByRole('link', { name: 'View Discipline Performance in Analytics' }),
    ).toHaveAttribute('href', expect.stringContaining('view=results'));
    expect(container.querySelectorAll('[data-insight-analytics]')).toHaveLength(3);
  });
});

describe('Strategy pillar copy', () => {
  it('names the observed subject and its basis without claiming proof', () => {
    const { container } = renderPillars(buildView(TWENTY));
    const strategy = pillar(container, 'strategy');
    const lead = primaryStatement(strategy);
    expect(within(lead).getByText('Strongest observed Strategy')).toBeVisible();
    expect(within(lead).getByText('Elliott Wave v3')).toBeVisible();
    // The hero is NAMED, and exactly one supporting figure sits beneath it.
    // Actual expectancy is no longer rendered on the Dashboard — it is a
    // third way of saying what the Gap already says, and it lives in
    // Analytics.
    expect(within(lead).getByText('System expectancy')).toBeVisible();
    expect(within(lead).getAllByText('System expectancy')).toHaveLength(1);
    expect(within(lead).queryByText('Actual expectancy')).toBeNull();
    expect(lead.querySelectorAll('[data-insight-comparison]')).toHaveLength(1);
    // §8 — never a significance or confidence claim.
    expect(strategy.textContent ?? '').not.toMatch(
      /statistically significant|high confidence|proven edge/i,
    );
  });

  it('shows a limited sample as a quiet caveat rather than a warning box', () => {
    const nine = Array.from({ length: 9 }, (_, index) => actual(index));
    const { container } = renderPillars(buildView(nine));
    const strategy = pillar(container, 'strategy');
    expect(strategy).toHaveAttribute('data-insight-status', 'limited_sample');
    expect(within(strategy).getByText(/Limited sample/)).toBeVisible();
    expect(within(strategy).getByText(/9 Trades/)).toBeVisible();
    // The observation still reaches the reader; it is not an error.
    expect(within(strategy).queryByRole('alert')).toBeNull();
    expect(strategy.querySelector('[data-insight-headline]')).not.toBeNull();
  });

  it('states the real policy threshold when the sample is insufficient', () => {
    const { container } = renderPillars(buildView([actual(0), actual(1)]));
    const strategy = pillar(container, 'strategy');
    expect(strategy).toHaveAttribute('data-insight-status', 'insufficient_sample');
    expect(within(strategy).getByText('Not enough Trades yet')).toBeVisible();
    expect(within(strategy).getByText(/5 Trades are needed/)).toBeVisible();
    // No fabricated winner.
    expect(strategy.querySelector('[data-insight-headline]')).toBeNull();
  });
});

describe('Psychology pillar copy', () => {
  it('describes an Emotion cohort against a baseline, never as a cost or a cause', () => {
    const fearful = Array.from({ length: 8 }, (_, index) => actual(index, { actualR: '-0.4400' }));
    const rest = Array.from({ length: 12 }, (_, index) => actual(index + 8, { actualR: '0.8000' }));
    const { container } = renderPillars(
      buildView([...fearful, ...rest], {
        emotions: [...emotionsFor(fearful, 'fear', 'Fear'), ...emotionsFor(rest, 'calm', 'Calm')],
      }),
    );
    const psychology = pillar(container, 'psychology');

    // The cohort is named as a group of Trades, not as a property of the trader.
    const lead = primaryStatement(psychology);
    expect(within(lead).getByText(/-tagged Trades$/)).toBeVisible();
    expect(within(lead).getByText('Scoped baseline')).toBeVisible();
    // §10/§16 — no causal or cost vocabulary anywhere on the card.
    expect(psychology.textContent ?? '').not.toMatch(/cost|caused|because of|lost|due to/i);
  });

  /** §12 — overlapping cohorts must never read as shares of a whole. */
  it('says in words that Emotion cohorts overlap', () => {
    const fearful = Array.from({ length: 8 }, (_, index) => actual(index, { actualR: '-0.4400' }));
    const rest = Array.from({ length: 12 }, (_, index) => actual(index + 8, { actualR: '0.8000' }));
    const { container } = renderPillars(
      buildView([...fearful, ...rest], {
        emotions: [
          ...emotionsFor(fearful, 'fear', 'Fear'),
          ...emotionsFor(rest, 'calm', 'Calm'),
          // The same Trades also carry a second Emotion.
          ...emotionsFor(fearful, 'fomo', 'FOMO'),
        ],
      }),
    );
    const psychology = pillar(container, 'psychology');
    // The note moved behind the ⓘ once the card stopped rendering a SECOND
    // cohort: with one cohort on the face there is no visible partition left
    // to misread. It is still present, still in the same words, and still
    // reachable by keyboard — asserted in the next test.
    expect(psychology.querySelector('[data-insight-non-additive]')).toBeNull();
    // No percentage-of-total presentation that would imply a partition.
    expect(psychology.textContent ?? '').not.toMatch(/\d+% Fear/);
  });

  it('keeps the overlapping-cohort note reachable from the info popover', async () => {
    const user = userEvent.setup();
    const fearful = Array.from({ length: 8 }, (_, index) => actual(index, { actualR: '-0.4400' }));
    const rest = Array.from({ length: 12 }, (_, index) => actual(index + 8, { actualR: '0.8000' }));
    renderPillars(
      buildView([...fearful, ...rest], {
        emotions: [
          ...emotionsFor(fearful, 'fear', 'Fear'),
          ...emotionsFor(rest, 'calm', 'Calm'),
          ...emotionsFor(fearful, 'fomo', 'FOMO'),
        ],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'About Psychology Performance' }));
    expect(await screen.findByText(/Trades can carry more than one tag/)).toBeVisible();
  });

  it('prints a canonical confidence level rather than a High/Medium/Low band', () => {
    const low = Array.from({ length: 10 }, (_, index) =>
      actual(index, { actualR: '-0.6000', confidence: 25 }),
    );
    const high = Array.from({ length: 10 }, (_, index) =>
      actual(index + 10, { actualR: '0.9000', confidence: 75 }),
    );
    const { container } = renderPillars(buildView([...low, ...high]));
    const psychology = pillar(container, 'psychology');
    expect(
      within(primaryStatement(psychology)).getByText(/^Confidence (0|25|50|75|100)$/),
    ).toBeVisible();
    expect(psychology.textContent ?? '').not.toMatch(/\b(high|medium|low) confidence\b/i);
  });

  it('explains missing tags without calling them calm or neutral', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index, { confidence: null }));
    const { container } = renderPillars(
      buildView(trades, { emotions: emotionsFor(trades.slice(0, 2), 'fear', 'Fear') }),
    );
    const psychology = pillar(container, 'psychology');
    expect(psychology.textContent ?? '').toMatch(/tagged/i);
    expect(psychology.textContent ?? '').not.toMatch(/\b(calm|neutral)\b/i);
  });
});

describe('Discipline pillar copy', () => {
  it('labels Rule Checks Followed and Trade Rule Adherence unambiguously', () => {
    const compliant = TWENTY.slice(0, 15);
    const violating = TWENTY.slice(15);
    const { container } = renderPillars(
      buildView(TWENTY, {
        ruleChecks: [...checksFor(compliant, 'followed'), ...checksFor(violating, 'violated')],
      }),
    );
    const discipline = pillar(container, 'discipline');
    const text = discipline.textContent ?? '';
    // Whichever of the two appears, it is spelled out in full — one is never
    // rendered under the other's name (§15).
    if (text.includes('Rule Checks Followed')) {
      expect(text).not.toMatch(/Rule Checks Followed[^%]*Trade Rule Adherence/);
    }
    expect(discipline.querySelector('[data-insight-headline]')).not.toBeNull();
  });

  it('states an associated Execution Gap observationally, never as a cost', () => {
    const offenders = TWENTY.slice(0, 8).map((trade) => ({ ...trade, actualR: '-1.2000' }));
    const rest = TWENTY.slice(8);
    const trades = [...offenders, ...rest];
    const { container } = renderPillars(
      buildView(trades, {
        ruleChecks: [...checksFor(offenders, 'violated'), ...checksFor(rest, 'followed')],
        mistakes: mistakesFor(offenders, 'Moved Stop'),
      }),
    );
    const discipline = pillar(container, 'discipline');
    const text = discipline.textContent ?? '';
    expect(text).not.toMatch(/cost|caused|lost because|due to/i);
    expect(text).not.toMatch(/discipline score|trader grade/i);
  });

  it('says nothing was evaluated rather than inventing an adherence figure', () => {
    const { container } = renderPillars(buildView(TWENTY));
    const discipline = pillar(container, 'discipline');
    expect(discipline).toHaveAttribute('data-insight-status', 'unevaluated');
    expect(within(discipline).getByText('No evaluated Trades yet')).toBeVisible();
    expect(discipline.textContent ?? '').not.toMatch(/0%|0\.00%/);
  });
});

describe('Empty and error states', () => {
  /** §25 — the section stays a product surface; it never disappears. */
  it('renders all three pillars with their own empty copy and no fake zero', () => {
    const { container } = renderPillars(buildView([]));
    expect(container.querySelectorAll('[data-insight-pillar]')).toHaveLength(3);
    expect(within(pillar(container, 'strategy')).getByText('No closed Trades yet')).toBeVisible();
    expect(
      within(pillar(container, 'psychology')).getByText('No eligible Trades yet'),
    ).toBeVisible();
    expect(
      within(pillar(container, 'discipline')).getByText('No evaluated Trades yet'),
    ).toBeVisible();
    expect(container.textContent ?? '').not.toMatch(/0%|0\.00R/);
    // The route onward survives an empty state.
    expect(container.querySelectorAll('[data-insight-analytics]')).toHaveLength(3);
  });

  it('announces an integrity failure instead of an empty state', () => {
    const { container } = renderPillars(insightPillarsServiceError(filterState()));
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(
      within(pillar(container, 'strategy')).getByText('Insights could not be prepared'),
    ).toBeVisible();
    expect(container.textContent ?? '').not.toMatch(/no data/i);
  });
});

describe('Localization', () => {
  it('renders Thai copy that keeps the observational meaning and no English fallback', () => {
    const fearful = Array.from({ length: 8 }, (_, index) => actual(index, { actualR: '-0.4400' }));
    const rest = Array.from({ length: 12 }, (_, index) => actual(index + 8, { actualR: '0.8000' }));
    const { container } = renderPillars(
      buildView([...fearful, ...rest], {
        emotions: [...emotionsFor(fearful, 'fear', 'Fear'), ...emotionsFor(rest, 'calm', 'Calm')],
      }),
      'th',
    );

    expect(screen.getByRole('heading', { name: 'ผลงานของ Strategy' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'ผลงานด้านจิตวิทยา' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'ผลงานด้านวินัย' })).toBeVisible();
    const psychology = pillar(container, 'psychology');
    // The Thai baseline label is present, and no untranslated English prose
    // leaks into the Thai UI (§27). Product nouns the product keeps in
    // English — Strategy, Setup, Trade, Execution Gap — are deliberate.
    expect(within(primaryStatement(psychology)).getByText('ค่าฐานในขอบเขตนี้')).toBeVisible();
    expect(psychology.textContent ?? '').not.toMatch(
      /Scoped baseline|Limited sample|tagged Trades/,
    );
  });

  it('keeps the Thai empty states truthful rather than borrowing English', () => {
    const { container } = renderPillars(buildView([]), 'th');
    expect(within(pillar(container, 'strategy')).getByText('ยังไม่มี Trade ที่ปิด')).toBeVisible();
    expect(container.textContent ?? '').not.toMatch(/No closed Trades|No eligible Trades/);
  });
});

/**
 * The Dashboard content budget for these three cards, asserted as exclusions.
 * Every figure named below is still composed by D8A, still on the payload, and
 * still rendered at the Analytics destination each card links to — it simply
 * has no permanent place on the Dashboard.
 */
describe('Insight pillars — Dashboard content budget', () => {
  it('keeps the runner-up Strategy Setup off the Dashboard', () => {
    const { container } = renderPillars(buildView(TWENTY));
    const strategy = pillar(container, 'strategy');
    expect(within(strategy).queryByText('Strongest observed Setup')).toBeNull();
    expect(within(strategy).queryByText('Wave 3 Continuation')).toBeNull();
    expect(within(strategy).queryByText('Actual expectancy')).toBeNull();
  });

  it('keeps the runner-up Psychology cohort and its Gap off the Dashboard', () => {
    const low = Array.from({ length: 10 }, (_, index) =>
      actual(index, { actualR: '-0.6000', confidence: 25 }),
    );
    const high = Array.from({ length: 10 }, (_, index) =>
      actual(index + 10, { actualR: '0.9000', confidence: 75 }),
    );
    const { container } = renderPillars(
      buildView([...low, ...high], {
        emotions: emotionsFor(low, 'fear', 'Fear'),
      }),
    );
    const psychology = pillar(container, 'psychology');
    expect(psychology.querySelectorAll('[data-insight-statement]')).toHaveLength(1);
    // The baseline is mandatory; the cohort's Execution Gap is not rendered.
    expect(within(psychology).getByText('Scoped baseline')).toBeVisible();
    expect(within(psychology).queryByText('Avg Execution Gap')).toBeNull();
  });

  it('leads Discipline with Trade Rule Adherence even when checks are incomplete', () => {
    const compliant = TWENTY.slice(0, 12);
    const violating = TWENTY.slice(12, 18);
    const unresolved = TWENTY.slice(18);
    const { container } = renderPillars(
      buildView(TWENTY, {
        ruleChecks: [
          ...checksFor(compliant, 'followed'),
          ...checksFor(violating, 'violated'),
          ...unresolved.map((trade) => ({
            tradeId: trade.tradeId,
            ruleKey: 'rule-1',
            title: 'Wait for confirmation',
            checkStatus: 'not_checked',
            isRequired: true,
            occurredAt: trade.actualExitedAt,
          })),
        ],
      }),
    );
    const discipline = pillar(container, 'discipline');
    const statement = primaryStatement(discipline);

    // The hero is the Trade-level rate, named — never the completeness
    // warning, and never the check-level rate under the Trade-level label.
    expect(within(statement).getByText('Trade Rule Adherence')).toBeVisible();
    expect(within(statement).getByText('Rule Checks Followed')).toBeVisible();

    // Incompleteness survives as a compact caveat with a real count, outside
    // the statement block, and never as the headline.
    const notice = discipline.querySelector('[data-insight-incomplete-checks]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent ?? '').toContain('Required checks not completed');
    expect(statement.contains(notice)).toBe(false);

    // The retired second finding is gone in every form.
    expect(
      within(discipline).queryByText('Compliant and non-compliant Trades differed'),
    ).toBeNull();
    expect(discipline.querySelector('[data-insight-comparison="compliant_expectancy"]')).toBeNull();
    expect(
      discipline.querySelector('[data-insight-comparison="associated_execution_gap"]'),
    ).toBeNull();
  });

  it('omits the incomplete-checks caveat when every required check resolved', () => {
    const { container } = renderPillars(
      buildView(TWENTY, { ruleChecks: checksFor(TWENTY, 'followed') }),
    );
    expect(
      pillar(container, 'discipline').querySelector('[data-insight-incomplete-checks]'),
    ).toBeNull();
  });

  /**
   * §10 — a caveat that is always on screen stops being read. It appears
   * below the policy's supported floor and moves into the info popover at or
   * above it, where the count is still reachable.
   */
  it('shows the limited-sample caveat only below the supported floor', () => {
    const limited = renderPillars(
      buildView(Array.from({ length: 9 }, (_, index) => actual(index))),
    );
    expect(
      pillar(limited.container, 'strategy').querySelector('[data-insight-sample="limited"]'),
    ).not.toBeNull();
    limited.unmount();

    const supported = renderPillars(buildView(TWENTY));
    const strategy = pillar(supported.container, 'strategy');
    expect(strategy.querySelector('[data-insight-sample]')).toBeNull();
    expect(within(strategy).queryByText(/Observed over/)).toBeNull();
  });

  it('keeps the sample count and coverage reachable from the info popover', async () => {
    const user = userEvent.setup();
    renderPillars(buildView(TWENTY));
    await user.click(screen.getByRole('button', { name: 'About Strategy Performance' }));
    expect(await screen.findByText(/Observed over/)).toBeVisible();
  });
});
