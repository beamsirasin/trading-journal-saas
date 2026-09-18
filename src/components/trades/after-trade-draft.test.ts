import { describe, expect, it } from 'vitest';

import { CreateCompletedTradeSchema } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import {
  addExit,
  adoptExitSubtotal,
  afterTradeReadiness,
  buildAfterTradePayload,
  createAfterTradeDraft,
  exitField,
  hasAfterTradeWork,
  removeExit,
  setActualRiskAmount,
  setActualRiskAnswer,
  setCompleteness,
  setOutcome,
  setTargetState,
  updateExit,
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
    let draft = { ...identified(), finalPnl: 'abc', enteredAt: '2026-09-19T10:00' };
    draft = setTargetState(draft, 'fixed');
    draft = setActualRiskAnswer(draft, 'matched');
    const { errors } = validateAfterTradeDraft(draft, CONTEXT);
    expect(errors).toEqual({
      finalPnl: 'invalid_money',
      enteredAt: 'future_time',
      targetProfit: 'fixed_target_requires_value',
      actualRisk: 'matched_requires_risk_at_entry',
    });
  });

  it('refuses a Risk at Entry of zero, never reading it as unknown', () => {
    const { errors } = validateAfterTradeDraft({ ...identified(), risk: '0' }, CONTEXT);
    expect(errors.risk).toBe('must_be_positive');
  });

  it('refuses a final exit before entry and exits that close more than the position', () => {
    let draft = { ...identified(), enteredAt: '2026-09-10T10:00', exitedAt: '2026-09-10T09:00' };
    draft = addExit(addExit(draft, 'a'), 'b');
    draft = updateExit(draft, 'a', { closedPercent: '60' });
    draft = updateExit(draft, 'b', { closedPercent: '60' });
    const { errors } = validateAfterTradeDraft(draft, CONTEXT);
    expect(errors.exitedAt).toBe('exit_before_entry');
    expect(errors[exitField('b', 'closedPercent')]).toBe('percent_over_total');
    expect(errors[exitField('a', 'closedPercent')]).toBeUndefined();
  });
});

describe('derived figures and notices', () => {
  it('derives Actual R only from Final Net P&L and Risk at Entry', () => {
    const neither = validateAfterTradeDraft(identified(), CONTEXT);
    expect(neither.actualR).toEqual({ status: 'unavailable', reason: 'needs_pnl_and_risk' });
    const pnl = validateAfterTradeDraft({ ...identified(), finalPnl: '150' }, CONTEXT);
    expect(pnl.actualR).toEqual({ status: 'unavailable', reason: 'needs_risk' });
    const both = validateAfterTradeDraft(
      setActualRiskAmount({ ...identified(), finalPnl: '150', risk: '100' }, '50'),
      CONTEXT,
    );
    expect(both.actualR).toEqual({ status: 'known', value: '1.5000' });
  });

  it('notes a sign contradiction without blocking', () => {
    const draft = setOutcome({ ...identified(), finalPnl: '-10' }, 'win');
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.notices).toEqual([{ kind: 'outcome_contradicts_pnl' }]);
    expect(afterTradeReadiness(draft, validation).status).toBe('ready');
  });

  it('calls a difference a discrepancy only for a Complete, fully priced history', () => {
    let draft = { ...identified(), finalPnl: '90' };
    draft = updateExit(addExit(draft, 'a'), 'a', { pnl: '100' });
    expect(validateAfterTradeDraft(draft, CONTEXT).notices).toEqual([]);
    draft = setCompleteness(draft, 'complete');
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(validation.notices).toEqual([
      { kind: 'exit_discrepancy', subtotalMinor: '10000', finalPnlMinor: '9000' },
    ]);
    expect(afterTradeReadiness(draft, validation).status).toBe('ready');
  });

  it('adopts the subtotal only when asked', () => {
    let draft = { ...identified(), finalPnl: '90' };
    draft = setCompleteness(updateExit(addExit(draft, 'a'), 'a', { pnl: '100' }), 'complete');
    const validation = validateAfterTradeDraft(draft, CONTEXT);
    expect(draft.finalPnl).toBe('90');
    expect(adoptExitSubtotal(draft, validation, (minor) => `${minor}c`).finalPnl).toBe('10000c');
  });

  it('returns completeness to Unanswered when the last exit goes', () => {
    const draft = setCompleteness(
      updateExit(addExit(identified(), 'a'), 'a', { pnl: '1' }),
      'unknown',
    );
    expect(removeExit(draft, 'a').completeness).toBe('unanswered');
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
      chartAttachmentStorageKey: null,
    });
    expect(CreateCompletedTradeSchema.safeParse(payload).success).toBe(true);
  });

  it('is never built from a draft that is not ready', () => {
    expect(payloadOf(createAfterTradeDraft(ACCOUNT))).toBeNull();
  });

  it('sends Different with an unknown amount as Different, never Matched', () => {
    const payload = payloadOf(setActualRiskAnswer({ ...identified(), risk: '100' }, 'different'));
    expect(payload).toMatchObject({ plannedRiskMinor: '10000', actualRiskAnswer: 'different' });
    expect(payload).not.toHaveProperty('actualInitialRiskMinor');
  });

  it('keeps each exit’s evidence as given, with scope Unknown distinct from Unanswered', () => {
    let draft = addExit(addExit(identified(), 'a'), 'b');
    draft = updateExit(draft, 'a', { reason: '  Half at the level ' });
    draft = updateExit(draft, 'b', { scope: 'unknown', price: '2410.5', closedPercent: '25' });
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
        closedBps: 2_500,
        exitScope: 'unknown',
        exitPrice: '2410.5',
        realizedPnlMinor: null,
        exitedAt: null,
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
