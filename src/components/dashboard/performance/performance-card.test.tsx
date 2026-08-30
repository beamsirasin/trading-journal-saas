import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import type { DashboardPageData, DashboardPerformanceData } from '@/lib/dashboard/page-data';
import {
  composePerformanceCards,
  PERFORMANCE_METRIC_KEYS,
  type PerformanceSide,
} from '@/lib/dashboard/performance-card';
import { DASHBOARD_WIDGET_IDS } from '@/lib/dashboard/widgets';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { PerformanceCard } from './performance-card';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable = (reason: 'no_trades' | 'no_losses'): AnalyticsMetric => ({
  status: 'unavailable',
  reason,
});

function axis(overrides: Partial<DashboardPerformanceData> = {}): DashboardPerformanceData {
  return {
    sampleCount: 31,
    outcomeCounts: { wins: 17, breakEvens: 3, losses: 11 },
    totalR: available('9.0000'),
    winRate: available('0.5484'),
    averageR: available('0.2903'),
    expectancyR: available('0.2903'),
    profitFactor: available('3.6400'),
    maximumDrawdownR: available('2.0000'),
    payoffRatio: available('2.4000'),
    ...overrides,
  };
}

const EMPTY_AXIS = axis({
  sampleCount: 0,
  outcomeCounts: { wins: 0, breakEvens: 0, losses: 0 },
  totalR: unavailable('no_trades'),
  winRate: unavailable('no_trades'),
  averageR: unavailable('no_trades'),
  expectancyR: unavailable('no_trades'),
  profitFactor: unavailable('no_trades'),
  maximumDrawdownR: unavailable('no_trades'),
  payoffRatio: unavailable('no_trades'),
});

function renderCard(
  side: PerformanceSide,
  overrides: Partial<DashboardPerformanceData> = {},
  locale: 'en' | 'th' = 'en',
) {
  const built = axis(overrides);
  const data = {
    system: side === 'system' ? built : axis(),
    trader: side === 'trader' ? built : axis(),
  } as unknown as DashboardPageData;
  const [system, trader] = composePerformanceCards(data);
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'th' ? th : en}>
      <PerformanceCard model={side === 'system' ? system : trader} />
    </NextIntlClientProvider>,
  );
}

function renderEmpty(side: PerformanceSide) {
  const data = {
    system: side === 'system' ? EMPTY_AXIS : axis(),
    trader: side === 'trader' ? EMPTY_AXIS : axis(),
  } as unknown as DashboardPageData;
  const [system, trader] = composePerformanceCards(data);
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PerformanceCard model={side === 'system' ? system : trader} />
    </NextIntlClientProvider>,
  );
}

const cell = (container: HTMLElement, key: string): HTMLElement => {
  const element = container.querySelector(`[data-performance-metric="${key}"]`);
  if (element === null) throw new Error(`missing metric cell ${key}`);
  return element as HTMLElement;
};

const SIDES: readonly {
  side: PerformanceSide;
  widgetId: string;
  title: string;
  heroLabel: string;
}[] = [
  {
    side: 'system',
    widgetId: 'system.performance',
    title: 'System Performance',
    heroLabel: 'System Total R',
  },
  {
    side: 'trader',
    widgetId: 'trader.performance',
    title: 'Trader Performance',
    heroLabel: 'Actual Total R',
  },
];

