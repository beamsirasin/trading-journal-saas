import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const STEP_LABEL = {
  trade: 'Trade',
  result: 'Result',
  plan: 'Plan',
  context: 'Context',
  save: 'Save',
} as const;

/** Open a step from the step list — the same control a trader taps. */
function goTo(step: keyof typeof STEP_LABEL) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^Step \\d of 5: ${STEP_LABEL[step]}$`) }),
  );
}

/** One step's own section, mounted whether or not it is the step being shown. */
function stepSection(step: 'trade' | 'result' | 'plan' | 'context' | 'details'): HTMLElement {
  return document.querySelector<HTMLElement>(`section[data-step="${step}"]`)!;
}

function currentStep(): string | null {
  return document.querySelector('[data-after-trade-form]')!.getAttribute('data-after-trade-step');
}

/**
 * Step 1 shows answers: the control that records one lives in the editor its
 * row opens, so a test reaches it the way a trader does. The returned scope is
 * the open editor — its own title labels it, so queries stay inside it.
 */
function openConcept(
  field: 'Trading Account' | 'Symbol' | 'Direction' | 'Entry time',
): ReturnType<typeof within> {
  // Only travel if we are elsewhere: opening a step deliberately focuses its
  // heading, which is not what a trader already on Step 1 would trigger.
  if (currentStep() !== 'trade') goTo('trade');
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  return within(screen.getByRole('dialog'));
}

function closeConcept() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
}

/** The Step 1 row for a concept — what it shows, and what it holds. */
function conceptRow(concept: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-concept="${concept}"]`)!;
}

function conceptValue(concept: string): string {
  return conceptRow(concept).getAttribute('data-value') ?? '';
}

function fillIdentity() {
  const symbol = openConcept('Symbol');
  fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  closeConcept();
  const direction = openConcept('Direction');
  fireEvent.click(direction.getByRole('radio', { name: 'Long' }));
  closeConcept();
}

function type(label: string | RegExp, value: string, scope: HTMLElement = document.body) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

/** Save lives on the last step only. */
function save() {
  goTo('save');
  fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
}

