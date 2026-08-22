import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradesJournal } from './trades-journal';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/actions/trades', () => ({}));
vi.mock('@/components/trades/trade-detail', () => ({ TradeDetail: () => <div>Trade detail</div> }));
vi.mock('@/components/trades/trade-list', () => ({ TradeList: () => <div>Trade list</div> }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/app/trades',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/trades/trading-calendar', () => ({
  TradingCalendar: () => <div data-testid="calendar-surface">Calendar surface</div>,
}));

const calendar = {
  year: 2026,
  month: 8,
  todayDate: '2026-08-20',
  selectedDate: null,
  trader: [],
  system: [],
  traderTotalR: null,
  systemTotalR: null,
  tradingDays: 0,
  daySummary: null,
} as const;

function renderJournal(view: 'calendar' | 'log', attention: 'system-pending' | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradesJournal
        view={view}
        attention={attention}
        trades={[]}
        nextCursor={null}
        currentCursor={null}
        cursorTrail=""
        selectedTrade={null}
        selectedTradeId={null}
        canWrite={false}
        writeBlockReason={null}
        timezone="Asia/Bangkok"
        locale="en-GB"
        classificationOptions={[]}
        calendar={calendar}
      />
    </NextIntlClientProvider>,
  );
}

describe('TradesJournal views', () => {
  it('renders Calendar without stacking the Trade Log below it', () => {
    renderJournal('calendar');
    expect(screen.getByTestId('calendar-surface')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Trade Log' })).not.toBeInTheDocument();
  });

  it('renders Trade Log without stacking Calendar above it', () => {
    renderJournal('log');
    expect(screen.getByRole('heading', { name: 'Trade Log' })).toBeVisible();
    expect(screen.queryByTestId('calendar-surface')).not.toBeInTheDocument();
  });

  it('shows a focused empty state for the pending System workflow', () => {
    renderJournal('log', 'system-pending');
    expect(screen.getByText('No pending System outcomes')).toBeVisible();
    expect(screen.getByText('Only Trades whose System outcome still needs review.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Show all Trades' })).toHaveAttribute(
      'href',
      '/app/trades?view=log',
    );
  });
});
