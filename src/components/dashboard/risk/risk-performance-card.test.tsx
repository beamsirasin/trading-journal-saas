import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from '@/lib/analytics/filters';
import {
  composeRiskPerformance,
  type ModeledBalanceTradeInput,
  type RiskPerformanceScopeInput,
} from '@/lib/dashboard/risk-performance';
import {
  composeRiskPerformanceView,
  riskPerformanceServiceError,
  type RiskPerformanceView,
} from '@/lib/dashboard/risk-performance-presentation';

import en from '../../../../messages/en.json';
import { RiskPerformanceCard } from './risk-performance-card';

/**
 * Recharts measures its parent with ResizeObserver, which jsdom does not
 * implement — without a stub the plot renders at zero size and emits no SVG
 * at all.
 *
 * This stub reports a real size rather than merely existing, which is what
 * lets the step-interpolation assertion below read an actual path `d`
 * attribute instead of settling for "a chart component was mounted". The size
 * itself is arbitrary; only the geometry's SHAPE is asserted.
 */
class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const rect = { width: 800, height: 300, top: 0, left: 0, bottom: 300, right: 800, x: 0, y: 0 };
    this.callback(
      [{ target, contentRect: rect as DOMRectReadOnly } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', SizedResizeObserver);

const ACCOUNT_ID = '019c43dc-8c6c-7000-8000-000000000001';
const AS_OF = new Date('2026-09-01T00:00:00.000Z');

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

/** The real D7A pipeline end to end — domain, then presentation, then DOM. */
function buildView(
  trades: readonly ModeledBalanceTradeInput[] = [],
  scopeInput: RiskPerformanceScopeInput = scope(),
): RiskPerformanceView {
  return composeRiskPerformanceView({
    data: composeRiskPerformance({ scope: scopeInput, asOf: AS_OF, trades }),
    timezone: 'Asia/Bangkok',
    dateLocale: 'en-GB',
  });
}

function renderCard(view: RiskPerformanceView) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RiskPerformanceCard view={view} />
    </NextIntlClientProvider>,
  );
}

const POPULATED: readonly ModeledBalanceTradeInput[] = [
  trade('older', '2026-05-01T10:00:00Z', 1_270_00n),
  trade('a', '2026-08-10T10:00:00Z', 1_150_00n),
  trade('b', '2026-08-20T10:00:00Z', -110_00n),
];
const BOUNDED_30D = scope('30d', {
  kind: 'bounded',
  start: '2026-08-02T00:00:00.000Z',
  endExclusive: AS_OF.toISOString(),
});

