import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { ActualSection } from './trade-actual-section';
import { ReviewSection } from './trade-review-section';
import { SystemSection } from './trade-system-section';

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
  strategyVersionId: 'sv',
  strategyVersionNumber: 4,
  strategyIsArchived: false,
  setupId: 'x',
  setupName: 'Pinned Retest',
  setupVersionId: 'xv',
  setupIsArchived: false,
  strategyAssignedAt: '2026-08-08T00:00:00.000Z',
  setupAssignedAt: '2026-08-08T00:00:00.000Z',
  executionGapR: null,
  status: 'planned',
  systemStatus: 'pending',
  recordedRetrospectively: false,
  recordingContract: null,
  enteredAtSource: null,
  targetState: null,
  targetPrice: null,
  contextEntryPrice: null,
  contextStopPrice: null,
  contextPositionSize: null,
  actualRiskAnswer: null,
  exitPlanState: null,
  exitPlanProvenance: null,
  exitPlanName: null,
  exitPlanInstructions: null,
  exitPlanInheritanceDeclined: false,
  noStrategy: false,
  noSetup: false,
  captureOrigins: { strategy: null, setup: null, exitPlan: null, confidence: null, emotions: null },
  traderOutcomeSelected: false,
  postTradeEmotionsRecordedAt: null,
  postTradeEmotions: [],
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
  exitHistoryCompleteness: null,
  finalPnlSource: null,
  exitSubtotalMinor: null,
  exitReconciliation: 'not_recorded',
  canAdoptExitSubtotal: false,
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
  systemGrossR: null,
  systemCostR: '0.0000',
  systemR: null,
  systemOutcome: null,
  systemResolvedAt: null,
  systemDependencySnapshot: null,
  systemPlanProvenance: null,
  planAdherence: null,
  setupConditionState: 'not_recorded',
  setupConditionChecks: [],
  setupConditionConfiguredCount: null,
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

/**
 * The record sections the live Trade Details sheet renders (its Execution,
 * Plan and Review panels reuse them verbatim). These cases used to reach them
 * through the retired Phase 15E `TradeDetail` container, which nothing in the
 * product rendered any more; they now render the sections directly.
 */
function renderDetail(trade: TradeDetailModel, section = 'actual', canWrite = false) {
  currentSearch = section === '' ? '' : `section=${section}`;
  const props = { trade, timezone: 'Asia/Bangkok', locale: 'en-GB', canWrite };
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {section === 'system' ? (
        <SystemSection {...props} />
      ) : section === 'review' ? (
        <ReviewSection trade={trade} timezone="Asia/Bangkok" canWrite={canWrite} />
      ) : (
        <ActualSection {...props} />
      )}
    </NextIntlClientProvider>,
  );
}

