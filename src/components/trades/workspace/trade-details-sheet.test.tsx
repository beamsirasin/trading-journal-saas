import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeDetailsTab } from '@/lib/trades/details-tabs';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../../messages/en.json';
import { TradeDetailsSheet } from './trade-details-sheet';

const push = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/app/trades',
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('range=30d&view=log&trade=trade-1'),
}));

/*
  The reused sections carry their real mutation dialogs, and those import the
  Trade server actions, which are `server-only` and throw the moment a jsdom
  run pulls them in. Stubbing the action module is the same seam
  `trade-detail.test.tsx` already uses: this file is asserting presentation and
  navigation, and every one of those actions has its own tests elsewhere.
*/
vi.mock('@/server/actions/trades', () => ({}));

function trade(overrides: Partial<TradeDetail> = {}): TradeDetail {
  return {
    tradeId: 'trade-1',
    tradingAccountId: 'account-1',
    tradingAccountName: 'Main account',
    tradingAccountBaseCurrency: 'USD',
    tradingAccountIsArchived: false,
    strategyId: 'strategy-1',
    strategyName: 'Elliott Wave',
    strategyVersionId: 'strategy-version-1',
    strategyVersionNumber: 2,
    strategyIsArchived: false,
    setupId: 'setup-1',
    setupName: 'Wave 3',
    setupVersionId: 'setup-version-1',
    setupIsArchived: false,
    strategyAssignedAt: '2026-08-24T07:00:00.000Z',
    setupAssignedAt: '2026-08-24T07:00:00.000Z',
    status: 'closed',
    systemStatus: 'resolved',
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
    timeframe: '1H',
    session: 'London',
    confidence: 75,
    confirmationNotes: 'Wave 3 impulse confirmed on the 1H.',
    tradingviewUrl: null,
    notes: null,
    reviewNotes: null,
    afterTradeNote: null,
    afterTradeTradingviewUrl: null,
    emotionsRecordedAt: null,
    hasChartAttachment: false,
    chartAttachmentUploadedAt: null,
    plannedEntry: '3400.00',
    plannedStop: '3390.00',
    plannedTarget: '3430.00',
    plannedPositionSize: '1',
    plannedRiskMinor: null,
    plannedRiskState: null,
    plannedRewardMinor: null,
    plannedR: '3.0000',
    actualResultMode: 'price',
    actualEntry: '3420.00',
    actualInitialStop: '3410.00',
    actualPositionSize: '1',
    actualInitialRiskMinor: '10000',
    actualExit: '3442.00',
    grossPnlMinor: '22000',
    commissionMinor: '0',
    feesMinor: '0',
    swapMinor: '0',
    netPnlMinor: '22000',
    exitHistoryCompleteness: null,
    finalPnlSource: null,
    exitSubtotalMinor: null,
    exitReconciliation: 'not_recorded',
    canAdoptExitSubtotal: false,
    actualR: '2.2000',
    traderOutcome: 'win',
    enteredAt: '2026-08-24T07:32:00.000Z',
    exitedAt: '2026-08-24T11:36:00.000Z',
    exits: [],
    closedBps: 10_000,
    remainingBps: 0,
    realizedRToDate: null,
    systemExitPrice: '3430.00',
    systemResolutionKind: 'price_exit',
    systemGrossRInput: null,
    systemExitedAt: '2026-08-24T11:00:00.000Z',
    systemExitReason: 'target_hit',
    systemGrossR: '3.0000',
    systemCostR: '0.0000',
    systemR: '3.0000',
    systemOutcome: 'win',
    systemResolvedAt: '2026-08-24T12:00:00.000Z',
    systemDependencySnapshot: null,
    systemPlanProvenance: null,
    planAdherence: null,
    executionGapR: '-0.8000',
    setupConditionState: 'not_recorded',
    setupConditionChecks: [],
    setupConditionConfiguredCount: null,
    ruleChecks: [],
    mistakes: [],
    mistakeCatalog: [],
    emotions: [],
    emotionCatalog: [],
    createdAt: '2026-08-24T07:00:00.000Z',
    updatedAt: '2026-08-24T12:00:00.000Z',
    ...overrides,
  };
}