function metric(container: HTMLElement, key: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-risk-metric="${key}"]`);
  if (node === null) throw new Error(`Missing Risk metric ${key}`);
  return node;
}

describe('Risk Performance section — populated available state', () => {
  it('leads with Modeled Balance and Current Drawdown, and nothing else', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));

    expect(screen.getByRole('heading', { name: 'Risk Performance' })).toBeInTheDocument();
    expect(container.querySelector('[data-risk-status]')).toHaveAttribute(
      'data-risk-status',
      'available',
    );
    expect(within(metric(container, 'modeledBalance')).getByText('$12,310.00')).toBeVisible();
    expect(within(metric(container, 'modeledBalance')).getByText('Modeled Balance')).toBeVisible();
    // The percentage leads; the money amount names itself as the distance
    // below the peak rather than sitting bare beside it.
    expect(within(metric(container, 'currentDrawdown')).getByText('0.89%')).toBeVisible();
    expect(
      within(metric(container, 'currentDrawdown')).getByText('$110.00 below peak'),
    ).toBeVisible();

    // EXACTLY these two on the face.
    const keys = [...container.querySelectorAll('[data-risk-metric]')].map((node) =>
      node.getAttribute('data-risk-metric'),
    );
    expect(keys).toEqual(['modeledBalance', 'currentDrawdown']);
  });

  /**
   * §1/§2 — PERIOD P&L IS NOT ON THE RISK FACE.
   *
   * It sums the SAME authoritative `net_pnl_minor` over the same closed,
   * non-deleted, date-bounded population as the KPI row's Net P&L, so on a
   * default Dashboard the two are the same number twice. They are not the
   * same metric — the KPI also requires `actual_r`/`trader_outcome` and DOES
   * follow Strategy/Setup/Version filters, which Risk deliberately ignores —
   * but that divergence is invisible without a sentence, so the figure is off
   * the first layer. `periodNetPnlMinor` remains on the payload, asserted
   * here so a regression cannot quietly drop the DATA as well as the display.
   */
  it('keeps Period P&L on the payload while never rendering it on the face', () => {
    const view = buildView(POPULATED, BOUNDED_30D);
    if (view.status !== 'available') throw new Error('Expected available');
    expect(view.periodNetPnl.text).toBe('+$1,040.00');

    const { container } = renderCard(view);
    expect(container.querySelector('[data-risk-metric="periodPnl"]')).toBeNull();
    expect(container.textContent ?? '').not.toContain('Period P&L');
    expect(container.textContent ?? '').not.toContain('+$1,040.00');
  });

  /**
   * §9/§10 — Max Drawdown and Peak Balance stay computed and stay reachable,
   * but neither is a permanent Dashboard figure any more. Max Drawdown is
   * range-dependent diagnosis; the peak is already drawn as the chart's
   * dashed reference line.
   */
  it('keeps Max Drawdown and Peak Balance computed but off the face', () => {
    const view = buildView(POPULATED, BOUNDED_30D);
    if (view.status !== 'available') throw new Error('Expected available');
    expect(view.maxDrawdown.amountText).toBe('$110.00');
    expect(view.peakBalanceText).toBe('$12,420.00');

    const { container } = renderCard(view);
    expect(container.querySelector('[data-risk-metric="maxDrawdown"]')).toBeNull();
    expect(container.querySelector('[data-risk-metric="peakBalance"]')).toBeNull();
  });

  it('states the displaced figures with their values in the info popover', async () => {
    const user = userEvent.setup();
    renderCard(buildView(POPULATED, BOUNDED_30D));
    await user.click(screen.getByRole('button', { name: 'About Modeled Balance' }));

    expect(await screen.findByText(/Peak Balance \$12,420\.00/)).toBeVisible();
    expect(screen.getByText(/Max Drawdown in this range \$110\.00/)).toBeVisible();
    expect(screen.getByText(/closed Trades? in range/)).toBeVisible();
  });

  /**
   * §2 — the concept is MODELED, and the copy must never borrow the authority
   * of a broker statement. Nothing in this product records a deposit, a
   * withdrawal, a transfer, an adjustment or an open position's mark, so no
   * surface may call this a broker balance, live balance or equity.
   */
  it('never uses broker, live-balance or equity terminology anywhere in the section', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    expect(container.textContent ?? '').not.toMatch(/broker balance|live balance|equity/i);
    expect(container.textContent).toContain('Modeled Balance');
  });

  /**
   * §5/§27 — the load-bearing one. The 30D card shows $12,310 and +$1,040, and
   * the range genuinely opened at $11,270 because $1,270 of history was
   * carried in. Without this sentence the two figures invite the false reading
   * "$10,000 became $12,310 in the last 30 days".
   */
  it('states the carried opening balance so a bounded range cannot be misread', () => {
    renderCard(buildView(POPULATED, BOUNDED_30D));
    expect(
      screen.getByText('This range opened at $11,270.00, carried in from Trades closed before it.'),
    ).toBeVisible();
    expect(screen.queryByText(/opened at \$10,000\.00/)).toBeNull();
  });

  /**
   * §13 — the All range carries nothing in, so the opening sentence is the
   * normal case and states what the ⓘ already explains. It leaves the face;
   * the carried case (asserted above) does not.
   */
  it('drops the opening sentence on the All range and never claims an inception date', () => {
    const { container } = renderCard(buildView(POPULATED));
    expect(container.querySelector('[data-risk-opening]')).toBeNull();
    expect(screen.queryByText(/Modeled from the declared Starting Balance/)).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/account opened on|since account creation/i);
  });

  it('labels the active range without adding a second range control', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    expect(container.querySelector('[data-risk-range]')).toHaveAttribute('data-risk-range', '30d');
    expect(screen.getByText('30 days')).toBeVisible();
    // The one Dashboard range control lives above this section; D7 owns none.
    expect(screen.queryByRole('link', { name: '30D' })).toBeNull();
    expect(screen.queryByRole('button', { name: /30D|90D|All/ })).toBeNull();
  });

  it('maps both reserved registry IDs onto the one shared section', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    const section = container.querySelector('[data-dashboard-section="risk-performance"]');
    expect(section).not.toBeNull();
    const balance = container.querySelector('[data-dashboard-widget="account.balance"]');
    const drawdown = container.querySelector('[data-dashboard-widget="risk.drawdown"]');
    expect(balance).toHaveAttribute('data-dashboard-desktop-span', '7');
    expect(drawdown).toHaveAttribute('data-dashboard-desktop-span', '5');
    expect(balance).toHaveAttribute('data-dashboard-section-columns', '12');
    // Both stack full width on mobile.
    expect(balance).toHaveAttribute('data-dashboard-mobile-span', '2');
    expect(drawdown).toHaveAttribute('data-dashboard-mobile-span', '2');
  });

  /**
   * §21 — at 320px the section is one column, and source order IS reading
   * order: the two hero figures, then the two drawdown readings, then the
   * peak, then the curve. Peak is deliberately last of the figures because it
   * is supporting context for the drawdowns rather than a fifth headline.
   */
  it('orders the stack by priority: balance, drawdown, then the chart', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    const keys = [...container.querySelectorAll('[data-risk-metric]')].map((node) =>
      node.getAttribute('data-risk-metric'),
    );
    expect(keys).toEqual(['modeledBalance', 'currentDrawdown']);
    const chart = container.querySelector('figure');
    const drawdown = container.querySelector('[data-risk-metric="currentDrawdown"]');
    expect(chart).not.toBeNull();
    expect(drawdown?.compareDocumentPosition(chart as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('Risk Performance section — the balance curve', () => {
  it('hands the chart the canonical D7A series and nothing it has to recompute', () => {
    const view = buildView(POPULATED, BOUNDED_30D);
    if (view.status !== 'available') throw new Error('Expected available');
    const { container } = renderCard(view);

    expect(
      screen.getByRole('img', { name: /Modeled Balance after each closed Trade/i }),
    ).toBeVisible();
    // Opening anchor, two closes inside the range, and the as-of anchor.
    expect(view.points.map((point) => point.kind)).toEqual([
      'opening',
      'trade_close',
      'trade_close',
      'as_of',
    ]);
    expect(view.points.map((point) => point.balanceText)).toEqual([
      '$11,270.00',
      '$12,420.00',
      '$12,310.00',
      '$12,310.00',
    ]);
    // The section renders exactly one plot. No second underwater drawdown
    // chart belongs on the Dashboard (§10).
    expect(container.querySelectorAll('.recharts-responsive-container')).toHaveLength(1);
  });

  it('draws the balance as an event step in the interaction blue, never as a smoothed curve', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    const path = container.querySelector('path.recharts-line-curve');
    expect(path).not.toBeNull();
    expect(path).toHaveAttribute('stroke', 'var(--primary)');
    /*
      A `stepAfter` path is a sequence of horizontal and vertical segments:
      every command after the initial `M` is an `L`. A monotone or basis
      interpolation emits `C` curve commands, which is exactly the
      "balance the Account never modeled between two closes" this forbids.
    */
    const commands = path?.getAttribute('d') ?? '';
    expect(commands).toMatch(/^M/);
    expect(commands).not.toMatch(/[CcSsQqTtAa]/);
  });

  it('publishes every point as a real table for readers who cannot use the plot', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const rows = table?.querySelectorAll('tbody tr') ?? [];
    expect(rows).toHaveLength(4);
    // The anchors are named as anchors, never as Trades that did not happen.
    expect(within(table as HTMLElement).getAllByText('Opening')).not.toHaveLength(0);
    expect(within(table as HTMLElement).getAllByText('As of now')).not.toHaveLength(0);
    expect(within(table as HTMLElement).getByText('$11,270.00')).toBeInTheDocument();
  });

  /**
   * §19 — presentation consumes PARENT-Trade realizations. Two Trades closing
   * at the identical instant are one balance step carrying both, and a
   * partially closed position is one step at the parent close, never one per
   * Exit leg.
   */
  it('renders one balance step per realization instant, not one per execution leg', () => {
    const view = buildView([
      trade('a', '2026-07-01T10:00:00.000Z', 100_00n),
      trade('b', '2026-07-01T10:00:00.000Z', 50_00n),
      trade('c', '2026-07-05T10:00:00.000Z', 25_00n),
    ]);
    if (view.status !== 'available') throw new Error('Expected available');
    const closes = view.points.filter((point) => point.kind === 'trade_close');
    expect(closes).toHaveLength(2);
    expect(closes[0]?.tradeCount).toBe(2);
    expect(view.closedTradeCount).toBe(3);
  });
});

describe('Risk Performance section — availability states', () => {
  it('asks for a single Account instead of showing a fabricated aggregate', () => {
    const { container } = renderCard(buildView([], { ...scope(), account: { kind: 'all' } }));
    expect(container.querySelector('[data-risk-status]')).toHaveAttribute(
      'data-risk-status',
      'unavailable',
    );
    expect(screen.getByText('Select an Account to view modeled balance.')).toBeVisible();
    expect(screen.getByText(/Balance history is calculated per Account/)).toBeVisible();
    // No zeroed figures, no empty axes, no plot at all.
    expect(container.querySelector('[data-risk-metric]')).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).toBeNull();
    expect(container.textContent ?? '').not.toContain('$0.00');
  });

  /**
   * §16 — an Account with a Starting Balance and no closed Trades is
   * AVAILABLE. Every figure is true, so all four are shown; only the chart is
   * withheld, because a flat line adds nothing the sentence does not.
   */
  it('keeps an Account with no closed Trades available at its starting balance', () => {
    const { container } = renderCard(buildView([]));
    expect(container.querySelector('[data-risk-status]')).toHaveAttribute(
      'data-risk-status',
      'available',
    );
    expect(within(metric(container, 'modeledBalance')).getByText('$10,000.00')).toBeVisible();
    // §8 — a zero drawdown states its status in words rather than leaving a
    // bare $0.00/0.00% that reads as missing data on a card whose other
    // states genuinely are unavailable.
    expect(within(metric(container, 'currentDrawdown')).getByText('0.00%')).toBeVisible();
    expect(
      within(metric(container, 'currentDrawdown')).getByText('At high-water mark'),
    ).toBeVisible();
    expect(metric(container, 'currentDrawdown')).toHaveAttribute('data-risk-drawdown', 'zero');
    // Never a reassurance the data does not support.
    expect(container.textContent ?? '').not.toMatch(/no risk|risk[- ]free|safe|perfect/i);
    expect(screen.getByText('No closed Trades yet.')).toBeVisible();
    expect(screen.getByText('Your modeled balance remains at the starting balance.')).toBeVisible();
    // Not an error, and no meaningless empty plot.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('withholds a partial balance when the money history is incomplete', () => {
    const { container } = renderCard(
      buildView([
        trade('a', '2026-07-01T10:00:00Z', 100_00n),
        trade('b', '2026-07-02T10:00:00Z', null),
      ]),
    );
    expect(container.querySelector('[data-risk-reason]')).toHaveAttribute(
      'data-risk-reason',
      'incomplete_money_history',
    );
    expect(screen.getByText('Modeled balance unavailable')).toBeVisible();
    expect(
      screen.getByText(/missing authoritative P&L, so the balance history cannot be reconstructed/),
    ).toBeVisible();
    expect(screen.getByText(/have not been silently excluded/)).toBeVisible();
    expect(container.querySelector('[data-risk-metric]')).toBeNull();
  });

  it('explains a currency mismatch as its own limitation rather than as no data', () => {
    const { container } = renderCard(
      buildView([
        trade('a', '2026-07-01T10:00:00Z', 100_00n),
        trade('b', '2026-07-02T10:00:00Z', 100_00n, 'THB'),
      ]),
    );
    expect(container.querySelector('[data-risk-reason]')).toHaveAttribute(
      'data-risk-reason',
      'currency_mismatch',
    );
    expect(screen.getByText(/do not all share one currency/)).toBeVisible();
    expect(container.textContent ?? '').not.toMatch(/no data/i);
  });

  it('announces an integrity failure distinctly from a product limitation', () => {
    const { container } = renderCard(buildView([trade('a', 'not-a-timestamp', 100_00n)]));
    expect(container.querySelector('[data-risk-status]')).toHaveAttribute(
      'data-risk-status',
      'error',
    );
    expect(container.querySelector('[data-risk-reason]')).toHaveAttribute(
      'data-risk-reason',
      'invalid_actual_exit_timestamp',
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Modeled balance could not be prepared')).toBeVisible();
    expect(within(alert).getByText(/exit timestamp that could not be read/)).toBeVisible();
  });

  it('announces a failed Risk read as a service failure, not as an empty Account', () => {
    renderCard(riskPerformanceServiceError());
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Modeled balance could not be loaded')).toBeVisible();
    expect(within(alert).getByText(/has been guessed or rounded to zero/)).toBeVisible();
  });
});

describe('Risk Performance section — scope and accessibility', () => {
  /**
   * §13 — Account and date range change this section; Strategy, Setup and
   * Strategy Version deliberately do not, because a balance is an Account-level
   * fact. The figures must be identical with a Strategy applied, and the
   * section must say why.
   */
  it('says that Strategy and Setup filters do not move the balance, only when one is applied', () => {
    const unfiltered = renderCard(buildView(POPULATED, BOUNDED_30D));
    expect(unfiltered.container.querySelector('[data-risk-scope-note]')).toBeNull();
    unfiltered.unmount();

    const filtered = renderCard(
      buildView(POPULATED, {
        ...BOUNDED_30D,
        strategyId: '019c43dc-8c6c-7000-8000-000000000009',
        setupId: '019c43dc-8c6c-7000-8000-00000000000a',
      }),
    );
    expect(filtered.container.querySelector('[data-risk-scope-note]')).not.toBeNull();
    expect(
      screen.getByText(
        'Account-level metric. Strategy and Setup filters do not change modeled balance.',
      ),
    ).toBeVisible();
    // Identical figures — the filter genuinely changed nothing. Asserted on
    // the two metrics the face now carries; the same holds for the payload's
    // Period P&L, which the filter also leaves untouched.
    expect(
      within(metric(filtered.container, 'modeledBalance')).getByText('$12,310.00'),
    ).toBeVisible();
    expect(within(metric(filtered.container, 'currentDrawdown')).getByText('0.89%')).toBeVisible();
  });

  it('exposes the limitations through a keyboard-reachable button, not a hover tooltip', () => {
    renderCard(buildView(POPULATED, BOUNDED_30D));
    const trigger = screen.getByRole('button', { name: 'About Modeled Balance' });
    expect(trigger).toBeVisible();
    expect(trigger.tagName).toBe('BUTTON');
  });

  it('labels the section, the plot and the drawdown magnitudes without relying on colour', () => {
    const { container } = renderCard(buildView(POPULATED, BOUNDED_30D));
    const section = container.querySelector('section');
    expect(section).toHaveAttribute('aria-labelledby', 'risk-performance-heading');
    expect(screen.getByRole('img', { name: /Modeled Balance/i })).toBeVisible();
    // The drawdown states an amount AND a percentage in text, so the negative
    // tint is never the only carrier.
    const node = metric(container, 'currentDrawdown');
    expect(node.textContent ?? '').toMatch(/\$[\d,]+\.\d{2}/);
    expect(node.textContent ?? '').toMatch(/\d+\.\d{2}%/);
    // A zero drawdown is marked neutral rather than tinted as a loss.
    const zero = renderCard(buildView([]));
    expect(metric(zero.container, 'currentDrawdown')).toHaveAttribute('data-risk-drawdown', 'zero');
  });
});
