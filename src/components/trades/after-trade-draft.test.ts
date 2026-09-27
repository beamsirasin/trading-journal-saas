import { describe, expect, it } from 'vitest';

import { CreateCompletedTradeSchema, HISTORICAL_EXIT_LIMIT } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import {
  addExit,
  afterTradeReadiness,
  buildAfterTradePayload,
  canAddExit,
  closingFromLegacy,
  createAfterTradeDraft,
  exitField,
  FULL_CLOSE_EXIT_ID,
  hasAfterTradeWork,
  setCloseMode,
  setOutcome,
  setPartsResult,
  setStatedTotal,
  setTargetState,
  updateExit,
  updateFullClose,
  validateAfterTradeDraft,
  type AfterTradeDraft,
} from './after-trade-draft';

const ACCOUNT = '018f0000-0000-7000-8000-000000000001';
const KEY = '018f0000-0000-7000-8000-0000000000aa';
const NOW = new Date('2026-09-18T12:00:00.000Z');
const CONTEXT = { currency: 'USD', timezone: 'UTC', now: NOW };
const OPTIONS = { strategies: [], exitPlans: [] } satisfies Pick<
  TradeCreateOptions,
  'strategies' | 'exitPlans'
>;

function identified(): AfterTradeDraft {
  return { ...createAfterTradeDraft(ACCOUNT), symbol: 'xauusd', direction: 'long' };
}

/** "Closed all at once" with this P&L for the close. */
function closedAllAtOnce(draft: AfterTradeDraft, pnl: string): AfterTradeDraft {
  return updateFullClose(setCloseMode(draft, 'all_at_once'), { pnl });
}

/** "Closed in parts" with these exit legs. */
function closedInParts(
  draft: AfterTradeDraft,
  legs: readonly Partial<Omit<AfterTradeDraft['exits'][number], 'id'>>[],
): AfterTradeDraft {
  let next = setPartsResult(setCloseMode(draft, 'in_parts'), 'each_exit');
  legs.forEach((leg, index) => {
    next = updateExit(addExit(next, `e${index + 1}`), `e${index + 1}`, leg);
  });
  return next;
}

function payloadOf(draft: AfterTradeDraft) {
  return buildAfterTradePayload(draft, { ...CONTEXT, mutationKey: KEY, options: OPTIONS });
}

describe('readiness', () => {
  it('needs only Account, Symbol and Direction', () => {
    const blank = createAfterTradeDraft('');
    const validation = validateAfterTradeDraft(blank, CONTEXT);
    expect(afterTradeReadiness(blank, validation)).toEqual({
      status: 'blocked',
      count: 3,
      fields: ['tradingAccountId', 'symbol', 'direction'],
    });
    const ready = identified();
    expect(afterTradeReadiness(ready, validateAfterTradeDraft(ready, CONTEXT))).toEqual({
      status: 'ready',
    });
  });

  it('blocks malformed values and incomplete explicit answers, never missing optional ones', () => {
    let draft = closedAllAtOnce({ ...identified(), enteredAt: '2026-09-19T10:00' }, 'abc');
    draft = setTargetState(draft, 'fixed');
    const { errors } = validateAfterTradeDraft(draft, CONTEXT);
    expect(errors).toEqual({
      [exitField(FULL_CLOSE_EXIT_ID, 'pnl')]: 'invalid_money',
      enteredAt: 'future_time',
      targetProfit: 'fixed_target_requires_value',
    });
  });

  it('refuses a Risk at Entry of zero, never reading it as unknown', () => {
    const { errors } = validateAfterTradeDraft({ ...identified(), risk: '0' }, CONTEXT);
    expect(errors.risk).toBe('must_be_positive');
  });

  it('refuses a final exit before entry, and checks no share of the position', () => {
    let draft = { ...identified(), enteredAt: '2026-09-10T10:00', exitedAt: '2026-09-10T09:00' };
    draft = addExit(
      addExit(setPartsResult(setCloseMode(draft, 'in_parts'), 'each_exit'), 'a'),
      'b',
    );
    // Shares an older draft may carry are neither asked nor checked any more.
    draft = updateExit(draft, 'a', { closedPercent: '60', pnl: '10' });
    draft = updateExit(draft, 'b', { closedPercent: '60', pnl: '10' });
    const { errors } = validateAfterTradeDraft(draft, CONTEXT);
    expect(errors.exitedAt).toBe('exit_before_entry');
    expect(errors[exitField('a', 'closedPercent')]).toBeUndefined();
    expect(errors[exitField('b', 'closedPercent')]).toBeUndefined();
  });
});

