import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordContractExitSchema } from '@/lib/trades/schemas';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeCloseForm } from './trade-close-form';

vi.setConfig({ testTimeout: 15_000 });

const recordContractExitActionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/server/actions/trades', () => ({
  recordContractExitAction: (input: unknown) => recordContractExitActionMock(input),
}));
vi.mock('@/server/actions/exit-plans', () => ({
  createExitPlanAction: vi.fn(),
  updateExitPlanAction: vi.fn(),
  archiveExitPlanAction: vi.fn(),
  setExitPlanStrategyDefaultAction: vi.fn(),
  removeExitPlanStrategyDefaultAction: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const TRADE_ID = '018f0000-0000-7000-8000-000000000099';
const HOUR = 60 * 60 * 1000;
const ENTERED_AT = new Date(Date.now() - 48 * HOUR).toISOString();
const EARLIER_EXIT_AT = new Date(Date.now() - 3 * HOUR).toISOString();

type Exit = TradeDetail['exits'][number];

function trade(exits: readonly Exit[] = [], overrides: Partial<TradeDetail> = {}): TradeDetail {
  return {
    tradeId: TRADE_ID,
    symbol: 'XAUUSD',
    direction: 'long',
    status: 'open',
    recordingContract: 'add_trade_v1',
    tradingAccountBaseCurrency: 'USD',
    enteredAt: ENTERED_AT,
    plannedRiskMinor: '10000',
    closedBps: exits.reduce((sum, exit) => sum + (exit.closedBps ?? 0), 0) || null,
    remainingBps: null,
    exits,
    // Entry context, read-only on the close flow.
    strategyName: 'Golden Breakout',
    noStrategy: false,
    setupName: null,
    noSetup: true,
    setupConditionChecks: [],
    setupConditionConfiguredCount: null,
    actualRiskAnswer: 'matched',
    actualInitialRiskMinor: null,
    // The plan answered (decision 59), so a close here is gated only on its own answers.
    targetState: 'fixed',
    plannedRewardMinor: '20000',
    targetPrice: null,
    exitPlanName: null,
    exitPlanInstructions: null,
    confidence: 75,
    emotionsRecordedAt: null,
    emotions: [],
    timeframe: '15m',
    session: null,
    confirmationNotes: 'Clean retest of the high.',
    notes: null,
    tradingviewUrl: null,
    ...overrides,
  } as unknown as TradeDetail;
}

const EARLIER_EXIT: Exit = {
  exitId: '018f0000-0000-7000-8000-0000000000e1',
  sequence: 1,
  closedBps: 5_000,
  exitScope: 'part',
  exitPrice: '2410',
  realizedPnlMinor: '4000',
  exitReason: null,
  exitedAt: EARLIER_EXIT_AT,
};

const DRAFT_SCOPE = { ownerKey: 'owner-a', workspaceKey: 'ws-1', tradeKey: 'trade-1' };
const DRAFT_KEY = 'tradechemist:close-draft:owner-a:ws-1:trade-1';

function renderForm(
  scope: 'part' | 'all_remaining',
  detail: TradeDetail = trade(),
  draftScope: typeof DRAFT_SCOPE | null = null,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeCloseForm
        trade={detail}
        scope={scope}
        timezone="Asia/Bangkok"
        draftScope={draftScope}
      />
    </NextIntlClientProvider>,
  );
}

function storedDraft(): { tasks: Record<string, { exitResult: Record<string, unknown> }> } | null {
  const raw = window.localStorage.getItem(DRAFT_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(name: 'Record partial exit' | 'Close trade') {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** A Final Close needs the trader's explicit outcome (decision 59). */
function chooseOutcome(name: 'Win' | 'BE' | 'Loss') {
  fireEvent.click(screen.getByRole('radio', { name }));
}

function lastPayload() {
  const calls = recordContractExitActionMock.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

function timeValue(id: string): string {
  return document.querySelector(`[data-exit-time="${id}"]`)?.getAttribute('data-value') ?? '';
}

function choose(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

/** Canonical Step 5 — "Closed all at once", with the close's P&L. */
function closeAllAtOnce(pnl: string) {
  choose('Closed all at once');
  type('P&L for the close', pnl);
}

/** Canonical Step 5 — "I only know the final result" (asked straight away once exits exist). */
function stateTotal(pnl: string, { askMode = true }: { askMode?: boolean } = {}) {
  if (askMode) choose('Closed in parts');
  choose('I only know the final result');
  type('Final net P&L', pnl);
}

function finalResult(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-final-result]')!;
}

beforeEach(() => {
  recordContractExitActionMock.mockReset();
  pushMock.mockReset();
  recordContractExitActionMock.mockResolvedValue({
    ok: true,
    data: {
      tradeId: TRADE_ID,
      exitId: 'exit',
      scope: 'part',
      alreadyRecorded: false,
      status: 'open',
      actualR: null,
      traderOutcome: null,
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Part — "Record partial exit"', () => {
  it('asks only for this exit leg: no scope choice, no whole-trade result, no outcome', () => {
    renderForm('part');
    expect(screen.getByLabelText('P&L for this exit')).toBeInTheDocument();
    expect(screen.getByLabelText('% of original position')).toBeInTheDocument();
    expect(screen.getByLabelText('Exit price')).toBeInTheDocument();
    expect(screen.getByLabelText('Exit reason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Exit date & time' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Final net P&L')).toBeNull();
    expect(document.querySelector('[data-actual-r]')).toBeNull();
    for (const name of ['Win', 'BE', 'Loss', 'Part', 'All remaining']) {
      expect(screen.queryByRole('radio', { name })).toBeNull();
    }
  });

  it('records the leg through the canonical action and returns to the trade', async () => {
    renderForm('part');
    type('P&L for this exit', '50');
    type('% of original position', '25');
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload).toMatchObject({
      tradeId: TRADE_ID,
      scope: 'part',
      realizedPnlMinor: '5000',
      closedBps: 2_500,
      exitedAt: null,
    });
    expect(payload).not.toHaveProperty('finalPnlMinor');
    expect(payload).not.toHaveProperty('traderOutcome');
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/app/trades?trade=${TRADE_ID}&tab=execution`, {
        scroll: false,
      }),
    );
  });

  it('puts a server exit-time refusal on the exit time, in its precise words, focused', async () => {
    recordContractExitActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'exit_time_before_entry' },
    });
    renderForm('part');
    submit('Record partial exit');
    const row = screen.getByRole('button', { name: 'Edit Exit date & time' });
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.getByText('The exit time cannot be before the entry time.')).toBeVisible();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('retries a failed save of the same answers with the same Save key', async () => {
    recordContractExitActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    renderForm('part');
    type('P&L for this exit', '50');
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
    const firstKey = lastPayload().mutationKey;
    await screen.findByRole('button', { name: 'Record partial exit' });
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(2));
    expect(lastPayload().mutationKey).toBe(firstKey);
    // Different answers are a different request, so a new key.
    await screen.findByRole('button', { name: 'Record partial exit' });
    type('P&L for this exit', '60');
    recordContractExitActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(3));
    expect(lastPayload().mutationKey).not.toBe(firstKey);
  });
});

/*
  THE FINAL CLOSE IS CANONICAL STEP 5. Close Existing enters the same Trader
  Result Record Closed shows — the same components, in the same order — with
  only its lifecycle facts coming in through props.
*/
describe('All Remaining — canonical Step 5, Trader result', () => {
  it('reads as Step 5: the step heading, the outcome, the Trade result, then the final exit time', () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    const step = document.querySelector<HTMLElement>('[data-close-step="result"]')!;
    expect(within(step).getByRole('heading', { name: 'Trader result' })).toBeVisible();
    expect(step).toHaveTextContent('Step 5 of 6');
    const order = [
      step.querySelector('[data-step-heading]'),
      step.querySelector('[data-result-outcome]'),
      step.querySelector('[data-result-panel]'),
      step.querySelector('[data-result-exit-time]'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // The final exit time is its own launcher, outside the Trade result.
    expect(step.querySelector('[data-result-panel] [data-result-exit-time]')).toBeNull();
    // Nothing of the retired close form remains: no typed Final Net P&L beside
    // the exits, no "Use recorded exits", no completeness question, no fold.
    expect(screen.queryByRole('button', { name: 'Use recorded exits' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Is this every exit?' })).toBeNull();
    expect(document.getElementById('close-history-toggle')).toBeNull();
    // No scope question: the action already chose All Remaining.
    expect(screen.queryByRole('radio', { name: 'Part' })).toBeNull();
    // Step 6 comes after the close: its System Result never gates it.
    expect(document.querySelector('[data-plan-outcome]')).toBeNull();
  });

  it('asks the outcome with the canonical Win / BE / Loss buttons, Required, and keeps it independent', async () => {
    renderForm('all_remaining');
    const outcome = document.querySelector<HTMLElement>('[data-result-outcome]')!;
    expect(outcome.querySelector('[data-requirement]')).toHaveAttribute(
      'data-requirement',
      'required',
    );
    for (const name of ['Win', 'BE', 'Loss']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    expect(outcome).toHaveTextContent('Your own call. It is never set from the P&L.');
    closeAllAtOnce('-20');
    expect(screen.getByRole('radio', { name: 'Loss' })).not.toBeChecked();
    chooseOutcome('Win');
    expect(screen.getByText(/You chose Win, but your final net P&L is negative/)).toBeVisible();
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({ finalPnlMinor: '-2000', traderOutcome: 'win' });
  });

  it('"Closed all at once": the close\'s P&L is the result, with Trader R derived from Risk', async () => {
    renderForm('all_remaining');
    const readout = () => document.querySelector('[data-actual-r]')!;
    expect(finalResult()).toHaveAttribute('data-final-result', 'waiting');
    expect(finalResult()).toHaveTextContent(
      'Choose how you closed the trade to record its result.',
    );
    // Never a fabricated 0R, and never a field.
    expect(readout()).toHaveAttribute('data-actual-r', 'unavailable');
    expect(readout()).not.toHaveTextContent('0.00R');
    expect(within(readout() as HTMLElement).queryByRole('textbox')).toBeNull();

    choose('Closed all at once');
    expect(finalResult()).toHaveTextContent('Enter the P&L for the close.');
    expect(screen.getByLabelText('Exit price')).toBeInTheDocument();
    expect(screen.getByLabelText('Exit reason')).toBeInTheDocument();
    type('P&L for the close', '150');
    expect(finalResult()).toHaveAttribute('data-final-result', 'final');
    expect(finalResult().querySelector('[data-final-pnl-provenance]')).toHaveAttribute(
      'data-final-pnl-provenance',
      'full_close',
    );
    expect(finalResult()).toHaveTextContent('From the close');
    expect(readout()).toHaveTextContent('+1.50R');

    chooseOutcome('Win');
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({
      scope: 'all_remaining',
      realizedPnlMinor: '15000',
      closedBps: null,
      exitedAt: null,
      finalPnlMinor: '15000',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
      finalExitedAt: null,
    });
    expect(RecordContractExitSchema.safeParse(lastPayload()).success).toBe(true);
  });

  it('"Closed in parts" asks how the result is recorded, as Record Closed does', () => {
    renderForm('all_remaining');
    choose('Closed in parts');
    expect(
      screen.getByRole('group', { name: /How do you want to record the result/ }),
    ).toBeVisible();
    expect(finalResult()).toHaveTextContent('Choose how you want to record the result.');
  });

  it('a Trade with recorded exits was closed in parts: it says so rather than asking again', () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    expect(screen.queryByRole('radio', { name: 'Closed all at once' })).toBeNull();
    const fact = document.querySelector('[data-closed-in-parts]')!;
    expect(fact).toHaveTextContent('Closed in parts');
    expect(fact).toHaveTextContent('1 exit was recorded while the trade was open.');
    expect(screen.getByRole('radio', { name: 'Record each exit' })).toBeInTheDocument();
  });

  it('"Record each exit": the recorded exits, then the closing exit — final once every exit has P&L', async () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    choose('Record each exit');
    const status = document.querySelector('[data-closing-status]')!;
    // The closing exit is All remaining, so the close is proven — the result is not, yet.
    expect(status).toHaveAttribute('data-closing-status', 'closed');
    expect(status).toHaveTextContent('Fully closed · 100% accounted for');
    expect(status).toHaveTextContent('2 exits');
    expect(document.querySelector('[data-recorded-exit="1"]')).toHaveTextContent('40.00');
    expect(
      within(document.querySelector<HTMLElement>('[data-recorded-exit="1"]')!).queryAllByRole(
        'textbox',
      ),
    ).toHaveLength(0);
    const closingExit = document.querySelector<HTMLElement>('[data-closing-exit]')!;
    expect(closingExit).toHaveTextContent('Exit 2');
    expect(closingExit).toHaveTextContent('All remaining');
    expect(finalResult()).toHaveAttribute('data-final-result', 'waiting');
    expect(finalResult()).toHaveTextContent('Recorded so far: +40.00');
    expect(finalResult()).toHaveTextContent('Waiting for the P&L of every exit.');

    type('P&L for this exit', '35');
    type('% of original position', '50');
    expect(finalResult()).toHaveAttribute('data-final-result', 'final');
    expect(finalResult()).toHaveTextContent('Sum of your exits');
    expect(finalResult().querySelector('[data-final-pnl]')).toHaveTextContent('75.00');

    chooseOutcome('Win');
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({
      realizedPnlMinor: '3500',
      closedBps: 5_000,
      finalPnlMinor: '7500',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
    });
    expect(RecordContractExitSchema.safeParse(lastPayload()).success).toBe(true);
  });

  it('"I only know the final result": the stated total, marked as stated, and no exit P&L made up', async () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    stateTotal('120', { askMode: false });
    expect(finalResult()).toHaveTextContent('Stated by you');
    expect(document.querySelector('[data-actual-r]')).toHaveTextContent('+1.20R');
    expect(screen.queryByLabelText('P&L for this exit')).toBeNull();
    chooseOutcome('Win');
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({ realizedPnlMinor: null, finalPnlMinor: '12000' });
    expect(lastPayload()).not.toHaveProperty('finalPnlAdoptedFromExits');
    expect(lastPayload()).not.toHaveProperty('exitHistoryCompleteness');
  });

  it('starts the final exit time unanswered; each shortcut writes only when pressed', () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    expect(timeValue('close-finalExitedAt')).toBe('');
    expect(document.getElementById('close-finalExitedAt')).toHaveTextContent('Not recorded');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use the last recorded exit time for Final exit time',
      }),
    );
    expect(timeValue('close-finalExitedAt')).not.toBe('');
    const last = timeValue('close-finalExitedAt');
    // "Use now" is offered again from the sheet, never applied on its own.
    fireEvent.click(document.getElementById('close-finalExitedAt')!);
    const sheet = within(screen.getByRole('dialog'));
    expect(timeValue('close-finalExitedAt')).toBe(last);
    fireEvent.click(sheet.getByRole('button', { name: 'Use now for Final exit time' }));
    expect(timeValue('close-finalExitedAt')).not.toBe(last);
    fireEvent.click(sheet.getByRole('button', { name: 'Clear Final exit time' }));
    expect(timeValue('close-finalExitedAt')).toBe('');
  });

  it('offers "Use last recorded exit time" only when an earlier exit states a time', () => {
    renderForm('all_remaining');
    expect(screen.getByRole('button', { name: 'Use now for Final exit time' })).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: 'Use the last recorded exit time for Final exit time',
      }),
    ).toBeNull();
  });

  it('puts a server exit-time refusal on the final exit time, in its precise words, focused', async () => {
    recordContractExitActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'exit_time_before_entry' },
    });
    renderForm('all_remaining');
    closeAllAtOnce('10');
    chooseOutcome('Win');
    submit('Close trade');
    const row = document.getElementById('close-finalExitedAt')!;
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.getByText('The exit time cannot be before the entry time.')).toBeVisible();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("focuses the closing exit's field a blocked Close is about", async () => {
    renderForm('all_remaining');
    closeAllAtOnce('abc');
    submit('Close trade');
    await waitFor(() => expect(screen.getByLabelText('P&L for the close')).toHaveFocus());
    expect(recordContractExitActionMock).not.toHaveBeenCalled();
  });
});

describe('the Close Trade draft', () => {
  it('survives a reload, per task, without keeping any view state', async () => {
    const first = renderForm('all_remaining', trade([EARLIER_EXIT]), DRAFT_SCOPE);
    stateTotal('-30', { askMode: false });
    fireEvent.click(screen.getByRole('radio', { name: 'Loss' }));
    await waitFor(() => expect(storedDraft()?.tasks.all_remaining).toBeDefined());
    first.unmount();

    // A reload: a fresh mount reads the answers back — how it was recorded included.
    renderForm('all_remaining', trade([EARLIER_EXIT]), DRAFT_SCOPE);
    await waitFor(() => expect(screen.getByLabelText('Final net P&L')).toHaveValue('-30'));
    expect(screen.getByRole('radio', { name: 'I only know the final result' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Loss' })).toBeChecked();
    expect(screen.getByText('Your unsaved answers for this close were restored.')).toBeVisible();
    cleanup();

    // The Part task on the same Trade is untouched by the Final Close's answers.
    renderForm('part', trade([EARLIER_EXIT]), DRAFT_SCOPE);
    await waitFor(() => expect(storedDraft()?.tasks.all_remaining).toBeDefined());
    expect(screen.getByLabelText('P&L for this exit')).toHaveValue('');
  });

  it('clears the task once the save succeeds', async () => {
    renderForm('part', trade(), DRAFT_SCOPE);
    type('P&L for this exit', '50');
    await waitFor(() => expect(storedDraft()?.tasks.part).toBeDefined());
    submit('Record partial exit');
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(storedDraft()).toBeNull();
  });

  it('clears the task on an explicit, confirmed discard', async () => {
    renderForm('part', trade(), DRAFT_SCOPE);
    type('P&L for this exit', '50');
    await waitFor(() => expect(storedDraft()?.tasks.part).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Discard answers' }));
    expect(screen.getByText('Discard your answers for this close?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('P&L for this exit')).toHaveValue('');
    await waitFor(() => expect(storedDraft()).toBeNull());
  });

  it('holds answers given against a Trade that has since changed until they are confirmed', async () => {
    const before = renderForm('all_remaining', trade(), DRAFT_SCOPE);
    stateTotal('25');
    await waitFor(() => expect(storedDraft()?.tasks.all_remaining).toBeDefined());
    before.unmount();

    // Meanwhile an exit was recorded elsewhere.
    renderForm('all_remaining', trade([EARLIER_EXIT]), DRAFT_SCOPE);
    await waitFor(() => expect(screen.getByLabelText('Final net P&L')).toHaveValue('25'));
    expect(screen.getByText(/This trade changed after you started/)).toBeVisible();
    submit('Close trade');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Keep my answers' })).toHaveFocus(),
    );
    expect(recordContractExitActionMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep my answers' }));
    chooseOutcome('BE');
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toMatchObject({ scope: 'all_remaining', finalPnlMinor: '2500' });
  });

  it('re-sends a failed save after a reload under the same Save key', async () => {
    recordContractExitActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    const first = renderForm('part', trade(), DRAFT_SCOPE);
    type('P&L for this exit', '50');
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
    const firstKey = lastPayload().mutationKey;
    first.unmount();

    renderForm('part', trade(), DRAFT_SCOPE);
    await waitFor(() => expect(screen.getByLabelText('P&L for this exit')).toHaveValue('50'));
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(2));
    expect(lastPayload().mutationKey).toBe(firstKey);
  });
});

describe('entry context, read-only', () => {
  it('opens the entry details from the close flow, with nothing to edit', () => {
    renderForm('all_remaining');
    fireEvent.click(screen.getByRole('button', { name: 'View entry details' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Entry details' }));
    expect(sheet.getByText('Golden Breakout')).toBeVisible();
    expect(sheet.getByText('No setup')).toBeVisible();
    expect(sheet.getByText('Clean retest of the high.')).toBeVisible();
    expect(sheet.getByText('75%')).toBeVisible();
    // Unanswered reads as not answered, never as a negative.
    expect(document.querySelector('[data-entry-detail="emotions"] dd')).toHaveTextContent(
      'Not answered',
    );
    expect(sheet.queryAllByRole('textbox')).toHaveLength(0);
    expect(sheet.queryAllByRole('radio')).toHaveLength(0);
    fireEvent.click(sheet.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('after the close', () => {
  it('a Final Close continues into Stage 6; a Part exit never does', async () => {
    const closed = renderForm('all_remaining');
    closeAllAtOnce('10');
    chooseOutcome('Win');
    submit('Close trade');
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        `/app/trades/after-trade?trade=${TRADE_ID}&from=close`,
        { scroll: false },
      ),
    );
    closed.unmount();
    pushMock.mockReset();

    renderForm('part');
    submit('Record partial exit');
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith(`/app/trades?trade=${TRADE_ID}&tab=execution`, {
      scroll: false,
    });
    expect(String(pushMock.mock.calls[0]?.[0])).not.toContain('after-trade');
  });
});

/*
  ONLY A COMPLETE RECORD CLOSES (contract decision 59). Final Close is the one
  operation Required items gate: every applicable Required item of Steps 1–5 —
  Risk, Target, the Exit Plan with No Fixed Target, the outcome and the result.
  Missing plan answers are asked here, only for what the Trade lacks, and are
  sent with the close. Recommended and Optional never block; a Part never does.
*/
describe('Final Close — Required for completion (decision 59)', () => {
  const UNPLANNED = {
    plannedRiskMinor: null,
    plannedRiskState: null,
    targetState: null,
    plannedRewardMinor: null,
    exitPlanState: null,
  } as const;

  it('asks the Required plan answers the Trade lacks, and blocks Close until they are given', async () => {
    renderForm('all_remaining', trade([], UNPLANNED));
    const section = document.querySelector<HTMLElement>('[data-close-plan]')!;
    expect(section).not.toBeNull();
    expect(within(section).getByRole('group', { name: 'Risk' })).toBeInTheDocument();
    expect(within(section).getByRole('group', { name: 'Target' })).toBeInTheDocument();
    // Complete the plan comes first, then Step 5.
    expect(
      section.compareDocumentPosition(document.querySelector('[data-close-step="result"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    closeAllAtOnce('80');
    chooseOutcome('Win');
    // Risk and Target still missing: never an error colour, and Close refuses.
    expect(document.querySelector('[data-close-completion]')).toHaveTextContent(
      '2 required items left before you can close this trade.',
    );
    submit('Close trade');
    expect(await screen.findByText(/required items left before you can close/)).toBeVisible();
    expect(recordContractExitActionMock).not.toHaveBeenCalled();

    fireEvent.click(within(section).getByRole('radio', { name: 'Defined risk' }));
    fireEvent.change(within(section).getByLabelText(/^Risk at entry/), {
      target: { value: '50' },
    });
    fireEvent.click(within(section).getByRole('radio', { name: 'Fixed target' }));
    fireEvent.change(within(section).getByLabelText('Target profit'), {
      target: { value: '100' },
    });
    expect(document.querySelector('[data-close-completion]')).toHaveTextContent('Ready to close.');
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
    expect(lastPayload()).toMatchObject({
      scope: 'all_remaining',
      finalPnlMinor: '8000',
      traderOutcome: 'win',
      plan: {
        plannedRiskState: 'defined',
        plannedRiskMinor: '5000',
        targetState: 'fixed',
        plannedRewardMinor: '10000',
      },
    });
    expect(RecordContractExitSchema.safeParse(lastPayload()).success).toBe(true);
  });

  it('accepts explicit negatives, and makes the Exit Plan Required only with No Fixed Target', () => {
    renderForm('all_remaining', trade([], UNPLANNED));
    const section = document.querySelector<HTMLElement>('[data-close-plan]')!;
    fireEvent.click(within(section).getByRole('radio', { name: 'No defined risk' }));
    expect(document.getElementById('close-plan-exitPlan')).toBeNull();
    fireEvent.click(within(section).getByRole('radio', { name: 'No fixed target' }));
    // The Exit Plan appears, Required, and the answers already given stay.
    const exitPlan = document.getElementById('close-plan-exitPlan')!;
    expect(exitPlan.querySelector('[data-requirement]')).toHaveAttribute(
      'data-requirement',
      'required',
    );
    expect(within(section).getByRole('radio', { name: 'No defined risk' })).toBeChecked();
    closeAllAtOnce('80');
    chooseOutcome('Win');
    expect(document.querySelector('[data-close-completion]')).toHaveTextContent(
      '1 required item left before you can close this trade.',
    );
  });

  it('never asks what the Trade already answers, and gates only on the outcome and result then', async () => {
    renderForm('all_remaining');
    expect(document.querySelector('[data-close-plan]')).toBeNull();
    // Outcome and Trade result are Required here, and say so.
    for (const selector of ['[data-result-outcome]', '[data-result-panel]']) {
      expect(document.querySelector(`${selector} [data-requirement="required"]`)).not.toBeNull();
    }
    expect(document.querySelector('[data-close-completion]')).toHaveTextContent(
      '2 required items left before you can close this trade.',
    );
    // A blocked close lands on the first missing answer: the outcome.
    submit('Close trade');
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Win' })).toHaveFocus());
    closeAllAtOnce('80');
    chooseOutcome('Loss');
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
    expect(lastPayload()).not.toHaveProperty('plan');
  });

  it('never gates a Part exit', async () => {
    renderForm('part', trade([], UNPLANNED));
    expect(document.querySelector('[data-close-plan]')).toBeNull();
    expect(document.querySelector('[data-close-completion]')).toBeNull();
    type('P&L for this exit', '20');
    submit('Record partial exit');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalledTimes(1));
  });
});