function renderSheet(overrides: Partial<TradeDetail> = {}, tab: TradeDetailsTab = 'overview') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeDetailsSheet
        trade={trade(overrides)}
        tab={tab}
        timezone="Asia/Bangkok"
        locale="en-GB"
        canWrite
        classificationOptions={[]}
      />
    </NextIntlClientProvider>,
  );
}

function panel(): HTMLElement {
  return screen.getByRole('tabpanel');
}

/**
 * The sheet renders through a portal, so `render`'s own `container` is empty.
 * Every structural query goes through the document instead.
 */
function find(selector: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(selector);
}

/** The identity block, so a word that is also a fact in Overview stays unambiguous. */
function identity(): HTMLElement {
  const element = find('[data-trade-details-identity]');
  if (element === null) throw new Error('missing identity block');
  return element;
}

beforeEach(() => {
  push.mockClear();
});

describe('Trade Details — identity and naming', () => {
  it('is called Trade Details and leads with the Symbol', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: /XAUUSD/ })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toHaveAccessibleName('Trade Details sections');
  });

  it('states direction, lifecycle and result without relying on colour', () => {
    renderSheet();
    expect(within(identity()).getByText('Long')).toBeInTheDocument();
    expect(within(identity()).getByText('Closed')).toBeInTheDocument();
    expect(within(identity()).getByText('WIN')).toBeInTheDocument();
  });

  it('names the account, the day, the session and the timeframe', () => {
    renderSheet();
    const context = within(identity()).getByText(/Main account/);
    expect(context).toHaveTextContent(/London/);
    expect(context).toHaveTextContent(/1H/);
    // The day is resolved in the reader's own zone: 24 Aug 11:36 UTC is still
    // 24 Aug in Bangkok, and a naive UTC render would be a different day for
    // trades either side of midnight.
    expect(context).toHaveTextContent(/24 Aug 2026/);
  });
});