describe('Trade record sections', () => {
  // Phase 15E — one section renders at a time; `actual` is the default
  // landing section (`DEFAULT_TRADE_DETAIL_SECTION`).
  it('shows a legacy planned Trade with friendly compatibility copy on the default Actual section, never invented numeric zero values', () => {
    renderDetail(base);
    expect(
      screen.getByText('This Trade was saved before execution information was recorded.'),
    ).toBeInTheDocument();
  });

  it('owns the Price System Plan only in System, never Actual or Entry Snapshot', () => {
    const trade = { ...base, plannedTarget: '130.0000', plannedR: '3.0000' };
    const actual = renderDetail(trade, 'actual', true);
    expect(screen.queryByRole('heading', { name: 'System Plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Take Profit')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit System Plan' })).not.toBeInTheDocument();
    actual.unmount();

    const system = renderDetail(trade, 'system', true);
    expect(screen.getByRole('heading', { name: 'System Plan' })).toBeVisible();
    expect(screen.getByText('Plan by Price')).toBeVisible();
    expect(screen.getByText('Take Profit')).toBeVisible();
    expect(screen.getByText('130.0000')).toBeVisible();
    expect(screen.getByText('+3.00R')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit System Plan' })).toBeVisible();
    system.unmount();

    renderDetail(trade, 'entry', true);
    expect(screen.queryByText('Take Profit')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit System Plan' })).not.toBeInTheDocument();
  });

  it('renders a Money System Plan without irrelevant Price fields', () => {
    renderDetail(
      {
        ...base,
        plannedEntry: null,
        plannedStop: null,
        plannedRiskMinor: '500',
        plannedRewardMinor: '1500',
        plannedR: '3.0000',
      },
      'system',
      true,
    );
    const plan = screen.getByRole('heading', { name: 'System Plan' }).closest('section');
    expect(plan).not.toBeNull();
    const scoped = within(plan!);
    expect(scoped.getByText('Plan by Money')).toBeVisible();
    expect(scoped.getByText('500 JPY')).toBeVisible();
    expect(scoped.getByText('1,500 JPY')).toBeVisible();
    expect(scoped.getByText('+3.00R')).toBeVisible();
    expect(scoped.queryByText('Entry', { exact: true })).not.toBeInTheDocument();
    expect(scoped.queryByText('Stop Loss')).not.toBeInTheDocument();
  });

  it('renders a truthful missing System Plan state', () => {
    renderDetail(
      {
        ...base,
        plannedEntry: null,
        plannedStop: null,
        plannedTarget: null,
        plannedRiskMinor: null,
        plannedRewardMinor: null,
        plannedR: null,
      },
      'system',
    );
    const plan = screen.getByRole('heading', { name: 'System Plan' }).closest('section');
    expect(within(plan!).getByText('Not recorded')).toBeVisible();
  });

  it('keeps historical dual-plan data quiet while Price remains the canonical first layer', () => {
    renderDetail(
      {
        ...base,
        plannedRiskMinor: '1000',
        plannedRewardMinor: '2000',
        plannedR: '2.0000',
      },
      'system',
    );
    expect(screen.getByText('Plan by Price')).toBeVisible();
    expect(screen.getByText('Additional historical plan data')).toBeVisible();
  });

  it('keeps differing Price Plan and Actual execution values in their correct sections', () => {
    const trade = {
      ...base,
      status: 'open' as const,
      actualResultMode: 'price' as const,
      plannedEntry: '4330',
      plannedStop: '4320',
      actualEntry: '4332',
      actualInitialStop: '4320',
      enteredAt: '2026-08-08T00:00:00.000Z',
    };
    const actual = renderDetail(trade, 'actual');
    expect(screen.getByText('4332')).toBeVisible();
    expect(screen.queryByText('4330')).not.toBeInTheDocument();
    actual.unmount();

    renderDetail(trade, 'system');
    expect(screen.getByText('4330')).toBeVisible();
    expect(screen.queryByText('4332')).not.toBeInTheDocument();
  });

  it('supports Price Plan / Money Actual and Money Plan / Price Actual without empty cross-basis fields', () => {
    const priceMoney = renderDetail(
      {
        ...base,
        status: 'closed',
        actualResultMode: 'money',
        actualInitialRiskMinor: '500',
        netPnlMinor: '1000',
        actualR: '2.0000',
        traderOutcome: 'win',
      },
      'actual',
    );
    expect(screen.getByText('500 JPY')).toBeVisible();
    expect(screen.queryByText('Actual Entry')).not.toBeInTheDocument();
    priceMoney.unmount();

    renderDetail(
      {
        ...base,
        status: 'closed',
        plannedEntry: null,
        plannedStop: null,
        plannedRiskMinor: '500',
        actualResultMode: 'price',
        actualEntry: '101',
        actualInitialStop: '91',
        actualR: '1.0000',
        traderOutcome: 'win',
      },
      'actual',
    );
    expect(screen.getByText('101')).toBeVisible();
    expect(screen.queryByText('Initial risk')).not.toBeInTheDocument();
  });

  it('renders Money Plan / Money Actual as two independent Money streams', () => {
    const trade = {
      ...base,
      status: 'closed' as const,
      plannedEntry: null,
      plannedStop: null,
      plannedRiskMinor: '1000',
      plannedRewardMinor: '3000',
      plannedR: '3.0000',
      actualResultMode: 'money' as const,
      actualInitialRiskMinor: '800',
      netPnlMinor: '1200',
      actualR: '1.5000',
      traderOutcome: 'win' as const,
    };
    const actual = renderDetail(trade, 'actual');
    expect(screen.getByText('800 JPY')).toBeVisible();
    expect(screen.getAllByText('+1.50R').length).toBeGreaterThan(0);
    actual.unmount();

    renderDetail(trade, 'system');
    expect(screen.getByText('Plan by Money')).toBeVisible();
    expect(screen.getByText('1,000 JPY')).toBeVisible();
    expect(screen.getByText('+3.00R')).toBeVisible();
  });

  it('shows truthful Open and Partial Actual empty/remaining states', () => {
    const open = renderDetail(
      {
        ...base,
        status: 'open',
        actualResultMode: 'price',
        actualEntry: '100',
        actualInitialStop: '90',
        enteredAt: '2026-08-08T00:00:00.000Z',
      },
      'actual',
    );
    expect(screen.getByText('No exits yet.')).toBeVisible();
    expect(
      screen.getByText('Actual Result will be available after the Trade is closed.'),
    ).toBeVisible();
    open.unmount();

    renderDetail(
      {
        ...base,
        status: 'open',
        actualResultMode: 'price',
        actualEntry: '100',
        actualInitialStop: '90',
        closedBps: 2500,
        remainingBps: 7500,
        realizedRToDate: '0.5000',
      },
      'actual',
    );
    expect(screen.getByText('Partial')).toBeVisible();
    expect(screen.getByText('75%')).toBeVisible();
    expect(screen.getAllByText('+0.50R').length).toBeGreaterThan(0);
  });

  it('derives Partially Closed from a contract Part leg, with no whole-trade R, and offers Stage 5', () => {
    renderDetail(
      {
        ...base,
        status: 'open',
        recordingContract: 'add_trade_v1',
        actualResultMode: 'money',
        plannedRiskMinor: '10000',
        enteredAt: '2026-08-08T00:00:00.000Z',
        // A Part whose % was left unanswered: still a Part, so still Partially Closed.
        closedBps: null,
        remainingBps: null,
        realizedRToDate: '0.5000',
        exits: [
          {
            exitId: '018f0000-0000-7000-8000-0000000000e1',
            sequence: 1,
            closedBps: null,
            exitScope: 'part',
            exitPrice: null,
            realizedPnlMinor: '5000',
            exitReason: null,
            exitedAt: null,
          },
        ],
      },
      'actual',
      true,
    );
    expect(screen.getByText('Partial')).toBeVisible();
    expect(
      screen.getByText('Actual Result will be available after the Trade is closed.'),
    ).toBeVisible();
    expect(screen.queryByText('+0.50R')).toBeNull();
    expect(screen.getByRole('link', { name: 'Record partial exit' })).toHaveAttribute(
      'href',
      `/app/trades/close?trade=${base.tradeId}&scope=part`,
    );
    expect(screen.getByRole('link', { name: 'Close trade' })).toHaveAttribute(
      'href',
      `/app/trades/close?trade=${base.tradeId}&scope=all`,
    );
  });

  it('keeps a legacy Open Trade on its legacy close, with no Stage 5 entry', () => {
    renderDetail(
      {
        ...base,
        status: 'open',
        actualResultMode: 'price',
        actualEntry: '100',
        actualInitialStop: '90',
        enteredAt: '2026-08-08T00:00:00.000Z',
      },
      'actual',
      true,
    );
    expect(screen.queryByRole('link', { name: 'Record partial exit' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Close trade' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Partial Close' })).toBeVisible();
  });

  it('shows System result Pending on the System section, independent of the Actual state', () => {
    renderDetail(base, 'system');
    expect(screen.getByRole('heading', { name: 'System Plan' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'System Outcome' })).toBeVisible();
    expect(screen.getByText("The System result hasn't been recorded yet.")).toBeInTheDocument();
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

  it('renders a truthful not-set Confidence state, never an invented percentage', () => {
    renderDetail({ ...base, confidence: null }, 'entry');
    expect(screen.queryByText(/^\d+% ·/)).not.toBeInTheDocument();
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
        actualResultMode: 'money',
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
    expect(screen.getByText('Target reached')).toBeInTheDocument();
  });

  it.each([
    ['price target', 'price_exit', 'target_hit', 'Target reached'],
    ['price stop', 'price_exit', 'stop_hit', 'Stop reached'],
    ['price break even', 'price_exit', 'break_even_rule', 'Break even'],
    ['money target', 'money_target', null, 'Target reached'],
    ['money stop', 'money_stop', null, 'Stop reached'],
    ['money break even', 'money_break_even', null, 'Break even'],
    ['money custom', 'money_custom', null, 'Custom'],
  ] as const)(
    'renders the customer-facing %s System resolution summary',
    (_label, systemResolutionKind, systemExitReason, expected) => {
      renderDetail(
        {
          ...base,
          systemStatus: 'resolved',
          systemResolutionKind,
          systemExitReason,
          systemR: '1.0000',
          systemOutcome: 'win',
        },
        'system',
      );
      expect(screen.getByText(expected, { exact: true })).toBeVisible();
    },
  );

  it('keeps Planned R and System R visibly distinct', () => {
    renderDetail(
      {
        ...base,
        plannedTarget: '150',
        plannedR: '5.0000',
        systemStatus: 'resolved',
        systemResolutionKind: 'price_exit',
        systemExitReason: 'stop_hit',
        systemExitPrice: '90',
        systemR: '-1.0000',
        systemOutcome: 'loss',
      },
      'system',
    );
    const plan = screen.getByRole('heading', { name: 'System Plan' }).closest('section');
    const outcome = screen.getByRole('heading', { name: 'System Outcome' }).closest('section');
    expect(within(plan!).getByText('+5.00R')).toBeVisible();
    expect(within(outcome!).getByText('-1.00R')).toBeVisible();
    expect(within(outcome!).getByText('Stop reached')).toBeVisible();
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
    expect(screen.getByText('Custom', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('+2.75R')).toBeInTheDocument();
    expect(screen.getAllByText('+2.50R').length).toBeGreaterThan(0);
    expect(screen.queryByText('Exit price')).not.toBeInTheDocument();
  });

  it('renders System no-trade on the System section, and Rules/Mistakes without scores or controls on the Review section', () => {
    renderDetail({ ...base, systemStatus: 'no_trade' }, 'system');
    expect(screen.getByText('According to the rules: No Trade')).toBeInTheDocument();

    renderDetail({ ...base, systemStatus: 'no_trade' }, 'review');
    expect(screen.getByText('Wait for confirmation')).toBeInTheDocument();
    expect(screen.getByText('FOMO entry')).toBeInTheDocument();
    expect(screen.getByText('Entered early')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove|attach|edit/i })).not.toBeInTheDocument();
  });

  it('renders no Archived badge when the live Account is active', () => {
    renderDetail(base);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
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
        screen.queryByRole('button', { name: 'Record System Outcome' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add Strategy' })).not.toBeInTheDocument();
    });

    it('routes the old System section to the single assessment editor in Review', () => {
      renderDetail(base, 'system', true);
      expect(
        screen.getByRole('link', { name: 'Open System assessment in Review' }),
      ).toHaveAttribute('href', expect.stringContaining('section=review'));
      expect(
        screen.queryByRole('button', { name: 'Record System Outcome' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark no trade' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add execution details & Open' }),
      ).not.toBeInTheDocument();
    });

    it('shows the production System assessment launcher only in Review', () => {
      renderDetail(base, 'review', true);
      expect(screen.getByRole('button', { name: /System assessment/ })).toBeInTheDocument();
      expect(screen.getByText('What would you repeat or change next time?')).toBeInTheDocument();
    });

    it('never shows Cancel for a Trade that has already been opened', () => {
      renderDetail({ ...base, status: 'open' }, 'actual', true);
      expect(
        screen.queryByRole('button', { name: 'Cancel planned Trade' }),
      ).not.toBeInTheDocument();
    });
  });
});