describe('derived figures and notices', () => {
  it('derives Trader R only from Final Net P&L and Risk at Entry', () => {
    const neither = validateAfterTradeDraft(identified(), CONTEXT);
    expect(neither.actualR).toEqual({ status: 'unavailable', reason: 'needs_pnl_and_risk' });
    const pnl = validateAfterTradeDraft(closedAllAtOnce(identified(), '150'), CONTEXT);
    expect(pnl.actualR).toEqual({ status: 'unavailable', reason: 'needs_risk' });
    const both = validateAfterTradeDraft(
      closedAllAtOnce({ ...identified(), riskState: 'defined', risk: '100' }, '150'),
      CONTEXT,
    );
    // 150 ÷ the 1R of 100 — the Step 2 Risk is the only denominator there is.
    expect(both.actualR).toEqual({ status: 'known', value: '1.5000' });
    // No Defined Risk: the P&L stands, and no R is made up for it.
    const none = validateAfterTradeDraft(
      closedAllAtOnce({ ...identified(), riskState: 'no_defined' }, '150'),
      CONTEXT,
    );
    expect(none.finalPnlMinor).toBe('15000');
    expect(none.actualR).toEqual({ status: 'unavailable', reason: 'no_defined_risk' });
  });

  it('notes a sign contradiction without blocking', () => {
    const draft = setOutcome(closedAllAtOnce(identified(), '-10'), 'win');
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.notices).toEqual([{ kind: 'outcome_contradicts_pnl' }]);
    expect(afterTradeReadiness(draft, validation).status).toBe('ready');
  });

  it('reads the outcome independently: a result never answers it', () => {
    const draft = closedAllAtOnce(identified(), '80');
    expect(draft.outcome).toBeNull();
    expect(payloadOf(draft)).not.toHaveProperty('traderOutcome');
  });
});