describe('Trade Details — the six tabs', () => {
  it("offers exactly this product's own six, in workflow order", () => {
    renderSheet();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Plan',
      'Execution',
      'Review',
      'Chart',
      'Notes',
    ]);
  });

  it('renders every tab even when the Trade has nothing to put in one', () => {
    // The tab a trader is looking for in order to ADD a chart must not be the
    // tab that disappears because there is no chart.
    renderSheet({ hasChartAttachment: false, tradingviewUrl: null });
    expect(screen.getByRole('tab', { name: 'Chart' })).toBeInTheDocument();
  });

  /*
    PROVENANCE ON THE LIVE RECORD (contract §28, Phase 15G.5C). The disclosure
    was lost when the five-section Trade Detail was retired; a Trade whose
    entry context was recorded after the outcome was known says so, once, on
    the Plan tab that holds that context — and a normal Trade says nothing.
  */
  it('discloses retrospective recording on the Plan tab, and only for such a Trade', () => {
    const { unmount } = renderSheet({ recordedRetrospectively: true }, 'plan');
    const disclosure = document.body.querySelectorAll('[data-recorded-retrospectively]');
    expect(disclosure).toHaveLength(1);
    expect(disclosure[0]).toHaveTextContent('Recorded retrospectively');
    expect(disclosure[0]).toHaveClass('text-muted-foreground');
    unmount();

    renderSheet({ recordedRetrospectively: false }, 'plan');
    expect(document.body.querySelector('[data-recorded-retrospectively]')).toBeNull();
    expect(screen.queryByText('Recorded retrospectively')).toBeNull();
  });

  it('opens on the tab the URL asked for', () => {
    renderSheet({}, 'review');
    expect(screen.getByRole('tab', { name: 'Review', selected: true })).toBeInTheDocument();
  });

  it('is a real tablist: one tab stop, arrow keys move between tabs', async () => {
    const user = userEvent.setup();
    renderSheet();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('tabindex', '-1');

    overview.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Plan', selected: true })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Notes', selected: true })).toBeInTheDocument();
  });

  it('switches panels without navigating, so Back is not six presses deep', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('Trade Details — system versus trader', () => {
  it('shows the comparison in beginner-first wording when both sides are settled', () => {
    renderSheet();
    const comparison = find('[data-trade-comparison="available"]');
    expect(comparison).not.toBeNull();
    const rows = within(comparison as HTMLElement);
    expect(rows.getByText('+3.00R')).toBeInTheDocument();
    expect(rows.getByText('+2.20R')).toBeInTheDocument();
    expect(rows.getByText('-0.80R')).toBeInTheDocument();
    expect(rows.getByText(/What the system offered/)).toBeInTheDocument();
    expect(rows.getByText(/What you captured/)).toBeInTheDocument();
    expect(rows.getByText('Execution Gap')).toBeInTheDocument();
  });

  it('never fabricates a gap, and says which side is missing', () => {
    renderSheet({
      systemStatus: 'pending',
      systemR: null,
      systemOutcome: null,
      executionGapR: null,
    });
    expect(find('[data-trade-comparison="available"]')).toBeNull();
    expect(find('[data-trade-comparison-reason="systemPending"]')).not.toBeNull();
    expect(screen.getByText(/system result has not been recorded yet/)).toBeInTheDocument();
  });

  it('explains an unsettled position rather than comparing a partial result', () => {
    renderSheet({
      status: 'open',
      actualR: null,
      traderOutcome: null,
      exitedAt: null,
      executionGapR: null,
    });
    expect(find('[data-trade-comparison-reason="actualIncomplete"]')).not.toBeNull();
  });

  /*
    THE MIXING THIS SLICE REMOVES. A contract row's Actual R is canonical and
    its stored System R is not, so the sheet states that rather than showing
    their difference as this Trade's Execution Gap (contract §25, §28).
  */
  it('withholds the comparison on an Add Trade contract row and says why', () => {
    renderSheet({ recordingContract: 'add_trade_v1' });
    expect(find('[data-trade-comparison="available"]')).toBeNull();
    expect(find('[data-trade-comparison-reason="systemNotCanonical"]')).not.toBeNull();
    expect(screen.queryByText('-0.80R')).toBeNull();
    expect(screen.getByText(/no System Assessment exists for it/)).toBeInTheDocument();
  });

  it('says so when the rules would not have permitted the Trade at all', () => {
    renderSheet({
      systemStatus: 'no_trade',
      systemR: null,
      systemOutcome: null,
      executionGapR: null,
    });
    expect(find('[data-trade-comparison-reason="systemNoTrade"]')).not.toBeNull();
  });
});

describe('Trade Details — Overview', () => {
  it('groups the result, the trade, the prices and the costs', () => {
    renderSheet();
    for (const group of ['Result', 'Trade', 'Price', 'Cost and size']) {
      expect(within(panel()).getByText(group)).toBeInTheDocument();
    }
  });

  it('reports holding time from the two stored instants', () => {
    renderSheet();
    expect(within(panel()).getByText('Holding time')).toBeInTheDocument();
    expect(within(panel()).getByText('4h 4m')).toBeInTheDocument();
  });

  it('drops the price group entirely for a Trade with no prices at all', () => {
    renderSheet({
      actualEntry: null,
      actualExit: null,
      actualInitialStop: null,
      plannedTarget: null,
    });
    expect(within(panel()).queryByText('Price')).not.toBeInTheDocument();
  });
});

describe('Trade Details — Plan and Confidence', () => {
  it("shows Confidence with the product's own five-step label", async () => {
    const user = userEvent.setup();
    renderSheet({ confidence: 75 });
    await user.click(screen.getByRole('tab', { name: 'Plan' }));

    expect(within(panel()).getByText('Confidence')).toBeInTheDocument();
    expect(within(panel()).getByText('High')).toBeInTheDocument();
    expect(find('[data-trade-confidence="75"]')).not.toBeNull();
  });

  it('says Confidence means confidence BEFORE entering', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(within(panel()).getByText(/How confident you were before entering/)).toBeInTheDocument();
  });

  it('reports an unrecorded Confidence honestly, and never fills it in from the result', async () => {
    const user = userEvent.setup();
    renderSheet({ confidence: null });
    await user.click(screen.getByRole('tab', { name: 'Plan' }));

    expect(within(panel()).getByText('No confidence recorded')).toBeInTheDocument();
    expect(within(panel()).getByText(/never filled in from the result/)).toBeInTheDocument();
  });

  it('carries the strategy, the setup and the planned reward ratio', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: 'Plan' }));

    expect(within(panel()).getByText('Elliott Wave')).toBeInTheDocument();
    expect(within(panel()).getByText('Wave 3')).toBeInTheDocument();
    expect(within(panel()).getByText('1 : 3.00')).toBeInTheDocument();
  });

  it('holds the System result, which is why "Needs system result" opens here', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(within(panel()).getByRole('heading', { name: 'System Outcome' })).toBeInTheDocument();
  });
});

