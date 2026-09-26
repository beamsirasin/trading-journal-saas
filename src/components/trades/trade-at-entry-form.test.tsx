import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import * as atEntry from './at-entry-draft';
import type { AtEntryDraft } from './at-entry-draft';
import { TradeAtEntryForm } from './trade-at-entry-form';

vi.setConfig({ testTimeout: 15_000 });

const pushMock = vi.fn();
const refreshMock = vi.fn();
const createTradeMock = vi.fn();
const libraryActions = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  setDefault: vi.fn(),
  removeDefault: vi.fn(),
}));

vi.mock('@/server/actions/exit-plans', () => ({
  createExitPlanAction: (input: unknown) => libraryActions.create(input),
  updateExitPlanAction: (input: unknown) => libraryActions.update(input),
  archiveExitPlanAction: (input: unknown) => libraryActions.archive(input),
  setExitPlanStrategyDefaultAction: (input: unknown) => libraryActions.setDefault(input),
  removeExitPlanStrategyDefaultAction: (input: unknown) => libraryActions.removeDefault(input),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/*
  The Saved Symbol library is server-backed. These tests are not about it, so
  its actions answer the way the server would for a single browser: saving
  puts a symbol first, once, and the list comes back.
*/
vi.mock('@/server/actions/saved-symbols', () => {
  let symbols: string[] = [];
  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  return {
    saveSymbolAction: async ({ symbol }: { symbol: string }) => {
      if (!symbols.some((item) => same(item, symbol))) symbols = [symbol.trim(), ...symbols];
      return { ok: true, symbols: [...symbols] };
    },
    removeSymbolAction: async ({ symbol }: { symbol: string }) => {
      symbols = symbols.filter((item) => !same(item, symbol));
      return { ok: true, symbols: [...symbols] };
    },
    importSavedSymbolsAction: async () => ({ ok: true, symbols: [...symbols] }),
  };
});

vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (input: unknown) => createTradeMock(input),
}));

const ACCOUNT = '018f0000-0000-7000-8000-000000000001';
const BREAKOUT = '018f0000-0000-7000-8000-000000000010';
const REVERSAL = '018f0000-0000-7000-8000-000000000011';
const RETEST = '018f0000-0000-7000-8000-000000000020';
const SCALE_OUT = '018f0000-0000-7000-8000-000000000030';
const TRAIL = '018f0000-0000-7000-8000-000000000031';
const FADE = '018f0000-0000-7000-8000-000000000032';

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  savedSymbols: [],
  emotionCatalog: [
    { key: 'calm', label: 'Calm' },
    { key: 'fomo', label: 'FOMO' },
  ],
  exitPlans: [
    {
      exitPlanId: SCALE_OUT,
      name: 'Scale out',
      instructions: 'Half at 1R, trail the rest.',
      strategyId: BREAKOUT,
    },
    { exitPlanId: TRAIL, name: 'Trail', instructions: 'Trail behind structure.', strategyId: null },
    {
      exitPlanId: FADE,
      name: 'Fade to mean',
      instructions: 'Close at the range midpoint.',
      strategyId: REVERSAL,
    },
  ],
  tradingAccounts: [
    {
      tradingAccountId: ACCOUNT,
      name: 'Main USD',
      accountMode: 'live',
      baseCurrency: 'USD',
    },
  ],
  strategies: [
    {
      strategyId: BREAKOUT,
      name: 'Breakout',
      currentVersionNumber: 1,
      setups: [
        {
          setupId: RETEST,
          name: 'Retest',
          sortOrder: 0,
          conditionSetToken: 'token-retest',
          conditions: [
            { conditionKey: 'candle', label: 'Candle closed', sortOrder: 0 },
            { conditionKey: 'volume', label: 'Volume rising', sortOrder: 1 },
          ],
        },
      ],
    },
    { strategyId: REVERSAL, name: 'Reversal', currentVersionNumber: 1, setups: [] },
  ],
} as const satisfies TradeCreateOptions;

