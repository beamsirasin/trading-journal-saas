import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import { TradesMobileList } from './trades-mobile-list';
import type { TradesWorkspaceRow } from './workspace-row';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/app/trades',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('view=log'),
}));

function row(overrides: Partial<TradesWorkspaceRow> = {}): TradesWorkspaceRow {
  return {
    tradeId: '018f0000-0000-7000-8000-000000000001',
    occurredAt: '2026-08-24T07:32:00.000Z',
    occurredAtDisplay: '24 Aug 2026',
    symbol: 'XAUUSD',
    direction: 'long',
    tradingAccountName: 'Main account',
    tradingAccountBaseCurrency: 'USD',
    strategyName: 'Elliott Wave',
    setupName: 'Wave 3',
    strategyVersionNumber: 2,
    status: 'closed',
    systemStatus: 'resolved',
    plannedR: '3.0000',
    actualR: '2.2000',
    systemR: '3.0000',
    netPnlMinor: '22000',
    traderOutcome: 'win',
    systemOutcome: 'win',
    hasReviewNotes: true,
    closedBps: 10_000,
    remainingBps: 0,
    realizedRToDate: null,
    setupConditionMetCount: null,
    setupConditionTotalCount: null,
    tradingAccountIsArchived: false,
    strategyIsArchived: false,
    setupIsArchived: false,
    ...overrides,
  };
}

function renderList(
  trades: readonly TradesWorkspaceRow[] = [row()],
  selected: string | null = null,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradesMobileList trades={trades} selectedTradeId={selected} />
    </NextIntlClientProvider>,
  );
}

describe('TradesMobileList', () => {
  it('is a list of Trades, not a compressed table', () => {
    const { container } = renderList();
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByRole('list', { name: 'Trades' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('surfaces symbol, result, date, money, R and the classification', () => {
    renderList();
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('XAUUSD')).toBeInTheDocument();
    expect(within(item).getByText('WIN')).toBeInTheDocument();
    expect(within(item).getByText('24 Aug 2026')).toBeInTheDocument();
    expect(within(item).getByText(/220\.00 USD/)).toBeInTheDocument();
    expect(within(item).getByText(/2\.20R/)).toBeInTheDocument();
    expect(within(item).getByText('Elliott Wave · Wave 3')).toBeInTheDocument();
    expect(within(item).getByText('Reviewed')).toBeInTheDocument();
  });

  it('labels the two bare figures for a screen reader', () => {
    // Sighted readers get position; everyone else needs the words.
    renderList();
    const item = screen.getByRole('listitem');
    // Rendered as "P&L: " / "R: " immediately before the figure, so the
    // matcher allows the separator the label actually carries.
    expect(within(item).getByText(/^P&L:/)).toBeInTheDocument();
    expect(within(item).getByText(/^R:/)).toBeInTheDocument();
  });

  it('keeps a row to two targets: open the Trade, or go to the work it needs', () => {
    renderList([row({ hasReviewNotes: false })]);
    const links = within(screen.getByRole('listitem')).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toContain('trade=018f0000-0000-7000-8000-000000000001');
    expect(links[1]?.getAttribute('href')).toContain('tab=review');
  });

  it('is one target only when there is nothing left to do', () => {
    renderList();
    expect(within(screen.getByRole('listitem')).getAllByRole('link')).toHaveLength(1);
  });

  it('says a Trade is unclassified once, rather than printing two dashes', () => {
    renderList([row({ strategyName: null, setupName: null })]);
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
  });

  it('derives every state exactly as the desktop table does', () => {
    const { container } = renderList([row({ status: 'planned' })]);
    expect(container.querySelector('[data-trade-review-state="needs_details"]')).not.toBeNull();
    expect(screen.getByText('PLANNED')).toBeInTheDocument();
  });

  it('marks the open Trade as current', () => {
    renderList([row()], '018f0000-0000-7000-8000-000000000001');
    expect(screen.getByRole('link', { name: /XAUUSD/ })).toHaveAttribute('aria-current', 'true');
  });
});
