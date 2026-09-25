import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
type Outcome = 'ok' | 'read_only' | 'throw' | 'hold' | 'hold_then_read_only';
const serverLibrary = vi.hoisted(() => ({
  symbols: [] as string[],
  failNextImport: false,
  /** What the next save/remove calls do, in order. Empty means 'ok'. */
  script: [] as Outcome[],
  /** Held calls, released by the test in whatever order it chooses. */
  held: [] as Array<() => void>,
  calls: 0,
}));

/** Run a write the way the scripted server says to. */
async function scripted<T>(apply: () => T): Promise<T | { ok: false; error: { code: string } }> {
  serverLibrary.calls += 1;
  const outcome = serverLibrary.script.shift() ?? 'ok';
  if (outcome === 'read_only') return { ok: false, error: { code: 'read_only_workspace' } };
  if (outcome === 'throw') throw new Error('network: the request never reached the server');
  if (outcome === 'hold' || outcome === 'hold_then_read_only') {
    await new Promise<void>((resolve) => serverLibrary.held.push(resolve));
  }
  if (outcome === 'hold_then_read_only') {
    return { ok: false, error: { code: 'read_only_workspace' } };
  }
  return apply();
}
const sameSymbol = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const importSavedSymbolsMock = vi.fn();

vi.mock('@/server/actions/saved-symbols', () => ({
  saveSymbolAction: ({ symbol }: { symbol: string }) =>
    scripted(() => {
      const value = symbol.trim();
      if (!serverLibrary.symbols.some((item) => sameSymbol(item, value))) {
        serverLibrary.symbols = [value, ...serverLibrary.symbols];
      }
      return { ok: true, symbols: [...serverLibrary.symbols] };
    }),
  removeSymbolAction: ({ symbol }: { symbol: string }) =>
    scripted(() => {
      serverLibrary.symbols = serverLibrary.symbols.filter((item) => !sameSymbol(item, symbol));
      return { ok: true, symbols: [...serverLibrary.symbols] };
    }),
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
  plan: 'Risk & target',
  setup: 'Strategy & setup',
  context: 'Entry context',
  result: 'Trader result',
  after: 'After trade',
} as const;
/** The Next buttons, in the task's canonical order (decision 55). */
const NEXTS = [
  'Next: Risk & target',
  'Next: Strategy & setup',
  'Next: Entry context',
  'Next: Trader result',
  'Next: After trade',
] as const;

/** Open a step from the step list — the same control a trader taps. */
function goTo(step: keyof typeof STEP_LABEL) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^Step \\d of 6: ${STEP_LABEL[step]}$`) }),
  );
}

/** One step's own section, mounted whether or not it is the step being shown. */
function statusText(): string {
  return document.querySelector('[data-save-status]')?.textContent ?? '';
}

function pnlSource(): string | null {
  return (
    document.querySelector('[data-final-pnl-source]')?.getAttribute('data-final-pnl-source') ?? null
  );
}

function stepSection(step: keyof typeof STEP_LABEL): HTMLElement {
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

/**
 * A single-choice editor: the tap is the commit, and the sheet closes on it —
 * there is no Done to press afterwards.
 */
function chooseDirection(direction: 'Long' | 'Short') {
  const editor = openConcept('Direction');
  fireEvent.click(editor.getByRole('button', { name: direction }));
}

/** Only the multi-part editor — Entry date & time — still has a Done. */
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

/** The Stage 5 final exit time: a launcher row whose sheet holds the day and the minute. */
function finalExitRow(): HTMLElement {
  return document.getElementById('after-exitedAt')!;
}

function finalExitValue(): string {
  return (
    document.querySelector('[data-exit-time="after-exitedAt"]')?.getAttribute('data-value') ?? ''
  );
}

function setFinalExitTime(date: string, time: string) {
  fireEvent.click(finalExitRow());
  const sheet = within(screen.getByRole('dialog'));
  fireEvent.click(document.getElementById('after-exitedAt-date')!);
  fireEvent.click(screen.getByRole('dialog').querySelector(`[data-range-date="${date}"]`)!);
  fireEvent.click(document.getElementById('after-exitedAt-time')!);
  fireEvent.click(
    within(document.getElementById('after-exitedAt-wheel-hour')!).getByText(time.slice(0, 2)),
  );
  fireEvent.click(
    within(document.getElementById('after-exitedAt-wheel-minute')!).getByText(time.slice(3, 5)),
  );
  fireEvent.click(sheet.getByRole('button', { name: 'Done' }));
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
  chooseDirection('Long');
}

/**
 * PLAN & RISK ANSWERS LIVE IN ROW EDITORS (UX Rules §20.4). The row reads the
 * answer back; the editor it opens is where the answer is given.
 */
function planRow(concept: 'risk' | 'target' | 'price'): HTMLElement {
  if (currentStep() !== 'plan') goTo('plan');
  return document.querySelector<HTMLElement>(`[data-plan-row="${concept}"]`)!;
}

function openPlanRow(concept: 'risk' | 'target' | 'price'): HTMLElement {
  fireEvent.click(planRow(concept));
  return screen.getByRole('dialog');
}

/** The Exit Plan's row, and the sheet of states and actions it opens. */
function exitPlanRow(): HTMLElement {
  if (currentStep() !== 'plan') goTo('plan');
  return document.querySelector<HTMLElement>('[data-exit-plan-row]')!;
}

function openExitPlan(): HTMLElement {
  fireEvent.click(exitPlanRow());
  return screen.getByRole('dialog');
}

function closeEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}

/** Answer one Plan & Risk field the way a trader does: open, type, close. */
function typeInPlan(concept: 'risk' | 'target' | 'price', label: string | RegExp, value: string) {
  const editor = openPlanRow(concept);
  // Risk is a decision first (contract decision 54); its amount follows.
  if (concept === 'risk') chooseRisk(editor, 'Defined risk');
  type(label, value, editor);
  closeEditor();
}

/** Take one risk answer the way a trader does: its label, not the sr-only radio. */
function chooseRisk(editor: HTMLElement, answer: 'Defined risk' | 'No defined risk') {
  const radio = within(editor).getByRole('radio', { name: new RegExp(`^${answer}`) });
  fireEvent.click(document.querySelector<HTMLElement>(`label[for="${radio.id}"]`)!);
}

function type(label: string | RegExp, value: string, scope: HTMLElement = document.body) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

/** Save lives on the last step only. */
function save() {
  goTo('after');
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
  const open = screen.queryByRole('dialog');
  if (phase === 'emotions') {
    // Entry Emotion is Entry Context's launcher row, answered in a focused editor.
    if (currentStep() !== 'context') goTo('context');
    if (open === null) {
      fireEvent.click(screen.getByRole('button', { name: 'Edit How you felt as you entered' }));
    }
    return document.querySelector<HTMLElement>('[data-emotions-phase="emotions"]')!;
  }
  // Post-Trade Emotion is Stage 6's: a launcher row on the After-trade step.
  if (open !== null && open.querySelector('[data-emotions-phase="emotions"]') !== null) {
    fireEvent.click(within(open).getByRole('button', { name: 'Done' }));
  }
  if (currentStep() !== 'after') goTo('after');
  if (screen.queryByRole('dialog') === null) {
    fireEvent.click(screen.getByRole('button', { name: 'Edit post-trade emotion' }));
  }
  return document.querySelector<HTMLElement>(`[data-emotions-phase="${phase}"]`)!;
}

beforeEach(() => {
  serverLibrary.symbols = [];
  serverLibrary.failNextImport = false;
  serverLibrary.script = [];
  serverLibrary.held = [];
  serverLibrary.calls = 0;
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
  it('counts the Trade’s missing required fields, never a share of a step', () => {
    renderForm();
    goTo('after');
    expect(statusText()).toMatch(/^[0-9]+ required fields? still missing$/);
    expect(statusText()).not.toMatch(/ of [0-9]/);
  });

  it('asks one topic at a time, in reading order, with no Money/Price result basis', () => {
    renderForm();
    const seen: string[] = [];
    for (const next of NEXTS) {
      seen.push(screen.getByRole('heading', { level: 2 }).textContent ?? '');
      fireEvent.click(screen.getByRole('button', { name: next }));
    }
    seen.push(screen.getByRole('heading', { level: 2 }).textContent ?? '');
    // The same four stages Record Open asks, in the same order, then the result
    // and what came after it (decision 55).
    expect(seen).toEqual([
      'Trade details',
      'Risk and target',
      'Strategy and setup',
      'Entry context',
      'Trader result',
      'After trade',
    ]);
    expect(screen.getByText('Step 6 of 6')).toBeInTheDocument();
    expect(screen.queryByText(/price levels instead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/amount instead/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Price' })).not.toBeInTheDocument();
  });

  it('offers Save only on the last step, and advances past unanswered optional steps', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Save closed trade' })).not.toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    for (const next of NEXTS) {
      fireEvent.click(screen.getByRole('button', { name: next }));
    }
    expect(currentStep()).toBe('after');
    expect(screen.getByRole('button', { name: 'Save closed trade' })).toBeInTheDocument();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('keeps every answer through Back and Next', () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: 'Next: Risk & target' }));
    typeInPlan('risk', 'Risk at entry', '60');
    goTo('result');
    type('Final net P&L', '120');
    fireEvent.click(screen.getByRole('radio', { name: 'Win' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(currentStep()).toBe('context');
    goTo('plan');
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
    // What the trader did is Trader R; System R belongs to After Trade.
    expect(document.querySelector('[data-result-panel]')).toHaveTextContent('Trader R');
    expect(document.querySelector('[data-result-panel]')).not.toHaveTextContent('Actual R');
    goTo('after');
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

  it('starts every answer Unanswered: no time, no outcome, no Target', () => {
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
    // Unanswered, and never "now": the shortcut is offered, not applied.
    expect(finalExitValue()).toBe('');
    expect(finalExitRow()).toHaveTextContent('Not recorded');
    expect(screen.getByRole('button', { name: 'Use now for Final exit time' })).toBeInTheDocument();
    for (const name of ['Win', 'BE', 'Loss']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    goTo('plan');
    // The rows say nothing was answered before anything is opened.
    expect(planRow('risk')).toHaveTextContent('Not answered');
    expect(planRow('target')).toHaveTextContent('Not answered');
    const targetEditor = within(openPlanRow('target'));
    expect(targetEditor.getByRole('radio', { name: /^Fixed target/ })).not.toBeChecked();
    expect(targetEditor.getByRole('radio', { name: /^No fixed target/ })).not.toBeChecked();
    closeEditor();
  });

  it('reads the final exit time on Result and the thesis on Context, saving both unchanged', async () => {
    renderForm();
    fillIdentity();
    // Each field is on the step that asks its question...
    expect(stepSection('trade').querySelector('#after-exitedAt')).toBeNull();
    expect(stepSection('result').querySelector('#after-exitedAt')).not.toBeNull();
    expect(within(stepSection('after')).queryByLabelText('Why this trade')).toBeNull();
    expect(within(stepSection('context')).getByLabelText('Why this trade')).toBeInTheDocument();

    // ...and each is sent exactly as it was before the move.
    goTo('result');
    setFinalExitTime('2026-09-18', '14:05');
    expect(finalExitValue()).toBe('2026-09-18T14:05');
    goTo('context');
    type('Why this trade', 'Clean retest of the London high.');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      exitedAt: '2026-09-18T07:05:00.000Z',
      confirmationNotes: 'Clean retest of the London high.',
    });
  });

  it('asks timeframe and session with the entry context, not on the After-trade step', async () => {
    renderForm();
    fillIdentity();
    goTo('context');
    type('Timeframe', '15m');
    type('Session', 'London');
    // Entry-time context lives in Entry Context; Save holds no context fields.
    const context = stepSection('context');
    expect(within(context).getByLabelText('Timeframe')).toHaveValue('15m');
    expect(within(stepSection('after')).queryByLabelText('Timeframe')).toBeNull();
    expect(within(stepSection('after')).queryByLabelText('Entry notes')).toBeNull();
    expect(within(stepSection('after')).queryByLabelText('Chart link')).toBeNull();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ timeframe: '15m', session: 'London' });
  });

  it('calls an untouched optional step Optional, never unfinished', () => {
    renderForm();
    fillIdentity();
    goTo('after');
    const review = document.querySelector('[data-trade-summary]')!;
    expect(review).toHaveTextContent(/XAUUSD · Long/);
    // Every later step is untouched — and that is a complete answer.
    expect(within(review as HTMLElement).getAllByText('Optional')).toHaveLength(4);
    // Read back in the task's own canonical order (decision 55).
    expect(Array.from(review.querySelectorAll('dt'), (term) => term.textContent)).toEqual([
      'Trade',
      'Risk & target',
      'Strategy & setup',
      'Entry context',
      'Trader result',
    ]);
    expect(review).not.toHaveTextContent('needs attention');
  });

  it('says on the step itself how much needs attention, beside the field error', async () => {
    renderForm();
    fillIdentity();
    typeInPlan('risk', 'Risk at entry', '12..5');
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
    const row = exitPlanRow();
    expect(row).toHaveTextContent('Not recorded');
    expect(row).toHaveAttribute('data-exit-plan-row', 'not_recorded');
    // Nothing opens until it is asked for.
    expect(screen.queryByRole('dialog')).toBeNull();
    const editor = within(openExitPlan());
    expect(editor.getByRole('button', { name: 'Choose exit plan' })).toBeInTheDocument();
  });

  it('asks price levels once, folded on the Plan step, never again on Save', () => {
    renderForm();
    // Plan & Risk holds them; the last step's details no longer do. Every
    // step stays mounted, so the hidden one is searched as hidden.
    goTo('plan');
    expect(within(stepSection('plan')).getByRole('button', { name: /^Edit Price levels/ })).toBe(
      document.getElementById('after-price-row'),
    );
    expect(
      within(stepSection('after')).queryByRole('button', {
        name: /^Edit Price levels/,
        hidden: true,
      }),
    ).toBeNull();
    // The inputs exist once, inside the one editor that row opens.
    expect(document.querySelectorAll('#after-contextEntryPrice')).toHaveLength(0);
    openPlanRow('price');
    expect(document.querySelectorAll('#after-contextEntryPrice')).toHaveLength(1);
  });

  it('never folds the price levels over an error a blocked Save has to reach', async () => {
    renderForm();
    fillIdentity();
    typeInPlan('price', 'Entry price', '2398.5');
    // Answered and closed, the row simply reads its values back.
    expect(planRow('price')).toHaveTextContent('Entry price 2398.5');
    expect(planRow('price')).not.toHaveAttribute('data-invalid');

    typeInPlan('price', 'Entry price', '12..5');
    // This one carries its error on the closed row: it has to stay reachable.
    expect(planRow('price')).toHaveAttribute('data-invalid', 'true');
    // Save from elsewhere: the blocked Save brings the trader back to Plan.
    goTo('after');
    save();
    expect(
      await screen.findByText(
        'Enter a price greater than zero, using digits and one decimal point.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(currentStep()).toBe('plan'));
    // The row is the control that exists to focus, and it opens the input.
    await waitFor(() => expect(planRow('price')).toHaveFocus());
    expect(within(openPlanRow('price')).getByLabelText('Entry price')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    closeEditor();
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
    expect(within(trade).queryByRole('button', { name: 'Long' })).toBeNull();
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

    chooseDirection('Short');
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

  it('leaves an answer already given alone when an editor is dismissed', async () => {
    renderForm();
    chooseDirection('Short');
    // Escape and X only leave: they neither take the answer back nor invent one.
    openConcept('Direction');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('direction')).toBe('short');
    openConcept('Direction');
    cancelConcept();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('direction')).toBe('short');
  });

  it('returns focus to the row that opened the editor, however it closes', async () => {
    renderForm();
    openConcept('Direction');
    cancelConcept();
    await waitFor(() => expect(conceptRow('direction')).toHaveFocus());
    chooseDirection('Long');
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
    typeInPlan('risk', 'Risk at entry', '100');
    // Open and close a Step 1 editor from Step 1 — nothing else moves.
    const account = openConcept('Trading Account');
    expect(account.getByRole('button', { name: 'Main USD · USD' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    cancelConcept();
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
    OPTIMISTIC, BUT NEVER FALSELY SUCCESSFUL. The picker shows a change at once
    and writes it in the background. Each test here is a way the write can not
    land — refused, lost on the network, overtaken by the next one, or cut off
    by a reload — and each asserts the picker ends up showing what the server
    actually holds rather than what it hoped for.
  */
  describe('when a Saved Symbol write does not land', () => {
    const shown = () =>
      screen
        .queryAllByRole('option')
        .map((option: HTMLElement) => option.getAttribute('data-symbol-option'));

    /*
      Let a released server answer be fully processed — promise continuation
      and React state — before asserting. Polling with `waitFor` is wrong for
      these: the state under test often already holds BEFORE the answer lands,
      so a poll passes on the first try and the answer arrives afterwards to a
      test that has already finished. That is how the adverse-ordering case
      below first passed on code that was broken.
    */
    async function release() {
      await act(async () => {
        serverLibrary.held.shift()!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    function add(symbol: string) {
      const search = within(screen.getByRole('dialog')).getByLabelText('Symbol');
      fireEvent.change(search, { target: { value: symbol } });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Add/ }));
    }

    it('takes an add back when the workspace refuses it (read-only)', async () => {
      seedSavedSymbols(['GER40']);
      renderForm();
      openConcept('Symbol');
      serverLibrary.script = ['read_only'];
      add('BTCUSD');
      await waitFor(() => expect(shown()).toEqual(['GER40']));
      expect(serverLibrary.symbols).toEqual(['GER40']);
    });

    it('takes an add back when the request never reaches the server', async () => {
      seedSavedSymbols(['GER40']);
      renderForm();
      openConcept('Symbol');
      serverLibrary.script = ['throw'];
      add('BTCUSD');
      await waitFor(() => expect(shown()).toEqual(['GER40']));
    });

    it('puts a removed symbol back, in its place, when the removal is refused', async () => {
      seedSavedSymbols(['GER40', 'NAS100', 'US30.cash']);
      renderForm();
      const picker = openConcept('Symbol');
      serverLibrary.script = ['read_only'];
      fireEvent.click(picker.getByRole('button', { name: 'Remove NAS100 from saved symbols' }));
      await waitFor(() => expect(shown()).toEqual(['GER40', 'NAS100', 'US30.cash']));
    });

    it('puts a removed symbol back when the removal never reaches the server', async () => {
      seedSavedSymbols(['GER40', 'NAS100']);
      renderForm();
      const picker = openConcept('Symbol');
      serverLibrary.script = ['throw'];
      fireEvent.click(picker.getByRole('button', { name: 'Remove NAS100 from saved symbols' }));
      await waitFor(() => expect(shown()).toEqual(['GER40', 'NAS100']));
    });

    /*
      Two writes in flight. The first answer to arrive describes the library
      BEFORE the second write, so adopting it wholesale would erase the second
      one from the screen while its request is still on its way.
    */
    it('never lets an earlier answer erase a later change still in flight', async () => {
      renderForm();
      openConcept('Symbol');
      serverLibrary.script = ['hold', 'hold'];
      add('GER40');
      add('BTCUSD');
      expect(shown()).toEqual(['BTCUSD', 'GER40']);
      await waitFor(() => expect(serverLibrary.held).toHaveLength(2));

      await release();
      // The server has answered the first; the second is still pending.
      expect(serverLibrary.symbols).toEqual(['GER40']);
      expect(shown()).toEqual(['BTCUSD', 'GER40']);

      await release();
      expect(serverLibrary.symbols).toEqual(['BTCUSD', 'GER40']);
      expect(shown()).toEqual(['BTCUSD', 'GER40']);
    });

    it('rolls back only the write that failed, not one beside it', async () => {
      renderForm();
      openConcept('Symbol');
      serverLibrary.script = ['hold', 'read_only'];
      add('GER40');
      add('BTCUSD'); // refused at once, while GER40 is still in flight
      await waitFor(() => expect(shown()).toEqual(['GER40']));
      await release();
      expect(serverLibrary.symbols).toEqual(['GER40']);
      expect(shown()).toEqual(['GER40']);
    });

    it('never erases a saved symbol when an EARLIER write fails after it', async () => {
      renderForm();
      openConcept('Symbol');
      serverLibrary.script = ['hold_then_read_only', 'ok'];
      add('GER40'); // will be refused, but only after…
      add('BTCUSD'); // …this one has landed
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['BTCUSD']));
      await release();
      // GER40 goes; BTCUSD, which the server holds, must stay.
      expect(shown()).toEqual(['BTCUSD']);
    });

    it('shows only what the server holds after a reload that cut a save off', async () => {
      renderForm();
      openConcept('Symbol');
      serverLibrary.script = ['hold'];
      add('GER40');
      expect(shown()).toEqual(['GER40']);
      // The page goes away before the server answers.
      cleanup();
      renderForm();
      openConcept('Symbol');
      expect(shown()).toEqual([]);
      // And if the write does land late, the next page shows it — once.
      await release();
      expect(serverLibrary.symbols).toEqual(['GER40']);
      cleanup();
      renderForm();
      openConcept('Symbol');
      expect(shown()).toEqual(['GER40']);
    });

    it('sends one request per press, and a second press of the same add is not a second row', async () => {
      renderForm();
      openConcept('Symbol');
      add('GER40');
      await waitFor(() => expect(serverLibrary.symbols).toEqual(['GER40']));
      expect(serverLibrary.calls).toBe(1);
      // The same symbol again is refused before any request is made.
      const search = within(screen.getByRole('dialog')).getByLabelText('Symbol');
      fireEvent.change(search, { target: { value: 'ger40' } });
      expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /^Add/ })).toBeNull();
      expect(serverLibrary.calls).toBe(1);
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
      chooseDirection('Long');

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
    chooseDirection('Long');
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
    goTo('after');
    const review = document.querySelector('[data-trade-summary]')!;
    expect(review).toHaveTextContent('Time not recorded');
    goTo('trade');
    setEntryTime('09:30');
    goTo('after');
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
    const button = (name: 'Long' | 'Short') =>
      within(screen.getByRole('dialog')).getByRole('button', { name });

    // NOTHING IS TINTED BEFORE AN ANSWER: the hue marks the selection, never
    // the mere existence of two directions.
    openConcept('Direction');
    expect(classesOf(button('Long'))).not.toContain('positive');
    expect(classesOf(button('Short'))).not.toContain('negative');
    cancelConcept();

    chooseDirection('Long');
    openConcept('Direction');
    expect(classesOf(button('Long'))).toContain('bg-positive/8');
    expect(classesOf(button('Long'))).toContain('border-positive/45');
    expect(classesOf(button('Short'))).not.toContain('negative');
    cancelConcept();

    chooseDirection('Short');
    openConcept('Direction');
    expect(classesOf(button('Short'))).toContain('bg-negative/8');
    expect(classesOf(button('Short'))).toContain('border-negative/45');
    // The previous answer gives its tint back with its selection.
    expect(classesOf(button('Long'))).not.toContain('positive');
  });

  it('never lets colour be the only thing that says which way the trade went', () => {
    renderForm();
    chooseDirection('Short');
    const editor = openConcept('Direction');
    // In the editor: the word, the pressed state, and a check beside it.
    expect(editor.getByRole('button', { name: 'Short' })).toHaveAttribute('aria-pressed', 'true');
    expect(editor.getByRole('button', { name: 'Long' })).toHaveAttribute('aria-pressed', 'false');
    const check = (name: string) => editor.getByRole('button', { name }).querySelector('svg')!;
    expect(classesOf(check('Short'))).toContain('opacity-100');
    expect(classesOf(check('Long'))).toContain('opacity-0');
    cancelConcept();
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

    chooseDirection('Long');
    expect(classesOf(value())).toContain('text-positive');

    chooseDirection('Short');
    expect(classesOf(value())).toContain('text-negative');
    expect(classesOf(value())).not.toContain('text-positive');
  });

  it('sends the direction the trader chose, unchanged by any of this', async () => {
    renderForm();
    chooseSymbol('xauusd');
    chooseDirection('Short');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ symbol: 'XAUUSD', direction: 'short' });
  });
});

/*
  ONE RULE FOR STEP 1's EDITORS. A single-choice editor commits on the choice
  and closes; only the multi-part Entry date & time keeps a Done. Dismissing
  any of them — X, Escape — changes nothing.
*/
/*
  EACH LAUNCHER ROW HAS AN ANCHOR. Neutral until answered; then the accent, or
  for Direction the tone the value already carries — and a glyph that changes
  shape, so the icon never relies on colour. Decorative to assistive tech.
*/
describe('Step 1 — launcher row icons', () => {
  const icon = (concept: string) =>
    conceptRow(concept).querySelector<HTMLElement>('[data-concept-icon]')!;
  const glyph = (concept: string) => icon(concept).querySelector('svg')!.getAttribute('class');

  it('gives every row a hidden icon, neutral before anything is answered', () => {
    renderForm({ ...options, tradingAccounts: [...options.tradingAccounts, secondAccountFor()] });
    for (const concept of ['tradingAccountId', 'symbol', 'direction', 'enteredAt']) {
      expect(icon(concept)).toHaveAttribute('aria-hidden', 'true');
      expect(icon(concept)).toHaveAttribute('data-concept-icon', 'neutral');
    }
    expect(glyph('tradingAccountId')).toContain('lucide-wallet');
    expect(glyph('symbol')).toContain('lucide-chart-candlestick');
    expect(glyph('direction')).toContain('lucide-arrow-up-down');
    expect(glyph('enteredAt')).toContain('lucide-calendar-clock');
    // The row's accessible name is unchanged by it.
    expect(screen.getByRole('button', { name: 'Edit Symbol' })).toBe(conceptRow('symbol'));
  });

  it('takes the accent once Account and Symbol are answered', () => {
    renderForm();
    // One account is already the answer.
    expect(icon('tradingAccountId')).toHaveAttribute('data-concept-icon', 'accent');
    chooseSymbol('xauusd');
    expect(icon('symbol')).toHaveAttribute('data-concept-icon', 'accent');
  });

  it('turns the Direction glyph with the answer, not only its colour', () => {
    renderForm();
    chooseDirection('Long');
    expect(icon('direction')).toHaveAttribute('data-concept-icon', 'positive');
    expect(glyph('direction')).toContain('lucide-trending-up');
    chooseDirection('Short');
    expect(icon('direction')).toHaveAttribute('data-concept-icon', 'negative');
    expect(glyph('direction')).toContain('lucide-trending-down');
  });

  it('keeps the Entry anchor neutral until both the date and the time are there', () => {
    renderForm();
    pickEntryDate('2026-09-18');
    expect(icon('enteredAt')).toHaveAttribute('data-concept-icon', 'neutral');
    setEntryTime('09:30');
    expect(icon('enteredAt')).toHaveAttribute('data-concept-icon', 'accent');
  });
});

function secondAccountFor() {
  return {
    tradingAccountId: '018f0000-0000-7000-8000-000000000003',
    name: 'Second',
    accountMode: 'live',
    baseCurrency: 'EUR',
  } as const;
}

describe('Step 1 — a single choice commits and closes', () => {
  const secondAccount = {
    tradingAccountId: '018f0000-0000-7000-8000-000000000002',
    name: 'Test',
    accountMode: 'live',
    baseCurrency: 'THB',
  } as const;
  const twoAccounts: TradeCreateOptions = {
    ...options,
    tradingAccounts: [...options.tradingAccounts, secondAccount],
  };

  it('lists every account as its own answer, the current one selected, with no Done', () => {
    // One account is the answer already; with two, none is chosen until tapped.
    renderForm(twoAccounts);
    expect(conceptValue('tradingAccountId')).toBe('');
    fireEvent.click(openConcept('Trading Account').getByRole('button', { name: 'Main USD · USD' }));
    const editor = openConcept('Trading Account');
    // No dropdown inside the sheet: the accounts are the answers.
    expect(editor.queryByRole('combobox')).toBeNull();
    expect(editor.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(editor.getByRole('button', { name: 'Main USD · USD' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(editor.getByRole('button', { name: 'Test · THB' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('records the account tapped, closes, and says so on the row', async () => {
    renderForm(twoAccounts);
    const editor = openConcept('Trading Account');
    fireEvent.click(editor.getByRole('button', { name: 'Test · THB' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('tradingAccountId')).toBe(secondAccount.tradingAccountId);
    expect(conceptRow('tradingAccountId')).toHaveTextContent('Test · THB');
    await waitFor(() => expect(conceptRow('tradingAccountId')).toHaveFocus());
    // And reopening shows it as the current one.
    expect(
      openConcept('Trading Account').getByRole('button', { name: 'Test · THB' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the account when the sheet is only dismissed', async () => {
    renderForm();
    openConcept('Trading Account');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    openConcept('Trading Account');
    cancelConcept();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('tradingAccountId')).toBe(options.tradingAccounts[0]!.tradingAccountId);
  });

  it('sends the account the trader tapped', async () => {
    renderForm(twoAccounts);
    fireEvent.click(openConcept('Trading Account').getByRole('button', { name: 'Test · THB' }));
    fillIdentity();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ tradingAccountId: secondAccount.tradingAccountId });
  });

  it('records Long or Short on the tap, closes, and has no Done', async () => {
    renderForm();
    const editor = openConcept('Direction');
    expect(editor.queryByRole('button', { name: 'Done' })).toBeNull();
    // Buttons, not radios: arrowing between them must never commit an answer.
    expect(editor.queryByRole('radio')).toBeNull();
    fireEvent.click(editor.getByRole('button', { name: 'Long' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(conceptValue('direction')).toBe('long');
    await waitFor(() => expect(conceptRow('direction')).toHaveFocus());
  });

  it('keeps Done only on the multi-part Entry date & time editor', () => {
    renderForm();
    const stamp = openConcept('Entry date & time');
    expect(stamp.getByRole('button', { name: 'Done' })).toBeInTheDocument();
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
    const next = within(bar as HTMLElement).getByRole('button', { name: /^Next: Risk & target/ });
    // Full width on a phone, its natural size once the card has room.
    expect(next.getAttribute('class')).toContain('w-full');
    expect(next.getAttribute('class')).toContain('lg:w-auto');
  });

  it('pairs Back and Next again from the second step on', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /^Next: Risk & target/ }));
    const bar = document.querySelector('[data-step-actions]')!;
    expect(bar.querySelector('[data-step-actions-layout]')).toHaveAttribute(
      'data-step-actions-layout',
      'paired',
    );
    expect(within(bar as HTMLElement).getByRole('button', { name: 'Back' })).toBeInTheDocument();
    const next = within(bar as HTMLElement).getByRole('button', {
      name: /^Next: Strategy & setup/,
    });
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
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
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
    typeInPlan('risk', 'Risk at entry', '100');
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
    typeInPlan('risk', 'Risk at entry', '12..5');
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
    goTo('after');
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

  it('shows Trader R only from Final Net P&L and Risk at Entry, and says why otherwise', () => {
    renderForm();
    goTo('result');
    expect(
      screen.getByText('Trader R needs your final net P&L and risk at entry.'),
    ).toBeInTheDocument();
    type('Final net P&L', '100');
    expect(screen.getByText('Trader R needs your risk at entry.')).toBeInTheDocument();
    expect(screen.queryByText('0.00R')).not.toBeInTheDocument();
    typeInPlan('risk', 'Risk at entry', '50');
    goTo('result');
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
  });
});

/*
  ACTUAL RISK IS RETIRED FROM CAPTURE (contract decision 56). Record Closed's
  Entry context asks no risk figure, and a Save sends none: the Step 2 Risk is
  the Trade's one 1R.
*/
describe('Record Closed — no Actual Risk', () => {
  it('asks no Actual Risk in Entry context, and a Save sends none', async () => {
    renderForm();
    fillIdentity();
    typeInPlan('risk', 'Risk at entry', '50');
    goTo('context');
    const step = document.querySelector<HTMLElement>('[data-entry-context-step]')!;
    expect(step).not.toHaveTextContent(/actual risk|actually risked/i);
    expect(document.getElementById('after-actual-risk-row')).toBeNull();
    expect(step.querySelector('[data-actual-risk-summary]')).toBeNull();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ plannedRiskState: 'defined', plannedRiskMinor: '5000' });
    expect(payload()).not.toHaveProperty('actualRiskAnswer');
    expect(payload()).not.toHaveProperty('actualInitialRiskMinor');
  });
});

describe('Step 6 — System Result (decision 55)', () => {
  /** Defined Risk 50 and a Fixed Target of 100: the bounded plan. */
  function boundedPlan() {
    typeInPlan('risk', 'Risk at entry', '50');
    const target = openPlanRow('target');
    fireEvent.click(within(target).getByRole('radio', { name: /^Fixed target/ }));
    type('Target profit', '100', target);
    closeEditor();
  }

  function systemResult(): HTMLElement {
    if (currentStep() !== 'after') goTo('after');
    return document.querySelector<HTMLElement>('[data-plan-outcome]')!;
  }

  it('asks what happened first, shows what each answer comes to, and sends only the answer', async () => {
    renderForm();
    fillIdentity();
    boundedPlan();
    const section = systemResult();
    expect(section).toHaveAttribute('data-plan-outcome', 'bounded');
    // System Result comes before the after-trade context fields.
    const emotionRow = document.querySelector('[data-post-trade-emotions]')!;
    expect(section.compareDocumentPosition(emotionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The plan's own figures are shown on the answers — nothing to type.
    const target = within(section).getByRole('radio', { name: /^Planned target/ });
    const risk = within(section).getByRole('radio', { name: /^Planned risk limit/ });
    // No canonical Stop field exists, so the answer never names one.
    expect(section).not.toHaveTextContent(/stop/i);
    // Nothing is saved yet in Record Closed: Stage 6 says the Save carries it.
    const intro = document.querySelector('[data-after-trade-context-step]')!;
    expect(intro).toHaveTextContent(
      'Anything you add here is saved with the closed trade when you press Save.',
    );
    expect(intro).not.toHaveTextContent(/already saved/);
    expect(target.closest('div')!.parentElement).toHaveTextContent('+2.00R');
    expect(risk.closest('div')!.parentElement).toHaveTextContent('-1.00R');
    expect(within(section).queryByRole('textbox')).toBeNull();
    // Unanswered until chosen: nothing selected, nothing derived.
    expect(target).not.toBeChecked();
    expect(section.querySelector('[data-plan-outcome-result]')).toBeNull();

    fireEvent.click(risk);
    expect(section.querySelector('[data-plan-outcome-result]')).toHaveTextContent('-1.00R');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ planOutcome: 'planned_risk_first' });
    expect(payload()).not.toHaveProperty('planOutcomeMinor');
  });

  it('sends nothing while Unanswered, and asks nothing of a No Defined Risk trade', async () => {
    renderForm();
    fillIdentity();
    chooseRisk(openPlanRow('risk'), 'No defined risk');
    closeEditor();
    const section = systemResult();
    expect(section).toHaveAttribute('data-plan-outcome', 'no_defined_risk');
    expect(section).toHaveTextContent(
      "R comparison isn't available because no risk was defined as 1R for this trade.",
    );
    expect(within(section).queryByRole('radio')).toBeNull();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).not.toHaveProperty('planOutcome');
  });

  it('asks a rule-based Exit Plan for its result, and derives R from it', async () => {
    renderForm(withStrategy);
    fillIdentity();
    typeInPlan('risk', 'Risk at entry', '50');
    const target = openPlanRow('target');
    fireEvent.click(within(target).getByRole('radio', { name: /^No fixed target/ }));
    closeEditor();
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Choose exit plan' }));
    fireEvent.click(screen.getByRole('radio', { name: /Trail structure/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    closeEditor();

    const section = systemResult();
    expect(section).toHaveAttribute('data-plan-outcome', 'exit_plan');
    // The plan is shown read-only, so the trader answers against it.
    expect(section.querySelector('[data-plan-outcome-exit-plan]')).toHaveTextContent(
      'Trail structure',
    );
    fireEvent.click(within(section).getByRole('radio', { name: 'State the result' }));

    // Blank is not an answer: Save stops on the amount and says why.
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    expect(
      await screen.findByText("Enter the result, or choose Can't determine."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.getElementById('after-stage6-plan-outcome-amount')).toHaveFocus(),
    );
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();

    type('Result under the plan', '300', section);
    expect(section.querySelector('[data-plan-outcome-result]')).toHaveTextContent('+6.00R');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      planOutcome: 'exit_plan_result',
      planOutcomeMinor: '30000',
    });
  });

  it('keeps Can’t determine as an answer, distinct from Unanswered', async () => {
    renderForm();
    fillIdentity();
    boundedPlan();
    fireEvent.click(within(systemResult()).getByRole('radio', { name: "Can't determine" }));
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ planOutcome: 'cannot_determine' });
  });

  it('never drops an answer the plan no longer offers: it waits for the trader', async () => {
    renderForm();
    fillIdentity();
    boundedPlan();
    fireEvent.click(within(systemResult()).getByRole('radio', { name: /^Planned target/ }));
    // The plan changes after the answer: no fixed target now, and no Exit Plan.
    const target = openPlanRow('target');
    fireEvent.click(within(target).getByRole('radio', { name: /^No fixed target/ }));
    closeEditor();
    const section = systemResult();
    expect(section).toHaveAttribute('data-plan-outcome', 'unavailable');
    expect(section.querySelector('[data-plan-outcome-stale]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(currentStep()).toBe('after'));
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();

    // Removing the answer is the trader's choice, and then Save goes ahead.
    fireEvent.click(within(section).getByRole('button', { name: 'Remove system result answer' }));
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).not.toHaveProperty('planOutcome');
  });
});

describe('Target', () => {
  it('blocks an explicitly Fixed Target with neither Target Profit nor TP price', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(within(openPlanRow('target')).getByRole('radio', { name: /^Fixed target/ }));
    closeEditor();
    save();
    expect(
      await screen.findByText('Add a target profit or a TP price, or choose No fixed target.'),
    ).toBeInTheDocument();
    expect(currentStep()).toBe('plan');
    expect(planRow('target')).toHaveAttribute('data-invalid', 'true');
    expect(
      within(openPlanRow('target')).getByRole('radio', { name: /^Fixed target/ }),
    ).toBeChecked();
    closeEditor();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('sends a TP price alone as a Fixed Target, and No Fixed Target as its own answer', async () => {
    renderForm();
    fillIdentity();
    const target = openPlanRow('target');
    fireEvent.click(within(target).getByRole('radio', { name: /^Fixed target/ }));
    type('TP price', '2410.5', target);
    closeEditor();
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      targetState: 'fixed',
      targetPrice: '2410.5',
      plannedRewardMinor: null,
    });
  });
});

/**
 * Step 3's Strategy and Setup are launcher rows: the row opens one editor,
 * and choosing in it is the answer. Reached the way a trader reaches it.
 */
function chooseClassification(field: 'Strategy' | 'Setup', choice: string) {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: choice }));
}

describe('Exit Plan and Strategy', () => {
  it('never inherits the Strategy default, and records a chosen plan as selected', async () => {
    renderForm(withStrategy);
    fillIdentity();
    goTo('setup');
    chooseClassification('Strategy', 'Golden Breakout');
    expect(screen.queryByText(/From Strategy/)).not.toBeInTheDocument();
    expect(exitPlanRow()).toHaveAttribute('data-exit-plan-row', 'not_recorded');
    openExitPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Choose exit plan' }));
    fireEvent.click(screen.getByRole('radio', { name: /Trail structure/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // Done returns to the Exit Plan sheet; leaving it is another press.
    closeEditor();
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
    goTo('setup');
    chooseClassification('Strategy', 'No strategy');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ noStrategy: true });
    expect(payload()).not.toHaveProperty('strategyId');
  });

  it('offers Don’t remember, sends only answered conditions, and never Not Met by omission', async () => {
    renderForm(withStrategy);
    fillIdentity();
    goTo('setup');
    chooseClassification('Strategy', 'Golden Breakout');
    chooseClassification('Setup', 'Clean Retest');
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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    goTo('context');
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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    // The launcher row reads the explicit answer back; it never shows as unanswered.
    expect(document.querySelector('[data-post-trade-emotions]')).toHaveAttribute(
      'data-post-trade-emotions',
      'none',
    );
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ postTradeEmotionKeys: [] });
    expect(payload()).not.toHaveProperty('emotionKeys');
  });
});

/*
  STEP 5 SAYS WHAT THE TRADER ACTUALLY DID, IN ORDER OF WEIGHT: the whole
  trade's Final Net P&L leads; Trader R sits beneath it as a smaller,
  Calculated readout; the outcome is its own answer that the P&L never fills
  in; and the final exit time and exit history follow as supporting detail.
*/
describe('Step 5 — Trader result hierarchy', () => {
  it('leads with Final Net P&L, derives Trader R, and keeps the outcome and exits apart', () => {
    renderForm();
    goTo('plan');
    typeInPlan('risk', 'Risk at entry', '50');
    goTo('result');
    const step = stepSection('result');
    const blocks = [
      step.querySelector('[data-result-panel]'),
      step.querySelector('[data-result-outcome]'),
      step.querySelector('[data-result-closing]'),
    ];
    for (const block of blocks) expect(block).not.toBeNull();
    const [panel, outcome, closing] = blocks as HTMLElement[];
    // In the order of weight, in the document too.
    expect(
      panel!.compareDocumentPosition(outcome!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      outcome!.compareDocumentPosition(closing!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The result card holds the lead figure and what it comes to — nothing else.
    expect(within(panel!).getByLabelText('Final net P&L')).toBeInTheDocument();
    expect(panel!.querySelector('[data-exit-time]')).toBeNull();
    type('Final net P&L', '80', panel);
    const r = panel!.querySelector<HTMLElement>('[data-actual-r]')!;
    expect(r).toHaveAttribute('data-actual-r-variant', 'derived');
    expect(r).toHaveTextContent('Calculated');
    expect(r).toHaveTextContent('+1.60R');
    // The outcome is never set from the P&L.
    expect(outcome!.querySelector('[data-trader-outcome]')).toHaveAttribute(
      'data-trader-outcome',
      'unanswered',
    );
    expect(
      within(outcome!).getByText('Your own call. It is never set from the P&L.'),
    ).toBeVisible();

    // Supporting detail follows: the exit time, then the exit history.
    expect(closing!.querySelector('[data-exit-time]')).not.toBeNull();
    expect(within(closing!).getByText('Exit history')).toBeInTheDocument();
    // The whole step is optional, so no field repeats an Optional tag.
    expect(within(step).queryByText('Optional')).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Use recorded exits' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('90');
    // A typed figure is plainly the trader's own; only an adopted one says so.
    expect(pnlSource()).toBe('typed');
    expect(screen.queryByText('Entered by you.')).toBeNull();
    // Offered beside the Final Net P&L it would replace, and only on request.
    fireEvent.click(screen.getByRole('button', { name: 'Use recorded exits' }));
    expect(screen.getByLabelText('Final net P&L')).toHaveValue('100.00');
    // The source says where the figure now comes from.
    expect(
      screen.getByText('From your recorded exits. Type a figure to replace it.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/but your final net P&L is/)).not.toBeInTheDocument();
    // Typing makes it the trader's own figure again.
    type('Final net P&L', '95');
    expect(pnlSource()).toBe('typed');
    expect(screen.queryByText(/From your recorded exits/)).toBeNull();
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

describe('a malformed chart link', () => {
  it('blocks Save on Context, at the link, with the server’s own rule — as Record Open does', async () => {
    renderForm();
    fillIdentity();
    goTo('context');
    type('Chart link', 'https://example.com/not-tradingview');
    save();
    await waitFor(() => expect(currentStep()).toBe('context'));
    await waitFor(() => expect(screen.getByLabelText('Chart link')).toHaveFocus());
    expect(screen.getByLabelText('Chart link')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter an HTTPS TradingView URL.')).toBeVisible();
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();

    // A TradingView link, and the Save goes through unchanged.
    type('Chart link', 'https://www.tradingview.com/x/abc12345/');
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ tradingviewUrl: 'https://www.tradingview.com/x/abc12345/' });
  });

  it('names the link when the server refuses it, as a backstop', async () => {
    createCompletedTradeActionMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'validation_error',
        fieldErrors: { tradingviewUrl: ['invalid_tradingview_url'] },
      },
    });
    renderForm();
    fillIdentity();
    goTo('context');
    // Valid to the client; the server has the last word.
    type('Chart link', 'https://www.tradingview.com/x/abc12345/');
    save();
    await waitFor(() => expect(currentStep()).toBe('context'));
    expect(screen.getByLabelText('Chart link')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter an HTTPS TradingView URL.')).toBeVisible();
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

describe('Stage 6 — After-Trade Context, the last canonical stage', () => {
  it('asks Post-Trade Emotion, the note and the evidence on After-trade, and saves them with the Trade', async () => {
    renderForm();
    fillIdentity();
    // Context no longer holds Post-Trade Emotion: Stage 6 owns it.
    expect(
      stepSection('context').querySelector('[data-emotions-phase="postTradeEmotions"]'),
    ).toBeNull();
    goTo('after');
    const after = stepSection('after');
    expect(within(after).getByRole('button', { name: 'Edit post-trade emotion' })).toBeVisible();
    fireEvent.change(within(after).getByLabelText('After-trade note'), {
      target: { value: 'Exited on fear.' },
    });
    fireEvent.change(within(after).getByLabelText('TradingView link'), {
      target: { value: 'https://www.tradingview.com/x/After0001/' },
    });
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({
      afterTradeNote: 'Exited on fear.',
      afterTradeTradingviewUrl: 'https://www.tradingview.com/x/After0001/',
      // The entry evidence is its own, untouched.
      notes: '',
      tradingviewUrl: '',
    });
    expect(payload()).not.toHaveProperty('postTradeEmotionKeys');
  });

  it('blocks Save at the after-trade link, on the After-trade step, with its own error', async () => {
    renderForm();
    fillIdentity();
    goTo('after');
    fireEvent.change(within(stepSection('after')).getByLabelText('TradingView link'), {
      target: { value: 'https://example.com/chart' },
    });
    goTo('trade');
    save();
    await waitFor(() => expect(currentStep()).toBe('after'));
    const link = within(stepSection('after')).getByLabelText('TradingView link');
    await waitFor(() => expect(link).toHaveFocus());
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });

  it('keeps Stage 6 answers through a reload, but not the step being shown', () => {
    renderForm();
    fillIdentity();
    goTo('after');
    fireEvent.change(within(stepSection('after')).getByLabelText('After-trade note'), {
      target: { value: 'Still fresh.' },
    });
    cleanup();
    renderForm();
    expect(currentStep()).toBe('trade');
    expect(within(stepSection('after')).getByLabelText('After-trade note')).toHaveValue(
      'Still fresh.',
    );
  });
});

/*
  NO PLANNED RISK, NO R (contract decision 54). Record Closed enters its
  result before its plan, so the R readout has to say why it is missing — and
  has to start working the moment the trader defines the risk it was missing.
*/
describe('Record Closed — Trader R follows the risk decision', () => {
  it('shows the P&L but no R when the trader defined no risk, and says why', async () => {
    renderForm();
    fillIdentity();
    goTo('result');
    type('Final net P&L', '120');
    const editor = openPlanRow('risk');
    chooseRisk(editor, 'No defined risk');
    closeEditor();
    goTo('result');
    expect(document.querySelector('[data-actual-r]')).toHaveAttribute(
      'data-actual-r',
      'unavailable',
    );
    expect(
      screen.getByText('No risk was defined as 1R for this trade, so R is not available.'),
    ).toBeInTheDocument();
    // The result itself is untouched: P&L is still recorded and still saved.
    save();
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalled());
    expect(payload()).toMatchObject({ plannedRiskState: 'no_defined', finalPnlMinor: '12000' });
    // After Trade states the absence explicitly rather than omitting the key.
    expect(payload().plannedRiskMinor).toBeNull();
    expect(payload().actualR).toBeUndefined();
  });

  it('starts showing R once the risk is defined after the result', () => {
    renderForm();
    fillIdentity();
    goTo('result');
    type('Final net P&L', '100');
    // Before the plan is answered, R says what it still needs.
    expect(document.querySelector('[data-actual-r]')).toHaveAttribute(
      'data-actual-r',
      'unavailable',
    );
    typeInPlan('risk', 'Risk at entry', '50');
    goTo('result');
    expect(document.querySelector('[data-actual-r]')).toHaveAttribute('data-actual-r', 'known');
    expect(screen.getByText('+2.00R')).toBeInTheDocument();
  });
});
