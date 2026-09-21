import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateCompletedTradeSchema } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeRecordingForm } from './trade-recording-form';

/*
  A LONGER BUDGET, BECAUSE THIS SUITE DOES MORE THAN IT USED TO.

  Step 1's controls live in overlays now, so a test that fills the identity
  mounts and unmounts two Radix sheets before it starts, and one that touches
  the entry timestamp mounts a month grid and an eighty-four-cell wheel too.
  That is fast in a browser — the e2e flow does all of it in seconds — and slow
  in jsdom, which has no layout to skip and rebuilds every node. Under a full
  suite run the longest tests here were landing within a few tens of
  milliseconds of the 5s default and timing out at random, which reports as a
  flake and hides real ones. The work is real, so the budget says so.
*/
vi.setConfig({ testTimeout: 15_000 });

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
/*
  THE SERVER'S SAVED SYMBOL LIBRARY, IN MEMORY. The actions below write it the
  way the real service does — newest first, one row per symbol whatever its
  case, the first spelling kept — and `renderForm` reads it the way the page
  does, through `getTradeCreateOptions`. So a "reload" in these tests really is
  a fresh page asking the server, and nothing can pass by surviving in React
  state or in this browser's storage instead.
*/
const serverLibrary = vi.hoisted(() => ({ symbols: [] as string[], failNextImport: false }));
const sameSymbol = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const importSavedSymbolsMock = vi.fn();

vi.mock('@/server/actions/saved-symbols', () => ({
  saveSymbolAction: async ({ symbol }: { symbol: string }) => {
    const value = symbol.trim();
    if (!serverLibrary.symbols.some((item) => sameSymbol(item, value))) {
      serverLibrary.symbols = [value, ...serverLibrary.symbols];
    }
    return { ok: true, symbols: [...serverLibrary.symbols] };
  },
  removeSymbolAction: async ({ symbol }: { symbol: string }) => {
    serverLibrary.symbols = serverLibrary.symbols.filter((item) => !sameSymbol(item, symbol));
    return { ok: true, symbols: [...serverLibrary.symbols] };
  },
  importSavedSymbolsAction: async (input: { symbols: string[] }) => {
    importSavedSymbolsMock(input);
    if (serverLibrary.failNextImport) {
      serverLibrary.failNextImport = false;
      return { ok: false, error: { code: 'unexpected_error' } };
    }
    // Behind what the server holds, in the browser's own order, no duplicates.
    const incoming = input.symbols
      .map((item) => item.trim())
      .filter(
        (item) => item !== '' && !serverLibrary.symbols.some((held) => sameSymbol(held, item)),
      );
    const unique = incoming.filter(
      (item, index) => incoming.findIndex((other) => sameSymbol(other, item)) === index,
    );
    serverLibrary.symbols = [...serverLibrary.symbols, ...unique];
    return { ok: true, symbols: [...serverLibrary.symbols] };
  },
}));

vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (...args: unknown[]) => createTradeActionMock(...args),
  createCompletedTradeAction: (...args: unknown[]) => createCompletedTradeActionMock(...args),
}));

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  savedSymbols: [],
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

/**
 * Saved Symbols are the trader's own library, kept in this browser — so a test
 * that needs one seeds the same storage the picker reads, rather than inventing
 * a second way in.
 */
const SAVED_SYMBOLS = ['XAUUSD', 'NAS100', 'US30.cash'];

/** Put these in the server library, as if saved on another device. */
function seedSavedSymbols(symbols: readonly string[] = SAVED_SYMBOLS) {
  serverLibrary.symbols = [...symbols];
}

/** The browser store Saved Symbols used to live in, before the server held them. */
const LEGACY_SYMBOL_KEY = `tradingos.trade-plan.symbol.v1.${options.workspaceId}`;

function seedLegacyBrowserSymbols(favorites: readonly string[], recents: readonly string[] = []) {
  window.localStorage.setItem(LEGACY_SYMBOL_KEY, JSON.stringify({ favorites, recents }));
}

function legacyBrowserStore(): { favorites: string[]; recents: string[] } | null {
  const raw = window.localStorage.getItem(LEGACY_SYMBOL_KEY);
  return raw === null ? null : (JSON.parse(raw) as { favorites: string[]; recents: string[] });
}

/** Escapes a symbol for use inside an accessible-name RegExp. */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
        options={{ ...formOptions, savedSymbols: [...serverLibrary.symbols] }}
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
  field: 'Trading Account' | 'Symbol' | 'Direction' | 'Entry date & time',
): ReturnType<typeof within> {
  // Only travel if we are elsewhere: opening a step deliberately focuses its
  // heading, which is not what a trader already on Step 1 would trigger.
  if (currentStep() !== 'trade') goTo('trade');
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  return within(screen.getByRole('dialog'));
}

/** Leave a sheet that commits on the choice itself: cancel, never confirm. */
function cancelConcept() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
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

/** One entry-timestamp sheet, and the two rows inside it. Idempotent. */
function openEntryStamp(): ReturnType<typeof within> {
  const open = screen.queryByRole('dialog');
  return open === null ? openConcept('Entry date & time') : within(open);
}

