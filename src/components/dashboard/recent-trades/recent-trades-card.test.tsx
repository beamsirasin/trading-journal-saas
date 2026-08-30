import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardRecentTrade } from '@/lib/dashboard/page-data';

import en from '../../../../messages/en.json';
import { RecentTradesCard } from './recent-trades-card';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const trade = (overrides: Partial<DashboardRecentTrade> = {}): DashboardRecentTrade => ({
  tradeId: 'trade-1',
  occurredAt: '2026-03-05T06:00:00.000Z',
  symbol: 'XAUUSD',
  direction: 'long',
  tradingAccountName: 'Primary',
  status: 'closed',
  systemStatus: 'resolved',
  strategyName: 'Momentum v1',
  setupName: 'London Retest',
  actualR: '2.0000',
  systemR: '3.0000',
  executionGapR: { status: 'available', value: '-1.0000' },
  ...overrides,
});

function renderCard(trades: readonly DashboardRecentTrade[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RecentTradesCard trades={trades} timezone="Asia/Bangkok" dateLocale="en-GB" />
    </NextIntlClientProvider>,
  );
}

describe('Recent Trades card', () => {
  it('publishes its registry identity and its five-of-twelve span', () => {
    const { container } = renderCard([trade()]);
    const widget = container.querySelector('[data-dashboard-widget="trades.recent"]');
    expect(widget).toHaveAttribute('data-dashboard-section', 'recent-and-calendar');
    expect(widget).toHaveAttribute('data-dashboard-section-columns', '12');
    expect(widget).toHaveAttribute('data-dashboard-desktop-span', '5');
  });

  it('renders every supplied Trade as one row', () => {
    const trades = Array.from({ length: 5 }, (_, index) =>
      trade({ tradeId: `trade-${index}`, symbol: `SYM${index}` }),
    );
    const { container } = renderCard(trades);
    expect(container.querySelectorAll('[data-recent-trade-row]')).toHaveLength(5);
  });

  /**
   * §14 — THE DASHBOARD PREVIEW IS THREE FIELDS.
   *
   * The measured benchmark renders three columns here (Close Date, Symbol,
   * Net P&L) against ten on its own full Trade View. This row is the same
   * shape in this product's terms: the local day, the symbol, and the one
   * canonical per-Trade result the projection carries (`actualR`).
   */
  it('shows the day, the symbol and one primary result, and nothing else', () => {
    const { container } = renderCard([trade()]);
    const row = container.querySelector('[data-recent-trade-row]') as HTMLElement;

    expect(row).toHaveTextContent('XAUUSD');
    expect(row).toHaveTextContent('+2.00R');
    // The local day in the workspace timezone — 06:00Z on 5 March is still
    // 5 March in Bangkok, and the clock time itself is not printed.
    expect(row).toHaveTextContent('05 Mar 2026');
    expect(row).not.toHaveTextContent(':');
  });

  /**
   * §14's explicit exclusion list. These belong to the Trade record, on the
   * Trade — not repeated on a preview row seven times over.
   */
  it('keeps Strategy, Setup, direction, status and the other R values off the row', () => {
    const { container } = renderCard([trade()]);
    const row = container.querySelector('[data-recent-trade-row]') as HTMLElement;

    expect(row).not.toHaveTextContent('Momentum v1');
    expect(row).not.toHaveTextContent('London Retest');
    expect(row).not.toHaveTextContent(/long/i);
    expect(row).not.toHaveTextContent(/closed/i);
    // System R (+3.00R) and the Gap (-1.00R) are supplied on the payload and
    // deliberately not rendered here; the Execution Gap section owns both.
    expect(row).not.toHaveTextContent('+3.00R');
    expect(row).not.toHaveTextContent('-1.00R');
  });

  /**
   * §16 — the row opens the same Trade quick preview it always did. What
   * changed is that the whole row is the target rather than the symbol alone.
   */
  it('makes the whole row one link to the Trade preview', () => {
    const { container } = renderCard([trade()]);
    const row = container.querySelector('[data-recent-trade-row]') as HTMLElement;
    const links = within(row).getAllByRole('link');

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/app/trades?trade=trade-1');
    expect(links[0]?.textContent).toContain('XAUUSD');
  });

  /**
   * The truthfulness rule the retired Gap column used to carry, which applies
   * just as much to the single result this row now shows: a Trade whose
   * Actual side is not final must never render a 0.00R that would assert a
   * flat outcome that has not happened.
   */
  it('marks an unfinished Actual result rather than printing a fabricated zero', () => {
    const { container } = renderCard([
      trade({
        status: 'open',
        actualR: null,
        systemStatus: 'pending',
        systemR: null,
        executionGapR: { status: 'unavailable', reason: 'both_incomplete' },
      }),
    ]);
    const row = container.querySelector('[data-recent-trade-row]') as HTMLElement;

    expect(row.querySelector('[data-recent-trade-result]')).toHaveAttribute(
      'data-recent-trade-result',
      'unavailable',
    );
    expect(row).not.toHaveTextContent('0.00R');
    // The row is still rendered — an unresolved Trade is recent activity too.
    expect(container.querySelectorAll('[data-recent-trade-row]')).toHaveLength(1);
  });

  /**
   * "No result yet" is not one thing. Each execution state that legitimately
   * has no Actual R says which one it is, using the Journal's own label, so
   * the reader does not have to open the Trade to find out why the number is
   * missing.
   */
  it.each([
    ['open', 'Open'],
    ['planned', 'Needs details'],
    ['canceled', 'Canceled'],
  ] as const)('names the %s state instead of an anonymous dash', (status, label) => {
    const { container } = renderCard([
      trade({
        status,
        actualR: null,
        executionGapR: { status: 'unavailable', reason: 'actual_incomplete' },
      }),
    ]);
    const result = container.querySelector('[data-recent-trade-result]') as HTMLElement;

    expect(result).toHaveAttribute('data-recent-trade-state', status);
    expect(result).toHaveTextContent(label);
    expect(result).not.toHaveTextContent('—');
    // A state is not an outcome, so it never borrows the result tones.
    expect(result.className).not.toMatch(/text-(positive|negative)/);
  });

  /**
   * The one case that keeps the dash: there is no state to name, only an
   * incomplete record. Labelling it would be the same fabrication as
   * printing a zero.
   */
  it('keeps the dash for a closed Trade whose Actual R is missing', () => {
    const { container } = renderCard([
      trade({
        status: 'closed',
        actualR: null,
        executionGapR: { status: 'unavailable', reason: 'actual_incomplete' },
      }),
    ]);
    const result = container.querySelector('[data-recent-trade-result]') as HTMLElement;

    expect(result).not.toHaveAttribute('data-recent-trade-state');
    expect(result).toHaveTextContent('—');
  });

  it('signs the result in text, not only in colour', () => {
    const { container } = renderCard([trade({ actualR: '-0.7500' })]);
    expect(container.querySelector('[data-recent-trade-result]')).toHaveTextContent('-0.75R');
  });
});

describe('Recent Trades empty state', () => {
  it('tells the reader what to do next rather than showing a skeleton', () => {
    const { container } = renderCard([]);
    expect(container.querySelector('[data-recent-trades-state="empty"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-recent-trade-row]')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Log a Trade' })).toHaveAttribute(
      'href',
      '/app/trades/new',
    );
  });
});
