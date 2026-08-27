import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CalendarDay, CalendarMode, CalendarMonthModel } from '@/lib/dashboard/calendar';

import en from '../../../../messages/en.json';
import { DashboardCalendarCard, type DashboardCalendarHrefs } from './dashboard-calendar-card';

vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const BASE = { year: 2026, month: 3, timezone: 'Asia/Bangkok' } as const;

const performanceDay = (overrides: Partial<CalendarDay> = {}): CalendarDay =>
  ({
    mode: 'actual',
    date: '2026-03-05',
    eligibleTradeCount: 3,
    totalR: '1.5000',
    wins: 2,
    breakEvens: 0,
    losses: 1,
    classification: 'winning',
    ...overrides,
  }) as CalendarDay;

const gapDay = (overrides: Partial<CalendarDay> = {}): CalendarDay =>
  ({
    mode: 'gap',
    date: '2026-03-05',
    pairedTradeCount: 2,
    systemR: '4.0000',
    actualR: '1.5000',
    gapR: '-2.5000',
    classification: 'underperformed',
    underperformedCount: 2,
    matchedCount: 0,
    outperformedCount: 0,
    ...overrides,
  }) as CalendarDay;

function availableMonth(mode: CalendarMode, days: readonly CalendarDay[]): CalendarMonthModel {
  return {
    status: 'available',
    mode,
    ...BASE,
    days,
    totals: {
      populatedDayCount: days.length,
      eligibleTradeCount: days.length,
      totalR: mode === 'gap' ? '-2.5000' : '1.5000',
      classifiedDayCounts: {
        positive: mode === 'gap' ? 0 : 1,
        neutral: 0,
        negative: mode === 'gap' ? 1 : 0,
      },
    },
  };
}

function hrefs(days: readonly string[] = ['2026-03-05']): DashboardCalendarHrefs {
  return {
    modes: {
      actual: '/app?range=30d',
      system: '/app?range=30d&mode=system',
      gap: '/app?range=30d&mode=gap',
    },
    previousMonth: '/app?range=30d&month=2026-02',
    nextMonth: '/app?range=30d&month=2026-04',
    currentMonth: '/app?range=30d',
    days: Object.fromEntries(
      days.map((date) => [date, `/app?range=30d&month=2026-03&day=${date}`]),
    ),
  };
}

