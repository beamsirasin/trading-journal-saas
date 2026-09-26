import { describe, expect, it } from 'vitest';

import { RecordContractExitSchema } from '@/lib/trades/schemas';

import {
  buildClosePayload,
  createCloseTradeDraft,
  effectiveCloseMode,
  firstCloseErrorField,
  lastRecordedExitTime,
  serverErrorField,
  setCloseMode,
  setFinalPnl,
  setOutcome,
  setPartsResult,
  updateLeg,
  validateCloseDraft,
  type CloseTradeContext,
  type CloseTradeDraft,
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

/** A Final Close answered the way Record Closed would be. */
const allAtOnce = (pnl: string): CloseTradeDraft =>
  updateLeg(setCloseMode(createCloseTradeDraft('all_remaining'), 'all_at_once'), { pnl });
const inParts = (partsResult: 'each_exit' | 'total_only'): CloseTradeDraft =>
  setPartsResult(setCloseMode(createCloseTradeDraft('all_remaining'), 'in_parts'), partsResult);

describe('All Remaining — the Final Close, as canonical Step 5 (decisions 57–58)', () => {
  it('"Closed all at once": the closing exit\'s P&L is the result, sent as adopted from it', () => {
    const draft = updateLeg(allAtOnce('-50'), { price: '2400', reason: '  stop  ' });
    const validation = validateCloseDraft(draft, context());
    expect(validation.errors).toEqual({});
    expect(validation.finalPnlMinor).toBe('-5000');
    expect(validation.actualR).toEqual({ status: 'known', value: '-0.5000' });
    expect(validation.closing).toMatchObject({
      mode: 'all_at_once',
      source: 'full_close',
      exitCount: 1,
      closed: true,
    });
    const payload = buildClosePayload(draft, context(), IDS);
    expect(payload).toEqual({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      scope: 'all_remaining',
      realizedPnlMinor: '-5000',
      closedBps: null,
      exitPrice: '2400',
      exitedAt: null,
      exitReason: 'stop',
      finalPnlMinor: '-5000',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
      finalExitedAt: null,
    });
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
  });

  it('never fabricates a result: no close answer, no P&L — unknown, never 0R', () => {
    expect(validateCloseDraft(createCloseTradeDraft('all_remaining'), context())).toMatchObject({
      finalPnlMinor: null,
      actualR: { status: 'unavailable', reason: 'needs_pnl' },
      closing: { mode: 'unanswered', source: null },
    });
    expect(validateCloseDraft(allAtOnce(''), context()).finalPnlMinor).toBeNull();
    // A stated zero is a real 0R.
    expect(validateCloseDraft(allAtOnce('0'), context()).actualR).toEqual({
      status: 'known',
      value: '0.0000',
    });
    expect(validateCloseDraft(allAtOnce('-50'), context({ riskMinor: null })).actualR).toEqual({
      status: 'unavailable',
      reason: 'needs_risk',
    });
  });

  it('a Trade with recorded exits was closed in parts: that is not asked again', () => {
    const exits = [{ closedBps: 6_000, realizedPnlMinor: '4000', exitedAt: null }];
    const draft = createCloseTradeDraft('all_remaining');
    expect(effectiveCloseMode(draft, context())).toBe('unanswered');
    expect(effectiveCloseMode(draft, context({ exits }))).toBe('in_parts');
    // Even an answer given before the exits were recorded does not override them.
    expect(effectiveCloseMode(setCloseMode(draft, 'all_at_once'), context({ exits }))).toBe(
      'in_parts',
    );
  });

  it('"Record each exit": the recorded exits plus the closing exit — final only once every one has P&L', () => {
    const exits = [{ closedBps: 6_000, realizedPnlMinor: '4000', exitedAt: null }];
    const waiting = validateCloseDraft(inParts('each_exit'), context({ exits }));
    // The closing exit is All remaining, so the close is proven — the result is not.
    expect(waiting.closing).toMatchObject({
      mode: 'in_parts',
      partsResult: 'each_exit',
      exitCount: 2,
      accountedBps: 10_000,
      closed: true,
      missingPnl: true,
      recordedSoFarMinor: '4000',
    });
    expect(waiting.finalPnlMinor).toBeNull();

    const draft = updateLeg(inParts('each_exit'), { pnl: '35', closedPercent: '40' });
    const validation = validateCloseDraft(draft, context({ exits }));
    expect(validation.finalPnlMinor).toBe('7500');
    expect(validation.closing).toMatchObject({ source: 'exit_legs', missingPnl: false });
    const payload = buildClosePayload(draft, context({ exits }), IDS);
    expect(payload).toMatchObject({
      realizedPnlMinor: '3500',
      closedBps: 4_000,
      finalPnlMinor: '7500',
      finalPnlAdoptedFromExits: true,
      exitHistoryCompleteness: 'complete',
    });
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
  });

  it('an earlier exit without P&L keeps "Record each exit" waiting — never a partial sum', () => {
    const exits = [{ closedBps: 5_000, realizedPnlMinor: null, exitedAt: null }];
    const draft = updateLeg(inParts('each_exit'), { pnl: '35' });
    const validation = validateCloseDraft(draft, context({ exits }));
    expect(validation.finalPnlMinor).toBeNull();
    expect(validation.closing).toMatchObject({ missingPnl: true, recordedSoFarMinor: '3500' });
  });

  it('"I only know the final result": the stated total, and no exit P&L made up for it', () => {
    const exits = [{ closedBps: 5_000, realizedPnlMinor: '4000', exitedAt: null }];
    // Answers given under another way of recording stay in the draft, unsent.
    const draft = updateLeg(setFinalPnl(inParts('total_only'), '120'), {
      pnl: '99',
      price: '2400',
      reason: 'kept, not sent',
    });
    const validation = validateCloseDraft(draft, context({ exits }));
    expect(validation.finalPnlMinor).toBe('12000');
    expect(validation.closing).toMatchObject({ source: 'stated_total', exitCount: 0 });
    const payload = buildClosePayload(draft, context({ exits }), IDS);
    expect(payload).toEqual({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      scope: 'all_remaining',
      realizedPnlMinor: null,
      closedBps: null,
      exitPrice: null,
      exitedAt: null,
      finalPnlMinor: '12000',
      finalExitedAt: null,
    });
    expect(RecordContractExitSchema.safeParse(payload).success).toBe(true);
    expect(validateCloseDraft(setFinalPnl(draft, 'abc'), context({ exits })).errors).toEqual({
      finalPnl: 'invalid_money',
    });
  });

  it('keeps the outcome the trader chose, noticing — not blocking — a sign contradiction', () => {
    const draft = setOutcome(allAtOnce('-20'), 'win');
    const validation = validateCloseDraft(draft, context());
    expect(validation.errors).toEqual({});
    expect(validation.outcomeContradictsPnl).toBe(true);
    expect(buildClosePayload(draft, context(), IDS)).toMatchObject({ traderOutcome: 'win' });
  });

  it('sends nothing it was not told: no outcome, no result, no final time', () => {
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

  it('refuses a final exit time before a recorded exit', () => {
    const exits = [
      { closedBps: 5_000, realizedPnlMinor: '4000', exitedAt: '2026-09-20T05:00:00.000Z' },
    ];
    const early = { ...createCloseTradeDraft('all_remaining'), finalExitedAt: '2026-09-20T11:59' };
    expect(validateCloseDraft(early, context({ exits })).errors.finalExitedAt).toBe(
      'final_exit_before_recorded_exit',
    );
    expect(lastRecordedExitTime(context({ exits }))).toBe('2026-09-20T05:00:00.000Z');
  });

  it('allows the closing exit to take exactly the rest of the position', () => {
    const exits = [{ closedBps: 6_000, realizedPnlMinor: null, exitedAt: null }];
    const rest = updateLeg(inParts('each_exit'), { closedPercent: '40' });
    expect(validateCloseDraft(rest, context({ exits })).errors).toEqual({});
    const over = updateLeg(inParts('each_exit'), { closedPercent: '41' });
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
    expect(serverErrorField('exit_time_in_future', createCloseTradeDraft('part'))).toBe(
      'leg.exitedAt',
    );
    // A Final Close sends one time — the final exit time.
    const close = createCloseTradeDraft('all_remaining');
    expect(serverErrorField('exit_time_before_entry', close)).toBe('finalExitedAt');
    expect(serverErrorField('exit_time_in_future', close)).toBe('finalExitedAt');
    expect(serverErrorField('final_exit_before_recorded_exit', close)).toBe('finalExitedAt');
    expect(serverErrorField('exit_history_not_adoptable', close)).toBe('leg.pnl');
    expect(serverErrorField('trade_not_found', close)).toBeNull();
  });
});