describe('Trade Details — Execution', () => {
  it('builds a timeline only from recorded events', async () => {
    const user = userEvent.setup();
    renderSheet({
      exits: [
        {
          exitId: 'exit-1',
          sequence: 1,
          closedBps: 5_000,
          exitScope: null,
          exitPrice: '3432.00',
          realizedPnlMinor: '12000',
          exitReason: 'Partial at target 1',
          exitedAt: '2026-08-24T10:51:00.000Z',
        },
        {
          exitId: 'exit-2',
          sequence: 2,
          closedBps: 5_000,
          exitScope: null,
          exitPrice: '3442.00',
          realizedPnlMinor: '10000',
          exitReason: null,
          exitedAt: '2026-08-24T11:36:00.000Z',
        },
      ],
    });
    await user.click(screen.getByRole('tab', { name: 'Execution' }));

    // Entry, two exit legs, and the settled result: four real events.
    expect(find('[data-trade-timeline]')).toHaveAttribute('data-trade-timeline', '4');
    expect(within(panel()).getByText('Entry')).toBeInTheDocument();
    expect(within(panel()).getByText('Exit 1 · 50%')).toBeInTheDocument();
    expect(within(panel()).getByText('Exit 2 · 50%')).toBeInTheDocument();
  });

  it('offers an honest empty state rather than inventing events', async () => {
    const user = userEvent.setup();
    renderSheet({ status: 'planned', enteredAt: null, exitedAt: null, exits: [] });
    await user.click(screen.getByRole('tab', { name: 'Execution' }));
    expect(within(panel()).getByText('Nothing executed yet')).toBeInTheDocument();
  });
});

describe('Trade Details — Review', () => {
  it('reads the attribution quadrant from two independently stored outcomes', async () => {
    const user = userEvent.setup();
    renderSheet({ systemOutcome: 'win', traderOutcome: 'loss' });
    await user.click(screen.getByRole('tab', { name: 'Review' }));
    expect(within(panel()).getByText('Good trade idea, weak execution.')).toBeInTheDocument();
  });

  it('withholds the reading while either axis is unresolved', async () => {
    const user = userEvent.setup();
    renderSheet({
      systemStatus: 'pending',
      systemOutcome: null,
      systemR: null,
      executionGapR: null,
    });
    await user.click(screen.getByRole('tab', { name: 'Review' }));
    expect(find('[data-trade-quadrant="unavailable"]')).not.toBeNull();
  });

  it('carries the discipline surfaces rather than generic tags', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: 'Review' }));
    expect(within(panel()).getByText('Trade Management')).toBeInTheDocument();
    expect(within(panel()).getByText('Rules followed')).toBeInTheDocument();
    expect(within(panel()).getByText('Common mistakes')).toBeInTheDocument();
    expect(within(panel()).getByText('Emotions')).toBeInTheDocument();
  });
});

