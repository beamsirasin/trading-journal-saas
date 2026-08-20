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
  tradingAccountIsArchived: false,
  strategyId: 's',
  strategyName: 'Pinned Breakout',
  strategyVersionNumber: 4,
  strategyIsArchived: false,
  setupId: 'x',
  setupName: 'Pinned Retest',
  setupIsArchived: false,
  strategyAssignedAt: '2026-08-08T00:00:00.000Z',
  setupAssignedAt: '2026-08-08T00:00:00.000Z',
  executionGapR: null,
  status: 'planned',
  systemStatus: 'pending',
  systemResolutionKind: null,
  systemGrossRInput: null,
  symbol: 'XAUUSD',
  direction: 'long',
  timeframe: null,
  session: null,
  confidence: null,
  confirmationNotes: null,
  tradingviewUrl: null,
  notes: null,
  reviewNotes: null,
  emotionsRecordedAt: null,
  hasChartAttachment: false,
  chartAttachmentUploadedAt: null,
  plannedEntry: '100.0000',
  plannedStop: '90.0000',
  plannedTarget: null,
  plannedPositionSize: null,
  plannedRiskMinor: null,
  plannedRewardMinor: null,
  plannedR: null,
  actualResultMode: null,
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
  exits: [],
  closedBps: 0,
  remainingBps: 10_000,
  realizedRToDate: null,
  enteredAt: null,
  exitedAt: null,
  systemExitPrice: null,
  systemExitedAt: null,
  systemExitReason: null,
  systemCostR: '0.0000',
  systemR: null,
  systemOutcome: null,
  systemResolvedAt: null,
  setupConditionState: 'not_recorded',
  setupConditionChecks: [],
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
  emotions: [],
  emotionCatalog: [],
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

function renderDetail(trade: TradeDetailModel) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeDetail
        trade={trade}
        timezone="Asia/Bangkok"
        locale="en-GB"
        canWrite={false}
        classificationOptions={[]}
      />
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

  it('renders a truthful not-set Confidence state, never an invented percentage', () => {
    renderDetail({ ...base, confidence: null });
    expect(screen.queryByText(/^\d+% ·/)).not.toBeInTheDocument();
  });

  it('distinguishes historical not-recorded Emotions from a recorded zero selection', () => {
    const first = renderDetail(base);
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    first.unmount();
    renderDetail({
      ...base,
      emotionsRecordedAt: '2026-08-08T00:00:00.000Z',
      emotions: [],
    });
    expect(screen.getByText('No emotions selected')).toBeInTheDocument();
  });

  it('renders localized selected Emotions and distinct post-trade review notes', () => {
    renderDetail({
      ...base,
      emotionsRecordedAt: '2026-08-08T00:00:00.000Z',
      emotions: [
        { key: 'calm', label: 'Calm' },
        { key: 'focused', label: 'Focused' },
      ],
      reviewNotes: 'I waited for the close and followed the plan.',
    });
    expect(screen.getByText('Calm')).toBeInTheDocument();
    expect(screen.getByText('Focused')).toBeInTheDocument();
    expect(screen.getByText('I waited for the close and followed the plan.')).toBeInTheDocument();
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
      systemResolutionKind: 'price_exit',
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

  it('renders a Money-only System resolution without inventing an exit price', () => {
    renderDetail({
      ...base,
      systemStatus: 'resolved',
      systemResolutionKind: 'money_custom',
      systemGrossRInput: '2.7500',
      systemExitedAt: '2026-08-08T02:00:00.000Z',
      systemExitReason: 'manual_system_valid_exit',
      systemCostR: '0.2500',
      systemR: '2.5000',
      systemOutcome: 'win',
      systemResolvedAt: '2026-08-08T02:00:00.000Z',
    });
    expect(screen.getByText('Custom gross R')).toBeInTheDocument();
    expect(screen.getByText('+2.75R')).toBeInTheDocument();
    expect(screen.getByText('+2.50R')).toBeInTheDocument();
    expect(screen.queryByText('Exit price')).not.toBeInTheDocument();
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

  it('shows Setup Conditions as historical not-recorded, distinct from a zero-Condition Setup', () => {
    const first = renderDetail({ ...base, setupConditionState: 'not_recorded' });
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    first.unmount();

    renderDetail({ ...base, setupConditionState: 'not_configured' });
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('renders recorded Setup Conditions with an adherence count and per-item Met/Not met status', () => {
    renderDetail({
      ...base,
      setupConditionState: 'recorded',
      setupConditionChecks: [
        { conditionKey: 'c1', label: 'Above the 200 EMA', sortOrder: 0, checkStatus: 'met' },
        {
          conditionKey: 'c2',
          label: 'Volume confirms breakout',
          sortOrder: 1,
          checkStatus: 'not_met',
        },
      ],
    });
    expect(screen.getByText('1/2 met · 50%')).toBeInTheDocument();
    expect(screen.getByText('Above the 200 EMA')).toBeInTheDocument();
    expect(screen.getByText('Volume confirms breakout')).toBeInTheDocument();
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Not met')).toBeInTheDocument();
  });

  it('discloses an archived live Strategy, Setup, or Account without hiding the pinned historical label', () => {
    renderDetail({
      ...base,
      strategyIsArchived: true,
      setupIsArchived: true,
      tradingAccountIsArchived: true,
    });
    expect(screen.getByText('Pinned Breakout')).toBeInTheDocument();
    expect(screen.getByText('Pinned Retest')).toBeInTheDocument();
    expect(screen.getByText('Main JPY')).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBe(3);
  });

  it('renders no Archived badge when the live Strategy, Setup, and Account are all active', () => {
    renderDetail(base);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('displays Entry Reason separately from legacy Notes', () => {
    renderDetail({
      ...base,
      confirmationNotes: 'Waited for the retest to confirm.',
      notes: 'General journal note.',
    });
    expect(screen.getByText('Entry Reason')).toBeInTheDocument();
    expect(screen.getByText('Waited for the retest to confirm.')).toBeInTheDocument();
    expect(screen.getByText('General journal note.')).toBeInTheDocument();
  });

  it('renders the System resolved time alongside the final System outcome', () => {
    renderDetail({
      ...base,
      systemStatus: 'resolved',
      systemResolutionKind: 'price_exit',
      systemExitPrice: '130',
      systemExitedAt: '2026-08-08T02:00:00.000Z',
      systemExitReason: 'target_hit',
      systemR: '3.0000',
      systemOutcome: 'win',
      systemResolvedAt: '2026-08-08T03:00:00.000Z',
    });
    expect(screen.getByText('System resolved')).toBeInTheDocument();
  });
});