function renderCard(
  month: CalendarMonthModel,
  overrides: Partial<React.ComponentProps<typeof DashboardCalendarCard>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DashboardCalendarCard
        month={month}
        mode={month.mode}
        year={2026}
        monthNumber={3}
        todayDate="2026-03-11"
        selectedDate={null}
        dateLocale="en-GB"
        hrefs={hrefs()}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe('Dashboard Calendar card', () => {
  it('publishes its registry identity and its section metadata', () => {
    const { container } = renderCard(availableMonth('actual', [performanceDay()]));
    const widget = container.querySelector('[data-dashboard-widget="calendar.performance"]');
    expect(widget).toHaveAttribute('data-dashboard-section', 'recent-and-calendar');
    expect(widget).toHaveAttribute('data-dashboard-section-columns', '12');
    expect(widget).toHaveAttribute('data-dashboard-desktop-span', '5');
  });

  it('renders one grid for a populated month with a link per populated date', () => {
    const { container } = renderCard(availableMonth('actual', [performanceDay()]));
    expect(container.querySelectorAll('[data-calendar-cell="populated"]')).toHaveLength(1);
    // Thirty-one dates, one of which is populated.
    expect(container.querySelectorAll('[data-calendar-cell="empty"]')).toHaveLength(30);
  });

  /**
   * §9 — a date with nothing eligible must not read as a 0R performance day.
   * It is not a link, carries no R value, and is hidden from assistive tech
   * behind the grid's own one-sentence summary.
   */
  it('does not present a date with no eligible Trades as a zero day', () => {
    const { container } = renderCard(availableMonth('actual', [performanceDay()]));
    const blank = container.querySelector('[data-calendar-date="2026-03-06"]');
    expect(blank).toHaveAttribute('data-calendar-cell', 'empty');
    expect(blank?.tagName).not.toBe('A');
    expect(blank?.textContent).toBe('6');
    expect(
      screen.getByText(/1 of 31 dates in this month have eligible Trades/),
    ).toBeInTheDocument();
  });

  /**
   * §9 again, from the other side: an ELIGIBLE day that happened to total
   * 0.00R is a real day and must show its zero and its Trade count.
   */
  it('shows an eligible zero-R day as a populated, neutral day', () => {
    const { container } = renderCard(
      availableMonth('actual', [
        performanceDay({
          totalR: '0.0000',
          classification: 'break_even',
          wins: 1,
          breakEvens: 0,
          losses: 1,
        }),
      ]),
    );
    const cell = container.querySelector('[data-calendar-date="2026-03-05"]');
    expect(cell).toHaveAttribute('data-calendar-cell', 'populated');
    expect(cell).toHaveAttribute('data-calendar-tone', 'neutral');
    expect(cell).toHaveTextContent('0.00R');
  });

  it('tones a winning day positive and a losing day negative', () => {
    const { container } = renderCard(
      availableMonth('actual', [
        performanceDay(),
        performanceDay({
          date: '2026-03-06',
          totalR: '-1.2500',
          classification: 'losing',
          wins: 0,
          losses: 2,
        }),
      ]),
      { hrefs: hrefs(['2026-03-05', '2026-03-06']) },
    );
    expect(container.querySelector('[data-calendar-date="2026-03-05"]')).toHaveAttribute(
      'data-calendar-tone',
      'positive',
    );
    expect(container.querySelector('[data-calendar-date="2026-03-06"]')).toHaveAttribute(
      'data-calendar-tone',
      'negative',
    );
  });

  /**
   * §26 — the sign must never be carried by colour alone. Every cell states
   * its own signed R value and a full sentence for assistive tech.
   */
  it('states the sign in text as well as in colour', () => {
    renderCard(availableMonth('actual', [performanceDay()]));
    const cell = screen.getByRole('link', { name: /Thursday, 5 March 2026/ });
    expect(cell).toHaveTextContent('+1.50R');
    expect(cell).toHaveAccessibleName(/\+1\.50R across 3 Trades\. 2 won, 0 broke even, 1 lost/);
    expect(cell).toHaveAccessibleName(/A winning day/);
  });

  it('marks the selected day as the current page state', () => {
    const { container } = renderCard(availableMonth('actual', [performanceDay()]), {
      selectedDate: '2026-03-05',
    });
    expect(container.querySelector('[data-calendar-date="2026-03-05"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('Dashboard Calendar modes', () => {
  it('offers all three modes and marks the active one', () => {
    const { container } = renderCard(
      availableMonth('system', [performanceDay({ mode: 'system' })]),
    );
    const control = container.querySelector('[data-calendar-mode-control]') as HTMLElement;
    expect(within(control).getAllByRole('link')).toHaveLength(3);
    expect(control.querySelector('[data-calendar-mode-option="system"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(control.querySelector('[data-calendar-mode-option="actual"]')).not.toHaveAttribute(
      'aria-current',
    );
  });

  /**
   * §5 — the three modes are different populations on different date axes,
   * not a display toggle over one set of Trades. The card says which question
   * it is answering rather than letting the grid imply they share a universe.
   */
  it('states each mode population and axis rather than implying one Trade universe', () => {
    const { rerender } = renderCard(availableMonth('actual', [performanceDay()]));
    expect(screen.getByText('Closed Trades, by the day you exited.')).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <DashboardCalendarCard
          month={availableMonth('system', [performanceDay({ mode: 'system' })])}
          mode="system"
          year={2026}
          monthNumber={3}
          todayDate="2026-03-11"
          selectedDate={null}
          dateLocale="en-GB"
          hrefs={hrefs()}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText('Resolved System outcomes, by the day the System exit resolved.'),
    ).toBeInTheDocument();
  });

  /**
   * §7 — Gap days are never called winning or losing days.
   */
  it('uses relative vocabulary in Gap mode and never a win/loss verdict', () => {
    renderCard(availableMonth('gap', [gapDay()]));
    const cell = screen.getByRole('link', { name: /Thursday, 5 March 2026/ });
    expect(cell).toHaveAccessibleName(/Execution Gap -2\.50R across 2 paired Trades/);
    expect(cell).toHaveAccessibleName(/You underperformed the System/);
    expect(cell).not.toHaveAccessibleName(/winning|losing/i);
    expect(screen.getByText('Execution Gap')).toBeInTheDocument();
  });

  it('labels the Gap month total as a Gap, not as an Actual total', () => {
    const { container } = renderCard(availableMonth('gap', [gapDay()]));
    expect(container.querySelector('[data-calendar-summary-total]')).toHaveTextContent('-2.50R');
    expect(screen.getByText('Paired')).toBeInTheDocument();
  });
});

describe('Dashboard Calendar month navigation', () => {
  it('links to the previous and next month, preserving the Dashboard filters', () => {
    renderCard(availableMonth('actual', [performanceDay()]));
    expect(screen.getByRole('link', { name: 'Previous month' })).toHaveAttribute(
      'href',
      '/en/app?range=30d&month=2026-02',
    );
    expect(screen.getByRole('link', { name: 'Next month' })).toHaveAttribute(
      'href',
      '/en/app?range=30d&month=2026-04',
    );
  });

  it('labels the month in the Gregorian calendar', () => {
    const { container } = renderCard(availableMonth('actual', [performanceDay()]));
    expect(container.querySelector('[data-calendar-month-label]')).toHaveTextContent('March 2026');
  });

  it('omits the "this month" shortcut when it would go nowhere', () => {
    renderCard(availableMonth('actual', [performanceDay()]), {
      hrefs: { ...hrefs(), currentMonth: null },
    });
    expect(screen.queryByRole('link', { name: 'This month' })).not.toBeInTheDocument();
  });
});

describe('Dashboard Calendar states', () => {
  it('renders an empty month as an intentional empty state, not a skeleton', () => {
    const { container } = renderCard({
      status: 'empty',
      reason: 'no_eligible_trades',
      mode: 'actual',
      ...BASE,
    });
    expect(container.querySelector('[data-calendar-state="empty"]')).toBeInTheDocument();
    expect(container.querySelector('[data-calendar-grid]')).toBeNull();
    expect(screen.getByText('Nothing eligible this month')).toBeInTheDocument();
    expect(screen.getByText(/Page to another month, or widen the date range/)).toBeInTheDocument();
  });

  /**
   * `empty` is not `error`. A failed R parse must never be reported to a
   * reader as "no Trades yet".
   */
  it('distinguishes an integrity error from an empty month', () => {
    const { container } = renderCard({
      status: 'error',
      reason: 'data_integrity_error',
      mode: 'actual',
      ...BASE,
    });
    expect(container.querySelector('[data-calendar-state="error"]')).toHaveAttribute(
      'role',
      'alert',
    );
    expect(screen.getByText('The Calendar could not be built')).toBeInTheDocument();
    expect(screen.queryByText('Nothing eligible this month')).not.toBeInTheDocument();
  });

  it('gives each mode its own empty explanation', () => {
    renderCard(
      { status: 'empty', reason: 'no_eligible_trades', mode: 'gap', ...BASE },
      {
        mode: 'gap',
      },
    );
    expect(screen.getByText(/The Gap needs both sides/)).toBeInTheDocument();
  });
});
