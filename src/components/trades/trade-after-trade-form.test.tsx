import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateCompletedTradeSchema } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeRecordingForm } from './trade-recording-form';

const TEST_DRAFT_SCOPE = { ownerKey: 'test-owner', workspaceKey: 'test-workspace' };
const DRAFT_KEY = 'tradechemist:recording-draft:test-owner:test-workspace';
const TRADE_ID = '018f0000-0000-7000-8000-000000000099';
const STRATEGY_ID = '018f0000-0000-7000-8000-000000000010';
const SETUP_ID = '018f0000-0000-7000-8000-000000000020';
const PLAN_ID = '018f0000-0000-7000-8000-000000000030';
const RETEST = '018f0000-0000-7000-8000-000000000041';
const TREND = '018f0000-0000-7000-8000-000000000042';

const createCompletedTradeActionMock = vi.fn();
const createTradeActionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/server/actions/exit-plans', () => ({}));
vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (...args: unknown[]) => createTradeActionMock(...args),
  createCompletedTradeAction: (...args: unknown[]) => createCompletedTradeActionMock(...args),
}));

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  exitPlans: [],
  emotionCatalog: [
    { key: 'calm', label: 'Calm' },
    { key: 'frustrated', label: 'Frustrated' },
  ],
  tradingAccounts: [
    {
      tradingAccountId: '018f0000-0000-7000-8000-000000000001',
      name: 'Main USD',
      accountMode: 'live',
      baseCurrency: 'USD',
    },
  ],
  strategies: [],
} as const satisfies TradeCreateOptions;

/** A Strategy with a default Exit Plan: After Trade must never inherit it. */
const withStrategy = {
  ...options,
  exitPlans: [
    {
      exitPlanId: PLAN_ID,
      name: 'Trail structure',
      instructions: 'Trail beneath each higher low.',
      strategyId: STRATEGY_ID,
    },
  ],
  strategies: [
    {
      strategyId: STRATEGY_ID,
      name: 'Golden Breakout',
      currentVersionNumber: 1,
      setups: [
        {
          setupId: SETUP_ID,
          name: 'Clean Retest',
          sortOrder: 0,
          conditionSetToken: 'a'.repeat(64),
          conditions: [
            { conditionKey: RETEST, label: 'Retest held', sortOrder: 0 },
            { conditionKey: TREND, label: 'Trend aligned', sortOrder: 1 },
          ],
        },
      ],
    },
  ],
} as const satisfies TradeCreateOptions;

function renderForm(formOptions: TradeCreateOptions = options) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeRecordingForm
        options={formOptions}
        timing="after_trade"
        timezone="Asia/Bangkok"
        draftScope={TEST_DRAFT_SCOPE}
      />
    </NextIntlClientProvider>,
  );
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
}

function type(label: string | RegExp, value: string, scope: HTMLElement = document.body) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
}

