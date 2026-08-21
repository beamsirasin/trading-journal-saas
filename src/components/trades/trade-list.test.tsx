import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradeList, type TradeListView } from './trade-list';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ back: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const statuses = ['planned', 'open', 'closed', 'canceled'] as const;
const trades: TradeListView[] = statuses.map((status, index) => ({
  tradeId: `018f0000-0000-7000-8000-00000000000${index}`,
  occurredAt: '2026-08-08T00:00:00.000Z',
  occurredAtDisplay: '08 Aug 2026, 07:00',
  symbol: `SYM${index}`,
  direction: index % 2 === 0 ? 'long' : 'short',
  tradingAccountName: 'Main account',
  strategyName: `Pinned Strategy ${index}`,
  setupName: `Pinned Setup ${index}`,
  strategyVersionNumber: 2,
  status,
  systemStatus: index === 0 ? 'pending' : index === 3 ? 'no_trade' : 'resolved',
  plannedR: '5.0000',
  actualR: index < 2 ? null : '2.1250',
  systemR: index === 1 || index === 2 ? '-1.0000' : null,
  traderOutcome: index < 2 ? null : 'win',
  systemOutcome: index === 1 || index === 2 ? 'loss' : null,
  closedBps: 0,
  remainingBps: 10_000,
  realizedRToDate: null,
  setupConditionMetCount: null,
  setupConditionTotalCount: null,
  tradingAccountIsArchived: false,
  strategyIsArchived: false,
  setupIsArchived: false,
}));

describe('TradeList', () => {
  it('renders the real DAL presentation including pinned labels and independent statuses', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList
          trades={trades}
          selectedTradeId={trades[0]?.tradeId ?? null}
          nextCursor="next-page"
          hasCursor={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText('Pinned Strategy 0').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pinned Setup 0/).length).toBeGreaterThan(0);
    for (const label of [
      'Needs details',
      'Open',
      'Closed',
      'Canceled',
      'Pending',
      'Resolved',
      'No trade',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('+2.13R').length).toBeGreaterThan(0);
    expect(screen.queryByText('London Open Sweep')).not.toBeInTheDocument();
  });

  it('renders cursor pagination without client-side slicing controls', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList
          trades={trades.slice(0, 1)}
          selectedTradeId={null}
          nextCursor="opaque"
          hasCursor
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Trade pages' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/app/trades?cursor=opaque',
    );
    expect(screen.getByRole('button', { name: /Previous/ })).toBeEnabled();
  });

  it('shows Planned R (not a fake 0R) for a planned Trade or an open Trade with no Exits yet', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList
          trades={trades.slice(0, 2)}
          selectedTradeId={null}
          nextCursor={null}
          hasCursor={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText('+5.00R').length).toBeGreaterThan(0);
    expect(screen.queryByText('+0.00R')).not.toBeInTheDocument();
  });

  it('shows remaining % and Realized R (never the final Actual R) for a partially-exited open Trade', () => {
    const partial: TradeListView = {
      ...trades[1]!,
      closedBps: 5_000,
      remainingBps: 5_000,
      realizedRToDate: '1.0000',
    };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList trades={[partial]} selectedTradeId={null} nextCursor={null} hasCursor={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText('50% remaining').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+1.00R').length).toBeGreaterThan(0);
  });

  it('shows the final Actual R for a closed Trade, not a Planned or Realized label', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList
          trades={[trades[2]!]}
          selectedTradeId={null}
          nextCursor={null}
          hasCursor={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText('+2.13R').length).toBeGreaterThan(0);
    expect(screen.queryByText('Realized R')).not.toBeInTheDocument();
  });

  it('shows a batched Setup Condition adherence chip only when recorded, staying calm otherwise', () => {
    const withAdherence: TradeListView = {
      ...trades[0]!,
      setupConditionMetCount: 3,
      setupConditionTotalCount: 5,
    };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList
          trades={[withAdherence, trades[1]!]}
          selectedTradeId={null}
          nextCursor={null}
          hasCursor={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText('Setup 3/5').length).toBeGreaterThan(0);
  });

  it('truthfully discloses an archived live Strategy, Setup, and Trading Account without hiding the pinned historical label', () => {
    const withArchived: TradeListView = {
      ...trades[0]!,
      strategyIsArchived: true,
      setupIsArchived: true,
      tradingAccountIsArchived: true,
    };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeList
          trades={[withArchived, trades[1]!]}
          selectedTradeId={null}
          nextCursor={null}
          hasCursor={false}
        />
      </NextIntlClientProvider>,
    );
    // Pinned historical labels remain visible and unchanged.
    expect(screen.getAllByText('Pinned Strategy 0').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pinned Setup 0/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Main account').length).toBeGreaterThan(0);
    // Archived annotation appears once per surface (desktop table + mobile card).
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
    // A non-archived Trade's row shows no archived annotation.
    expect(
      screen.queryAllByText('Pinned Strategy 1').every((node) => {
        const row = node.closest('tr') ?? node.closest('a');
        return row === null || row.textContent?.includes('Archived') === false;
      }),
    ).toBe(true);
  });
});
