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
  actualR: index < 2 ? null : '2.1250',
  systemR: index === 1 || index === 2 ? '-1.0000' : null,
  traderOutcome: index < 2 ? null : 'win',
  systemOutcome: index === 1 || index === 2 ? 'loss' : null,
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
      'Planned',
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
});