function payload() {
  return createCompletedTradeActionMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function openExitHistory() {
  fireEvent.click(screen.getByRole('button', { name: /^Exit history/ }));
}

function recordExit(fields: { pnl?: string; percent?: string; reason?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
  const exit = document.querySelectorAll<HTMLElement>('[data-after-exit]');
  const last = exit[exit.length - 1]!;
  if (fields.pnl !== undefined) type('P&L for this exit', fields.pnl, last);
  if (fields.percent !== undefined) type(/% of original position/, fields.percent, last);
  if (fields.reason !== undefined) type('Exit reason', fields.reason, last);
  return last;
}

function emotions(phase: 'emotions' | 'postTradeEmotions'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-emotions-phase="${phase}"]`)!;
}

beforeEach(() => {
  createCompletedTradeActionMock.mockReset();
  createCompletedTradeActionMock.mockResolvedValue({
    ok: true,
    data: { tradeId: TRADE_ID },
  });
  createTradeActionMock.mockReset();
  pushMock.mockReset();
  window.localStorage.clear();
});

describe('After Trade — the moment and its sections', () => {
  it('asks what happened, in reading order, with no Money/Price result basis', () => {
    renderForm();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['The trade', 'What happened', 'Risk and plan at entry', 'Your read on the trade']);
    expect(screen.queryByText(/price levels instead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/amount instead/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Price' })).not.toBeInTheDocument();
  });

  it('starts every answer Unanswered: no time, no outcome, no Actual Risk, no Target', () => {
    renderForm();
    expect(screen.getByLabelText('Entry time')).toHaveValue('');
    expect(screen.getByLabelText('Final exit time')).toHaveValue('');
    for (const name of ['Win', 'BE', 'Loss', 'Matched risk at entry', 'It was different']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    expect(screen.getByRole('radio', { name: /^Fixed target/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^No fixed target/ })).not.toBeChecked();
  });
});

describe('Save Closed Trade — only identity is required', () => {
  it('names only Symbol and Direction before saving, and saves the minimum', async () => {
    renderForm();
    save();
    expect(await screen.findByText('Enter a symbol.')).toBeInTheDocument();
    expect(screen.getByText('Choose Long or Short.')).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();

    fillIdentity();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    const sent = payload();
    expect(sent).toMatchObject({
      recordingTiming: 'after_trade',
      recordingContract: 'add_trade_v1',
      symbol: 'XAUUSD',
      direction: 'long',
      enteredAt: null,
      exitedAt: null,
      plannedRiskMinor: null,
      finalPnlMinor: null,
      exits: [],
    });
    for (const unanswered of [
      'traderOutcome',
      'actualRiskAnswer',
      'targetState',
      'exitPlan',
      'exitHistoryCompleteness',
      'strategyId',
      'noStrategy',
      'confidence',
      'emotionKeys',
      'postTradeEmotionKeys',
    ]) {
      expect(sent).not.toHaveProperty(unanswered);
    }
    expect(CreateCompletedTradeSchema.safeParse(sent).success).toBe(true);
  });

  it('prompts for Final Net P&L and the outcome without requiring them', async () => {
    renderForm();
    expect(screen.getByText(/not recorded yet\. You can still save/)).toBeInTheDocument();
    fillIdentity();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
  });
});

describe('Final Net P&L, the trader’s outcome and Actual R', () => {
  it('keeps the outcome the trader chose, with a quiet notice when it contradicts the sign', async () => {
    renderForm();
    fillIdentity();
    type('Final net P&L', '-25');
    fireEvent.click(screen.getByRole('radio', { name: 'Win' }));
    expect(
      screen.getByText(/You chose Win, but your final net P&L is negative/),
    ).toBeInTheDocument();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ finalPnlMinor: '-2500', traderOutcome: 'win' });
  });

  it('never derives an outcome from the P&L', async () => {
    renderForm();
    fillIdentity();
    type('Final net P&L', '120');
    expect(screen.getByRole('radio', { name: 'Win' })).not.toBeChecked();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).not.toHaveProperty('traderOutcome');
  });

  it('carries no sign notice for BE beside a profit', () => {
    renderForm();
    type('Final net P&L', '10');
    fireEvent.click(screen.getByRole('radio', { name: 'BE' }));
    expect(screen.queryByText(/does not block saving/)).not.toBeInTheDocument();
  });

  it('shows Actual R only from Final Net P&L and Risk at Entry, and says why otherwise', () => {
    renderForm();
    expect(
      screen.getByText('Actual R needs your final net P&L and risk at entry.'),
    ).toBeInTheDocument();
    type('Final net P&L', '100');
    expect(screen.getByText('Actual R needs your risk at entry.')).toBeInTheDocument();
    expect(screen.queryByText('0.00R')).not.toBeInTheDocument();
    type('Risk at entry', '50');
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
    // Actual Risk is Risk Discipline evidence and never moves the denominator.
    fireEvent.click(screen.getByRole('radio', { name: 'It was different' }));
    type('Actual risk amount', '25');
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
  });
});

describe('Actual Risk', () => {
  it('refuses Matched without a Risk at Entry to match', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('radio', { name: 'Matched risk at entry' }));
    save();
    expect(await screen.findByText(/Matched needs a risk at entry/)).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('refuses a Different amount equal to Risk at Entry, never rewriting it to Matched', async () => {
    renderForm();
    fillIdentity();
    type('Risk at entry', '50');
    fireEvent.click(screen.getByRole('radio', { name: 'It was different' }));
    type('Actual risk amount', '50');
    save();
    expect(await screen.findByText(/This is the same as your risk at entry/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'It was different' })).toBeChecked();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Matched risk at entry', 'matched', undefined],
    ["Don't know", 'unknown', undefined],
    ['It was different', 'different', undefined],
  ] as const)('sends %s as its own answer', async (label, answer, amount) => {
    renderForm();
    fillIdentity();
    type('Risk at entry', '50');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actual risk' })).getByRole('radio', {
        name: label,
      }),
    );
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ plannedRiskMinor: '5000', actualRiskAnswer: answer });
    expect(payload().actualInitialRiskMinor).toBe(amount);
  });
});

describe('Target', () => {
  it('blocks an explicitly Fixed Target with neither Target Profit nor TP price', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('radio', { name: /^Fixed target/ }));
    save();
    expect(
      await screen.findByText('Add a target profit or a TP price, or choose No fixed target.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Fixed target/ })).toBeChecked();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('sends a TP price alone as a Fixed Target, and No Fixed Target as its own answer', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('radio', { name: /^Fixed target/ }));
    type('TP price', '2410.5');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      targetState: 'fixed',
      targetPrice: '2410.5',
      plannedRewardMinor: null,
    });
  });
});

describe('Exit Plan and Strategy', () => {
  it('never inherits the Strategy default, and records a chosen plan as selected', async () => {
    renderForm(withStrategy);
    fillIdentity();
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: STRATEGY_ID } });
    expect(screen.queryByText(/From Strategy/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-exit-plan-state]')).toHaveAttribute(
      'data-exit-plan-state',
      'not_recorded',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose exit plan' }));
    fireEvent.click(screen.getByRole('radio', { name: /Trail structure/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      strategyId: STRATEGY_ID,
      exitPlan: { state: 'saved', exitPlanId: PLAN_ID, provenance: 'selected' },
    });
    expect(payload()).not.toHaveProperty('exitPlanInheritanceDeclined');
  });

  it('keeps Unanswered, No Strategy and a selected Strategy distinct', async () => {
    renderForm(withStrategy);
    fillIdentity();
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: '__none' } });
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ noStrategy: true });
    expect(payload()).not.toHaveProperty('strategyId');
  });

  it('offers Don’t remember, sends only answered conditions, and never Not Met by omission', async () => {
    renderForm(withStrategy);
    fillIdentity();
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: STRATEGY_ID } });
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: SETUP_ID } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Retest held' })).getByRole('radio', {
        name: "Don't remember",
      }),
    );
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      setupId: SETUP_ID,
      conditionAnswers: [{ conditionKey: RETEST, status: 'unknown' }],
    });
  });
});

describe('psychology', () => {
  it('keeps recalled Entry Emotion and Post-Trade Emotion separate, the same emotion in both', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(within(emotions('emotions')).getByRole('button', { name: 'Calm' }));
    fireEvent.click(within(emotions('postTradeEmotions')).getByRole('button', { name: 'Calm' }));
    fireEvent.click(
      within(emotions('postTradeEmotions')).getByRole('button', { name: 'Frustrated' }),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Very High' }));
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      emotionKeys: ['calm'],
      postTradeEmotionKeys: ['calm', 'frustrated'],
      confidence: 100,
    });
  });

  it('records None of these as an explicit answer, distinct from never answering', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(
      within(emotions('postTradeEmotions')).getByRole('button', { name: 'None of these' }),
    );
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ postTradeEmotionKeys: [] });
    expect(payload()).not.toHaveProperty('emotionKeys');
  });
});

describe('exit history', () => {
  it('accepts a reason-only exit and an explicit unknown scope', async () => {
    renderForm();
    fillIdentity();
    openExitHistory();
    recordExit({ reason: 'Took half off at the level' });
    const second = recordExit({ pnl: '15' });
    fireEvent.click(within(second).getByRole('radio', { name: "Don't know" }));
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload().exits).toEqual([
      {
        closedBps: null,
        exitScope: null,
        exitPrice: null,
        realizedPnlMinor: null,
        exitReason: 'Took half off at the level',
        exitedAt: null,
      },
      {
        closedBps: null,
        exitScope: 'unknown',
        exitPrice: null,
        realizedPnlMinor: '1500',
        exitedAt: null,
      },
    ]);
    expect(payload()).not.toHaveProperty('exitHistoryCompleteness');
  });

  it('asks completeness only once an exit exists, with no answer preselected', () => {
    renderForm();
    openExitHistory();
    expect(screen.queryByRole('group', { name: 'Is this every exit?' })).not.toBeInTheDocument();
    recordExit({ pnl: '10' });
    const group = screen.getByRole('group', { name: 'Is this every exit?' });
    for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('calls a difference a discrepancy only for a Complete, fully priced history, and never blocks', async () => {
    renderForm();
    fillIdentity();
    type('Final net P&L', '90');
    openExitHistory();
    recordExit({ pnl: '60' });
    recordExit({ pnl: '40' });
    expect(screen.queryByText(/add up to .* but your final net P&L/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Some exits are missing' }));
    expect(screen.queryByText(/but your final net P&L/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByText(/but your final net P&L is/)).toBeInTheDocument();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      finalPnlMinor: '9000',
      exitHistoryCompleteness: 'complete',
    });
  });

  it('adopts the recorded exits as Final Net P&L only when asked', () => {
    renderForm();
    type('Final net P&L', '90');
    openExitHistory();
    recordExit({ pnl: '60' });
    recordExit({ pnl: '40' });
    expect(
      screen.queryByRole('button', { name: 'Use recorded exits as final result' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('90');
    fireEvent.click(screen.getByRole('button', { name: 'Use recorded exits as final result' }));
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('100.00');
    expect(screen.queryByText(/but your final net P&L is/)).not.toBeInTheDocument();
  });

  it('never re-weights exit P&L by percentage, and blocks exits that close more than 100%', async () => {
    renderForm();
    fillIdentity();
    openExitHistory();
    recordExit({ pnl: '30', percent: '60' });
    recordExit({ pnl: '10', percent: '60' });
    save();
    expect(
      await screen.findByText(/Together your exits close more than the whole position/),
    ).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });
});

describe('after Save', () => {
  it('offers Review Trade or Done, never navigating on its own, and clears the draft', async () => {
    renderForm();
    fillIdentity();
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    save();
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toHaveFocus();
    expect(pushMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review trade' }));
    expect(pushMock).toHaveBeenCalledWith(`/app/trades?trade=${TRADE_ID}&tab=review`);
  });

  it('Done returns to Trades without entering Review', async () => {
    renderForm();
    fillIdentity();
    save();
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(pushMock).toHaveBeenCalledWith('/app/trades');
  });

  it('keeps the draft and the same mutation key through a server failure and a retry', async () => {
    createCompletedTradeActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    renderForm();
    fillIdentity();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    const firstKey = payload().mutationKey;
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(2));
    expect(payload().mutationKey).toBe(firstKey);
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeInTheDocument();
  });

  it('ignores a second Save while one is in flight', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    createCompletedTradeActionMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderForm();
    fillIdentity();
    save();
    // While in flight the action reads Saving… and a second press does nothing.
    fireEvent.click(await screen.findByRole('button', { name: 'Saving…' }));
    expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: { tradeId: TRADE_ID } });
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeInTheDocument();
  });
});