function renderForm(
  props: {
    initialDraft?: AtEntryDraft;
    onDraftChange?: (draft: AtEntryDraft) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeAtEntryForm
        options={options}
        activeTradingAccountId={ACCOUNT}
        timezone="Asia/Bangkok"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const STEP = {
  trade: 'Trade',
  plan: 'Risk & target',
  setup: 'Strategy & setup',
  context: 'Entry context',
} as const;
type Step = keyof typeof STEP;
const STEP_NUMBER: Readonly<Record<Step, number>> = { trade: 1, plan: 2, setup: 3, context: 4 };

/**
 * Open a step from the step list — the same control a trader taps: the phone's
 * progress rail ("Step 2 of 4: Risk & target"), or the list beside a wide form.
 */
function goTo(step: Step) {
  const rail = screen.queryByRole('button', {
    name: `Step ${STEP_NUMBER[step]} of 4: ${STEP[step]}`,
  });
  fireEvent.click(rail ?? document.querySelector<HTMLElement>(`[data-step-link="${step}"]`)!);
}

function currentStep(): string | null {
  return document.querySelector('[data-record-open-form]')!.getAttribute('data-record-open-step');
}

/** One step's own section, mounted whether or not it is the step being shown. */
function stepSection(step: Step): HTMLElement {
  return document.querySelector<HTMLElement>(`section[data-step="${step}"]`)!;
}

/**
 * Save Open Trade: Save now from Plan & Risk on, or the last step's button.
 * From Step 1 there is neither, so the trader goes on to Plan & Risk.
 */
function save() {
  if (screen.queryAllByRole('button', { name: 'Save open trade' }).length === 0) goTo('plan');
  fireEvent.click(screen.getAllByRole('button', { name: 'Save open trade' })[0]!);
}

/** Step 1's Symbol: typed, added to the saved library, and chosen — which closes the sheet. */
function chooseSymbol(symbol: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Symbol' }));
  const editor = within(screen.getByRole('dialog'));
  fireEvent.change(editor.getByLabelText('Symbol'), { target: { value: symbol } });
  fireEvent.click(editor.getByRole('button', { name: /^Add/ }));
  fireEvent.click(editor.getByRole('option', { name: new RegExp('^' + symbol, 'i') }));
}

function chooseDirection(direction: 'Long' | 'Short') {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Direction' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: direction }));
}

/** Save Open Trade's minimum: identity on Step 1, Risk at Entry on Plan & Risk. */
/** Choose how risk was defined, then answer what that choice asks for. */
function chooseRisk(answer: 'Defined risk' | 'No defined risk', amount?: string) {
  const editor = openPlanRow('risk');
  const radio = editor.getByRole('radio', { name: new RegExp(`^${answer}`) });
  fireEvent.click(document.querySelector<HTMLElement>(`label[for="${radio.id}"]`)!);
  if (amount !== undefined) {
    fireEvent.change(editor.getByLabelText('Risk at entry'), { target: { value: amount } });
  }
  closeEditor();
}

function fillMinimum() {
  chooseSymbol('xauusd');
  chooseDirection('Long');
  goTo('plan');
  chooseRisk('Defined risk', '100');
}

/** Strategy and Setup are Setup & Checklist's launcher rows; the choice is the answer. */
function chooseClassification(field: 'Strategy' | 'Setup', choice: string) {
  if (currentStep() !== 'setup') goTo('setup');
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: choice }));
}

/**
 * The Exit Plan's state, read from its launcher row so it can be checked
 * whether or not its editor happens to be open.
 */
function exitPlanState() {
  return document.querySelector('[data-exit-plan-row]')?.getAttribute('data-exit-plan-row');
}

/**
 * PLAN & RISK ANSWERS LIVE IN ROW EDITORS (UX Rules §20.4). The row reads the
 * answer back; the editor it opens is where the answer is given.
 */
function planRow(concept: 'risk' | 'target' | 'price'): HTMLElement {
  if (currentStep() !== 'plan') goTo('plan');
  return document.querySelector<HTMLElement>(`[data-plan-row="${concept}"]`)!;
}

function openPlanRow(concept: 'risk' | 'target' | 'price') {
  fireEvent.click(planRow(concept));
  return within(screen.getByRole('dialog'));
}

/** The Exit Plan's launcher row, which reads its state and provenance back. */
function exitPlanRow(): HTMLElement {
  if (currentStep() !== 'plan') goTo('plan');
  return document.querySelector<HTMLElement>('[data-exit-plan-row]')!;
}

/** The Exit Plan's own row opens the same states and actions it always had. */
function openExitPlan() {
  if (currentStep() !== 'plan') goTo('plan');
  fireEvent.click(document.querySelector<HTMLElement>('[data-exit-plan-row]')!);
  return within(screen.getByRole('dialog'));
}

function closeEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}

function statusText() {
  return document.querySelector('[data-save-status]')?.textContent ?? '';
}

function payload(call = 0): Record<string, unknown> {
  return createTradeMock.mock.calls[call]![0] as Record<string, unknown>;
}

/** Entry Emotion opens in its own editor from Entry Context. */
function openEntryEmotions() {
  if (currentStep() !== 'context') goTo('context');
  fireEvent.click(screen.getByRole('button', { name: 'Edit How you feel as you enter' }));
  return within(screen.getByRole('dialog'));
}

beforeEach(() => {
  pushMock.mockReset();
  createTradeMock.mockReset();
  createTradeMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-1' } });
  refreshMock.mockReset();
  for (const action of Object.values(libraryActions)) {
    action.mockReset();
    // The server's library is unchanged unless a test says otherwise.
    action.mockResolvedValue({
      ok: true,
      data: { exitPlanId: 'plan-new', replacedExitPlanId: null },
      exitPlans: options.exitPlans,
    });
  }
  window.localStorage.clear();
});

