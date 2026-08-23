import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeDetail } from './trade-detail';

let currentSearch = '';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/app/trades',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
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
  recordedRetrospectively: false,
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

function renderDetail(trade: TradeDetailModel, section = '', canWrite = false) {
  currentSearch = section === '' ? '' : `section=${section}`;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeDetail
        trade={trade}
        timezone="Asia/Bangkok"
        locale="en-GB"
        canWrite={canWrite}
        classificationOptions={[]}
      />
    </NextIntlClientProvider>,
  );
}

describe('TradeDetail', () => {
  // Phase 15E — one section renders at a time; `actual` is the default
  // landing section (`DEFAULT_TRADE_DETAIL_SECTION`).
  it('shows a legacy planned Trade with friendly compatibility copy on the default Actual section, never invented numeric zero values', () => {
    renderDetail(base);
    expect(
      screen.getByText('This Trade was saved before execution information was recorded.'),
    ).toBeInTheDocument();
  });

  it('makes the canonical optional Take Profit and Planned R visible/editable in Actual, not Entry Snapshot', () => {
    const trade = { ...base, plannedTarget: '130.0000', plannedR: '3.0000' };
    const actual = renderDetail(trade, 'actual', true);
    expect(screen.getByText('Take Profit')).toBeVisible();
    expect(screen.getByText('130.0000')).toBeVisible();
    expect(screen.getByText('+3.00R')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Plan' })).toBeVisible();
    actual.unmount();

    renderDetail(trade, 'entry', true);
    expect(screen.queryByText('Take Profit')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Plan' })).not.toBeInTheDocument();
  });

  it('shows System result Pending on the System section, independent of the Actual state', () => {
    renderDetail(base, 'system');
    expect(screen.getByText(/System result is Pending/)).toBeInTheDocument();
  });

  it('shows the distinct "not opened" copy for a canceled Trade, not the legacy planned copy', () => {
    renderDetail({ ...base, status: 'canceled' });
    expect(
      screen.getByText('This Trade has not been opened. No actual execution has been recorded.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('This Trade was saved before execution information was recorded.'),
    ).not.toBeInTheDocument();
  });

  it('renders Confidence as "X% · Label", never "/100" or "/5", inside Entry Snapshot', () => {
    renderDetail({ ...base, confidence: 75 }, 'entry');
    expect(screen.getByText('75% · High')).toBeInTheDocument();
    expect(screen.queryByText(/75\/100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/5\b/)).not.toBeInTheDocument();
  });

  it('labels the Entry Snapshot once when the Trade was recorded retrospectively', () => {
    renderDetail({ ...base, recordedRetrospectively: true }, 'entry');
    expect(screen.getByText('Recorded retrospectively')).toBeVisible();
    expect(screen.getAllByText('Recorded retrospectively')).toHaveLength(1);
  });

  it('renders a truthful not-set Confidence state, never an invented percentage', () => {
    renderDetail({ ...base, confidence: null }, 'entry');
    expect(screen.queryByText(/^\d+% ·/)).not.toBeInTheDocument();
  });

  it('distinguishes historical not-recorded Emotions from a recorded zero selection, inside Entry Snapshot', () => {
    const first = renderDetail(base, 'entry');
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    first.unmount();
    renderDetail(
      {
        ...base,
        emotionsRecordedAt: '2026-08-08T00:00:00.000Z',
        emotions: [],
      },
      'entry',
    );
    // Appears once in the scan-summary <dl> and once in the full-detail
    // TradeEmotionsEditor behind "Show full details" — both by design (brief §22).
    expect(screen.getAllByText('No emotions selected').length).toBeGreaterThan(0);
  });

  it('renders localized selected Emotions in Entry Snapshot and post-trade review notes in Review', () => {
    renderDetail(
      {
        ...base,
        emotionsRecordedAt: '2026-08-08T00:00:00.000Z',
        emotions: [
          { key: 'calm', label: 'Calm' },
          { key: 'focused', label: 'Focused' },
        ],
      },
      'entry',
    );
    expect(screen.getByText('Calm')).toBeInTheDocument();
    expect(screen.getByText('Focused')).toBeInTheDocument();

    renderDetail(
      { ...base, reviewNotes: 'I waited for the close and followed the plan.' },
      'review',
    );
    expect(screen.getByText('I waited for the close and followed the plan.')).toBeInTheDocument();
  });

  it('renders a Chart attachment via the authenticated delivery route, never a stored URL, inside Entry Snapshot', () => {
    renderDetail(
      {
        ...base,
        hasChartAttachment: true,
        chartAttachmentUploadedAt: '2026-08-08T00:00:00.000Z',
      },
      'entry',
    );
    const image = screen.getByAltText('Uploaded chart image') as HTMLImageElement;
    expect(image.src).toBe(`http://localhost:3000/api/trades/${base.tradeId}/chart-attachment`);
    const link = screen.getByRole('link', { name: /Open chart image/ });
    expect(link).toHaveAttribute('href', `/api/trades/${base.tradeId}/chart-attachment`);
  });

  it('renders no Chart attachment section when the Trade has none', () => {
    renderDetail({ ...base, hasChartAttachment: false }, 'entry');
    expect(screen.queryByAltText('Uploaded chart image')).not.toBeInTheDocument();
  });

  it('renders closed Actual with safe money formatting on the Actual section', () => {
    renderDetail(
      {
        ...base,
        status: 'closed',
        actualEntry: '101',
        actualInitialStop: '91',
        actualInitialRiskMinor: '500',
        actualExit: '120',
        netPnlMinor: '1000',
        actualR: '2.0000',
        traderOutcome: 'win',
        enteredAt: '2026-08-08T00:00:00.000Z',
        exitedAt: '2026-08-08T01:00:00.000Z',
      },
      'actual',
    );
    expect(screen.getByText('500 JPY')).toBeInTheDocument();
    expect(screen.getByText('1,000 JPY')).toBeInTheDocument();
    // Appears once as the Trade Overview hero and once as the Actual
    // section's own compact result-first line (brief §11) — both by design.
    expect(screen.getAllByText('+2.00R').length).toBeGreaterThan(0);
  });

  it('renders resolved System with a Target hit reason, independent of Actual state, on the System section', () => {
    renderDetail(
      {
        ...base,
        systemStatus: 'resolved',
        systemResolutionKind: 'price_exit',
        systemExitPrice: '130',
        systemExitedAt: '2026-08-08T02:00:00.000Z',
        systemExitReason: 'target_hit',
        systemR: '3.0000',
        systemOutcome: 'win',
      },
      'system',
    );
    expect(screen.getAllByText('+3.00R').length).toBeGreaterThan(0);
    expect(screen.getByText('Target hit')).toBeInTheDocument();
  });

  it('renders a Money-only System resolution without inventing an exit price', () => {
    renderDetail(
      {
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
      },
      'system',
    );
    expect(screen.getByText('Custom gross R')).toBeInTheDocument();
    expect(screen.getByText('+2.75R')).toBeInTheDocument();
    expect(screen.getAllByText('+2.50R').length).toBeGreaterThan(0);
    expect(screen.queryByText('Exit price')).not.toBeInTheDocument();
  });

  it('renders System no-trade on the System section, and Rules/Mistakes without scores or controls on the Review section', () => {
    renderDetail({ ...base, systemStatus: 'no_trade' }, 'system');
    expect(screen.getByText(/would not have permitted this Trade/)).toBeInTheDocument();

    renderDetail({ ...base, systemStatus: 'no_trade' }, 'review');
    expect(screen.getByText('Wait for confirmation')).toBeInTheDocument();
    expect(screen.getByText('FOMO entry')).toBeInTheDocument();
    expect(screen.getByText('Entered early')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove|attach|edit/i })).not.toBeInTheDocument();
  });

  it('shows Setup Conditions as historical not-recorded, distinct from a zero-Condition Setup, inside Entry Snapshot', () => {
    const first = renderDetail({ ...base, setupConditionState: 'not_recorded' }, 'entry');
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    first.unmount();

    renderDetail({ ...base, setupConditionState: 'not_configured' }, 'entry');
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
  });

  it('renders recorded Setup Conditions with an adherence count and per-item Met/Not met status', () => {
    renderDetail(
      {
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
      },
      'entry',
    );
    expect(screen.getByText('1/2 met · 50%')).toBeInTheDocument();
    expect(screen.getByText('Above the 200 EMA')).toBeInTheDocument();
    expect(screen.getByText('Volume confirms breakout')).toBeInTheDocument();
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Not met')).toBeInTheDocument();
  });

  it('discloses an archived live Strategy and Setup on the Strategy & Setup section, and archived Account on Overview, without hiding the pinned historical label', () => {
    const first = renderDetail({
      ...base,
      strategyIsArchived: true,
      setupIsArchived: true,
      tradingAccountIsArchived: true,
    });
    expect(screen.getByText('Main JPY')).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBeGreaterThan(0);
    first.unmount();

    renderDetail(
      {
        ...base,
        strategyIsArchived: true,
        setupIsArchived: true,
      },
      'strategy',
    );
    expect(screen.getByText('Pinned Breakout')).toBeInTheDocument();
    expect(screen.getByText('Pinned Retest')).toBeInTheDocument();
    expect(screen.getAllByText('Archived').length).toBe(2);
  });

  it('renders no Archived badge when the live Account is active', () => {
    renderDetail(base);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('displays Entry Reason separately from legacy Notes, inside Entry Snapshot', () => {
    renderDetail(
      {
        ...base,
        confirmationNotes: 'Waited for the retest to confirm.',
        notes: 'General journal note.',
      },
      'entry',
    );
    // Appears once as the compact <dl> row label and once as the full-detail
    // SubSection heading behind "Show full details" — both by design (brief §22).
    expect(screen.getAllByText('Entry Reason').length).toBeGreaterThan(0);
    expect(screen.getByText('Waited for the retest to confirm.')).toBeInTheDocument();
    expect(screen.getByText('General journal note.')).toBeInTheDocument();
  });

  it('renders the System resolved time alongside the final System outcome, on the System section', () => {
    renderDetail(
      {
        ...base,
        systemStatus: 'resolved',
        systemResolutionKind: 'price_exit',
        systemExitPrice: '130',
        systemExitedAt: '2026-08-08T02:00:00.000Z',
        systemExitReason: 'target_hit',
        systemR: '3.0000',
        systemOutcome: 'win',
        systemResolvedAt: '2026-08-08T03:00:00.000Z',
      },
      'system',
    );
    expect(screen.getByText('System resolved')).toBeInTheDocument();
  });

  // Phase 15E §12/§15/§29 — action colocation: every mutation trigger lives
  // beside the data it changes, never in a distant generic "Lifecycle
  // Actions" card, and never leaks into an unrelated section's body.
  describe('action colocation', () => {
    it('shows Actual-lifecycle actions only on the Actual section', () => {
      renderDetail(base, 'actual', true);
      expect(
        screen.getByRole('button', { name: 'Add execution details & Open' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Resolve System result' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add Strategy' })).not.toBeInTheDocument();
    });

    it('shows System-lifecycle actions only on the System section', () => {
      renderDetail(base, 'system', true);
      expect(screen.getByRole('button', { name: 'Resolve System result' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark no trade' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add execution details & Open' }),
      ).not.toBeInTheDocument();
    });

    it('shows classification actions only on the Strategy & Setup section', () => {
      renderDetail(
        { ...base, strategyId: null, strategyName: null, setupId: null, setupName: null },
        'strategy',
        true,
      );
      expect(screen.getByRole('button', { name: 'Add Strategy' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Resolve System result' }),
      ).not.toBeInTheDocument();
    });

    it('shows Trade-level Identity/Delete actions on Overview regardless of the active section, never as a hero CTA', () => {
      renderDetail(base, 'system', true);
      expect(screen.getByRole('button', { name: 'Correct identity' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Trade' })).toBeInTheDocument();
      // A legacy `planned` row exposes Cancel too — quiet overflow, not a hero.
      expect(screen.getByRole('button', { name: 'Cancel planned Trade' })).toBeInTheDocument();
    });

    it('never shows Cancel for a Trade that has already been opened', () => {
      renderDetail({ ...base, status: 'open' }, 'actual', true);
      expect(
        screen.queryByRole('button', { name: 'Cancel planned Trade' }),
      ).not.toBeInTheDocument();
    });
  });
});