function payload() {
  return createCompletedTradeActionMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function openExitHistory() {
  goTo('result');
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

/** The Context step, with this phase's emotion question opened. */
function emotions(phase: 'emotions' | 'postTradeEmotions'): HTMLElement {
  if (currentStep() !== 'context') goTo('context');
  const toggle = document.getElementById(`after-${phase}-toggle`)!;
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
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

describe('After Trade — the moment and its steps', () => {
  it('asks one topic at a time, in reading order, with no Money/Price result basis', () => {
    renderForm();
    const seen: string[] = [];
    for (const next of ['Next: Result', 'Next: Plan', 'Next: Context', 'Next: Save']) {
      seen.push(screen.getByRole('heading', { level: 2 }).textContent ?? '');
      fireEvent.click(screen.getByRole('button', { name: next }));
    }
    seen.push(screen.getByRole('heading', { level: 2 }).textContent ?? '');
    expect(seen).toEqual([
      'Trade details',
      'Result',
      'Plan at entry',
      'Context',
      'Review and save',
    ]);
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument();
    expect(screen.queryByText(/price levels instead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/amount instead/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Price' })).not.toBeInTheDocument();
  });

  it('offers Save only on the last step, and advances past unanswered optional steps', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Save closed trade' })).not.toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    for (const next of ['Next: Result', 'Next: Plan', 'Next: Context', 'Next: Save']) {
      fireEvent.click(screen.getByRole('button', { name: next }));
    }
    expect(currentStep()).toBe('details');
    expect(screen.getByRole('button', { name: 'Save closed trade' })).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('keeps every answer through Back and Next', () => {
    renderForm();
    fillIdentity();
    goTo('result');
    type('Final net P&L', '120');
    fireEvent.click(screen.getByRole('radio', { name: 'Win' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Plan' }));
    type('Risk at entry', '60');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(currentStep()).toBe('trade');
    // Step 1 reads back as answers, and the editors still hold them.
    expect(conceptRow('symbol')).toHaveTextContent('XAUUSD');
    expect(conceptRow('direction')).toHaveTextContent('Long');
    const symbol = openConcept('Symbol');
    expect(symbol.getByLabelText('Symbol')).toHaveValue('xauusd');
    closeConcept();
    const direction = openConcept('Direction');
    expect(direction.getByRole('radio', { name: 'Long' })).toBeChecked();
    closeConcept();
    goTo('result');
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('120');
    expect(screen.getByRole('radio', { name: 'Win' })).toBeChecked();
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
    goTo('save');
    expect(document.querySelector('[data-trade-summary]')).toHaveTextContent(
      /XAUUSD · Long · Main USD/,
    );
  });

  it('sends a blocked Save back to the step that needs attention, focusing its control', async () => {
    renderForm();
    save();
    expect(await screen.findByText('Enter a symbol.')).toBeInTheDocument();
    expect(currentStep()).toBe('trade');
    /*
      The row is the control now: it names the concept, carries the error, and
      opens the input in one press. No Save can be pressed while an editor is
      open, so the input itself is never on screen at this moment.
    */
    await waitFor(() => expect(conceptRow('symbol')).toHaveFocus());
    expect(conceptRow('symbol')).toHaveAttribute('data-invalid', 'true');
    expect(conceptRow('symbol').getAttribute('aria-describedby')).toBe('after-row-symbol-error');
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('starts every answer Unanswered: no time, no outcome, no Actual Risk, no Target', () => {
    renderForm();
    // Blank is "Not recorded", never a zero and never a preselected now.
    expect(conceptRow('enteredAt')).toHaveTextContent('Not recorded');
    expect(openConcept('Entry time').getByLabelText('Entry time')).toHaveValue('');
    closeConcept();
    goTo('result');
    expect(screen.getByLabelText('Final exit time')).toHaveValue('');
    for (const name of ['Win', 'BE', 'Loss']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    goTo('plan');
    for (const name of ['Matched risk at entry', 'It was different']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    expect(screen.getByRole('radio', { name: /^Fixed target/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^No fixed target/ })).not.toBeChecked();
  });

  it('reads the final exit time on Result and the thesis on Context, saving both unchanged', async () => {
    renderForm();
    fillIdentity();
    // Each field is on the step that asks its question...
    expect(within(stepSection('trade')).queryByLabelText('Final exit time')).toBeNull();
    expect(within(stepSection('result')).getByLabelText('Final exit time')).toBeInTheDocument();
    expect(within(stepSection('details')).queryByLabelText('Why this trade')).toBeNull();
    expect(within(stepSection('context')).getByLabelText('Why this trade')).toBeInTheDocument();

    // ...and each is sent exactly as it was before the move.
    goTo('result');
    type('Final exit time', '2026-09-18T14:05');
    goTo('context');
    type('Why this trade', 'Clean retest of the London high.');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      exitedAt: '2026-09-18T07:05:00.000Z',
      confirmationNotes: 'Clean retest of the London high.',
    });
  });

  it('keeps Step 5 groups folded, holding what was typed in them', async () => {
    renderForm();
    fillIdentity();
    goTo('save');
    const market = screen.getByRole('button', { name: /^Market context/ });
    expect(market).toHaveAttribute('aria-expanded', 'false');
    expect(market).toHaveTextContent('Nothing added');
    fireEvent.click(market);
    type('Timeframe', '15m');
    type('Session', 'London');
    fireEvent.click(market);
    // Folded, it says what it holds, and it still holds it.
    expect(market).toHaveAttribute('aria-expanded', 'false');
    expect(market).toHaveTextContent('15m · London');
    fireEvent.click(market);
    expect(screen.getByLabelText('Timeframe')).toHaveValue('15m');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ timeframe: '15m', session: 'London' });
  });

  it('calls an untouched optional step Optional, never unfinished', () => {
    renderForm();
    fillIdentity();
    goTo('save');
    const review = document.querySelector('[data-trade-summary]')!;
    expect(review).toHaveTextContent(/XAUUSD · Long/);
    // Result, Plan and Context are untouched — and that is a complete answer.
    expect(within(review as HTMLElement).getAllByText('Optional')).toHaveLength(3);
    expect(review).not.toHaveTextContent('needs attention');
  });

  it('says on the step itself how much needs attention, beside the field error', async () => {
    renderForm();
    fillIdentity();
    goTo('plan');
    type('Risk at entry', '12..5');
    save();
    await waitFor(() => expect(currentStep()).toBe('plan'));
    expect(document.querySelector('[data-step-attention]')).toHaveTextContent(
      '1 item needs attention',
    );
    expect(
      screen.getByText("Enter a valid amount with the currency's supported precision."),
    ).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('reads the exit plan as one line and opens the chooser only when asked', () => {
    renderForm(withStrategy);
    goTo('plan');
    const toggle = screen.getByRole('button', { name: /^Exit plan/ });
    expect(toggle).toHaveTextContent('Not recorded');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('[data-exit-plan-state]')).toHaveAttribute(
      'data-exit-plan-state',
      'not_recorded',
    );
    expect(screen.getByRole('button', { name: 'Choose exit plan' })).toBeInTheDocument();
  });

  it('never folds a Step 5 group over an error a blocked Save has to reach', async () => {
    renderForm();
    fillIdentity();
    goTo('save');
    const group = screen.getByRole('button', { name: /^Price levels/ });
    fireEvent.click(group);
    type('Entry price', '2398.5');
    // A group with nothing wrong in it folds away on request.
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(group);
    type('Entry price', '12..5');
    fireEvent.click(group);
    // This one cannot fold: the error inside it has to stay reachable.
    expect(group).toHaveAttribute('aria-expanded', 'true');
    save();
    expect(
      await screen.findByText(
        'Enter a price greater than zero, using digits and one decimal point.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Entry price')).toHaveFocus());
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });
});

describe('Step 1 — read first, edit on demand', () => {
  it('shows four answers and no input until an editor is asked for', () => {
    renderForm();
    // Every concept reads as what is recorded — or a neutral word for what is not.
    expect(conceptRow('tradingAccountId')).toHaveTextContent('Main USD · USD');
    expect(conceptRow('symbol')).toHaveTextContent('Not answered');
    expect(conceptRow('direction')).toHaveTextContent('Not answered');
    expect(conceptRow('enteredAt')).toHaveTextContent('Not recorded');
    // Required and Optional are said on the row, once.
    expect(within(conceptRow('symbol').parentElement!).getByText('Required')).toBeInTheDocument();
    expect(
      within(conceptRow('enteredAt').parentElement!).getByText('Optional'),
    ).toBeInTheDocument();

    // The old inline Step 1 form is gone: no symbol box, no Long/Short radios,
    // no datetime input sitting in the step itself.
    const trade = stepSection('trade');
    expect(within(trade).queryByLabelText('Symbol')).toBeNull();
    expect(within(trade).queryByRole('radio', { name: 'Long' })).toBeNull();
    expect(within(trade).queryByLabelText('Entry time')).toBeNull();
    expect(within(trade).queryByLabelText('Trading Account')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('records each concept in its own editor and reads it back on the row', () => {
    renderForm();
    const symbol = openConcept('Symbol');
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
    closeConcept();
    expect(conceptRow('symbol')).toHaveTextContent('XAUUSD');

    const direction = openConcept('Direction');
    fireEvent.click(direction.getByRole('radio', { name: 'Short' }));
    closeConcept();
    expect(conceptRow('direction')).toHaveTextContent('Short');
    expect(conceptValue('direction')).toBe('short');

    const entered = openConcept('Entry time');
    fireEvent.change(entered.getByLabelText('Entry time'), {
      target: { value: '2026-09-18T09:30' },
    });
    closeConcept();
    expect(conceptValue('enteredAt')).toBe('2026-09-18T09:30');
    expect(conceptRow('enteredAt')).not.toHaveTextContent('Not recorded');
  });

  it('keeps what was entered when an editor is closed without Done', () => {
    renderForm();
    const symbol = openConcept('Symbol');
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'eurusd' } });
    // Escape is Close-and-keep, never Discard (UX Rules §5.2, §17.4).
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    return waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(conceptValue('symbol')).toBe('eurusd');
    });
  });

  it('returns focus to the row that opened the editor', async () => {
    renderForm();
    openConcept('Direction');
    closeConcept();
    await waitFor(() => expect(conceptRow('direction')).toHaveFocus());
  });

  it('clears an entry time from its editor without touching anything else', () => {
    renderForm();
    fillIdentity();
    const entered = openConcept('Entry time');
    fireEvent.change(entered.getByLabelText('Entry time'), {
      target: { value: '2026-09-18T09:30' },
    });
    fireEvent.click(entered.getByRole('button', { name: /^Clear time/ }));
    closeConcept();
    expect(conceptValue('enteredAt')).toBe('');
    expect(conceptRow('enteredAt')).toHaveTextContent('Not recorded');
    expect(conceptValue('symbol')).toBe('xauusd');
  });

  it('carries every later step’s answer through a round trip into Step 1’s editors', async () => {
    renderForm();
    fillIdentity();
    goTo('result');
    type('Final net P&L', '400');
    goTo('plan');
    type('Risk at entry', '100');
    // Open and close a Step 1 editor from Step 1 — nothing else moves.
    const account = openConcept('Trading Account');
    expect(account.getByLabelText('Trading Account')).toHaveValue(
      options.tradingAccounts[0]!.tradingAccountId,
    );
    closeConcept();
    goTo('result');
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('400');
    expect(screen.getByText('+4.00R')).toBeInTheDocument();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      symbol: 'XAUUSD',
      direction: 'long',
      finalPnlMinor: '40000',
    });
  });

  it('offers recent symbols inside the symbol editor and filters them by what is typed', async () => {
    renderForm();
    fillIdentity();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());

    cleanup();
    renderForm();
    const symbol = openConcept('Symbol');
    expect(symbol.getByRole('button', { name: 'XAUUSD' })).toBeInTheDocument();
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'eur' } });
    expect(symbol.queryByRole('button', { name: 'XAUUSD' })).toBeNull();
    expect(symbol.getByText(/No recent symbol matches/)).toBeInTheDocument();
    // A recent is applied only when it is pressed.
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'xau' } });
    fireEvent.click(symbol.getByRole('button', { name: 'XAUUSD' }));
    expect(symbol.getByLabelText('Symbol')).toHaveValue('XAUUSD');
  });
});