describe('Trade Details — Chart and Notes', () => {
  it('links a TradingView chart out, safely', async () => {
    const user = userEvent.setup();
    renderSheet({ tradingviewUrl: 'https://www.tradingview.com/x/abc123/' });
    await user.click(screen.getByRole('tab', { name: 'Chart' }));

    const link = within(panel()).getByRole('link', { name: /Open TradingView chart/ });
    expect(link).toHaveAttribute('href', 'https://www.tradingview.com/x/abc123/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('serves an attached image from the authenticated route, never a storage key', async () => {
    const user = userEvent.setup();
    renderSheet({ hasChartAttachment: true });
    await user.click(screen.getByRole('tab', { name: 'Chart' }));
    expect(within(panel()).getByRole('img')).toHaveAttribute(
      'src',
      '/api/trades/trade-1/chart-attachment',
    );
  });

  it('says what a Chart tab would hold when there is nothing attached', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('tab', { name: 'Chart' }));
    expect(within(panel()).getByText('No chart attached')).toBeInTheDocument();
  });

  it('organises Notes around when they were written', async () => {
    const user = userEvent.setup();
    renderSheet({ notes: 'Held through the retrace.', reviewNotes: 'Size down next time.' });
    await user.click(screen.getByRole('tab', { name: 'Notes' }));

    expect(within(panel()).getByText('Before the trade')).toBeInTheDocument();
    expect(within(panel()).getByText('Why am I taking this trade?')).toBeInTheDocument();
    expect(within(panel()).getByText('The trade itself')).toBeInTheDocument();
    expect(within(panel()).getByText('The lesson')).toBeInTheDocument();
    // The lesson is edited where it belongs, not in a second form.
    expect(within(panel()).getByText(/edited in the Review tab/)).toBeInTheDocument();
  });

  it('says what Notes are for when nothing was written', async () => {
    const user = userEvent.setup();
    renderSheet({ confirmationNotes: null, notes: null, reviewNotes: null });
    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(within(panel()).getByText('Nothing written down yet')).toBeInTheDocument();
  });
});

describe('Trade Details — closing', () => {
  it('returns to the same list, keeping the applied scope', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.keyboard('{Escape}');
    expect(push).toHaveBeenCalledWith('/app/trades?range=30d&view=log', { scroll: false });
  });

  it('closes on the close button by the same one path', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(push).toHaveBeenCalledWith('/app/trades?range=30d&view=log', { scroll: false });
  });
});

