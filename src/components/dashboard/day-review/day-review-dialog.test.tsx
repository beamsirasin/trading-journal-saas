import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DayReviewData, DayReviewTradeRow } from '@/lib/dashboard/day-review';

import en from '../../../../messages/en.json';
import { DayReviewDialog } from './day-review-dialog';

const navigateDashboardState = vi.fn();

vi.mock('@/components/dashboard/dashboard-state-link', () => ({
  DashboardStateLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={`/en${href}`} {...rest}>
      {children}
    </a>
  ),
  useDashboardStateNavigation: () => navigateDashboardState,
}));

const row = (overrides: Partial<DayReviewTradeRow> = {}): DayReviewTradeRow => ({
  tradeId: 'trade-1',
  occurredAt: '2026-03-05T06:00:00.000Z',
  axisAt: '2026-03-05T06:00:00.000Z',
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

const BASE = { date: '2026-03-05', timezone: 'Asia/Bangkok' } as const;

const actualReview: DayReviewData = {
  status: 'available',
  mode: 'actual',
  ...BASE,
  headline: {
    mode: 'actual',
    totalR: '1.5000',
    eligibleTradeCount: 2,
    wins: 1,
    breakEvens: 0,
    losses: 1,
    classification: 'winning',
  },
  trades: [row(), row({ tradeId: 'trade-2', symbol: 'EURUSD', actualR: '-0.5000' })],
};

const gapReview: DayReviewData = {
  status: 'available',
  mode: 'gap',
  ...BASE,
  headline: {
    mode: 'gap',
    pairedTradeCount: 2,
    systemR: '4.0000',
    actualR: '1.5000',
    gapR: '-2.5000',
    classification: 'underperformed',
    underperformedCount: 2,
    matchedCount: 0,
    outperformedCount: 0,
  },
  trades: [row(), row({ tradeId: 'trade-2', symbol: 'EURUSD' })],
};

function renderDialog(review: DayReviewData, tradeHrefs: Record<string, string> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DayReviewDialog
        review={review}
        dateLabel="Thursday, 5 March 2026"
        closeHref="/app?range=30d&month=2026-03"
        tradeHrefs={tradeHrefs}
        timezone="Asia/Bangkok"
        dateLocale="en-GB"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  navigateDashboardState.mockClear();
});

describe('Day Review dialog semantics', () => {
  /** §26 — proper dialog semantics, a title and a described-by relationship. */
  it('is a labelled, described dialog', () => {
    renderDialog(actualReview);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Thursday, 5 March 2026');
    expect(dialog).toHaveAccessibleDescription(/Closed Trades you exited on this day/);
  });

  /**
   * §10/§18 — closing returns to the Calendar at the same month, mode and
   * filters. It never destroys the Calendar and never lands on a bare route.
   */
  it('closes back to the same Calendar state rather than dismissing into React memory', async () => {
    const user = userEvent.setup();
    renderDialog(actualReview);
    await user.keyboard('{Escape}');
    expect(navigateDashboardState).toHaveBeenCalledWith('/app?range=30d&month=2026-03');
  });

  it('offers a close affordance that is itself an ordinary link to that state', () => {
    renderDialog(actualReview);
    expect(document.body.querySelector('[data-day-review-close]')).toHaveAttribute(
      'href',
      '/en/app?range=30d&month=2026-03',
    );
  });
});

describe('Actual Day Review', () => {
  /**
   * §11/§12 — the headline is the clicked square's own numbers, passed
   * through. The two rows here sum to +1.50R; the point of this test is that
   * the panel shows the HEADLINE's figure rather than a second aggregation.
   */
  it('shows the Calendar day total, eligible count and W/BE/L', () => {
    renderDialog(actualReview);
    const headline = document.body.querySelector(
      '[data-day-review-headline="actual"]',
    ) as HTMLElement;
    expect(within(headline).getByText('Actual Total R')).toBeInTheDocument();
    expect(headline).toHaveTextContent('+1.50R');
    expect(within(headline).getByText('Eligible Trades')).toBeInTheDocument();
    expect(headline).toHaveTextContent('Won');
    expect(headline).toHaveTextContent('Break even');
    expect(headline).toHaveTextContent('Lost');
  });

  it('renders one compact row per Trade with its own three figures', () => {
    renderDialog(actualReview);
    const rows = document.body.querySelectorAll('[data-day-review-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('XAUUSD');
    expect(rows[0]).toHaveTextContent('+2.00R');
    expect(rows[0]).toHaveTextContent('+3.00R');
    expect(rows[0]).toHaveTextContent('-1.00R');
  });

  it('preserves an unresolved System state on a row', () => {
    renderDialog({
      ...actualReview,
      trades: [
        row({
          systemStatus: 'pending',
          systemR: null,
          executionGapR: { status: 'unavailable', reason: 'system_incomplete' },
        }),
      ],
    });
    expect(document.body.querySelector('[data-day-review-gap-status]')).toHaveAttribute(
      'data-day-review-gap-status',
      'unavailable',
    );
    expect(document.body.querySelector('[data-day-review-row]')).toHaveTextContent('Pending');
  });
});

describe('Gap Day Review', () => {
  /**
   * §14 — a Gap day is never a winning or losing day. The vocabulary is
   * relative, and the supporting System and Actual figures are present so the
   * difference can be read rather than taken on trust.
   */
  it('reports the Gap, the paired count and both sides, with relative wording', () => {
    renderDialog(gapReview);
    const headline = document.body.querySelector('[data-day-review-headline="gap"]') as HTMLElement;
    expect(within(headline).getByText('Total Execution Gap')).toBeInTheDocument();
    expect(headline).toHaveTextContent('-2.50R');
    expect(within(headline).getByText('Paired Trades')).toBeInTheDocument();
    expect(within(headline).getByText('System R')).toBeInTheDocument();
    expect(within(headline).getByText('Actual R')).toBeInTheDocument();
    expect(headline).not.toHaveTextContent(/Won|Lost/);
  });

  it('shows the relative distribution instead of an outcome tally', () => {
    renderDialog(gapReview);
    const distribution = document.body.querySelector(
      '[data-day-review-distribution]',
    ) as HTMLElement;
    expect(within(distribution).getByText('Underperformed')).toBeInTheDocument();
    expect(within(distribution).getByText('Matched')).toBeInTheDocument();
    expect(within(distribution).getByText('Outperformed')).toBeInTheDocument();
  });

  it('describes the Gap population and its anchoring axis', () => {
    renderDialog(gapReview);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      /both sides complete, anchored to the day you exited/,
    );
  });
});

describe('Day Review Trade selection', () => {
  /** §15 — clicking a Trade sets `trade` in the URL, keeping the day. */
  it('links each row to its Quick Preview URL', () => {
    renderDialog(actualReview, {
      'trade-1': '/app?range=30d&month=2026-03&day=2026-03-05&trade=trade-1',
    });
    const link = document.body.querySelector('[data-day-review-trade]');
    expect(link).toHaveAttribute(
      'href',
      '/en/app?range=30d&month=2026-03&day=2026-03-05&trade=trade-1',
    );
  });

  it('leaves a row inert rather than linking nowhere when no href exists', () => {
    renderDialog(actualReview);
    expect(document.body.querySelector('[data-day-review-trade]')).toBeNull();
    expect(document.body.querySelectorAll('[data-day-review-row]')).toHaveLength(2);
  });
});

describe('Day Review states', () => {
  it('reports an empty day per mode without calling it an error', () => {
    renderDialog({
      status: 'empty',
      reason: 'no_eligible_trades',
      mode: 'system',
      ...BASE,
    });
    expect(screen.getByText('Nothing on this day')).toBeInTheDocument();
    expect(
      screen.getByText('No System outcome resolved on this day within the current filters.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an integrity error as an alert, not as an empty day', () => {
    renderDialog({
      status: 'error',
      reason: 'data_integrity_error',
      mode: 'actual',
      ...BASE,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('This day could not be read');
    expect(screen.queryByText('Nothing on this day')).not.toBeInTheDocument();
  });
});