describe('Record Open — the canonical stages', () => {
  it('asks the four canonical stages in order, one at a time', () => {
    renderForm();
    expect(currentStep()).toBe('trade');
    expect(screen.getByRole('heading', { level: 2, name: 'Trade details' })).toBeVisible();
    expect(screen.getByText('Step 1 of 4')).toBeVisible();
    // Step 1 is the protected launcher-row step: four rows, no inline inputs.
    expect(within(stepSection('trade')).getAllByRole('button', { name: /^Edit / })).toHaveLength(4);
    expect(within(stepSection('trade')).queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next: Risk & target' }));
    expect(currentStep()).toBe('plan');
    expect(document.querySelector('[data-plan-risk-step="at_entry"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Strategy & setup' }));
    expect(currentStep()).toBe('setup');
    expect(document.querySelector('[data-setup-checklist-step="at_entry"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Entry context' }));
    expect(currentStep()).toBe('context');
    expect(document.querySelector('[data-entry-context-step="at_entry"]')).not.toBeNull();
    // No Exit & Result, no After-Trade Context, no Review in Record Open.
    expect(screen.queryByLabelText('Final net P&L')).toBeNull();
    expect(screen.queryByText(/How you feel about the trade now/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Review/ })).toBeNull();
  });

  it('never loses an answer to Back or Next', () => {
    renderForm();
    fillMinimum();
    goTo('context');
    fireEvent.change(screen.getByLabelText('Why this trade'), { target: { value: 'Retest.' } });
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    }
    expect(currentStep()).toBe('trade');
    expect(document.querySelector('[data-concept="symbol"]')).toHaveAttribute(
      'data-value',
      'xauusd',
    );
    goTo('plan');
    expect(openPlanRow('risk').getByLabelText('Risk at entry')).toHaveValue('100');
    closeEditor();
    goTo('context');
    expect(screen.getByLabelText('Why this trade')).toHaveValue('Retest.');
  });

  it('keeps the current step out of the draft: a reload recovers answers from Step 1', () => {
    const drafts: AtEntryDraft[] = [];
    const first = renderForm({ onDraftChange: (draft) => drafts.push(draft) });
    fillMinimum();
    goTo('setup');
    const last = drafts.at(-1)!;
    expect(Object.keys(last)).not.toContain('step');
    expect(JSON.stringify(last)).not.toContain('"setup"');
    first.unmount();

    renderForm({ initialDraft: last });
    expect(currentStep()).toBe('trade');
    expect(document.querySelector('[data-concept="symbol"]')).toHaveAttribute(
      'data-value',
      'xauusd',
    );
    goTo('plan');
    expect(openPlanRow('risk').getByLabelText('Risk at entry')).toHaveValue('100');
  });
});

describe('Record Open — Save and Save now', () => {
  it('saves Account, Symbol, Direction and Risk at Entry alone, with Risk as the 1R baseline', async () => {
    renderForm();
    fillMinimum();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      recordingContract: 'add_trade_v1',
      recordingTiming: 'at_entry',
      systemPlanBasis: 'money',
      symbol: 'XAUUSD',
      direction: 'long',
      plannedRiskMinor: '10000',
      enteredAtSource: 'default_now',
    });
    // No Actual Risk is part of any Save (decision 56).
    expect(payload()).not.toHaveProperty('actualRiskAnswer');
    expect(payload()).not.toHaveProperty('actualInitialRiskMinor');
    expect(payload()).not.toHaveProperty('targetState');
    expect(payload()).not.toHaveProperty('exitPlan');
    expect(payload()).not.toHaveProperty('plannedEntry');
    // Save Open Trade offers no Review: it opens the Trade.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=trade-1'));
  });

  it('offers Save now from Plan & Risk on — never on Step 1 — and Save open trade last', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Save open trade' })).toBeNull();
    for (const step of ['plan', 'setup'] as const) {
      goTo(step);
      const quick = document.getElementById('entry-quick-save')!;
      expect(quick).toHaveTextContent('Save now');
      expect(quick).toHaveAccessibleName('Save open trade');
    }
    goTo('context');
    expect(document.getElementById('entry-quick-save')).toBeNull();
    const primary = screen.getByRole('button', { name: 'Save open trade' });
    expect(primary).toHaveAttribute('type', 'submit');
  });

  it('never requires Setup & Checklist or Entry Context to save', async () => {
    renderForm();
    fillMinimum();
    // From Plan & Risk, straight away: Steps 3 and 4 were never opened.
    fireEvent.click(document.getElementById('entry-quick-save')!);
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty('strategyId');
    expect(payload()).not.toHaveProperty('noStrategy');
    expect(payload()).not.toHaveProperty('confidence');
    expect(payload()).not.toHaveProperty('emotionKeys');
  });

  it('takes a blocked Save to Step 1 and focuses the row a missing answer belongs to', async () => {
    renderForm();
    goTo('plan');
    chooseRisk('Defined risk', '100');
    fireEvent.click(document.getElementById('entry-quick-save')!);
    await waitFor(() => expect(currentStep()).toBe('trade'));
    await waitFor(() => expect(document.getElementById('entry-row-symbol')).toHaveFocus());
    expect(document.getElementById('entry-row-symbol')).toHaveAttribute('data-invalid', 'true');
    expect(createTradeMock).not.toHaveBeenCalled();
  });

  /*
    REQUIRED IS FOR COMPLETION, NOT FOR SAVING (decision 59). With the risk
    decision still missing the Open Trade saves; the footer says what is left
    to complete, quietly, never as an error.
  */
  it('saves with the risk decision missing, and says what is left to complete', async () => {
    renderForm();
    chooseSymbol('xauusd');
    chooseDirection('Short');
    goTo('context');
    expect(statusText()).toMatch(/required items? left\. You can save now and finish them later\./);
    expect(document.querySelector('[data-save-status]')?.className).not.toContain('destructive');
    fireEvent.click(screen.getByRole('button', { name: 'Save open trade' }));
    await waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    const payload = createTradeMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('plannedRiskState');
    expect(payload).not.toHaveProperty('plannedRiskMinor');
  });

  it('never saves early from Enter on an earlier step', () => {
    renderForm();
    fillMinimum();
    fireEvent.submit(document.querySelector('[data-record-open-form]')!);
    expect(createTradeMock).not.toHaveBeenCalled();
  });
});