describe.each(SIDES)('PerformanceCard — $side', ({ side, widgetId, title, heroLabel }) => {
  it('renders under its registered widget ID with a named accessible group', () => {
    const { container } = renderCard(side);
    const card = container.querySelector(`[data-dashboard-widget="${widgetId}"]`);
    expect(card).not.toBeNull();
    expect(DASHBOARD_WIDGET_IDS).toContain(widgetId);
    expect(screen.getByRole('group', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    // The tagline was retired with the density pass — its wording lives in the
    // card's own info popover as `purpose` and nowhere on the visible card.
    expect(
      screen.queryByText(side === 'system' ? 'Strategy outcomes' : 'Your actual execution'),
    ).toBeNull();
  });

  it('shows exactly three metrics: a hero Total R over Win Rate and Avg Win / Loss', () => {
    const { container } = renderCard(side);
    expect(screen.getByText(heroLabel)).toBeVisible();
    expect(screen.getByText('+9.00R')).toBeVisible();

    const rendered = [...container.querySelectorAll('[data-performance-metric]')].map((node) =>
      node.getAttribute('data-performance-metric'),
    );
    expect(rendered).toEqual(['winRate', 'payoffRatio']);
    expect(within(cell(container, 'winRate')).getByText('Win Rate')).toBeVisible();
    expect(within(cell(container, 'payoffRatio')).getByText('Avg Win / Loss')).toBeVisible();
    expect(within(cell(container, 'payoffRatio')).getByText('2.40x')).toBeVisible();
  });

  /**
   * The Dashboard content budget for this section, asserted as an exclusion.
   * Each of these is still computed and still on the Dashboard payload; none
   * of them may be permanently rendered here.
   */
  it('renders none of the retired metrics or the outcome composition', () => {
    const { container } = renderCard(side);
    for (const key of [
      'averageR',
      'expectancyR',
      'profitFactor',
      'maximumDrawdownR',
      'sampleCount',
    ]) {
      expect(container.querySelector(`[data-performance-metric="${key}"]`)).toBeNull();
    }
    for (const label of ['Avg R', 'Expectancy', 'Profit Factor', 'Max Drawdown', 'Trades']) {
      expect(within(container).queryByText(label)).toBeNull();
    }
    // The W/BE/L composition line goes with them.
    expect(screen.queryByText('17W · 3BE · 11L')).toBeNull();
  });

  /**
   * §7 terminology. The visible label is "Avg Win / Loss" — never "Average
   * RR", "Risk Reward" or "Avg R", each of which names a different thing
   * (planned SL/TP geometry, or the mean R per Trade).
   */
  it('names the ratio Avg Win / Loss and never uses risk-reward wording', () => {
    const { container } = renderCard(side);
    expect(within(cell(container, 'payoffRatio')).getByText('Avg Win / Loss')).toBeVisible();
    expect(container.textContent ?? '').not.toMatch(/risk.?reward|\bRR\b|Average R\b/i);
  });

  it('gives the hero more visual weight than any supporting figure', () => {
    const { container } = renderCard(side);
    const hero = screen.getByText('+9.00R');
    const supporting = within(cell(container, 'winRate')).getByText('54.84%');
    // A supporting cell must not be rendered at the hero's scale.
    expect(hero.className).toContain('text-[2rem]');
    expect(supporting.className).toContain('text-xl');
    expect(supporting.className).not.toContain('text-[2rem]');
  });

  it.each([
    ['9.0000', '+9.00R', 'text-positive'],
    ['-4.5000', '-4.50R', 'text-negative'],
    ['0.0000', '0.00R', 'text-foreground'],
  ])('tones a %s Total R as %s', (value, text, toneClass) => {
    renderCard(side, { totalR: available(value) });
    expect(screen.getByText(text)).toHaveClass(toneClass);
  });

  it('keeps every supporting metric neutral however strong it reads', () => {
    const { container } = renderCard(side, {
      winRate: available('0.9800'),
      payoffRatio: available('14.0000'),
    });
    for (const key of PERFORMANCE_METRIC_KEYS) {
      const value = cell(container, key).querySelector('dd span');
      expect(value).not.toHaveClass('text-positive');
      expect(value).not.toHaveClass('text-negative');
    }
  });

  it('renders Avg Win / Loss as a neutral multiple, never as a signed R', () => {
    const { container } = renderCard(side, { payoffRatio: available('2.4000') });
    const ratio = cell(container, 'payoffRatio');
    expect(within(ratio).getByText('2.40x')).toBeVisible();
    expect(within(ratio).queryByText('+2.40R')).toBeNull();
    expect(within(ratio).getByText('2.40x')).not.toHaveClass('text-negative');
    expect(within(ratio).getByText('2.40x')).not.toHaveClass('text-positive');
  });

  /**
   * §23 — an undefined denominator is stated in words. Never 0x, never ∞,
   * never a misleading 100%.
   */
  it('states an unavailable Avg Win / Loss rather than fabricating a ratio', () => {
    const { container } = renderCard(side, { payoffRatio: unavailable('no_losses') });
    const ratio = cell(container, 'payoffRatio');
    expect(within(ratio).getByText('No losing Trades')).toBeVisible();
    expect(ratio).toHaveAttribute('data-performance-metric-reason', 'no_losses');
    // The neighbours are untouched.
    expect(screen.getByText('+9.00R')).toBeVisible();
    expect(within(cell(container, 'winRate')).getByText('54.84%')).toBeVisible();
    expect(container.textContent).not.toMatch(/Infinity|NaN|∞/);
    expect(within(ratio).queryByText('0x')).toBeNull();
  });

  it('surfaces a supplied integrity error without blanking its neighbours', () => {
    const { container } = renderCard(side, {
      payoffRatio: { status: 'error', reason: 'data_integrity_error' },
    });
    const ratio = cell(container, 'payoffRatio');
    expect(within(ratio).getByText('Metric temporarily unavailable')).toBeVisible();
    expect(ratio).toHaveAttribute('data-performance-metric-status', 'error');
    expect(within(cell(container, 'winRate')).getByText('54.84%')).toBeVisible();
  });

  it('shows one empty notice and no metric cells at all, not a blank card', () => {
    const { container } = renderEmpty(side);
    const card = container.querySelector(`[data-dashboard-widget="${widgetId}"]`) as HTMLElement;
    expect(card).toHaveAttribute('data-performance-status', 'empty');
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    // The `Trades: 0` cell went with the metric budget — the sentence below
    // already says the population is empty, and a metric slot restating it was
    // the only thing this state used it for.
    expect(container.querySelector('[data-performance-metric]')).toBeNull();
    // No hero, no composition, and the reason is stated once.
    expect(within(card).queryByText(heroLabel)).toBeNull();
    expect(within(card).queryAllByText('No eligible Trades')).toHaveLength(0);
    expect(
      within(card).getByText(
        side === 'system' ? /No eligible System Trades/i : /No eligible closed Trader Trades/i,
      ),
    ).toBeVisible();
  });

  it('opens its definitions from the keyboard and states the population in words', async () => {
    const user = userEvent.setup();
    renderCard(side);
    const trigger = screen.getByRole('button', { name: `About ${title}` });

    trigger.focus();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByText(heroLabel, { selector: 'dt' })).toBeVisible();
    });
    expect(
      screen.getByText(
        side === 'system'
          ? /Total R from eligible resolved System outcomes/
          : /Total R from eligible closed Actual Trades/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/Break-even stays in the denominator/)).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText(/Break-even stays in the denominator/)).toBeNull();
    });
  });

  it('renders Thai copy for both metric labels', () => {
    const { container } = renderCard(side, {}, 'th');
    expect(within(cell(container, 'winRate')).getByText('อัตราชนะ')).toBeVisible();
    expect(
      within(cell(container, 'payoffRatio')).getByText('กำไรเฉลี่ย / ขาดทุนเฉลี่ย'),
    ).toBeVisible();
  });

  it('reads only its supplied model — the card never fetches', () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error('Performance cards must not fetch analytics');
    }) as typeof fetch;
    try {
      renderCard(side);
    } finally {
      globalThis.fetch = original;
    }
    expect(called).toBe(false);
  });
});