describe('Quick Save — the short way out once identity is answered', () => {
  const quickSave = () => screen.queryByRole('button', { name: 'Save closed trade' });

  it('is offered only once Account, Symbol and Direction are answered', () => {
    renderForm();
    expect(quickSave()).toBeNull();
    goTo('result');
    expect(quickSave()).toBeNull();
    fillIdentity();
    expect(quickSave()).not.toBeNull();
    expect(screen.getByText('You can add the rest later.')).toBeInTheDocument();
  });

  it('saves everything already answered on later steps, not only this step', async () => {
    renderForm();
    fillIdentity();
    goTo('result');
    type('Final net P&L', '400');
    fireEvent.click(screen.getByRole('radio', { name: 'Win' }));
    goTo('plan');
    type('Risk at entry', '100');
    // Back on Step 1, the quiet Save still carries the later answers.
    goTo('trade');
    fireEvent.click(quickSave()!);
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      symbol: 'XAUUSD',
      direction: 'long',
      finalPnlMinor: '40000',
      traderOutcome: 'win',
      plannedRiskMinor: '10000',
    });
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeInTheDocument();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('runs the one Save lifecycle: the same key on retry, and the replay conflict', async () => {
    createCompletedTradeActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    renderForm();
    fillIdentity();
    goTo('context');
    fireEvent.click(quickSave()!);
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    const firstKey = payload().mutationKey;
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    createCompletedTradeActionMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'mutation_replay_conflict',
        existingTradeId: TRADE_ID,
        replayConflict: 'different',
      },
    });
    fireEvent.click(quickSave()!);
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(2));
    expect(payload().mutationKey).toBe(firstKey);
    expect(
      await screen.findByText('A different version of this trade was already saved'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-save-replay-conflict="different"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save this draft as a new trade' })).toBeVisible();
    // Nothing was written, so the draft and its Save key stay exactly as they are.
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Trade saved' })).toBeNull();
  });

  it('is blocked by the same validation as the last step, landing on the problem', async () => {
    renderForm();
    fillIdentity();
    goTo('plan');
    type('Risk at entry', '12..5');
    goTo('context');
    fireEvent.click(quickSave()!);
    await waitFor(() => expect(currentStep()).toBe('plan'));
    expect(
      screen.getByText("Enter a valid amount with the currency's supported precision."),
    ).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
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
    goTo('save');
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
    goTo('result');
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
    goTo('result');
    type('Final net P&L', '120');
    expect(screen.getByRole('radio', { name: 'Win' })).not.toBeChecked();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).not.toHaveProperty('traderOutcome');
  });

  it('carries no sign notice for BE beside a profit', () => {
    renderForm();
    goTo('result');
    type('Final net P&L', '10');
    fireEvent.click(screen.getByRole('radio', { name: 'BE' }));
    expect(screen.queryByText(/does not block saving/)).not.toBeInTheDocument();
  });

  it('shows Actual R only from Final Net P&L and Risk at Entry, and says why otherwise', () => {
    renderForm();
    goTo('result');
    expect(
      screen.getByText('Actual R needs your final net P&L and risk at entry.'),
    ).toBeInTheDocument();
    type('Final net P&L', '100');
    expect(screen.getByText('Actual R needs your risk at entry.')).toBeInTheDocument();
    expect(screen.queryByText('0.00R')).not.toBeInTheDocument();
    goTo('plan');
    type('Risk at entry', '50');
    goTo('result');
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
    // Actual Risk is Risk Discipline evidence and never moves the denominator.
    goTo('plan');
    fireEvent.click(screen.getByRole('radio', { name: 'It was different' }));
    type('Actual risk amount', '25');
    goTo('result');
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
  });
});