describe('Record Open — Step 1 keeps At Entry’s "now"', () => {
  function entryRow() {
    return document.getElementById('entry-row-enteredAt')!;
  }

  function openEntryTime() {
    if (currentStep() !== 'trade') goTo('trade');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Entry date & time' }));
    return within(screen.getByRole('dialog'));
  }

  it('starts as a visible "now" default that follows the clock', () => {
    renderForm();
    expect(within(entryRow()).getByText('Set automatically to now')).toBeVisible();
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'default_now');
    // A complete stamp, never half of one.
    expect(entryRow().getAttribute('data-value')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('keeps an untouched default distinct from a confirmed time, and can clear it', async () => {
    renderForm();
    fillMinimum();
    const sheet = openEntryTime();
    // At Entry keeps one complete stamp: no half-only clears, with both halves open.
    fireEvent.click(document.getElementById('entry-entry-date')!);
    expect(document.querySelector('[data-entry-date-picker]')).not.toBeNull();
    fireEvent.click(document.getElementById('entry-entry-time')!);
    expect(document.querySelector('[data-time-wheel-state]')).not.toBeNull();
    expect(sheet.queryByRole('button', { name: 'Clear date', hidden: true })).toBeNull();
    expect(sheet.queryByRole('button', { name: 'Clear time', hidden: true })).toBeNull();
    fireEvent.click(sheet.getByRole('button', { name: 'This time is right' }));
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'trader');
    expect(within(entryRow()).queryByText('Set automatically to now')).toBeNull();
    fireEvent.click(sheet.getByRole('button', { name: 'Done' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ enteredAtSource: 'trader' });

    const again = openEntryTime();
    fireEvent.click(again.getByRole('button', { name: 'Clear entry date & time' }));
    expect(entryRow()).toHaveTextContent('Not set');
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'cleared');
    fireEvent.click(again.getByRole('button', { name: 'Done' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(payload(1)).not.toHaveProperty('enteredAt');
    expect(payload(1)).not.toHaveProperty('enteredAtSource');
  });

  it('puts a cleared time back on the clock only by Use now', () => {
    renderForm();
    const sheet = openEntryTime();
    fireEvent.click(sheet.getByRole('button', { name: 'Clear entry date & time' }));
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'cleared');
    // Done on a cleared time keeps it cleared: nothing is filled in for the trader.
    fireEvent.click(sheet.getByRole('button', { name: 'Done' }));
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'cleared');
    const again = openEntryTime();
    fireEvent.click(again.getByRole('button', { name: 'Use now' }));
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'default_now');
    expect(within(entryRow()).getByText('Set automatically to now')).toBeVisible();
  });

  it('does not confirm the default when the sheet is merely opened and closed', () => {
    renderForm();
    const sheet = openEntryTime();
    fireEvent.click(sheet.getByRole('button', { name: 'Done' }));
    expect(entryRow().parentElement).toHaveAttribute('data-entry-source', 'default_now');
  });
});

/*
  ACTUAL RISK IS RETIRED FROM CAPTURE (contract decision 56). Record Open's
  Entry context asks no risk figure, Risk & target asks only the 1R, and a
  Save sends no Actual Risk however the trade was recorded.
*/
describe('Record Open — no Actual Risk', () => {
  it('asks no Actual Risk anywhere, and Entry context begins with Confidence', async () => {
    renderForm();
    fillMinimum();
    expect(planRow('risk')).not.toHaveTextContent(/actual risk/i);
    goTo('context');
    const step = document.querySelector<HTMLElement>('[data-entry-context-step]')!;
    expect(step).not.toHaveTextContent(/actual risk|actually risked/i);
    expect(document.getElementById('entry-actual-risk-row')).toBeNull();
    expect(step.querySelector('[data-actual-risk-summary]')).toBeNull();
    expect(
      within(step.querySelector('section')!).getByRole('group', { name: 'Confidence' }),
    ).toBeInTheDocument();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ plannedRiskState: 'defined', plannedRiskMinor: '10000' });
    expect(payload()).not.toHaveProperty('actualRiskAnswer');
    expect(payload()).not.toHaveProperty('actualInitialRiskMinor');
  });
});