/*
  ONE RESULT SOURCE (decision 57). Step 5 records how the Trade closed; the
  Final Net P&L is what that close adds up to, never typed beside it.
*/
describe('the close is the result', () => {
  const RISKED = { riskState: 'defined', risk: '50' } as const;

  it('a full close of +80 is a Final Net P&L of +80 and, against a 50 risk, +1.60R', () => {
    const draft = closedAllAtOnce({ ...identified(), ...RISKED }, '80');
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.finalPnlMinor).toBe('8000');
    expect(validation.actualR).toEqual({ status: 'known', value: '1.6000' });
    expect(validation.closing).toMatchObject({ mode: 'all_at_once', closed: true, exitCount: 1 });
    expect(payloadOf(draft)).toMatchObject({
      finalPnlMinor: '8000',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
      exits: [{ exitScope: 'all_remaining', realizedPnlMinor: '8000', closedBps: null }],
    });
    expect(CreateCompletedTradeSchema.safeParse(payloadOf(draft)).success).toBe(true);
  });

  it('a full close with no P&L yet has no result, and never a 0', () => {
    const draft = setCloseMode(identified(), 'all_at_once');
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.finalPnlMinor).toBeNull();
    expect(validation.closing.recordedSoFarMinor).toBeNull();
    expect(payloadOf(draft)).toMatchObject({ finalPnlMinor: null });
    expect(payloadOf(draft)).not.toHaveProperty('finalPnlAdoptedFromExits');
  });

  /*
    "RECORD EACH EXIT" IS AN ORDERED SEQUENCE OF RESULTS (2026-09-27). The last
    exit is the Final exit — the rest of the position — so the exits close the
    trade by themselves; Net P&L is their sum once every one has a P&L. No
    share or scope is asked. Saved, the last exit is All remaining (what the
    Final exit means) and the earlier ones carry no scope; no share is sent.
  */
  it('no exits yet: no result, and nothing to save as exits', () => {
    const draft = closedInParts({ ...identified(), ...RISKED }, []);
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.closing).toMatchObject({ exitCount: 0, closed: false });
    expect(validation.finalPnlMinor).toBeNull();
    expect(payloadOf(draft)).toMatchObject({ finalPnlMinor: null, exits: [] });
    expect(payloadOf(draft)).not.toHaveProperty('exitHistoryCompleteness');
  });

  it('one exit is the Final exit, and its P&L is the result', () => {
    const draft = closedInParts({ ...identified(), ...RISKED }, [{ pnl: '50' }]);
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.closing).toMatchObject({ exitCount: 1, closed: true, source: 'exit_legs' });
    expect(validation.finalPnlMinor).toBe('5000');
    expect(validation.actualR).toEqual({ status: 'known', value: '1.0000' });
    expect(payloadOf(draft)?.exits).toEqual([
      {
        closedBps: null,
        exitScope: 'all_remaining',
        exitPrice: null,
        realizedPnlMinor: '5000',
        exitedAt: null,
      },
    ]);
  });

  it('several exits: Net P&L is their sum, and the last is sent as the Final exit', () => {
    const draft = closedInParts({ ...identified(), ...RISKED }, [
      { pnl: '30' },
      { pnl: '20' },
      { pnl: '50' },
    ]);
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.closing).toMatchObject({ exitCount: 3, closed: true, missingPnl: false });
    expect(validation.finalPnlMinor).toBe('10000');
    // Trader R is still Net P&L ÷ Risk at Entry: 100 ÷ 50.
    expect(validation.actualR).toEqual({ status: 'known', value: '2.0000' });
    const payload = payloadOf(draft);
    expect(payload).toMatchObject({
      finalPnlMinor: '10000',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
    });
    expect(payload?.exits?.map((exit) => [exit.exitScope, exit.closedBps])).toEqual([
      [null, null],
      [null, null],
      ['all_remaining', null],
    ]);
    expect(CreateCompletedTradeSchema.safeParse(payload).success).toBe(true);
  });

  it('an exit without P&L: no result until every exit has one — a running figure only', () => {
    const draft = closedInParts(identified(), [{ pnl: '20' }, { reason: 'Stopped out' }]);
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.closing).toMatchObject({ closed: true, missingPnl: true });
    expect(validation.finalPnlMinor).toBeNull();
    expect(validation.closing.recordedSoFarMinor).toBe('2000');
    expect(payloadOf(draft)).toMatchObject({ exitHistoryCompleteness: 'complete' });
    expect(payloadOf(draft)).not.toHaveProperty('finalPnlAdoptedFromExits');
  });

  it('an older draft’s scope and share stay in the draft, and are neither counted nor sent', () => {
    const draft = closedInParts({ ...identified(), ...RISKED }, [
      { scope: 'part', closedPercent: '30', pnl: '20' },
      { scope: 'all_remaining', pnl: '15' },
      { scope: 'unknown', closedPercent: '25', pnl: '45' },
    ]);
    // Kept exactly as they were.
    expect(draft.exits.map((exit) => [exit.scope, exit.closedPercent])).toEqual([
      ['part', '30'],
      ['all_remaining', ''],
      ['unknown', '25'],
    ]);
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.finalPnlMinor).toBe('8000');
    // The order decides the Final exit, not an old scope answer.
    expect(payloadOf(draft)?.exits?.map((exit) => [exit.exitScope, exit.closedBps])).toEqual([
      [null, null],
      [null, null],
      ['all_remaining', null],
    ]);
  });

  it('keeps each way of closing when switching, and saves only the chosen one', () => {
    let draft = closedInParts(identified(), [{ closedPercent: '30', pnl: '20' }]);
    draft = updateFullClose(setCloseMode(draft, 'all_at_once'), { pnl: '80' });
    expect(draft.exits).toHaveLength(1);
    expect(payloadOf(draft)?.exits).toHaveLength(1);
    expect(payloadOf(draft)?.exits?.[0]).toMatchObject({
      exitScope: 'all_remaining',
      realizedPnlMinor: '8000',
    });
    draft = setPartsResult(setCloseMode(draft, 'in_parts'), 'each_exit');
    expect(draft.fullClose.pnl).toBe('80');
    expect(draft.exits[0]?.closedPercent).toBe('30');
    expect(payloadOf(draft)?.exits?.[0]).toMatchObject({
      realizedPnlMinor: '2000',
      exitScope: 'all_remaining',
      closedBps: null,
    });
  });

  it('holds no separate Final Net P&L to type', () => {
    const draft = createAfterTradeDraft(ACCOUNT);
    expect(draft).not.toHaveProperty('finalPnl');
    expect(draft).not.toHaveProperty('finalPnlAdopted');
    expect(draft).not.toHaveProperty('completeness');
  });

  it('reads an older draft once, keeping every typed value and choosing no mode', () => {
    const exit = {
      id: 'x',
      scope: '' as const,
      pnl: '20',
      closedPercent: '30',
      exitedAt: '',
      price: '',
      reason: '',
    };
    // Exits alone could only have been recorded exit by exit.
    expect(closingFromLegacy({ finalPnl: '', exits: [exit] })).toMatchObject({
      closeMode: 'in_parts',
      partsResult: 'each_exit',
      exits: [exit],
    });
    // Exits beside a typed total: both kept, no way of recording chosen.
    expect(closingFromLegacy({ finalPnl: '80', exits: [exit] })).toMatchObject({
      closeMode: 'in_parts',
      partsResult: 'unanswered',
      exits: [exit],
      statedTotal: '80',
    });
    // A typed total alone: kept where either way would hold it, nothing chosen.
    expect(closingFromLegacy({ finalPnl: '80', exits: [] })).toMatchObject({
      closeMode: 'unanswered',
      fullClose: { pnl: '80' },
      statedTotal: '80',
    });
    expect(closingFromLegacy({ finalPnl: '', exits: [] })).toMatchObject({
      closeMode: 'unanswered',
    });
  });
});