/*
  AN AFTER TRADE RECORD SAYS WHAT IT HOLDS AND WHEN IT WAS CAPTURED (contract
  §7, §9, §13; UX Rules §2.8). Recalled answers read as recalled, "Don't
  remember" is never shown as Not met, Post-Trade Emotion stays its own
  observation, and a stated result offers no correction that would rebuild it.
*/
describe('Trade Details — an After Trade record', () => {
  const CORRECT_EXECUTION = en.trades.lifecycle.execution.correct;
  const afterTrade: Partial<TradeDetail> = {
    recordingContract: 'add_trade_v1',
    recordedRetrospectively: true,
    traderOutcome: 'break_even',
    traderOutcomeSelected: true,
    actualR: '0.2000',
    netPnlMinor: '1000',
    plannedRiskMinor: '5000',
    actualResultMode: 'money',
    actualRiskAnswer: 'unknown',
    actualInitialRiskMinor: null,
    systemStatus: 'pending',
    systemR: null,
    systemOutcome: null,
    exitPlanState: 'saved',
    exitPlanProvenance: 'selected',
    exitPlanName: 'Trail structure',
    exitPlanInstructions: 'Trail beneath each higher low.',
    captureOrigins: {
      strategy: 'recalled_after_trade',
      setup: 'recalled_after_trade',
      exitPlan: 'recalled_after_trade',
      confidence: 'recalled_after_trade',
      emotions: 'recalled_after_trade',
    },
    setupConditionState: 'recorded',
    setupConditionChecks: [
      {
        conditionKey: 'c1',
        label: 'Retest held',
        sortOrder: 0,
        checkStatus: 'met',
        origin: 'recalled_after_trade',
      },
      {
        conditionKey: 'c2',
        label: 'News clear',
        sortOrder: 1,
        checkStatus: 'unknown',
        origin: 'recalled_after_trade',
      },
    ],
    postTradeEmotionsRecordedAt: '2026-08-24T12:00:00.000Z',
    postTradeEmotions: [{ key: 'frustrated', label: 'Frustrated' }],
  };

  it('shows the trader’s own outcome, never marked legacy', () => {
    renderSheet(afterTrade);
    expect(within(identity()).getByText('BE')).toBeInTheDocument();
    expect(screen.queryByText('Legacy')).toBeNull();
  });

  it('labels each recalled answer as recalled after close, on the Plan tab', () => {
    renderSheet(afterTrade, 'plan');
    const tags = Array.from(document.body.querySelectorAll('[data-capture-origin]'));
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const tag of tags) {
      expect(tag).toHaveAttribute('data-capture-origin', 'recalled_after_trade');
      expect(tag).toHaveTextContent('Recalled after close');
    }
    expect(find('[data-exit-plan-record="saved"]')).toHaveTextContent('Trail structure');
  });

  it('shows "Don’t remember" as its own answer, never counted as Not met', () => {
    renderSheet(afterTrade, 'plan');
    expect(find('[data-condition-status="unknown"]')).toHaveTextContent("Don't remember");
    expect(find('[data-condition-status="unknown"]')).not.toHaveTextContent('Not met');
    expect(find('[data-condition-coverage]')).toHaveTextContent("1 met · 1 don't remember");
  });

  it('keeps unanswered conditions in the coverage, never hiding them behind a ratio', () => {
    renderSheet({ ...afterTrade, setupConditionConfiguredCount: 5 }, 'plan');
    const coverage = find('[data-condition-coverage]');
    expect(coverage).toHaveTextContent("1 met · 1 don't remember · 3 unanswered");
    expect(coverage).toHaveAttribute('data-condition-unanswered', '3');
    expect(coverage).not.toHaveTextContent('not met');
  });

  it('shows No Strategy as an answer rather than an empty classification', () => {
    renderSheet(
      { ...afterTrade, strategyName: null, setupName: null, strategyId: null, noStrategy: true },
      'plan',
    );
    expect(within(panel()).getByText('No strategy')).toBeInTheDocument();
  });

  it('keeps Post-Trade Emotion separate on the Review tab, and withholds the legacy quadrant', () => {
    renderSheet({ ...afterTrade, systemOutcome: 'win' }, 'review');
    expect(find('[data-post-trade-emotions="selected"]')).toHaveTextContent('Frustrated');
    expect(find('[data-trade-quadrant="unavailable"]')).not.toBeNull();
  });

  it('states Risk at Entry and the Actual Risk answer, and offers no rebuild-from-legs correction', () => {
    renderSheet(afterTrade, 'execution');
    expect(within(panel()).getByText('Risk at entry')).toBeInTheDocument();
    expect(within(panel()).getByText("Don't know")).toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: CORRECT_EXECUTION })).toBeNull();
  });

  it('still offers that correction on a legacy closed Trade', () => {
    renderSheet({}, 'execution');
    expect(within(panel()).getByRole('button', { name: CORRECT_EXECUTION })).toBeInTheDocument();
  });
});