describe('Record Open — Plan & Risk: Target', () => {
  it('attaches an incomplete Fixed Target to Target profit, never to No fixed target', async () => {
    renderForm();
    fillMinimum();
    fireEvent.click(openPlanRow('target').getByLabelText(/^Fixed target/));
    closeEditor();
    save();
    // The row a blocked Save lands on says what is wrong before anything opens.
    await waitFor(() => expect(planRow('target')).toHaveAttribute('data-invalid', 'true'));
    const message = await screen.findByText(
      'Add a target profit or a TP price, or choose No fixed target.',
    );
    expect(message).toBeVisible();
    const editor = openPlanRow('target');
    expect(editor.getByLabelText('Target profit')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining(
        editor.getByText('Add a target profit or a TP price, or choose No fixed target.').id,
      ),
    );
    expect(editor.getByLabelText(/^No fixed target/)).not.toHaveAttribute('aria-invalid', 'true');
    expect(createTradeMock).not.toHaveBeenCalled();
  });

  it('returns Target to Unanswered by an explicit, labelled action', () => {
    renderForm();
    fillMinimum();
    const editor = openPlanRow('target');
    fireEvent.click(editor.getByLabelText(/^No fixed target/));
    expect(editor.getByLabelText(/^No fixed target/)).toBeChecked();
    fireEvent.click(editor.getByRole('button', { name: 'Remove target answer' }));
    expect(editor.getByLabelText(/^No fixed target/)).not.toBeChecked();
    expect(editor.getByLabelText(/^Fixed target/)).not.toBeChecked();
  });

  it('keeps a money-based target R as context beside the Target', () => {
    renderForm();
    fillMinimum();
    const editor = openPlanRow('target');
    fireEvent.click(editor.getByLabelText(/^Fixed target/));
    fireEvent.change(editor.getByLabelText('Target profit'), { target: { value: '300' } });
    expect(editor.getByText('Reaching your target would be +3.00R.')).toBeVisible();
    closeEditor();
    // And it reads back where the Target is read.
    expect(planRow('target')).toHaveTextContent('Reaching your target would be +3.00R.');
  });
});

