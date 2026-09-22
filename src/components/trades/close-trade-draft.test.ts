import { describe, expect, it } from 'vitest';

import { RecordContractExitSchema } from '@/lib/trades/schemas';

import {
  adoptRecordedExits,
  buildClosePayload,
  createCloseTradeDraft,
  firstCloseErrorField,
  lastRecordedExitTime,
  serverErrorField,
  setCompleteness,
  setFinalPnl,
  setOutcome,
  updateLeg,
  validateCloseDraft,
  type CloseTradeContext,
} from './close-trade-draft';

const TRADE_ID = '018f0000-0000-7000-8000-000000000099';
const KEY = '018f0000-0000-7000-8000-0000000000aa';
const IDS = { tradeId: TRADE_ID, mutationKey: KEY };

// Bangkok is UTC+7: 2026-09-20T09:00 local is 02:00Z.
const context = (overrides: Partial<CloseTradeContext> = {}): CloseTradeContext => ({
  currency: 'USD',
  timezone: 'Asia/Bangkok',
  now: new Date('2026-09-21T05:00:00.000Z'),
  enteredAt: '2026-09-20T02:00:00.000Z',
  riskMinor: '10000',
  exits: [],
  ...overrides,
});

describe('Part exit', () => {
  it('builds a Part request with only its own leg — nothing whole-trade, nothing invented', () => {
    const draft = updateLeg(createCloseTradeDraft('part'), {
      pnl: '50',
      closedPercent: '25',
      exitedAt: '2026-09-20T10:30',
      price: '2410.5',
      reason: '  first target  ',
    });
    const validation = validateCloseDraft(draft, context());
    expect(validation.errors).toEqual({});
    const payload = buildClosePayload(draft, context(), IDS);
    expect(payload).toEqual({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      scope: 'part',
      realizedPnlMinor: '5000',
      closedBps: 2_500,
      exitPrice: '2410.5',
      exitedAt: '2026-09-20T03:30:00.000Z',
      exitReason: 'first target',
    });
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
  });

  it('sends every unanswered leg answer as unknown, never zero or now', () => {
    const payload = buildClosePayload(createCloseTradeDraft('part'), context(), IDS);
    expect(payload).toEqual({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      scope: 'part',
      realizedPnlMinor: null,
      closedBps: null,
      exitPrice: null,
      exitedAt: null,
    });
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
  });

  it('never lets a Part account for the whole position', () => {
    const exits = [{ closedBps: 6_000, realizedPnlMinor: null, exitedAt: null }];
    const draft = updateLeg(createCloseTradeDraft('part'), { closedPercent: '40' });
    expect(validateCloseDraft(draft, context({ exits })).errors).toEqual({
      'leg.closedPercent': 'part_closes_position',
    });
  });

  it('names each exit-time problem precisely', () => {
    const at = (exitedAt: string) =>
      validateCloseDraft(updateLeg(createCloseTradeDraft('part'), { exitedAt }), context()).errors[
        'leg.exitedAt'
      ];
    expect(at('2026-09-20T08:59')).toBe('exit_time_before_entry');
    expect(at('2026-09-21T12:01')).toBe('exit_time_in_future');
    expect(at('2026-09-20')).toBe('exit_time_required');
    expect(at('T10:00')).toBe('exit_date_required');
    expect(at('2026-09-20T10:00')).toBeUndefined();
  });
});