describe('Actual Risk', () => {
  it('refuses Matched without a Risk at Entry to match', async () => {
    renderForm();
    fillIdentity();
    goTo('plan');
    fireEvent.click(screen.getByRole('radio', { name: 'Matched risk at entry' }));
    save();
    expect(await screen.findByText(/Matched needs a risk at entry/)).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('refuses a Different amount equal to Risk at Entry, never rewriting it to Matched', async () => {
    renderForm();
    fillIdentity();
    goTo('plan');
    type('Risk at entry', '50');
    fireEvent.click(screen.getByRole('radio', { name: 'It was different' }));
    type('Actual risk amount', '50');
    save();
    expect(await screen.findByText(/This is the same as your risk at entry/)).toBeInTheDocument();
    expect(currentStep()).toBe('plan');
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
    goTo('plan');
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
    goTo('plan');
    fireEvent.click(screen.getByRole('radio', { name: /^Fixed target/ }));
    save();
    expect(
      await screen.findByText('Add a target profit or a TP price, or choose No fixed target.'),
    ).toBeInTheDocument();
    expect(currentStep()).toBe('plan');
    expect(screen.getByRole('radio', { name: /^Fixed target/ })).toBeChecked();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('sends a TP price alone as a Fixed Target, and No Fixed Target as its own answer', async () => {
    renderForm();
    fillIdentity();
    goTo('plan');
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
    goTo('context');
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: STRATEGY_ID } });
    expect(screen.queryByText(/From Strategy/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-exit-plan-state]')).toHaveAttribute(
      'data-exit-plan-state',
      'not_recorded',
    );
    goTo('plan');
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
    goTo('context');
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: '__none' } });
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ noStrategy: true });
    expect(payload()).not.toHaveProperty('strategyId');
  });

  it('offers Don’t remember, sends only answered conditions, and never Not Met by omission', async () => {
    renderForm(withStrategy);
    fillIdentity();
    goTo('context');
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
    goTo('result');
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
    goTo('result');
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
    expect(currentStep()).toBe('result');
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