/*
  CAPTURE READBACK (Add Trade contract §5, §13, §24). What the trader answered
  in At Entry or After Trade is read back on the live sheet — not only in a
  renderer the product never shows — and nothing the trader was never asked
  appears as a known value.
*/
describe('Trade Details — reads back what Add Trade captured', () => {
  const contract: Partial<TradeDetail> = {
    recordingContract: 'add_trade_v1',
    recordedRetrospectively: true,
    traderOutcome: 'win',
    traderOutcomeSelected: true,
    actualR: '1.0000',
    netPnlMinor: '5000',
    plannedRiskMinor: '5000',
    plannedEntry: null,
    plannedStop: null,
    plannedTarget: null,
    plannedR: null,
    actualResultMode: 'money',
    actualEntry: null,
    actualInitialStop: null,
    actualRiskAnswer: 'matched',
    actualInitialRiskMinor: '5000',
    systemStatus: 'pending',
    systemR: null,
    systemOutcome: null,
    executionGapR: null,
  };

  it('shows No Fixed Target as an answer, not as a blank field', () => {
    renderSheet({ ...contract, targetState: 'no_fixed' }, 'plan');
    expect(find('[data-target-state="no_fixed"]')).toHaveTextContent('No fixed target');
  });

  it('shows an unanswered Target as not answered', () => {
    renderSheet({ ...contract, targetState: null }, 'plan');
    expect(find('[data-target-state="unanswered"]')).toHaveTextContent('Not answered');
  });

  it('shows a Fixed Target recorded as a TP price only, with no invented profit', () => {
    renderSheet(
      { ...contract, targetState: 'fixed', targetPrice: '2412.50', plannedRewardMinor: null },
      'plan',
    );
    expect(find('[data-target-state="fixed"]')).toHaveTextContent('Fixed target');
    expect(within(panel()).getByText('2412.50')).toBeInTheDocument();
    expect(within(panel()).getByText('TP price')).toBeInTheDocument();
  });

  it('shows the price and size context the trader gave', () => {
    renderSheet(
      {
        ...contract,
        contextEntryPrice: '2400.10',
        contextStopPrice: '2390.00',
        contextPositionSize: '0.5',
      },
      'plan',
    );
    expect(find('[data-price-context="recorded"]')).toHaveTextContent('2400.10');
    expect(find('[data-price-context="recorded"]')).toHaveTextContent('2390.00');
    expect(find('[data-price-context="recorded"]')).toHaveTextContent('0.5');
  });

  it('reads Risk at Entry and Target as the trader’s intent, never as a System Plan', () => {
    renderSheet({ ...contract, targetState: 'fixed', plannedRewardMinor: '10000' }, 'plan');
    expect(within(panel()).getByText('Risk and target')).toBeInTheDocument();
    expect(within(panel()).queryByRole('heading', { name: 'System Plan' })).toBeNull();
    expect(within(panel()).queryByText('Plan by Money')).toBeNull();
  });

  it('never shows costs Add Trade did not ask for as $0.00, and names Actual Risk', () => {
    renderSheet(contract, 'overview');
    const overview = panel();
    expect(within(overview).queryByText('Commission')).toBeNull();
    expect(within(overview).queryByText('Fees')).toBeNull();
    expect(within(overview).queryByText('Swap')).toBeNull();
    expect(within(overview).getByText('Actual risk')).toBeInTheDocument();
  });

  it('shows no Money mode row, and no default costs, on the Execution tab', () => {
    renderSheet(
      {
        ...contract,
        exits: [],
        enteredAtSource: 'default_now',
        enteredAt: '2026-08-24T02:00:00.000Z',
      },
      'execution',
    );
    const execution = panel();
    expect(within(execution).queryByText(/Money mode/)).toBeNull();
    expect(within(execution).queryByText('Commission')).toBeNull();
    expect(within(execution).getByText(/Set automatically when saved/)).toBeInTheDocument();
  });

  it('marks a legacy row’s derived outcome and R as legacy in the header', () => {
    renderSheet();
    expect(find('[data-result-legacy]')).not.toBeNull();
    expect(find('[data-trade-details-hero]')).toHaveTextContent('Legacy');
  });

  it('never marks a contract row’s selected outcome or canonical R as legacy', () => {
    renderSheet(contract);
    expect(find('[data-result-legacy]')).toBeNull();
    expect(find('[data-trade-details-hero]')).not.toHaveTextContent('Legacy');
  });
});