describe('Record Open — readiness and errors', () => {
  it('names what Save itself still needs, apart from what completes the Trade', () => {
    renderForm();
    goTo('context');
    // Account, Symbol and Direction are what a Save needs; nothing else blocks it.
    expect(statusText()).toMatch(/^[0-9]+ more answers? needed to save$/);
    expect(statusText()).not.toMatch(/ of [0-9]/);
  });

  it('never reports Ready while a blocking price error sits on another step', () => {
    renderForm();
    fillMinimum();
    goTo('context');
    // Saveable: the line speaks of completion, not of anything blocking.
    expect(statusText()).toMatch(/You can save now|Required items complete/);

    fireEvent.change(openPlanRow('price').getByLabelText('SL price'), {
      target: { value: '12..5' },
    });
    closeEditor();
    // An error is never hidden behind a tap: the closed row carries it.
    expect(planRow('price')).toHaveAttribute('data-invalid', 'true');
    goTo('context');
    expect(statusText()).not.toMatch(/You can save now|Required items complete/);
    expect(statusText()).toContain('attention');
  });

  it('takes a blocked Save back to the price level that holds the error', async () => {
    renderForm();
    fillMinimum();
    fireEvent.change(openPlanRow('price').getByLabelText('Entry price'), {
      target: { value: 'abc' },
    });
    closeEditor();
    goTo('context');
    fireEvent.click(screen.getByRole('button', { name: 'Save open trade' }));
    expect(createTradeMock).not.toHaveBeenCalled();
    await waitFor(() => expect(currentStep()).toBe('plan'));
    // The row is the focusable thing that exists: it names the concept, holds
    // the error, and opens the input in one press (as Step 1 has always done).
    await waitFor(() => expect(planRow('price')).toHaveFocus());
    expect(
      screen.getByText('Enter a price greater than zero, using digits and one decimal point.'),
    ).toBeVisible();
    expect(openPlanRow('price').getByLabelText('Entry price')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

describe('Record Open — Exit Plan inheritance across stages', () => {
  it('inherits the Strategy default visibly, and announces it where the Strategy is chosen', () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    // Announced on Setup & Checklist, where the choice caused it.
    expect(
      within(stepSection('setup')).getByText(
        'Breakout currently supplies the exit plan “Scale out” unless you change it.',
      ),
    ).toBeVisible();
    goTo('plan');
    // At Entry reads the Exit Plan in full on Plan & Risk.
    expect(exitPlanState()).toBe('inherited');
    expect(screen.getByText('From Strategy: Breakout')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use this plan' })).toBeNull();
  });

  it('follows a Strategy change while still inherited', () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    chooseClassification('Strategy', 'Reversal');
    expect(
      within(stepSection('setup')).getByText(
        'Reversal currently supplies the exit plan “Fade to mean” unless you change it.',
      ),
    ).toBeVisible();
    goTo('plan');
    expect(exitPlanState()).toBe('inherited');
    expect(screen.getByText('From Strategy: Reversal')).toBeInTheDocument();
  });

  it('stops following the Strategy once the Exit Plan is explicitly overridden', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openExitPlan();
    // An explicit override: another choice, made in the Exit Plan editor.
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('radio', { name: /^No defined exit rule/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('no_rule');
    closeEditor();
    chooseClassification('Strategy', 'Reversal');
    // No announcement, and the override stands.
    expect(within(stepSection('setup')).queryByText(/currently supplies the exit plan/)).toBeNull();
    expect(exitPlanState()).toBe('no_rule');
    // Only the explicit restore brings the default back.
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Use strategy default' }));
    expect(exitPlanState()).toBe('inherited');
    expect(within(exitPlanRow()).getByText('From Strategy: Reversal')).toBeVisible();
  });

  it('opening the chooser and closing without a change never manufactures an override', () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('inherited');

    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(exitPlanState()).toBe('inherited');
  });

  it('opening Customize claims nothing until the wording really changes', () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByLabelText('Your plan for this trade')).toHaveValue(
      'Half at 1R, trail the rest.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('inherited');

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.change(screen.getByLabelText('Your plan for this trade'), {
      target: { value: 'Half at 1R, close the rest at 2R.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('customized');
    expect(within(exitPlanRow()).getByText('Customized for this trade')).toBeVisible();
  });

  it('discards an edit only when Discard changes is chosen', () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.change(screen.getByLabelText('Your plan for this trade'), {
      target: { value: 'Something else entirely.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(exitPlanState()).toBe('inherited');
  });

  it('keeps custom wording through another choice and restores it', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.change(screen.getByLabelText('Your plan for this trade'), {
      target: { value: 'Close before the news.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('customized');

    fireEvent.click(screen.getByRole('button', { name: 'Use strategy default' }));
    expect(exitPlanState()).toBe('inherited');
    fireEvent.click(screen.getByRole('button', { name: 'Use your custom plan' }));
    expect(exitPlanState()).toBe('customized');
    expect(screen.getByText('Close before the news.')).toBeVisible();

    closeEditor();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      exitPlan: { state: 'customized', instructions: 'Close before the news.' },
      exitPlanInheritanceDeclined: true,
    });
  });

  it('sends an inherited plan with its Strategy-default provenance', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      strategyId: BREAKOUT,
      exitPlan: { state: 'saved', exitPlanId: SCALE_OUT, provenance: 'strategy_default' },
    });
  });
});

describe('Record Open — managing saved exit plans', () => {
  function openManage() {
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: /^(Choose another|Choose exit plan)$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage saved plans' }));
  }

  function libraryItem(name: string): HTMLElement {
    const item = document.querySelector(`[data-exit-plan-library-item="${name}"]`);
    if (!(item instanceof HTMLElement)) throw new Error(`no library item ${name}`);
    return item;
  }

  it('creates a saved plan as a library decision, never as this trade’s answer', async () => {
    const NEWS = '018f0000-0000-7000-8000-000000000033';
    libraryActions.create.mockResolvedValue({
      ok: true,
      data: { exitPlanId: NEWS },
      exitPlans: [
        {
          exitPlanId: NEWS,
          name: 'News exit',
          instructions: 'Flat before news.',
          strategyId: null,
        },
        ...options.exitPlans,
      ],
    });
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'New saved plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'News exit' } });
    fireEvent.change(screen.getByLabelText('Instructions'), {
      target: { value: 'Flat before high-impact news.\nNo re-entry for 15 minutes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await vi.waitFor(() => expect(libraryActions.create).toHaveBeenCalledTimes(1));
    // The plan form lives in a portal inside the form's React tree: its submit
    // must never bubble up and save the Trade.
    expect(createTradeMock).not.toHaveBeenCalled();
    expect(libraryActions.create.mock.calls[0]![0]).toMatchObject({
      name: 'News exit',
      instructions: 'Flat before high-impact news.\nNo re-entry for 15 minutes.',
      mutationKey: expect.any(String),
    });
    expect(
      await screen.findByText('News exit saved. Go back to choose it for this trade.'),
    ).toBeVisible();
    expect(refreshMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to exit plan choices' }));
    expect(screen.getByRole('radio', { name: /News exit/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // The inherited default is untouched: creating a plan chose nothing.
    expect(exitPlanState()).toBe('inherited');
  });

  it('refuses a blank plan at its fields without calling the server', () => {
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'New saved plan' }));
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(screen.getByText('Enter a name for this plan.')).toBeVisible();
    expect(screen.getByText("Write the plan's instructions.")).toBeVisible();
    expect(libraryActions.create).not.toHaveBeenCalled();
  });

  it('keeps a half-written plan when the editor is closed and reopened', () => {
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'New saved plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half written' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose exit plan' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Half written');
  });

  it('makes, replaces and removes a default only for the Strategy this trade uses', async () => {
    renderForm();
    fillMinimum();
    openManage();
    // No Strategy chosen: no default can be set from here.
    expect(screen.queryByRole('button', { name: /default for/ })).toBeNull();
    expect(
      screen.getByText('To set a Strategy default, choose a Strategy for this trade first.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Closing the chooser returns to the Exit Plan sheet it opened from.
    closeEditor();

    chooseClassification('Strategy', 'Breakout');
    openManage();
    fireEvent.click(
      within(libraryItem('Trail')).getByRole('button', {
        name: 'Make this the default for Breakout instead',
      }),
    );
    await vi.waitFor(() =>
      expect(libraryActions.setDefault).toHaveBeenCalledWith({
        exitPlanId: TRAIL,
        strategyId: BREAKOUT,
      }),
    );
    fireEvent.click(
      within(libraryItem('Scale out')).getByRole('button', {
        name: 'Remove as default for Breakout',
      }),
    );
    await vi.waitFor(() =>
      expect(libraryActions.removeDefault).toHaveBeenCalledWith({ exitPlanId: SCALE_OUT }),
    );
  });

  it('confirms an archive and says when this trade’s own answer depends on the plan', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    openManage();
    const scaleOut = libraryItem('Scale out');
    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Archive Scale out' }));
    expect(libraryActions.archive).not.toHaveBeenCalled();
    expect(within(scaleOut).getByText('It also stops being a Strategy default.')).toBeVisible();
    expect(
      within(scaleOut).getByText(
        "This trade's exit plan currently uses it, so that answer will become Not recorded.",
      ),
    ).toBeVisible();
    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Keep plan' }));
    expect(libraryActions.archive).not.toHaveBeenCalled();

    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Archive Scale out' }));
    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Archive plan' }));
    await vi.waitFor(() =>
      expect(libraryActions.archive).toHaveBeenCalledWith({ exitPlanId: SCALE_OUT }),
    );
  });

  it('drops an archived plan from the choices as soon as the archive succeeds', async () => {
    libraryActions.archive.mockResolvedValue({
      ok: true,
      data: { exitPlanId: TRAIL },
      exitPlans: options.exitPlans.filter((plan) => plan.exitPlanId !== TRAIL),
    });
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(within(libraryItem('Trail')).getByRole('button', { name: 'Archive Trail' }));
    fireEvent.click(within(libraryItem('Trail')).getByRole('button', { name: 'Archive plan' }));
    expect(await screen.findByText('Trail archived.')).toBeVisible();
    expect(document.querySelector('[data-exit-plan-library-item="Trail"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to exit plan choices' }));
    expect(screen.queryByRole('radio', { name: /^Trail/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Scale out/ })).toBeInTheDocument();
  });

  it('shows a failed library change and changes nothing', async () => {
    libraryActions.update.mockResolvedValue({ ok: false, error: { code: 'read_only_workspace' } });
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(within(libraryItem('Trail')).getByRole('button', { name: 'Edit Trail' }));
    expect(screen.getByLabelText('Instructions')).toHaveValue('Trail behind structure.');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(
      await screen.findByText(
        'Your workspace is read-only, so saved plans cannot be changed right now.',
      ),
    ).toBeVisible();
    expect(document.querySelector('[data-exit-plan-library-item="Trail"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(libraryItem('Trail')).toHaveTextContent('Trail behind structure.');
  });
});

describe('Record Open — Setup & Checklist', () => {
  function setupRow() {
    return document.querySelector<HTMLElement>('[data-classification="setup"]')!;
  }

  it('restores Setup and condition answers when a Strategy is returned to', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    chooseClassification('Setup', 'Retest');
    const candle = screen.getByRole('group', { name: /Candle closed/ });
    fireEvent.click(within(candle).getByLabelText('Met'));

    chooseClassification('Strategy', 'Reversal');
    expect(setupRow()).toHaveAttribute('data-answer', 'unanswered');

    chooseClassification('Strategy', 'Breakout');
    expect(setupRow()).toHaveTextContent('Retest');
    expect(
      within(screen.getByRole('group', { name: /Candle closed/ })).getByLabelText('Met'),
    ).toBeChecked();
    // Multi-state, never a checkbox.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    // Only the answered condition travels; the unanswered one is never a Not Met.
    expect(payload()).toMatchObject({
      setupId: RETEST,
      conditionAnswers: [{ conditionKey: 'candle', status: 'met' }],
    });
  });

  it('holds No strategy, a selection and Unanswered apart', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'No strategy');
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ noStrategy: true });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Strategy' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove strategy answer' }),
    );
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(payload(1)).not.toHaveProperty('noStrategy');
    expect(payload(1)).not.toHaveProperty('strategyId');
  });

  it('records No setup as a complete answer with its own sentence', async () => {
    renderForm();
    fillMinimum();
    chooseClassification('Strategy', 'Breakout');
    chooseClassification('Setup', 'No setup');
    expect(
      within(stepSection('setup')).getByText(
        'No setup for this trade, so there is no checklist to answer.',
      ),
    ).toBeVisible();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ strategyId: BREAKOUT, noSetup: true });
  });
});

