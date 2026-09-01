import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradeList, type TradeListView } from './trade-list';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('month=2026-08&date=2026-08-20'),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ back: vi.fn() }),
  usePathname: () => '/app/trades',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function makeTrade(overrides: Partial<TradeListView> = {}): TradeListView {
  return {
    tradeId: '018f0000-0000-7000-8000-000000000001',
    occurredAt: '2026-08-20T07:32:00.000Z',
    occurredAtDisplay: '20 Aug 2026, 14:32',
    symbol: 'XAUUSD',
    direction: 'long',
    tradingAccountName: 'Main account',
    tradingAccountBaseCurrency: 'USD',
    strategyName: 'Elliott Wave',
    setupName: 'RSI confirmation',
    strategyVersionNumber: 2,
    status: 'closed',
    systemStatus: 'resolved',
    plannedR: '5.0000',
    actualR: '-0.5000',
    systemR: '2.0000',
    netPnlMinor: '-5000',
    traderOutcome: 'loss',
    systemOutcome: 'win',
    hasReviewNotes: true,
    closedBps: 10_000,
    remainingBps: 0,
    realizedRToDate: null,
    setupConditionMetCount: 3,
    setupConditionTotalCount: 5,
    tradingAccountIsArchived: false,
    strategyIsArchived: false,
    setupIsArchived: false,
    ...overrides,
  };
}

function renderList(
  trades: readonly TradeListView[],
  options: {
    canWrite?: boolean;
    nextCursor?: string | null;
    currentCursor?: string | null;
    cursorTrail?: string;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeList
        trades={trades}
        selectedTradeId={null}
        nextCursor={options.nextCursor ?? null}
        currentCursor={options.currentCursor ?? null}
        cursorTrail={options.cursorTrail ?? ''}
        canWrite={options.canWrite ?? true}
      />
    </NextIntlClientProvider>,
  );
}

