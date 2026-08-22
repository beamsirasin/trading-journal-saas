import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradingCalendar, type TradingCalendarProps } from './trading-calendar';

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function baseProps(overrides: Partial<TradingCalendarProps> = {}): TradingCalendarProps {
  return {
    year: 2026,
    month: 8,
    locale: 'en-GB',
    todayDate: '2026-08-20',
    selectedDate: null,
    trader: [
      { date: '2026-08-05', totalR: '2.5000', count: 2 },
      { date: '2026-08-20', totalR: '-1.0000', count: 1 },
    ],
    system: [{ date: '2026-08-21', totalR: '3.0000', count: 1 }],
    traderTotalR: '1.5000',
    systemTotalR: '3.0000',
    tradingDays: 3,
    daySummary: null,
    ...overrides,
  };
}

function renderCalendar(props: TradingCalendarProps = baseProps()) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradingCalendar {...props} />
    </NextIntlClientProvider>,
  );
}

describe('TradingCalendar (Phase 14D)', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('renders the month grid with Trader R values by default, never showing Analytics KPIs', () => {
    const { container } = renderCalendar();
    expect(screen.getByText('Trading Calendar')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /5 August 2026.*Trader result.*\+2\.50R.*2 trades/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /20 August 2026.*Trader result.*-1\.00R.*1 trade/ }),
    ).toBeVisible();
    expect(container.textContent).not.toMatch(/expectancy|profit factor|max drawdown/i);
  });

  it('never fabricates a 0R for a day with no finalized result', () => {
    renderCalendar();
    // Aug 1 has no bucket at all — its cell shows only the day number, no R.
    const day1 = screen.getByRole('button', { name: /^1 August 2026, no results/ });
    expect(within(day1).queryByText(/0\.00R/)).not.toBeInTheDocument();
  });

  it('switches to System R values when the axis toggle is used, without changing the URL', async () => {
    const user = userEvent.setup();
    renderCalendar();
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(
      screen.getByRole('button', { name: /21 August 2026.*System result.*\+3\.00R.*1 result/ }),
    ).toBeVisible();
    expect(screen.queryByText('-1.00R')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('links Previous/Next month and Today to the correct query params', () => {
    renderCalendar();
    expect(screen.getByRole('link', { name: 'Previous month' })).toHaveAttribute(
      'href',
      '/app/trades?view=calendar&month=2026-07',
    );
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute(
      'href',
      '/app/trades?view=calendar&month=2026-09',
    );
    expect(screen.getByRole('button', { name: 'Today' }).closest('a')).toHaveAttribute(
      'href',
      '/app/trades?view=calendar',
    );
  });

  it('rolls Next month over the year boundary from December', () => {
    renderCalendar(baseProps({ year: 2026, month: 12, todayDate: '2026-12-01' }));
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute(
      'href',
      '/app/trades?view=calendar&month=2027-01',
    );
  });

  it('clicking a day navigates to that date, preserving the month', async () => {
    const user = userEvent.setup();
    renderCalendar();
    await user.click(screen.getByRole('button', { name: /^20 August 2026/ }));
    expect(push).toHaveBeenCalledWith('/app/trades?view=log&month=2026-08&date=2026-08-20');
  });

  it('marks the selected day distinctly from today, and both are announced without relying on color alone', () => {
    renderCalendar(baseProps({ selectedDate: '2026-08-05' }));
    const selected = screen.getByRole('button', { name: /^5 August 2026/ });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    const today = screen.getByRole('button', { name: /^20 August 2026/ });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking an already-selected day still opens that date in Trade Log', async () => {
    const user = userEvent.setup();
    renderCalendar(baseProps({ selectedDate: '2026-08-05' }));
    await user.click(screen.getByRole('button', { name: /^5 August 2026/ }));
    expect(push).toHaveBeenCalledWith('/app/trades?view=log&month=2026-08&date=2026-08-05');
  });

  it('shows the selected-day summary label and a working Clear date action', async () => {
    const user = userEvent.setup();
    renderCalendar(
      baseProps({
        selectedDate: '2026-08-20',
        daySummary: {
          actualR: '-1.0000',
          systemR: null,
          trades: 2,
          open: 1,
          pendingSystem: 1,
          unclassified: 0,
        },
      }),
    );
    expect(screen.getByText('20 August 2026')).toBeVisible();
    const summary = screen.getByTestId('calendar-day-summary');
    expect(within(summary).getByText('-1.00R')).toBeVisible();
    expect(within(summary).getByText('No results')).toBeVisible(); // System R, unfinished that day
    expect(within(summary).getByText('Open')).toBeVisible();
    expect(within(summary).getByText('Pending System')).toBeVisible();
    // unclassified is 0 — omitted entirely, not shown as "0".
    expect(within(summary).queryByText('Unclassified')).not.toBeInTheDocument();

    await user.click(within(summary).getByRole('button', { name: 'Clear date' }));
    expect(push).toHaveBeenCalledWith('/app/trades?view=calendar&month=2026-08');
  });

  it('shows the month summary totals, using "No results" rather than a fabricated 0R when nothing finalized', () => {
    renderCalendar(baseProps({ traderTotalR: null, systemTotalR: null, tradingDays: 0 }));
    expect(screen.getAllByText('No results')).toHaveLength(2);
    expect(screen.getByText('0')).toBeVisible(); // Trading days
  });
});