describe('PerformanceCard — the pair', () => {
  it('shows no Execution Gap, System Edge Captured, or paired figure', () => {
    const { container } = renderCard('system');
    const { container: traderContainer } = renderCard('trader');
    const text = `${container.textContent ?? ''}${traderContainer.textContent ?? ''}`;
    for (const forbidden of [
      'Execution Gap',
      'System Edge Captured',
      'Comparable Trades',
      'missed',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('uses one identity mark per side and never a coloured card surface', () => {
    const { container: system } = renderCard('system');
    const { container: trader } = renderCard('trader');
    const systemCard = system.querySelector('[data-dashboard-panel="system"]') as HTMLElement;
    const traderCard = trader.querySelector('[data-dashboard-panel="trader"]') as HTMLElement;

    // Same neutral card surface on both sides — no green/red, no tinted panel.
    expect(systemCard.className).toContain('bg-card');
    expect(traderCard.className).toContain('bg-card');
    for (const card of [systemCard, traderCard]) {
      expect(card.className).not.toMatch(/bg-(positive|negative|system|trader)\b/);
      expect(card.className).not.toContain('border-t-4');
    }
    expect(system.querySelectorAll('.bg-system\\/10')).toHaveLength(1);
    expect(trader.querySelectorAll('.bg-trader\\/10')).toHaveLength(1);
  });

  it('gives both sides the same metric geometry so like compares with like', () => {
    const { container: system } = renderCard('system');
    const { container: trader } = renderCard('trader');
    const keys = (root: HTMLElement) =>
      [...root.querySelectorAll('[data-performance-metric]')].map((node) =>
        node.getAttribute('data-performance-metric'),
      );
    expect(keys(system)).toEqual(keys(trader));
    expect(keys(system)).toEqual([...PERFORMANCE_METRIC_KEYS]);
  });
});