describe('the Save payload', () => {
  it('sends the minimum with every unanswered question omitted and blanks as null', () => {
    const payload = payloadOf(identified());
    expect(payload).toEqual({
      mutationKey: KEY,
      tradingAccountId: ACCOUNT,
      recordingTiming: 'after_trade',
      recordingContract: 'add_trade_v1',
      symbol: 'XAUUSD',
      direction: 'long',
      enteredAt: null,
      exitedAt: null,
      plannedRiskMinor: null,
      finalPnlMinor: null,
      exits: [],
      timeframe: '',
      session: '',
      confirmationNotes: '',
      tradingviewUrl: '',
      notes: '',
      afterTradeNote: '',
      afterTradeTradingviewUrl: '',
      chartAttachmentStorageKey: null,
    });
    expect(CreateCompletedTradeSchema.safeParse(payload).success).toBe(true);
  });

  it('sends Stage 6 After-Trade Context apart from the entry notes and link', () => {
    const payload = payloadOf({
      ...identified(),
      afterTradeNote: 'Exited on fear.',
      afterTradeTradingviewUrl: 'https://www.tradingview.com/x/After0001/',
    });
    expect(payload).toMatchObject({
      notes: '',
      tradingviewUrl: '',
      afterTradeNote: 'Exited on fear.',
      afterTradeTradingviewUrl: 'https://www.tradingview.com/x/After0001/',
    });
    const parsed = CreateCompletedTradeSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('names a malformed after-trade link at its own field, not the entry link', () => {
    const draft = { ...identified(), afterTradeTradingviewUrl: 'https://example.com/chart' };
    expect(validateAfterTradeDraft(draft, CONTEXT).errors).toEqual({
      afterTradeTradingviewUrl: 'invalid_tradingview_url',
    });
  });

  it('is never built from a draft that is not ready', () => {
    expect(payloadOf(createAfterTradeDraft(ACCOUNT))).toBeNull();
  });

  it('holds no Actual Risk and never sends one (decision 56)', () => {
    expect(createAfterTradeDraft(ACCOUNT)).not.toHaveProperty('actualRisk');
    const payload = payloadOf({
      ...identified(),
      riskState: 'defined',
      risk: '100',
      closeMode: 'all_at_once',
      fullClose: { pnl: '80', price: '', reason: '' },
    });
    expect(payload).toMatchObject({ plannedRiskMinor: '10000', finalPnlMinor: '8000' });
    expect(payload).not.toHaveProperty('actualRiskAnswer');
    expect(payload).not.toHaveProperty('actualInitialRiskMinor');
  });

  it('keeps each exit’s evidence as given, in order, the last one the Final exit', () => {
    let draft = addExit(
      addExit(setPartsResult(setCloseMode(identified(), 'in_parts'), 'each_exit'), 'a'),
      'b',
    );
    draft = updateExit(draft, 'a', { reason: '  Half at the level ' });
    draft = updateExit(draft, 'b', { price: '2410.5', exitedAt: '2026-09-18T10:30' });
    expect(payloadOf(draft)?.exits).toEqual([
      {
        closedBps: null,
        exitScope: null,
        exitPrice: null,
        realizedPnlMinor: null,
        exitReason: 'Half at the level',
        exitedAt: null,
      },
      {
        closedBps: null,
        exitScope: 'all_remaining',
        exitPrice: '2410.5',
        realizedPnlMinor: null,
        exitedAt: '2026-09-18T10:30:00.000Z',
      },
    ]);
  });
});

describe('work', () => {
  it('treats an untouched draft, or an exit row left empty, as no work', () => {
    const pristine = createAfterTradeDraft(ACCOUNT);
    expect(hasAfterTradeWork(pristine, pristine)).toBe(false);
    expect(hasAfterTradeWork(addExit(pristine, 'a'), pristine)).toBe(false);
    expect(hasAfterTradeWork(setOutcome(pristine, 'loss'), pristine)).toBe(true);
  });
});

/*
  ONE RESULT SOURCE PER TRADE (decision 58). A close in parts is recorded
  exit by exit (the result is their sum) or, when only the final result is
  known, as a stated total — never both, and a stated total invents no exits.
*/
describe('closed in parts, only the final result known', () => {
  function totalOnly(total: string): AfterTradeDraft {
    const parts = setPartsResult(
      setCloseMode({ ...identified(), riskState: 'defined', risk: '50' }, 'in_parts'),
      'total_only',
    );
    return setStatedTotal(parts, total);
  }

  it('a stated +80 is the Final Net P&L, +1.60R, with trader-stated provenance', () => {
    const validation = validateAfterTradeDraft(totalOnly('80'), CONTEXT);
    expect(validation.finalPnlMinor).toBe('8000');
    expect(validation.actualR).toEqual({ status: 'known', value: '1.6000' });
    expect(validation.closing).toMatchObject({ source: 'stated_total', partsResult: 'total_only' });
    const payload = payloadOf(totalOnly('80'));
    expect(payload).toMatchObject({ finalPnlMinor: '8000', finalPnlStatedTotal: true });
    expect(payload).not.toHaveProperty('finalPnlAdoptedFromExits');
    expect(CreateCompletedTradeSchema.safeParse(payload).success).toBe(true);
  });

  it('invents no exits and asks for no allocation', () => {
    // Exits recorded earlier "each exit" stay in the draft, never in this Save.
    let draft = totalOnly('80');
    draft = setPartsResult(draft, 'each_exit');
    draft = updateExit(addExit(draft, 'e1'), 'e1', { closedPercent: '30', pnl: '20' });
    draft = setPartsResult(draft, 'total_only');
    const payload = payloadOf(draft);
    expect(payload?.exits).toEqual([]);
    expect(payload).not.toHaveProperty('exitHistoryCompleteness');
    expect(draft.exits).toHaveLength(1);
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.closing).toMatchObject({ exitCount: 0, accountedBps: null, closed: false });
  });

  it('names a malformed stated total at its own field', () => {
    expect(validateAfterTradeDraft(totalOnly('abc'), CONTEXT).errors).toEqual({
      finalPnl: 'invalid_money',
    });
  });

  it('exit by exit never also sends a stated total, and a stated total never claims the exits', () => {
    let draft = setStatedTotal(
      setPartsResult(setCloseMode(identified(), 'in_parts'), 'each_exit'),
      '999',
    );
    draft = updateExit(addExit(draft, 'e1'), 'e1', { scope: 'all_remaining', pnl: '80' });
    const exits = payloadOf(draft);
    expect(exits).toMatchObject({ finalPnlMinor: '8000', finalPnlAdoptedFromExits: true });
    expect(exits).not.toHaveProperty('finalPnlStatedTotal');
    const stated = payloadOf(setPartsResult(draft, 'total_only'));
    expect(stated).toMatchObject({ finalPnlMinor: '99900', finalPnlStatedTotal: true, exits: [] });
    expect(stated).not.toHaveProperty('finalPnlAdoptedFromExits');
  });

  it('with the way of recording unanswered, claims no result and saves no exits', () => {
    let draft = setCloseMode(identified(), 'in_parts');
    draft = updateExit(addExit(draft, 'e1'), 'e1', { scope: 'all_remaining', pnl: '80' });
    draft = setStatedTotal(draft, '80');
    const payload = payloadOf(draft);
    expect(payload).toMatchObject({ finalPnlMinor: null, exits: [] });
    expect(payload).not.toHaveProperty('finalPnlStatedTotal');
    expect(payload).not.toHaveProperty('finalPnlAdoptedFromExits');
  });
});

describe('the exit limit is the server limit', () => {
  it('stops adding exits at the limit a Save accepts', () => {
    let draft = setPartsResult(setCloseMode(identified(), 'in_parts'), 'each_exit');
    for (let index = 0; index < HISTORICAL_EXIT_LIMIT + 5; index += 1) {
      draft = updateExit(addExit(draft, `e${index}`), `e${index}`, { reason: 'r' });
    }
    expect(draft.exits).toHaveLength(HISTORICAL_EXIT_LIMIT);
    expect(canAddExit(draft)).toBe(false);
    expect(CreateCompletedTradeSchema.safeParse(payloadOf(draft)).success).toBe(true);
  });
});
