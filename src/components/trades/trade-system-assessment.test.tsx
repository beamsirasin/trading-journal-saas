import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSystemDependencySnapshot } from '@/lib/calc/system-assessment';
import {
  correctSystemResolutionAction,
  markSystemCannotDetermineAction,
  markSystemNoTradeAction,
  resolveSystemTradeAction,
} from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { SystemAssessmentLauncher } from './trade-system-assessment';

const refresh = vi.fn();

vi.mock('@/hooks/use-is-desktop-viewport', () => ({ useIsDesktopViewport: () => true }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server/actions/trades', () => ({
  correctSystemResolutionAction: vi.fn(),
  markSystemCannotDetermineAction: vi.fn(),
  markSystemNoTradeAction: vi.fn(),
  resolveSystemTradeAction: vi.fn(),
}));

function trade(overrides: Partial<TradeDetail> = {}): TradeDetail {
  return {
    tradeId: '018f0000-0000-7000-8000-000000000001',
    tradingAccountId: 'account-1',
    tradingAccountName: 'Main',
    tradingAccountBaseCurrency: 'USD',
    tradingAccountIsArchived: false,
    strategyId: 'strategy-1',
    strategyName: 'Breakout',
    strategyVersionId: 'strategy-version-1',
    strategyVersionNumber: 1,
    strategyIsArchived: false,
    setupId: 'setup-1',
    setupName: 'Retest',
    setupVersionId: 'setup-version-1',
    setupIsArchived: false,
    strategyAssignedAt: null,
    setupAssignedAt: null,
    status: 'closed',
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
    captureOrigins: {
      strategy: null,
      setup: null,
      exitPlan: null,
      confidence: null,
      emotions: null,
    },
    traderOutcomeSelected: false,
    postTradeEmotionsRecordedAt: null,
    postTradeEmotions: [],
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
    plannedEntry: '100',
    plannedStop: '90',
    plannedTarget: '150',
    plannedPositionSize: null,
    plannedRiskMinor: null,
    plannedRewardMinor: null,
    plannedR: '5.0000',
    actualResultMode: 'price',
    actualEntry: '100',
    actualInitialStop: '90',
    actualPositionSize: null,
    actualInitialRiskMinor: null,
    actualExit: '120',
    grossPnlMinor: '999999',
    commissionMinor: '0',
    feesMinor: '0',
    swapMinor: '0',
    netPnlMinor: '999999',
    exitHistoryCompleteness: null,
    finalPnlSource: null,
    exitSubtotalMinor: null,
    exitReconciliation: 'not_recorded',
    canAdoptExitSubtotal: false,
    actualR: '99.0000',
    traderOutcome: 'win',
    enteredAt: null,
    exitedAt: null,
    exits: [],
    closedBps: 10_000,
    remainingBps: 0,
    realizedRToDate: null,
    systemExitPrice: null,
    systemResolutionKind: null,
    systemGrossRInput: null,
    systemExitedAt: null,
    systemExitReason: null,
    systemGrossR: null,
    systemCostR: null,
    systemR: null,
    systemOutcome: null,
    systemResolvedAt: null,
    systemDependencySnapshot: null,
    systemPlanProvenance: null,
    planAdherence: null,
    executionGapR: null,
    setupConditionState: 'not_recorded',
    setupConditionChecks: [],
    setupConditionConfiguredCount: null,
    ruleChecks: [],
    mistakes: [],
    mistakeCatalog: [],
    emotions: [],
    emotionCatalog: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function show(value: TradeDetail = trade()) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SystemAssessmentLauncher trade={value} timezone="Asia/Bangkok" canWrite />
    </NextIntlClientProvider>,
  );
}

async function open(value: TradeDetail = trade()) {
  show(value);
  await userEvent.click(screen.getByRole('button', { name: /System assessment/ }));
  return within(screen.getByRole('dialog'));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of [
    resolveSystemTradeAction,
    markSystemNoTradeAction,
    markSystemCannotDetermineAction,
    correctSystemResolutionAction,
  ]) {
    vi.mocked(action).mockResolvedValue({ ok: true } as never);
  }
});

