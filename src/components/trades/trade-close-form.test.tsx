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
    targetState: null,
    plannedRewardMinor: null,
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

function lastPayload() {
  const calls = recordContractExitActionMock.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

function timeValue(id: string): string {
  return document.querySelector(`[data-exit-time="${id}"]`)?.getAttribute('data-value') ?? '';
}

function openHistory() {
  fireEvent.click(document.getElementById('close-history-toggle')!);
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

describe('All Remaining — "Close trade"', () => {
  it('reads as the result, in order: final time, Final Net P&L, Actual R, outcome, then history', () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    const order = [
      document.getElementById('close-finalExitedAt'),
      screen.getByLabelText('Final net P&L'),
      document.querySelector('[data-actual-r]'),
      screen.getByRole('radio', { name: 'Win' }),
      document.getElementById('close-history-toggle'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // No scope question: the action already chose All Remaining.
    expect(screen.queryByRole('radio', { name: 'Part' })).toBeNull();
    // Post-Trade Emotion is Stage 6, not here.
    expect(screen.queryByText(/after the trade/i)).toBeNull();
  });

  it('starts the final exit time unanswered; each shortcut writes only when pressed', () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    expect(timeValue('close-finalExitedAt')).toBe('');
    expect(document.getElementById('close-finalExitedAt')).toHaveTextContent('Not recorded');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use the last recorded exit time for Final exit date & time',
      }),
    );
    expect(timeValue('close-finalExitedAt')).not.toBe('');
    const last = timeValue('close-finalExitedAt');
    // "Use now" is offered again from the sheet, never applied on its own.
    fireEvent.click(document.getElementById('close-finalExitedAt')!);
    const sheet = within(screen.getByRole('dialog'));
    expect(timeValue('close-finalExitedAt')).toBe(last);
    fireEvent.click(sheet.getByRole('button', { name: 'Use now for Final exit date & time' }));
    expect(timeValue('close-finalExitedAt')).not.toBe(last);
    fireEvent.click(sheet.getByRole('button', { name: 'Clear Final exit date & time' }));
    expect(timeValue('close-finalExitedAt')).toBe('');
  });

  it('offers "Use last recorded exit time" only when an earlier exit states a time', () => {
    renderForm('all_remaining');
    expect(
      screen.getByRole('button', { name: 'Use now for Final exit date & time' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: 'Use the last recorded exit time for Final exit date & time',
      }),
    ).toBeNull();
  });

  it('derives Actual R from Final Net P&L ÷ Risk at Entry, and never shows a fabricated 0R', () => {
    renderForm('all_remaining');
    const readout = () => document.querySelector('[data-actual-r]')!;
    expect(readout()).toHaveAttribute('data-actual-r', 'unavailable');
    expect(readout()).toHaveTextContent('Actual R needs your final net P&L.');
    expect(readout()).not.toHaveTextContent('0.00R');
    type('Final net P&L', '150');
    expect(readout()).toHaveAttribute('data-actual-r', 'known');
    expect(readout()).toHaveTextContent('+1.50R');
    // A readout, never a field.
    expect(within(readout() as HTMLElement).queryByRole('textbox')).toBeNull();
  });

  it('keeps the outcome explicit and independent of the P&L sign', async () => {
    renderForm('all_remaining');
    for (const name of ['Win', 'BE', 'Loss']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    type('Final net P&L', '-20');
    expect(screen.getByRole('radio', { name: 'Loss' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Win' }));
    expect(screen.getByText(/You chose Win, but your final net P&L is negative/)).toBeVisible();
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({
      scope: 'all_remaining',
      finalPnlMinor: '-2000',
      traderOutcome: 'win',
      finalExitedAt: null,
    });
  });

  it('adopts the recorded exits only on request, and says where the figure came from', async () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    type('Final net P&L', '75');
    expect(screen.getByText('Entered by you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use recorded exits' })).toBeNull();
    openHistory();
    // Each earlier leg is kept as recorded.
    expect(document.querySelector('[data-recorded-exit="1"]')).toHaveTextContent('40.00');
    type('P&L for this exit', '40');
    // Not yet a Complete history: the subtotal is evidence, with a note saying why.
    expect(screen.queryByRole('button', { name: 'Use recorded exits' })).toBeNull();
    expect(screen.getByText(/Answer that these are all the exits/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('75');
    fireEvent.click(screen.getByRole('button', { name: 'Use recorded exits' }));
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('80.00');
    expect(
      screen.getByText('From your recorded exits. Type a figure to replace it.'),
    ).toBeInTheDocument();
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({
      finalPnlMinor: '8000',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
      realizedPnlMinor: '4000',
    });
  });

  it('shows a Complete-history discrepancy quietly and still closes with the stated figure', async () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    type('Final net P&L', '75');
    openHistory();
    type('P&L for this exit', '40');
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByText(/but your final net P&L is/)).toBeInTheDocument();
    submit('Close trade');
    await waitFor(() => expect(recordContractExitActionMock).toHaveBeenCalled());
    expect(lastPayload()).toMatchObject({ finalPnlMinor: '7500' });
    expect(lastPayload()).not.toHaveProperty('finalPnlAdoptedFromExits');
  });

  it('blocks Close at the final exit time when it falls before a recorded exit', async () => {
    renderForm('all_remaining', trade([EARLIER_EXIT]));
    // The closing leg happened now; the final time is set to the earlier leg's time.
    openHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Use now for Exit date & time' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use the last recorded exit time for Final exit date & time',
      }),
    );
    submit('Close trade');
    const row = document.getElementById('close-finalExitedAt')!;
    await waitFor(() => expect(row).toHaveFocus());
    expect(
      screen.getByText('The final exit time cannot be before an exit you already recorded.'),
    ).toBeVisible();
    expect(recordContractExitActionMock).not.toHaveBeenCalled();
  });

  it('opens the exit history and focuses the leg field a blocked Close is about', async () => {
    renderForm('all_remaining');
    openHistory();
    type('P&L for this exit', 'abc');
    openHistory(); // fold it away again
    submit('Close trade');
    await waitFor(() => expect(screen.getByLabelText('P&L for this exit')).toHaveFocus());
    expect(recordContractExitActionMock).not.toHaveBeenCalled();
  });
});

describe('the Close Trade draft', () => {
  it('survives a reload, per task, without keeping any view state', async () => {
    const first = renderForm('all_remaining', trade([EARLIER_EXIT]), DRAFT_SCOPE);
    type('Final net P&L', '-30');
    fireEvent.click(screen.getByRole('radio', { name: 'Loss' }));
    openHistory();
    type('P&L for this exit', '10');
    await waitFor(() => expect(storedDraft()?.tasks.all_remaining).toBeDefined());
    first.unmount();

    // A reload: a fresh mount reads the answers back.
    renderForm('all_remaining', trade([EARLIER_EXIT]), DRAFT_SCOPE);
    await waitFor(() => expect(screen.getByLabelText('Final net P&L')).toHaveValue('-30'));
    expect(screen.getByRole('radio', { name: 'Loss' })).toBeChecked();
    expect(screen.getByText('Your unsaved answers for this close were restored.')).toBeVisible();
    // The fold it was left open in is view state: it starts folded again.
    expect(document.getElementById('close-history-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
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
    type('Final net P&L', '25');
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