/** A row inside that sheet, whether its control is open or not. */
function stampRow(half: 'date' | 'time'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-entry-stamp="after-entry-${half}"]`)!;
}

function stampValue(half: 'date' | 'time'): string {
  return stampRow(half).getAttribute('data-value') ?? '';
}

/** Open a half's control, the way a trader taps its row. */
function openStampHalf(half: 'date' | 'time') {
  // The sheet owns both halves, so reaching one means having it open.
  if (screen.queryByRole('dialog') === null) openEntryStamp();
  const toggle = document.getElementById(`after-entry-${half}`)!;
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return toggle;
}

/**
 * Pick a day in the entry-date calendar. The grid is the Dashboard's own, so
 * its cells are addressed the way that picker's tests address them.
 */
function pickEntryDate(date: string) {
  openEntryStamp();
  openStampHalf('date');
  fireEvent.click(screen.getByRole('dialog').querySelector(`[data-range-date="${date}"]`)!);
  closeConcept();
}

/**
 * Set the time on the wheel by tapping the two numbers, which is one of the
 * four ways it moves and the only one jsdom can carry out faithfully — it has
 * no layout, so a scroll there would prove nothing about a real wheel.
 */
function setEntryTime(time: string) {
  openEntryStamp();
  openStampHalf('time');
  pickWheel('hour', time.slice(0, 2));
  pickWheel('minute', time.slice(3, 5));
  closeConcept();
}

function wheelColumn(half: 'hour' | 'minute'): HTMLElement {
  return document.getElementById(`after-enteredTime-${half}`)!;
}

function pickWheel(half: 'hour' | 'minute', value: string) {
  fireEvent.click(within(wheelColumn(half)).getByText(value));
}

/**
 * Record a symbol through the picker. Typing only searches, so the deliberate
 * act is pressing the offer to add what was typed — the same two steps a
 * trader takes for an instrument the list has never seen.
 */
function chooseSymbol(symbol: string) {
  /*
    The two presses a trader makes: add it to the library if it is not there
    yet, then tap its row — which records it and closes the sheet on its own,
    so there is nothing to close afterwards. Typing alone is a search and
    records nothing either way.
  */
  const editor = openConcept('Symbol');
  fireEvent.change(editor.getByLabelText('Symbol'), { target: { value: symbol } });
  const add = editor.queryByRole('button', { name: /^Add/ });
  if (add !== null) fireEvent.click(add);
  fireEvent.click(editor.getByRole('option', { name: new RegExp(`^${escape(symbol)}`, 'i') }));
}

function fillIdentity() {
  chooseSymbol('xauusd');
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
  serverLibrary.symbols = [];
  serverLibrary.failNextImport = false;
  importSavedSymbolsMock.mockReset();
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
    /*
      Step 1 reads back as answers. What the EDITORS still hold after a round
      trip is its own test in "read first, edit on demand" — reopening two
      modals here to assert it a second time only adds four overlay mounts to
      a test about navigation.
    */
    expect(conceptRow('symbol')).toHaveTextContent('XAUUSD');
    expect(conceptValue('symbol')).toBe('xauusd');
    expect(conceptRow('direction')).toHaveTextContent('Long');
    expect(conceptValue('direction')).toBe('long');
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
    expect(conceptValue('enteredAt')).toBe('');
    // Both halves read as unrecorded, and both are open to answer.
    openEntryStamp();
    expect(stampRow('date')).toHaveTextContent('Not recorded');
    expect(stampRow('time')).toHaveTextContent('Not recorded');
    for (const half of ['date', 'time'] as const) {
      expect(document.getElementById(`after-entry-${half}`)).not.toHaveAttribute('aria-disabled');
      expect(document.getElementById(`after-entry-${half}`)).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
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
    expect(trade.querySelector('[data-entry-date-picker]')).toBeNull();
    expect(trade.querySelector('[data-entry-stamp-editor]')).toBeNull();
    // One row owns the whole timestamp; there is no second launcher beside it.
    expect(document.querySelectorAll('[data-concept]')).toHaveLength(4);
    expect(within(trade).queryByLabelText('Trading Account')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('records each concept in its own editor and reads it back on the row', () => {
    renderForm();
    chooseSymbol('xauusd');
    expect(conceptRow('symbol')).toHaveTextContent('XAUUSD');

    const direction = openConcept('Direction');
    fireEvent.click(direction.getByRole('radio', { name: 'Short' }));
    closeConcept();
    expect(conceptRow('direction')).toHaveTextContent('Short');
    expect(conceptValue('direction')).toBe('short');

    // One row holds the whole timestamp and says how much of it is recorded.
    pickEntryDate('2026-09-18');
    expect(conceptValue('enteredAt')).toBe('2026-09-18');
    expect(conceptRow('enteredAt')).toHaveTextContent('Time not recorded');

    setEntryTime('09:30');
    expect(conceptValue('enteredAt')).toBe('2026-09-18T09:30');
    expect(conceptRow('enteredAt')).toHaveTextContent('09:30');
    expect(conceptRow('enteredAt')).not.toHaveTextContent('Time not recorded');
  });

  it('keeps an answer already given when an editor is closed without Done', () => {
    renderForm();
    const direction = openConcept('Direction');
    fireEvent.click(direction.getByRole('radio', { name: 'Short' }));
    // Escape is Close-and-keep, never Discard (UX Rules §5.2, §17.4).
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    return waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(conceptValue('direction')).toBe('short');
    });
  });

  it('returns focus to the row that opened the editor', async () => {
    renderForm();
    openConcept('Direction');
    closeConcept();
    await waitFor(() => expect(conceptRow('direction')).toHaveFocus());
  });

  it('clears the entry time on its own, and the date takes the whole timestamp with it', () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    setEntryTime('09:30');

    // Clearing the time leaves the day the trader recorded standing.
    const sheet = openEntryStamp();
    openStampHalf('time');
    fireEvent.click(sheet.getByRole('button', { name: /^Clear time/ }));
    // Cleared means the wheel stops asserting an answer, not that it shows 00:00.
    expect(wheelColumn('hour')).not.toHaveAttribute('aria-activedescendant');
    expect(document.querySelector('[data-time-wheel-state]')).toHaveAttribute(
      'data-time-wheel-state',
      'unset',
    );
    expect(stampValue('date')).toBe('2026-09-18');
    expect(stampValue('time')).toBe('');
    expect(stampRow('time')).toHaveTextContent('Not recorded');

    // Clearing the date takes the date only: the two halves are independent.
    setEntryTime('09:30');
    const again = openEntryStamp();
    openStampHalf('date');
    fireEvent.click(again.getByRole('button', { name: /^Clear date/ }));
    expect(stampValue('date')).toBe('');
    expect(stampValue('time')).toBe('09:30');
    // Only the footer's own action discards the whole answer.
    fireEvent.click(again.getByRole('button', { name: /^Clear entry date & time/ }));
    expect(stampValue('date')).toBe('');
    expect(stampValue('time')).toBe('');
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

  /*
    TWO MEANINGS, TWO PRESSES. Adding to the saved library and choosing the
    Symbol for this Trade are separate acts, and the tests below are one per
    way the old picker ran them together or let a search leak into the draft.
  */
  it('lists the saved library and filters it as you type', () => {
    seedSavedSymbols();
    renderForm();
    const symbol = openConcept('Symbol');
    expect(symbol.getByText('Saved symbols')).toBeInTheDocument();
    for (const name of SAVED_SYMBOLS) {
      expect(symbol.getByRole('option', { name: new RegExp(`^${escape(name)}`) })).toBeVisible();
    }
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'nas' } });
    expect(symbol.queryByRole('option', { name: /^XAUUSD/ })).toBeNull();
    expect(symbol.getByRole('option', { name: /^NAS100/ })).toBeVisible();
  });

  it('adds a typed symbol to the library without choosing it for the Trade', () => {
    seedSavedSymbols();
    renderForm();
    const symbol = openConcept('Symbol');
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: '  BTCUSD  ' } });
    fireEvent.click(symbol.getByRole('button', { name: /^Add/ }));

    // Saved, trimmed, at the top, and marked as the row that just arrived.
    const options = symbol.getAllByRole('option');
    expect(options[0]).toHaveAttribute('data-symbol-option', 'BTCUSD');
    expect(options[0]).toHaveAttribute('data-symbol-added');
    // The search is back to the plain library, and the Trade is untouched.
    expect(symbol.getByLabelText('Symbol')).toHaveValue('');
    expect(symbol.getByRole('option', { name: /^XAUUSD/ })).toBeVisible();
    expect(conceptValue('symbol')).toBe('');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // And then one tap records it and the sheet closes on its own.
    fireEvent.click(symbol.getByRole('option', { name: /^BTCUSD/ }));
    expect(conceptValue('symbol')).toBe('BTCUSD');
    return waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a duplicate whatever its case, and says so', () => {
    seedSavedSymbols();
    renderForm();
    const symbol = openConcept('Symbol');
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
    expect(symbol.queryByRole('button', { name: /^Add/ })).toBeNull();
    expect(symbol.getByText(/already saved/)).toBeInTheDocument();
    // The spelling already saved is the one kept.
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: '' } });
    expect(symbol.getAllByRole('option')).toHaveLength(SAVED_SYMBOLS.length);
    expect(symbol.getByRole('option', { name: /^XAUUSD/ })).toBeVisible();
  });

  it('keeps a broker’s own spelling exactly, dots and all', () => {
    renderForm();
    const symbol = openConcept('Symbol');
    for (const name of ['US30.cash', 'XAUUSD.m', 'GER40']) {
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: name } });
      fireEvent.click(symbol.getByRole('button', { name: /^Add/ }));
    }
    for (const name of ['US30.cash', 'XAUUSD.m', 'GER40']) {
      expect(symbol.getByRole('option', { name: new RegExp(`^${escape(name)}`) })).toBeVisible();
    }
  });

  it('records the Symbol and closes on one tap of a saved row', async () => {
    seedSavedSymbols();
    renderForm();
    const symbol = openConcept('Symbol');
    // There is nothing to confirm, so there is no Done to confirm it with.
    expect(symbol.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(symbol.getByRole('option', { name: /^US30\.cash/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('symbol')).toBe('US30.cash');
    expect(conceptRow('symbol')).toHaveTextContent('US30.CASH');

    // Reopening marks it, and does not filter the list down to it.
    const again = openConcept('Symbol');
    expect(again.getByLabelText('Symbol')).toHaveValue('');
    expect(again.getByRole('option', { name: /^US30\.cash/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(again.getByRole('option', { name: /^NAS100/ })).toBeVisible();
  });

  it('walks the library with arrows and takes one with Enter', async () => {
    seedSavedSymbols();
    renderForm();
    const symbol = openConcept('Symbol');
    const search = symbol.getByLabelText('Symbol');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('symbol')).toBe('NAS100');
  });

  it('removes a symbol from the library without touching the Trade', () => {
    seedSavedSymbols();
    renderForm();
    chooseSymbol('XAUUSD');
    const symbol = openConcept('Symbol');
    fireEvent.click(symbol.getByRole('button', { name: 'Remove NAS100 from saved symbols' }));
    expect(symbol.queryByRole('option', { name: /^NAS100/ })).toBeNull();
    expect(conceptValue('symbol')).toBe('XAUUSD');
  });

  it('keeps the library across a reopen and a reload', () => {
    renderForm();
    const symbol = openConcept('Symbol');
    fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'BTCUSD' } });
    fireEvent.click(symbol.getByRole('button', { name: /^Add/ }));
    cancelConcept();
    // Reopening the sheet.
    expect(openConcept('Symbol').getByRole('option', { name: /^BTCUSD/ })).toBeVisible();
    cancelConcept();
    // And a reload: the library is this browser's, not the draft's.
    cleanup();
    renderForm();
    expect(openConcept('Symbol').getByRole('option', { name: /^BTCUSD/ })).toBeVisible();
  });

  /*
    THE LIBRARY IS THE SERVER'S. A curated list that vanished with a browser
    or a device would be worse than no list, so these assert where it lives:
    every change reaches the server, a fresh page reads it back from there, and
    this browser's storage no longer holds it.
  */
  describe('Saved Symbols persist on the server', () => {
    it('saves an added symbol to the server, where a fresh page finds it', async () => {
      renderForm();
      const symbol = openConcept('Symbol');
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: ' US30.cash ' } });
      fireEvent.click(symbol.getByRole('button', { name: /^Add/ }));
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['US30.cash']));
      // Not in this browser: the server is the only place it lives.
      expect(legacyBrowserStore()?.favorites ?? []).toEqual([]);

      cleanup();
      renderForm();
      expect(openConcept('Symbol').getByRole('option', { name: /^US30\.cash/ })).toBeVisible();
    });

    it('shows a library saved on another device, newest first', () => {
      seedSavedSymbols(['GER40', 'XAUUSD.m', 'BTCUSD']);
      renderForm();
      const symbol = openConcept('Symbol');
      expect(
        symbol
          .getAllByRole('option')
          .map((option: HTMLElement) => option.getAttribute('data-symbol-option')),
      ).toEqual(['GER40', 'XAUUSD.m', 'BTCUSD']);
    });

    it('puts a new symbol first, and keeps the spelling the server already has', async () => {
      seedSavedSymbols(['BTCUSD']);
      renderForm();
      const symbol = openConcept('Symbol');
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'XAUUSD.m' } });
      fireEvent.click(symbol.getByRole('button', { name: /^Add/ }));
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['XAUUSD.m', 'BTCUSD']));
      // A second spelling of a saved symbol is not a second symbol.
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'btcusd' } });
      expect(symbol.queryByRole('button', { name: /^Add/ })).toBeNull();
      expect(serverLibrary.symbols).toEqual(['XAUUSD.m', 'BTCUSD']);
    });

    it('removes a symbol from the server, and a fresh page agrees', async () => {
      seedSavedSymbols();
      renderForm();
      const symbol = openConcept('Symbol');
      fireEvent.click(symbol.getByRole('button', { name: 'Remove NAS100 from saved symbols' }));
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['XAUUSD', 'US30.cash']));
      cleanup();
      renderForm();
      expect(openConcept('Symbol').queryByRole('option', { name: /^NAS100/ })).toBeNull();
    });

    it('adds without choosing, and a tap still chooses and closes', async () => {
      renderForm();
      const symbol = openConcept('Symbol');
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'GER40' } });
      fireEvent.click(symbol.getByRole('button', { name: /^Add/ }));
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['GER40']));
      expect(conceptValue('symbol')).toBe('');
      fireEvent.click(symbol.getByRole('option', { name: /^GER40/ }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(conceptValue('symbol')).toBe('GER40');
    });
  });

  /*
    THE ONE-TIME MOVE. Saved Symbols used to live in this browser only. A
    trader who built a list before this change must not lose it, must not get
    it twice, and must not have it silently shadow the server's afterwards.
  */
  describe('moving a browser-held library to the server', () => {
    it('merges the browser list in once, without duplicates, then clears it', async () => {
      seedSavedSymbols(['BTCUSD']);
      // Newest first, as the browser stored it, with one the server already has.
      seedLegacyBrowserSymbols(['US30.cash', 'btcusd', 'XAUUSD.m'], ['EURUSD']);
      renderForm();

      await waitFor(() => expect(importSavedSymbolsMock).toHaveBeenCalledTimes(1));
      // Behind what the server held, in the browser's order, BTCUSD once.
      await waitFor(() =>
        expect(serverLibrary.symbols).toEqual(['BTCUSD', 'US30.cash', 'XAUUSD.m']),
      );
      // The browser no longer holds the library — but keeps At Entry's recents.
      await waitFor(() => expect(legacyBrowserStore()?.favorites).toEqual([]));
      expect(legacyBrowserStore()?.recents).toEqual(['EURUSD']);

      const symbol = openConcept('Symbol');
      expect(symbol.getAllByRole('option')).toHaveLength(3);
    });

    it('does not move anything twice', async () => {
      seedLegacyBrowserSymbols(['GER40']);
      renderForm();
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['GER40']));
      cleanup();
      renderForm();
      // Nothing left in the browser, so nothing is sent again.
      expect(importSavedSymbolsMock).toHaveBeenCalledTimes(1);
      expect(serverLibrary.symbols).toEqual(['GER40']);
    });

    it('asks the server for nothing when the browser holds no library', () => {
      seedLegacyBrowserSymbols([], ['EURUSD']);
      renderForm();
      expect(importSavedSymbolsMock).not.toHaveBeenCalled();
    });

    it('keeps the browser’s copy when the move fails, so it tries again next time', async () => {
      serverLibrary.failNextImport = true;
      seedLegacyBrowserSymbols(['GER40']);
      renderForm();
      await waitFor(() => expect(importSavedSymbolsMock).toHaveBeenCalledTimes(1));
      expect(legacyBrowserStore()?.favorites).toEqual(['GER40']);
      expect(serverLibrary.symbols).toEqual([]);

      cleanup();
      renderForm();
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['GER40']));
      await waitFor(() => expect(legacyBrowserStore()?.favorites).toEqual([]));
    });
  });

  describe('the search never becomes the answer', () => {
    it('leaves the recorded Symbol alone while the list is filtered', () => {
      seedSavedSymbols();
      renderForm();
      chooseSymbol('XAUUSD');
      const symbol = openConcept('Symbol');
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'nas' } });
      expect(symbol.queryByRole('option', { name: /^XAUUSD/ })).toBeNull();
      expect(conceptValue('symbol')).toBe('XAUUSD');
    });

    for (const [name, close] of [
      ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })],
      [
        'the close button',
        () =>
          fireEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
          ),
      ],
    ] as const) {
      it(`keeps the previous Symbol when cancelled by ${name} mid-search`, async () => {
        seedSavedSymbols();
        renderForm();
        chooseSymbol('XAUUSD');
        const symbol = openConcept('Symbol');
        fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'eur' } });
        close();
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(conceptValue('symbol')).toBe('XAUUSD');
      });
    }

    it('never lets an unfinished search reach the payload', async () => {
      seedSavedSymbols();
      renderForm();
      chooseSymbol('XAUUSD');
      const direction = openConcept('Direction');
      fireEvent.click(direction.getByRole('radio', { name: 'Long' }));
      closeConcept();

      const symbol = openConcept('Symbol');
      fireEvent.change(symbol.getByLabelText('Symbol'), { target: { value: 'us3' } });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      save();
      await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
      expect(payload()).toMatchObject({ symbol: 'XAUUSD' });
    });

    it('starts a fresh search each time the picker is opened', () => {
      seedSavedSymbols();
      renderForm();
      const first = openConcept('Symbol');
      fireEvent.change(first.getByLabelText('Symbol'), { target: { value: 'nas' } });
      cancelConcept();
      const second = openConcept('Symbol');
      expect(second.getByLabelText('Symbol')).toHaveValue('');
      expect(second.getByRole('option', { name: /^XAUUSD/ })).toBeVisible();
    });
  });

  /*
    THE PICKER SHOWS ONE LIST. A symbol used once is not a symbol the trader
    chose to keep, so saving a Trade no longer puts anything in this sheet —
    the library is built by an explicit Add and nothing else. (The recents
    store itself still exists and still feeds At Entry's quick chips; only this
    picker stopped reading it.)
  */
  it('shows the saved library and nothing else, even after a Trade is saved', async () => {
    seedSavedSymbols(['NAS100']);
    renderForm();
    chooseSymbol('XAUUSD');
    const direction = openConcept('Direction');
    fireEvent.click(direction.getByRole('radio', { name: 'Long' }));
    closeConcept();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());

    cleanup();
    renderForm();
    const symbol = openConcept('Symbol');
    expect(symbol.queryByText('Recent')).toBeNull();
    // XAUUSD is there because it was ADDED, not because it was traded.
    expect(symbol.getAllByRole('option')).toHaveLength(2);
  });
});

describe('Step 1 — entry date and entry time', () => {
  it('sends one instant, composed from the two answers', async () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    setEntryTime('09:30');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    // Asia/Bangkok is UTC+7: the wall clock the trader chose, stored as UTC.
    expect(payload()).toMatchObject({ enteredAt: '2026-09-18T02:30:00.000Z' });
  });

  it('still saves with neither half recorded — both stay optional', async () => {
    renderForm();
    fillIdentity();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ enteredAt: null });
  });

  /*
    A DATE WITH NO TIME IS NEITHER SAVED NOR DISCARDED. A Trade carries one
    `entered_at` instant, so there is nowhere to put a bare date — and
    fabricating midnight or dropping the day the trader chose are both worse
    than asking. Save stops on the TIME row, which is the half that is missing.
  */
  it('stops Save on the time when a date was chosen without one, keeping the date', async () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    save();
    expect(
      await screen.findByText('Add the time to finish this entry, or clear the date.'),
    ).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
    expect(currentStep()).toBe('trade');
    await waitFor(() => expect(conceptRow('enteredAt')).toHaveFocus());
    // The date is still the trader's answer, and the sheet names the half that is missing.
    expect(conceptValue('enteredAt')).toBe('2026-09-18');
    openEntryStamp();
    expect(stampValue('date')).toBe('2026-09-18');
    expect(stampRow('time')).toHaveTextContent('Add the time to finish this entry');
    closeConcept();

    // Either way out works, and both leave a saveable trade.
    setEntryTime('09:30');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
  });

  it('clearing the date is the other way out of that block', async () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    save();
    expect(
      await screen.findByText('Add the time to finish this entry, or clear the date.'),
    ).toBeInTheDocument();

    const sheet = openEntryStamp();
    openStampHalf('date');
    fireEvent.click(sheet.getByRole('button', { name: /^Clear date/ }));
    closeConcept();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ enteredAt: null });
  });

  it('reads back as the date plus what is missing on the review step', () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    goTo('save');
    const review = document.querySelector('[data-trade-summary]')!;
    expect(review).toHaveTextContent('Time not recorded');
    goTo('trade');
    setEntryTime('09:30');
    goTo('save');
    expect(document.querySelector('[data-trade-summary]')).not.toHaveTextContent(
      'Time not recorded',
    );
  });

  it('keeps both halves through Back, Next and a reload', () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    setEntryTime('09:30');
    goTo('plan');
    goTo('trade');
    expect(conceptValue('enteredAt')).toBe('2026-09-18T09:30');

    // A reload recovers the Recording Draft from this browser.
    cleanup();
    renderForm();
    expect(conceptValue('enteredAt')).toBe('2026-09-18T09:30');
    openEntryStamp();
    expect(stampValue('date')).toBe('2026-09-18');
    expect(stampValue('time')).toBe('09:30');
  });

  it('recovers a half-finished timestamp too, and still refuses to guess a time', () => {
    renderForm();
    fillIdentity();
    pickEntryDate('2026-09-18');
    cleanup();
    renderForm();
    expect(conceptValue('enteredAt')).toBe('2026-09-18');
    expect(conceptRow('enteredAt')).toHaveTextContent('Time not recorded');
    openEntryStamp();
    expect(stampValue('time')).toBe('');
    expect(stampRow('time')).toHaveTextContent('Not recorded');
  });

  it('opens with both halves collapsed and answers neither', () => {
    renderForm();
    const sheet = openEntryStamp();
    for (const half of ['date', 'time'] as const) {
      expect(document.getElementById(`after-entry-${half}`)).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      // Collapsed is not merely short: the control is out of the tab order.
      expect(document.getElementById(`after-entry-${half}-panel`)).not.toHaveAttribute('data-open');
    }
    expect(sheet.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog').querySelector('[data-range-date]')).toBeNull();
    expect(conceptValue('enteredAt')).toBe('');

    // And it still opens on neither once a full answer is recorded.
    closeConcept();
    pickEntryDate('2026-09-18');
    setEntryTime('09:30');
    openEntryStamp();
    expect(document.getElementById('after-entry-date')).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('after-entry-time')).toHaveAttribute('aria-expanded', 'false');
  });

  /*
    A TIME REMEMBERED BEFORE ITS DAY. The mirror of the date-only case, and the
    reason neither half is gated behind the other: the answer is kept, it is
    never completed by guesswork, and Save names the half that is missing.
  */
  it('records a time with no date, keeps it through a reload, and blocks Save on the date', async () => {
    renderForm();
    fillIdentity();
    setEntryTime('09:30');
    expect(conceptValue('enteredAt')).toBe('T09:30');
    expect(conceptRow('enteredAt')).toHaveTextContent('09:30');

    cleanup();
    renderForm();
    expect(conceptValue('enteredAt')).toBe('T09:30');
    openEntryStamp();
    expect(stampValue('time')).toBe('09:30');
    expect(stampValue('date')).toBe('');
    closeConcept();

    save();
    expect(
      await screen.findByText('Add the date to finish this entry, or clear the time.'),
    ).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();

    pickEntryDate('2026-09-18');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ enteredAt: '2026-09-18T02:30:00.000Z' });
  });

  it('holds its tongue until the sheet is closed on half an answer', () => {
    renderForm();
    fillIdentity();
    openEntryStamp();
    openStampHalf('date');
    fireEvent.click(screen.getByRole('dialog').querySelector('[data-range-date="2026-09-18"]')!);
    // Mid-answer, with the other row right there, nothing is wrong yet.
    expect(stampRow('time')).not.toHaveTextContent('Add the time');
    closeConcept();
    // Closing on half an answer is when the missing half speaks up.
    expect(
      screen.getByText('Add the time to finish this entry, or clear the date.'),
    ).toBeInTheDocument();
    openEntryStamp();
    expect(stampRow('time')).toHaveTextContent('Add the time to finish this entry');
  });

  it('records nothing until the wheel is touched, then both columns at once', () => {
    renderForm();
    pickEntryDate('2026-09-18');
    openStampHalf('time');
    // Resting, not answering: no option is selected and the row still says so.
    expect(document.querySelector('[data-time-wheel-state]')).toHaveAttribute(
      'data-time-wheel-state',
      'unset',
    );
    expect(wheelColumn('hour')).not.toHaveAttribute('aria-activedescendant');
    expect(stampValue('time')).toBe('');

    // One press answers where the wheel is resting — what is under the band.
    fireEvent.keyDown(wheelColumn('hour'), { key: 'ArrowDown' });
    expect(stampValue('time')).toBe('00:00');
    expect(document.querySelector('[data-time-wheel-state]')).toHaveAttribute(
      'data-time-wheel-state',
      'set',
    );
  });

  it('moves by keyboard, clamping at both ends of each column', () => {
    renderForm();
    pickEntryDate('2026-09-18');
    openStampHalf('time');
    const hour = wheelColumn('hour');
    const minute = wheelColumn('minute');

    fireEvent.keyDown(hour, { key: 'End' });
    expect(stampValue('time')).toBe('23:00');
    fireEvent.keyDown(hour, { key: 'ArrowDown' });
    expect(stampValue('time')).toBe('23:00');

    fireEvent.keyDown(minute, { key: 'End' });
    expect(stampValue('time')).toBe('23:59');
    fireEvent.keyDown(minute, { key: 'PageUp' });
    expect(stampValue('time')).toBe('23:49');
    fireEvent.keyDown(minute, { key: 'Home' });
    expect(stampValue('time')).toBe('23:00');

    fireEvent.keyDown(hour, { key: 'PageDown' });
    expect(stampValue('time')).toBe('23:00');
    fireEvent.keyDown(hour, { key: 'PageUp' });
    expect(stampValue('time')).toBe('17:00');
  });

  it('is two listboxes a screen reader can read, in 24-hour format', () => {
    renderForm();
    pickEntryDate('2026-09-18');
    openStampHalf('time');
    const hour = wheelColumn('hour');
    const minute = wheelColumn('minute');
    expect(hour).toHaveAttribute('role', 'listbox');
    expect(hour).toHaveAttribute('aria-label', 'Hour');
    expect(minute).toHaveAttribute('aria-label', 'Minute');
    // 24 hours and 60 minutes, zero-padded: no AM/PM anywhere.
    expect(within(hour).getAllByRole('option')).toHaveLength(24);
    expect(within(minute).getAllByRole('option')).toHaveLength(60);
    expect(within(hour).getByText('23')).toBeInTheDocument();
    expect(within(hour).queryByText('24')).toBeNull();

    pickWheel('hour', '09');
    pickWheel('minute', '30');
    expect(hour).toHaveAttribute('aria-activedescendant', 'after-enteredTime-hour-09');
    expect(within(hour).getByText('09')).toHaveAttribute('aria-selected', 'true');
    expect(stampValue('time')).toBe('09:30');
  });

  it('opens either half on its own, and only one at a time', () => {
    renderForm();
    openEntryStamp();
    // The time first, with no date anywhere.
    openStampHalf('time');
    expect(document.getElementById('after-entry-time')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog').querySelector('[data-time-wheel]')).not.toBeNull();
    // Opening the other closes this one: never two controls in one sheet.
    openStampHalf('date');
    expect(document.getElementById('after-entry-time')).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('after-entry-date')).toHaveAttribute('aria-expanded', 'true');
    // And a row toggles itself shut again.
    fireEvent.click(document.getElementById('after-entry-date')!);
    expect(document.getElementById('after-entry-date')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Step 1 — Long and Short carry a direction, never only a colour', () => {
  /** The class list a colour-blind or greyscale reader never sees. */
  const classesOf = (element: Element) => element.getAttribute('class') ?? '';

  it('tints a chosen Long green and a chosen Short red, leaving the other neutral', () => {
    renderForm();
    const editor = openConcept('Direction');
    const long = editor.getByRole('radio', { name: 'Long' });
    const short = editor.getByRole('radio', { name: 'Short' });
    const labelFor = (radio: HTMLElement) =>
      document.querySelector(`label[for="${radio.getAttribute('id')}"]`)!;

    // NOTHING IS TINTED BEFORE AN ANSWER: the hue marks the selection, never
    // the mere existence of two directions.
    expect(classesOf(labelFor(long))).not.toContain('positive');
    expect(classesOf(labelFor(short))).not.toContain('negative');

    fireEvent.click(long);
    expect(classesOf(labelFor(long))).toContain('bg-positive/8');
    expect(classesOf(labelFor(long))).toContain('border-positive/45');
    expect(classesOf(labelFor(short))).not.toContain('negative');

    fireEvent.click(short);
    expect(classesOf(labelFor(short))).toContain('bg-negative/8');
    expect(classesOf(labelFor(short))).toContain('border-negative/45');
    // The previous answer gives its tint back with its selection.
    expect(classesOf(labelFor(long))).not.toContain('positive');
  });

  it('never lets colour be the only thing that says which way the trade went', () => {
    renderForm();
    const editor = openConcept('Direction');
    fireEvent.click(editor.getByRole('radio', { name: 'Short' }));
    // In the editor: the word, the radio role, and the checked state.
    expect(editor.getByRole('radio', { name: 'Short' })).toBeChecked();
    expect(editor.getByRole('radio', { name: 'Long' })).not.toBeChecked();
    closeConcept();
    // On the row: the word again, and the stored value behind it.
    expect(conceptRow('direction')).toHaveTextContent('Short');
    expect(conceptValue('direction')).toBe('short');
  });

  it('carries the direction onto the launcher row, and drops it when unanswered', () => {
    renderForm();
    const value = () => conceptRow('direction').querySelector('span.block:not(.flex)')!;
    // Unanswered reads neutral — never a negative, never a tint.
    expect(classesOf(value())).not.toContain('positive');
    expect(classesOf(value())).not.toContain('negative');

    const editor = openConcept('Direction');
    fireEvent.click(editor.getByRole('radio', { name: 'Long' }));
    closeConcept();
    expect(classesOf(value())).toContain('text-positive');

    const again = openConcept('Direction');
    fireEvent.click(again.getByRole('radio', { name: 'Short' }));
    closeConcept();
    expect(classesOf(value())).toContain('text-negative');
    expect(classesOf(value())).not.toContain('text-positive');
  });

  it('sends the direction the trader chose, unchanged by any of this', async () => {
    renderForm();
    chooseSymbol('xauusd');
    const direction = openConcept('Direction');
    fireEvent.click(direction.getByRole('radio', { name: 'Short' }));
    closeConcept();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ symbol: 'XAUUSD', direction: 'short' });
  });
});

describe('Step 1 — proportion and the step action bar', () => {
  it('gives the first step one forward action instead of half a paired row', () => {
    renderForm();
    const bar = document.querySelector('[data-step-actions]')!;
    expect(bar.querySelector('[data-step-actions-layout]')).toHaveAttribute(
      'data-step-actions-layout',
      'single',
    );
    expect(within(bar as HTMLElement).queryByRole('button', { name: 'Back' })).toBeNull();
    const next = within(bar as HTMLElement).getByRole('button', { name: /^Next: Result/ });
    // Full width on a phone, its natural size once the card has room.
    expect(next.getAttribute('class')).toContain('w-full');
    expect(next.getAttribute('class')).toContain('lg:w-auto');
  });

  it('pairs Back and Next again from the second step on', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /^Next: Result/ }));
    const bar = document.querySelector('[data-step-actions]')!;
    expect(bar.querySelector('[data-step-actions-layout]')).toHaveAttribute(
      'data-step-actions-layout',
      'paired',
    );
    expect(within(bar as HTMLElement).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    const next = within(bar as HTMLElement).getByRole('button', { name: /^Next: Plan/ });
    expect(next.getAttribute('class')).not.toContain('w-full');
  });

  it('keeps Quick Save a quiet line above the forward action, never a second button', () => {
    renderForm();
    fillIdentity();
    const bar = document.querySelector('[data-step-actions]') as HTMLElement;
    const quickSave = within(bar).getByRole('button', { name: 'Save closed trade' });
    expect(quickSave).toHaveAttribute('id', 'after-quick-save');
    // Still the inline text action, not a filled button competing with Next.
    expect(quickSave.getAttribute('class')).toContain('text-primary');
    expect(within(bar).getByText('You can add the rest later.')).toBeInTheDocument();
    expect(bar.getAttribute('data-step-actions')).toBe('');
  });

  it('says the mode, the way to change it and the position once each', () => {
    renderForm();
    // One mode statement, one progress statement, one step heading.
    expect(document.querySelectorAll('[data-recording-mode="after_trade"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-step-progress]')).toHaveLength(1);
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-recording-mode-change]')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Trade details');
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