describe('production System assessment', () => {
  it('starts untouched, independently of Actual R and Target R', async () => {
    show();
    expect(screen.getByText('What would following your rules have produced?')).toBeInTheDocument();
    expect(screen.queryByText('+99.00R')).not.toBeInTheDocument();
    expect(screen.queryByText('+5.00R')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /System assessment/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Would your rules have taken this trade?')).toBeInTheDocument();
    expect(dialog.queryByText('Gross System R')).not.toBeInTheDocument();
  });

  it('persists no_trade with no result fields and independent metadata', async () => {
    const dialog = await open();
    await userEvent.click(dialog.getByLabelText("No — the setup wasn't valid"));
    await userEvent.click(dialog.getByLabelText('Followed'));
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
    await waitFor(() =>
      expect(markSystemNoTradeAction).toHaveBeenCalledWith({
        tradeId: expect.any(String),
        systemPlanProvenance: 'unknown',
        planAdherence: 'followed',
      }),
    );
    expect(resolveSystemTradeAction).not.toHaveBeenCalled();
  });

  it('persists cannot_determine distinctly with no result fields', async () => {
    const dialog = await open();
    await userEvent.click(dialog.getByLabelText("Can't determine"));
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
    await waitFor(() =>
      expect(markSystemCannotDetermineAction).toHaveBeenCalledWith({
        tradeId: expect.any(String),
        systemPlanProvenance: 'unknown',
        planAdherence: null,
      }),
    );
    expect(resolveSystemTradeAction).not.toHaveBeenCalled();
  });

  it('reveals the resolution only after Yes and calls the canonical initial-stop path', async () => {
    const dialog = await open();
    expect(dialog.queryByText('What would have closed the trade?')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByLabelText('Yes'));
    expect(dialog.getByText('What would have closed the trade?')).toBeInTheDocument();
    await userEvent.click(dialog.getByLabelText('Initial stop hit'));
    expect(dialog.getByText('-1.00R')).toBeInTheDocument();
    expect(dialog.getByText(/gross result only/i)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
    await waitFor(() =>
      expect(resolveSystemTradeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          resolutionKind: 'price_exit',
          systemExitPrice: '90',
          systemExitReason: 'stop_hit',
          systemCostR: '',
        }),
      ),
    );
  });

  it('shows gross, supplied cost, and net without deriving adherence from the loss', async () => {
    const dialog = await open();
    await userEvent.click(dialog.getByLabelText('Yes'));
    await userEvent.click(dialog.getByLabelText('Initial stop hit'));
    await userEvent.type(dialog.getByLabelText('Trading costs'), '0.10');
    expect(dialog.getByText('Gross System R')).toBeInTheDocument();
    expect(dialog.getByText('-1.10R')).toBeInTheDocument();
    expect(dialog.getByLabelText('Followed')).not.toBeChecked();
    expect(dialog.getByLabelText('Partly')).not.toBeChecked();
    expect(dialog.getByLabelText('Did not follow')).not.toBeChecked();
  });

  it('labels an existing unknown-cost result as gross-only in the launcher', () => {
    show(
      trade({
        systemStatus: 'resolved',
        systemResolutionKind: 'money_target',
        systemExitReason: 'target_hit',
        systemGrossR: '5.0000',
        systemCostR: null,
        systemR: null,
        systemOutcome: null,
      }),
    );
    expect(screen.getByText('Gross result only')).toBeInTheDocument();
    expect(screen.getByText('+5.00R')).toBeInTheDocument();
  });

  it.each([
    ['Followed', 'followed'],
    ['Partly', 'partly'],
    ['Did not follow', 'not_followed'],
    ['Unanswered', null],
  ] as const)('persists adherence %s', async (label, value) => {
    const dialog = await open();
    await userEvent.click(dialog.getByLabelText("No — the setup wasn't valid"));
    await userEvent.click(dialog.getByLabelText(label));
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
    await waitFor(() =>
      expect(markSystemNoTradeAction).toHaveBeenCalledWith(
        expect.objectContaining({ planAdherence: value }),
      ),
    );
  });

  it('keeps provenance unknown until the user explicitly confirms at-entry evidence', async () => {
    const dialog = await open();
    expect(dialog.getByLabelText("Can't confirm")).toBeChecked();
    await userEvent.click(dialog.getByLabelText('Yes — in place at entry'));
    await userEvent.click(dialog.getByLabelText("No — the setup wasn't valid"));
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
    await waitFor(() =>
      expect(markSystemNoTradeAction).toHaveBeenCalledWith(
        expect.objectContaining({ systemPlanProvenance: 'at_entry' }),
      ),
    );
  });

  it('keeps a stale confirmed result separate from the current-input preview until reconfirmed', async () => {
    const snapshot = buildSystemDependencySnapshot({
      systemResolutionKind: 'money_target',
      systemExitReason: 'target_hit',
      strategyVersionId: 'strategy-version-1',
      setupVersionId: 'setup-version-1',
      plannedRiskMinor: 100n,
      plannedRewardMinor: 500n,
      plannedEntry: null,
      plannedStop: null,
    });
    const stale = trade({
      plannedEntry: null,
      plannedStop: null,
      plannedTarget: null,
      plannedRiskMinor: '100',
      plannedRewardMinor: '1000',
      plannedR: '10.0000',
      systemStatus: 'resolved',
      systemResolutionKind: 'money_target',
      systemExitReason: 'target_hit',
      systemGrossRInput: '5.0000',
      systemGrossR: '5.0000',
      systemCostR: '0.0000',
      systemR: '5.0000',
      systemOutcome: 'win',
      systemResolvedAt: '2026-09-01T01:00:00.000Z',
      systemDependencySnapshot: snapshot,
    });
    show(stale);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Previously confirmed: +5.00R')).toBeInTheDocument();
    expect(correctSystemResolutionAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /System assessment/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Previously confirmed: +5.00R')).toBeInTheDocument();
    expect(dialog.getByText('Current inputs would calculate +10.00R')).toBeInTheDocument();
    expect(correctSystemResolutionAction).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(correctSystemResolutionAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /System assessment/ }));
    const reopened = within(screen.getByRole('dialog'));
    expect(reopened.getByText('Previously confirmed: +5.00R')).toBeInTheDocument();
    expect(reopened.getByText('Current inputs would calculate +10.00R')).toBeInTheDocument();
    await userEvent.click(reopened.getByRole('button', { name: 'This still applies' }));
    await waitFor(() =>
      expect(correctSystemResolutionAction).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'resolved', resolutionKind: 'money_target' }),
      ),
    );
  });

  it.each(['no_trade', 'cannot_determine'] as const)(
    'reopens the confirmed %s finding without inventing a resolution',
    async (systemStatus) => {
      const label = systemStatus === 'no_trade' ? "No — the setup wasn't valid" : "Can't determine";
      const dialog = await open(
        trade({ systemStatus, systemResolvedAt: '2026-09-01T01:00:00.000Z' }),
      );
      expect(dialog.getByLabelText(label)).toBeChecked();
      expect(dialog.queryByText('What would have closed the trade?')).not.toBeInTheDocument();
    },
  );

  it('cancels untouched and stale drafts without writing, restores focus, and resets on reopen', async () => {
    const value = trade();
    show(value);
    const launcher = screen.getByRole('button', { name: /System assessment/ });
    await userEvent.click(launcher);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByLabelText('Yes'));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(launcher).toHaveFocus());
    expect(resolveSystemTradeAction).not.toHaveBeenCalled();

    await userEvent.click(launcher);
    const reopened = within(screen.getByRole('dialog'));
    expect(reopened.getByLabelText('Yes')).not.toBeChecked();
    expect(reopened.queryByText('What would have closed the trade?')).not.toBeInTheDocument();
  });

  it('keeps validation quiet until submit, associates it, and clears it after correction', async () => {
    const dialog = await open();
    await userEvent.click(dialog.getByLabelText('Yes'));
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
    const error = dialog.getByRole('alert');
    expect(error).toHaveTextContent('Complete the rule-based result before confirming.');
    expect(
      dialog.getByRole('group', { name: 'What would have closed the trade?' }),
    ).toHaveAttribute('aria-describedby', error.id);
    await userEvent.click(dialog.getByLabelText('Initial stop hit'));
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses named native radio groups and associates visible helper text', async () => {
    const dialog = await open();
    const yes = dialog.getByLabelText('Yes');
    expect(yes).toHaveAttribute('name', 'system-assessment-taken');
    expect(yes.id).not.toBe('');
    expect(yes.closest('label')).toHaveAttribute('for', yes.id);
    expect(dialog.getByRole('group', { name: 'Did you follow your plan?' })).toHaveAttribute(
      'aria-describedby',
      'system-assessment-adherence-hint',
    );
    expect(
      dialog.getByRole('group', { name: 'Were these rules in place before you entered?' }),
    ).toHaveAttribute('aria-describedby', 'system-assessment-provenance-hint');

    await userEvent.click(yes);
    await userEvent.click(dialog.getByLabelText('Initial stop hit'));
    expect(dialog.getByLabelText('Trading costs')).toHaveAttribute(
      'aria-describedby',
      'system-assessment-cost-hint',
    );
  });

  it('moves between unknown and known cost without losing gross truth', async () => {
    const dialog = await open();
    await userEvent.click(dialog.getByLabelText('Yes'));
    await userEvent.click(dialog.getByLabelText('Plan target'));
    const cost = dialog.getByLabelText('Trading costs');
    expect(dialog.getByText(/gross result only/i)).toBeInTheDocument();
    await userEvent.type(cost, '0.25');
    expect(dialog.getByText('+4.75R')).toBeInTheDocument();
    await userEvent.clear(cost);
    expect(dialog.getByText(/gross result only/i)).toBeInTheDocument();
  });

  it.each([
    ['Partly', 'partly', 'unknown'],
    ['Reconstructed later', 'followed', 'reconstructed_later'],
  ] as const)(
    'corrects assessment metadata through %s without changing the confirmed resolution',
    async (label, expectedAdherence, expectedProvenance) => {
      const dialog = await open(
        trade({
          systemStatus: 'resolved',
          systemResolutionKind: 'price_exit',
          systemExitPrice: '150',
          systemExitReason: 'target_hit',
          systemGrossR: '5.0000',
          systemCostR: '0.0000',
          systemR: '5.0000',
          systemOutcome: 'win',
          systemPlanProvenance: 'unknown',
          planAdherence: 'followed',
        }),
      );
      await userEvent.click(dialog.getByLabelText(label));
      await userEvent.click(dialog.getByRole('button', { name: 'Confirm assessment' }));
      await waitFor(() =>
        expect(correctSystemResolutionAction).toHaveBeenCalledWith(
          expect.objectContaining({
            target: 'resolved',
            resolutionKind: 'price_exit',
            systemExitPrice: '150',
            systemExitReason: 'target_hit',
            planAdherence: expectedAdherence,
            systemPlanProvenance: expectedProvenance,
          }),
        ),
      );
    },
  );
});