describe('All Remaining — the Final Close', () => {
  it('derives Actual R from Final Net P&L ÷ Risk at Entry, and says what is missing otherwise', () => {
    const typed = setFinalPnl(createCloseTradeDraft('all_remaining'), '-50');
    expect(validateCloseDraft(typed, context()).actualR).toEqual({
      status: 'known',
      value: '-0.5000',
    });
    // No Final Net P&L: unknown, never 0R.
    expect(validateCloseDraft(createCloseTradeDraft('all_remaining'), context()).actualR).toEqual({
      status: 'unavailable',
      reason: 'needs_pnl',
    });
    expect(validateCloseDraft(typed, context({ riskMinor: null })).actualR).toEqual({
      status: 'unavailable',
      reason: 'needs_risk',
    });
    // A stated zero is a real 0R.
    expect(
      validateCloseDraft(setFinalPnl(createCloseTradeDraft('all_remaining'), '0'), context())
        .actualR,
    ).toEqual({ status: 'known', value: '0.0000' });
  });

  it('keeps the outcome the trader chose, noticing — not blocking — a sign contradiction', () => {
    const draft = setOutcome(setFinalPnl(createCloseTradeDraft('all_remaining'), '-20'), 'win');
    const validation = validateCloseDraft(draft, context());
    expect(validation.errors).toEqual({});
    expect(validation.outcomeContradictsPnl).toBe(true);
    expect(buildClosePayload(draft, context(), IDS)).toMatchObject({ traderOutcome: 'win' });
  });

  it('sends nothing it was not told: no outcome, no completeness, no final time', () => {
    const payload = buildClosePayload(createCloseTradeDraft('all_remaining'), context(), IDS);
    expect(payload).toEqual({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      scope: 'all_remaining',
      realizedPnlMinor: null,
      closedBps: null,
      exitPrice: null,
      exitedAt: null,
      finalPnlMinor: null,
      finalExitedAt: null,
    });
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
  });

  it('refuses a final exit time before a recorded exit, and before this closing leg', () => {
    const exits = [
      { closedBps: 5_000, realizedPnlMinor: '4000', exitedAt: '2026-09-20T05:00:00.000Z' },
    ];
    const early = { ...createCloseTradeDraft('all_remaining'), finalExitedAt: '2026-09-20T11:59' };
    expect(validateCloseDraft(early, context({ exits })).errors.finalExitedAt).toBe(
      'final_exit_before_recorded_exit',
    );
    const legAfter = updateLeg(
      { ...createCloseTradeDraft('all_remaining'), finalExitedAt: '2026-09-20T13:00' },
      { exitedAt: '2026-09-20T14:00' },
    );
    expect(validateCloseDraft(legAfter, context()).errors.finalExitedAt).toBe(
      'final_exit_before_recorded_exit',
    );
    expect(lastRecordedExitTime(context({ exits }))).toBe('2026-09-20T05:00:00.000Z');
  });

  it('offers the exit subtotal only for a Complete, fully priced history, and marks the adoption', () => {
    const exits = [{ closedBps: 5_000, realizedPnlMinor: '4000', exitedAt: null }];
    const base = updateLeg(setFinalPnl(createCloseTradeDraft('all_remaining'), '75'), {
      pnl: '40',
    });
    // Not Complete: the subtotal is evidence only.
    expect(validateCloseDraft(base, context({ exits })).canAdoptExitSubtotal).toBe(false);
    const complete = setCompleteness(base, 'complete');
    const validation = validateCloseDraft(complete, context({ exits }));
    expect(validation.exitSubtotalMinor).toBe('8000');
    expect(validation.canAdoptExitSubtotal).toBe(true);

    const adopted = adoptRecordedExits(complete, '80.00');
    expect(adopted.finalPnlAdopted).toBe(true);
    expect(buildClosePayload(adopted, context({ exits }), IDS)).toMatchObject({
      finalPnlMinor: '8000',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
    });
    // Typing replaces the adopted figure with the trader's own.
    expect(setFinalPnl(adopted, '79').finalPnlAdopted).toBe(false);
    // An adoption the evidence no longer supports is caught before Save.
    const stale = updateLeg(adopted, { pnl: '41' });
    expect(validateCloseDraft(stale, context({ exits })).errors.finalPnl).toBe(
      'exit_history_not_adoptable',
    );
  });

  it('allows the closing leg to take exactly the rest of the position', () => {
    const exits = [{ closedBps: 6_000, realizedPnlMinor: null, exitedAt: null }];
    const rest = updateLeg(createCloseTradeDraft('all_remaining'), { closedPercent: '40' });
    expect(validateCloseDraft(rest, context({ exits })).errors).toEqual({});
    const over = updateLeg(createCloseTradeDraft('all_remaining'), { closedPercent: '41' });
    expect(validateCloseDraft(over, context({ exits })).errors['leg.closedPercent']).toBe(
      'percent_over_total',
    );
  });
});

describe('blocked-action routing', () => {
  it('focuses the final exit time first, then the result, then the leg', () => {
    expect(
      firstCloseErrorField({ 'leg.pnl': 'invalid_money', finalExitedAt: 'exit_time_in_future' }),
    ).toBe('finalExitedAt');
    expect(firstCloseErrorField({})).toBeNull();
  });

  it('sends each precise server exit-time error to the time it is about', () => {
    const part = createCloseTradeDraft('part');
    expect(serverErrorField('exit_time_in_future', part, context())).toBe('leg.exitedAt');
    const finalOnly = {
      ...createCloseTradeDraft('all_remaining'),
      finalExitedAt: '2026-09-20T10:00',
    };
    expect(serverErrorField('exit_time_before_entry', finalOnly, context())).toBe('finalExitedAt');
    const legOnly = updateLeg(createCloseTradeDraft('all_remaining'), {
      exitedAt: '2026-09-20T10:00',
    });
    expect(serverErrorField('exit_time_in_future', legOnly, context())).toBe('leg.exitedAt');
    expect(serverErrorField('final_exit_before_recorded_exit', finalOnly, context())).toBe(
      'finalExitedAt',
    );
    expect(serverErrorField('trade_not_found', finalOnly, context())).toBeNull();
  });
});
