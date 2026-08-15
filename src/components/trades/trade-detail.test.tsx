import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeDetail } from './trade-detail';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/server/actions/trades', () => ({}));

const base: TradeDetailModel = {
  tradeId: '018f0000-0000-7000-8000-000000000001',
  tradingAccountId: 'a',
  tradingAccountName: 'Main JPY',
  tradingAccountBaseCurrency: 'JPY',
  strategyId: 's',
  strategyName: 'Pinned Breakout',
  strategyVersionNumber: 4,
  setupId: 'x',
  setupName: 'Pinned Retest',
  status: 'planned',
  systemStatus: 'pending',
  symbol: 'XAUUSD',
  direction: 'long',
  timeframe: null,
  session: null,
  confidence: null,
  confirmationNotes: null,
  tradingviewUrl: null,
  notes: null,
  hasChartAttachment: false,
  chartAttachmentUploadedAt: null,
  plannedEntry: '100.0000',
  plannedStop: '90.0000',
  plannedTarget: null,
  plannedPositionSize: null,
  plannedRiskMinor: null,
  plannedRewardMinor: null,
  plannedR: null,
  actualEntry: null,
  actualInitialStop: null,
  actualPositionSize: null,
  actualInitialRiskMinor: null,
  actualExit: null,
  grossPnlMinor: null,
  commissionMinor: '0',
  feesMinor: '0',
  swapMinor: '0',
  netPnlMinor: null,
  actualR: null,
  traderOutcome: null,
  enteredAt: null,
  exitedAt: null,
  systemExitPrice: null,
  systemExitedAt: null,
  systemExitReason: null,
  systemCostR: '0.0000',
  systemR: null,
  systemOutcome: null,
  systemResolvedAt: null,
  ruleChecks: [
    {
      ruleKey: 'r',
      scope: 'strategy',
      title: 'Wait for confirmation',
      category: 'entry',
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: 0,
      checkStatus: 'not_checked',
    },
  ],
  mistakes: [
    {
      mistakeTypeId: 'm',
      key: 'fomo',
      label: 'FOMO entry',
      severityAtTime: 'moderate',
      weightAtTime: '1.0000',
      note: 'Entered early',
    },
  ],
  mistakeCatalog: [],
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

function renderDetail(trade: TradeDetailModel) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeDetail trade={trade} timezone="Asia/Bangkok" locale="en-GB" canWrite={false} />
    </NextIntlClientProvider>,
  );
}

describe('TradeDetail', () => {
  it('shows a plan-only Trade without invented numeric zero values', () => {
    renderDetail(base);
    expect(
      screen.getByText('This Trade has not been opened. No actual execution has been recorded.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/System result is Pending/)).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.00R')).not.toBeInTheDocument();
  });

  it('renders Confidence as "X% · Label", never "/100" or "/5"', () => {
    renderDetail({ ...base, confidence: 75 });
    expect(screen.getByText('75% · High')).toBeInTheDocument();
    expect(screen.queryByText(/75\/100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/5\b/)).not.toBeInTheDocument();
  });

  it('renders no Confidence row when unset', () => {
    renderDetail({ ...base, confidence: null });
    expect(screen.queryByText('Confidence')).not.toBeInTheDocument();
  });

  it('renders a Chart attachment via the authenticated delivery route, never a stored URL', () => {
    renderDetail({
      ...base,
      hasChartAttachment: true,
      chartAttachmentUploadedAt: '2026-08-08T00:00:00.000Z',
    });
    const image = screen.getByAltText('Uploaded chart image') as HTMLImageElement;
    expect(image.src).toBe(`http://localhost:3000/api/trades/${base.tradeId}/chart-attachment`);
    const link = screen.getByRole('link', { name: /Open chart image/ });
    expect(link).toHaveAttribute('href', `/api/trades/${base.tradeId}/chart-attachment`);
  });

  it('renders no Chart attachment section when the Trade has none', () => {
    renderDetail({ ...base, hasChartAttachment: false });
    expect(screen.queryByAltText('Uploaded chart image')).not.toBeInTheDocument();
  });

  it('renders resolved System and closed Trader independently with safe money formatting', () => {
    renderDetail({
      ...base,
      status: 'closed',
      systemStatus: 'resolved',
      actualEntry: '101',
      actualInitialStop: '91',
      actualInitialRiskMinor: '500',
      actualExit: '120',
      netPnlMinor: '1000',
      actualR: '2.0000',
      traderOutcome: 'win',
      enteredAt: '2026-08-08T00:00:00.000Z',
      exitedAt: '2026-08-08T01:00:00.000Z',
      systemExitPrice: '130',
      systemExitedAt: '2026-08-08T02:00:00.000Z',
      systemExitReason: 'target_hit',
      systemR: '3.0000',
      systemOutcome: 'win',
    });
    expect(screen.getByText('500 JPY')).toBeInTheDocument();
    expect(screen.getByText('1,000 JPY')).toBeInTheDocument();
    expect(screen.getByText('+3.00R')).toBeInTheDocument();
    expect(screen.getByText('Target hit')).toBeInTheDocument();
  });

  it('renders no-trade, Rule groups, and mistakes without scores or controls', () => {
    renderDetail({ ...base, systemStatus: 'no_trade' });
    expect(screen.getByText(/would not have permitted this Trade/)).toBeInTheDocument();
    expect(screen.getByText('Strategy Rules')).toBeInTheDocument();
    expect(screen.getByText('Wait for confirmation')).toBeInTheDocument();
    expect(screen.getByText('FOMO entry')).toBeInTheDocument();
    expect(screen.getByText('Entered early')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove|attach|edit/i })).not.toBeInTheDocument();
  });
});