describe('Record Open — Entry Context & Evidence', () => {
  it('refuses to turn the last selected emotion into silence', () => {
    renderForm();
    fillMinimum();
    const editor = openEntryEmotions();
    fireEvent.click(editor.getByRole('button', { name: 'Calm' }));
    expect(editor.getByRole('button', { name: 'Calm' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(editor.getByRole('button', { name: 'Calm' }));
    expect(editor.getByRole('button', { name: 'Calm' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      editor.getByText('To clear this answer, choose None of these or Remove answer.'),
    ).toBeVisible();

    fireEvent.click(editor.getByRole('button', { name: 'Remove emotions answer' }));
    expect(editor.getByRole('button', { name: 'Calm' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps Not answered, None of these and a selection as three different answers', async () => {
    renderForm();
    fillMinimum();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty('emotionKeys');

    const editor = openEntryEmotions();
    fireEvent.click(editor.getByRole('button', { name: 'None of these' }));
    fireEvent.click(editor.getByRole('button', { name: 'Done' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(payload(1)).toMatchObject({ emotionKeys: [] });

    const again = openEntryEmotions();
    fireEvent.click(again.getByRole('button', { name: 'FOMO' }));
    fireEvent.click(again.getByRole('button', { name: 'Done' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(3));
    expect(payload(2)).toMatchObject({ emotionKeys: ['fomo'] });
  });

  it('has no Confidence default and removes it explicitly', async () => {
    renderForm();
    fillMinimum();
    goTo('context');
    for (const level of ['Very Low', 'Low', 'Neutral', 'High', 'Very High']) {
      expect(screen.getByLabelText(level)).not.toBeChecked();
    }
    fireEvent.click(screen.getByLabelText('High'));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ confidence: 75 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove confidence answer' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(payload(1)).not.toHaveProperty('confidence');
  });

  it('saves the entry-time context and the chart link, and offers no upload', async () => {
    renderForm();
    fillMinimum();
    goTo('context');
    fireEvent.change(screen.getByLabelText('Why this trade'), { target: { value: 'Retest.' } });
    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: '15m' } });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 'London' } });
    fireEvent.change(screen.getByLabelText('Entry notes'), { target: { value: 'Tight spread.' } });
    fireEvent.change(screen.getByLabelText('Chart link'), {
      target: { value: 'https://www.tradingview.com/x/abc123/' },
    });
    expect(document.querySelector('input[type="file"]')).toBeNull();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      timeframe: '15m',
      session: 'London',
      notes: 'Tight spread.',
      tradingviewUrl: 'https://www.tradingview.com/x/abc123/',
    });
  });
});

describe('Record Open — a malformed chart link', () => {
  it('blocks Save on Entry Context, at the link, with the server’s own rule', async () => {
    renderForm();
    fillMinimum();
    goTo('context');
    fireEvent.change(screen.getByLabelText('Chart link'), {
      target: { value: 'https://example.com/not-tradingview' },
    });
    goTo('plan');
    fireEvent.click(document.getElementById('entry-quick-save')!);
    await waitFor(() => expect(currentStep()).toBe('context'));
    await waitFor(() => expect(screen.getByLabelText('Chart link')).toHaveFocus());
    expect(screen.getByLabelText('Chart link')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter an HTTPS TradingView URL.')).toBeVisible();
    expect(createTradeMock).not.toHaveBeenCalled();

    // A TradingView link, and the Save goes through.
    fireEvent.change(screen.getByLabelText('Chart link'), {
      target: { value: 'https://www.tradingview.com/x/abc12345/' },
    });
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ tradingviewUrl: 'https://www.tradingview.com/x/abc12345/' });
  });
});

describe('Record Open — the step list beside a wide form', () => {
  it('summarizes each step honestly, and says what Save still needs', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(min-width: 64rem)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    try {
      renderForm();
      const rail = () => document.querySelector('aside')!;
      const link = (key: string) => rail().querySelector<HTMLElement>(`[data-step-link="${key}"]`)!;
      // Required items left per step (decision 59): Symbol and Direction on
      // Step 1, Risk and Target on Step 2. Step 3 is Recommended, never Optional.
      expect(link('trade')).toHaveTextContent('2 required left');
      expect(link('plan')).toHaveTextContent('2 required left');
      expect(link('setup')).toHaveTextContent('Recommended');
      expect(document.querySelector('[data-required-status]')).toHaveAttribute(
        'data-required-status',
        'missing',
      );

      /*
        The same answers, recovered from a draft: this test is about the list
        beside the form, not the editors that give the answers (a wide screen's
        editors are dialogs, covered by the tests above at phone width).
      */
      cleanup();
      let filled = atEntry.createAtEntryDraft(ACCOUNT);
      filled = {
        ...filled,
        symbol: 'xauusd',
        direction: 'long',
        riskState: 'defined',
        risk: '100',
      };
      filled = atEntry.selectStrategy(filled, BREAKOUT);
      filled = atEntry.selectSetup(filled, RETEST);
      filled = atEntry.answerCondition(filled, 'candle', 'met');
      filled = atEntry.answerNoEmotions(filled);
      renderForm({ initialDraft: filled });

      expect(link('trade')).toHaveTextContent('XAUUSD · Long · Main USD');
      // Risk answered, Target not yet: the step says what is left.
      expect(link('plan')).toHaveTextContent('1 required left');
      expect(link('setup')).toHaveTextContent('Breakout · Retest · 1 of 2 conditions answered');
      expect(link('context')).toHaveTextContent('No emotions');
      expect(document.querySelector('[data-required-status]')).toHaveAttribute(
        'data-required-status',
        'ready',
      );
    } finally {
      matchMedia.mockRestore();
    }
  });
});
