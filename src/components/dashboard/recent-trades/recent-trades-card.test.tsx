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
  it('publishes its registry identity and its seven-of-twelve span', () => {
    const { container } = renderCard([trade()]);
    const widget = container.querySelector('[data-dashboard-widget="trades.recent"]');
    expect(widget).toHaveAttribute('data-dashboard-section', 'recent-and-calendar');
    expect(widget).toHaveAttribute('data-dashboard-section-columns', '12');
    expect(widget).toHaveAttribute('data-dashboard-desktop-span', '7');
  });

  it('renders every supplied Trade as one row', () => {
    const trades = Array.from({ length: 5 }, (_, index) =>
      trade({ tradeId: `trade-${index}`, symbol: `SYM${index}` }),
    );
    const { container } = renderCard(trades);
    expect(container.querySelectorAll('[data-recent-trade-row]')).toHaveLength(5);
  });

  /**
   * §2 — identity, then the three results. Strategy, Setup and the occurred
   * time are supporting context and are typeset as one quiet line.
   */
  it('leads with Trade identity and the three results, with Strategy as context', () => {
    const { container } = renderCard([trade()]);
    const row = container.querySelector('[data-recent-trade-row]') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'XAUUSD' })).toHaveAttribute(
      'href',
      '/app/trades?trade=trade-1',
    );
    expect(row).toHaveTextContent('Momentum v1 · London Retest');
    expect(within(row).getByText('Actual R')).toBeInTheDocument();
    expect(within(row).getByText('System R')).toBeInTheDocument();
    expect(within(row).getByText('Gap')).toBeInTheDocument();
    expect(row).toHaveTextContent('+2.00R');
    expect(row).toHaveTextContent('+3.00R');
    expect(row).toHaveTextContent('-1.00R');
  });

  it('names an unclassified Trade rather than borrowing a Strategy', () => {
    const { container } = renderCard([trade({ strategyName: null, setupName: null })]);
    expect(container.querySelector('[data-recent-trade-row]')).toHaveTextContent('Not assigned');
  });
});

describe('Recent Trades Execution Gap states', () => {
  /**
   * §3 — the Gap comes from the supplied typed state. It is never
   * `actualR - systemR` derived in React, which is why a row with a complete
   * Actual side and a pending System side shows a truthful unresolved state
   * rather than a fabricated 0.00R.
   */
  it('keeps an unresolved System side unresolved instead of inventing a zero Gap', () => {
    const { container } = renderCard([
      trade({
        systemStatus: 'pending',
        systemR: null,
        executionGapR: { status: 'unavailable', reason: 'system_incomplete' },
      }),
    ]);
    const gap = container.querySelector('[data-recent-gap-status]');
    expect(gap).toHaveAttribute('data-recent-gap-status', 'unavailable');
    expect(gap).toHaveTextContent('Pending');
    expect(container.querySelector('[data-recent-trade-row]')).not.toHaveTextContent('0.00R');
  });

  it('renders the row at all when the System side is unresolved', () => {
    const { container } = renderCard([
      trade({
        systemStatus: 'pending',
        systemR: null,
        executionGapR: { status: 'unavailable', reason: 'system_incomplete' },
      }),
    ]);
    expect(container.querySelectorAll('[data-recent-trade-row]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'XAUUSD' })).toBeInTheDocument();
  });

  it('shows an explicit integrity state rather than a value it could not read', () => {
    const { container } = renderCard([
      trade({ executionGapR: { status: 'error', reason: 'data_integrity_error' } }),
    ]);
    const gap = container.querySelector('[data-recent-gap-status]');
    expect(gap).toHaveAttribute('data-recent-gap-status', 'error');
    expect(gap).toHaveTextContent('Error');
  });

  it('signs the Gap in text, not only in colour', () => {
    const { container } = renderCard([
      trade({ executionGapR: { status: 'available', value: '0.7500' } }),
    ]);
    expect(container.querySelector('[data-recent-gap-status="available"]')).toHaveTextContent(
      '+0.75R',
    );
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