describe('TradeList', () => {
  it('renders compact independent Actual/System states for closed, open, partial, and no-trade rows', () => {
    renderList([
      makeTrade(),
      makeTrade({
        tradeId: '018f0000-0000-7000-8000-000000000002',
        symbol: 'BTCUSD',
        status: 'open',
        actualR: null,
        closedBps: 5_000,
        remainingBps: 5_000,
        realizedRToDate: '1.0000',
        systemStatus: 'pending',
        systemR: null,
      }),
      makeTrade({
        tradeId: '018f0000-0000-7000-8000-000000000003',
        symbol: 'EURUSD',
        status: 'open',
        actualR: null,
        closedBps: 0,
        remainingBps: 10_000,
        systemStatus: 'no_trade',
        systemR: null,
      }),
    ]);

    const closed = screen.getByRole('listitem', { name: 'XAUUSD' });
    expect(within(closed).getByText('Closed')).toBeInTheDocument();
    expect(within(closed).getByText('-0.50R')).toHaveClass('text-negative');
    expect(within(closed).getByText('Resolved')).toBeInTheDocument();
    expect(within(closed).getByText('+2.00R')).toHaveClass('text-positive');

    const partial = screen.getByRole('listitem', { name: 'BTCUSD' });
    expect(within(partial).getByText('Open')).toBeInTheDocument();
    expect(within(partial).getByText('50% remaining')).toBeInTheDocument();
    expect(within(partial).getByText('+1.00R')).toBeInTheDocument();
    expect(within(partial).getByText('Pending')).toBeInTheDocument();

    const noTrade = screen.getByRole('listitem', { name: 'EURUSD' });
    expect(within(noTrade).getByText('No trade')).toBeInTheDocument();
    expect(within(noTrade).queryByText('+5.00R')).not.toBeInTheDocument();
  });

  it('uses one deterministic deep action: legacy Actual before pending System before Strategy', () => {
    renderList([
      makeTrade({
        status: 'planned',
        systemStatus: 'pending',
        strategyName: null,
        setupName: null,
        actualR: null,
        systemR: null,
      }),
    ]);

    const row = screen.getByRole('listitem', { name: 'XAUUSD' });
    expect(within(row).getByText('Needs execution details')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /Add execution details & Open/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/month=2026-08.*date=2026-08-20.*trade=.*section=actual/),
    );
    expect(within(row).queryByRole('link', { name: /Update outcome/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('link', { name: /Add Strategy/ })).not.toBeInTheDocument();
  });

  it('deep-links writable pending System and unassigned Strategy rows to the canonical sections', () => {
    renderList([
      makeTrade({ systemStatus: 'pending', systemR: null }),
      makeTrade({
        tradeId: '018f0000-0000-7000-8000-000000000002',
        symbol: 'BTCUSD',
        strategyName: null,
        setupName: null,
      }),
    ]);

    expect(
      within(screen.getByRole('listitem', { name: 'XAUUSD' })).getByRole('link', {
        name: /Update outcome/,
      }),
    ).toHaveAttribute('href', expect.stringContaining('section=system'));
    expect(
      within(screen.getByRole('listitem', { name: 'BTCUSD' })).getByRole('link', {
        name: /Add Strategy/,
      }),
    ).toHaveAttribute('href', expect.stringContaining('section=strategy'));
  });

  it('keeps read-only and over-limit-shaped rows navigable without mutation wording', () => {
    renderList(
      [makeTrade({ systemStatus: 'pending', systemR: null, strategyName: null, setupName: null })],
      { canWrite: false },
    );
    const row = screen.getByRole('listitem', { name: 'XAUUSD' });
    expect(within(row).getByRole('link', { name: /View System/ })).toHaveAttribute(
      'href',
      expect.stringContaining('section=system'),
    );
    expect(within(row).queryByText('Update outcome')).not.toBeInTheDocument();
    expect(within(row).queryByText('Add Strategy')).not.toBeInTheDocument();
  });

  it('opens an ordinary Trade at the default Actual section while preserving Calendar queries', () => {
    renderList([makeTrade()]);
    const open = screen.getByRole('link', { name: /Open Trade/ });
    expect(open).toHaveAttribute(
      'href',
      expect.stringMatching(/month=2026-08.*date=2026-08-20.*trade=/),
    );
    expect(open.getAttribute('href')).not.toContain('section=');
  });

  it('keeps only first-layer fields and relocates Setup, version, checklist, outcomes, and Planned R', () => {
    renderList([makeTrade()]);
    expect(screen.getByText('Elliott Wave')).toBeInTheDocument();
    expect(screen.queryByText('RSI confirmation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Version 2/)).not.toBeInTheDocument();
    expect(screen.queryByText('Setup 3/5')).not.toBeInTheDocument();
    expect(screen.queryByText('Win')).not.toBeInTheDocument();
    expect(screen.queryByText('Loss')).not.toBeInTheDocument();
    expect(screen.queryByText('+5.00R')).not.toBeInTheDocument();
    for (const detailOnly of ['Confidence', 'Emotion', 'Entry reason', 'Rules', 'Mistakes']) {
      expect(screen.queryByText(detailOnly)).not.toBeInTheDocument();
    }
  });

  it('preserves archived Account and Strategy history, and keeps pagination query-safe', () => {
    renderList(
      [
        makeTrade({
          tradingAccountIsArchived: true,
          strategyIsArchived: true,
          setupIsArchived: true,
        }),
      ],
      { nextCursor: 'opaque', currentCursor: 'current', cursorTrail: 'prior' },
    );
    expect(screen.getAllByText('Main account')).toHaveLength(2);
    expect(screen.getByText('Elliott Wave')).toBeInTheDocument();
    expect(screen.getAllByText('Archived')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /Next/ })).toHaveAttribute(
      'href',
      '/app/trades?month=2026-08&date=2026-08-20&cursor=opaque&trail=prior%2Ccurrent',
    );
    expect(screen.getByRole('link', { name: /Previous/ })).toHaveAttribute(
      'href',
      '/app/trades?month=2026-08&date=2026-08-20&cursor=prior',
    );
    expect(screen.getByText('Page 3')).toBeVisible();
  });
});
