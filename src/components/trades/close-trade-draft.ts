import Decimal from 'decimal.js';
import type { z } from 'zod';

import { actualR } from '@/lib/calc/trade';
import { reconcileExitHistory, traderOutcomeContradictsPnl } from '@/lib/trades/add-trade-contract';
import type { ExitHistoryCompleteness, OutcomeValue } from '@/lib/trades/constants';
import type { RecordContractExitSchema } from '@/lib/trades/schemas';

import { composeEntryTimestamp, entryTimestampParts, percentToBps } from './after-trade-draft';
import { datetimeLocalToIso, parseTradeMoneyInput } from './trade-form-values';

/**
 * STAGE 5 — EXIT & RESULT, for an existing Open contract Trade (Add Trade
 * contract §10–§12; lifecycle stage 5, Close Existing Open Trade).
 *
 * The entry action decides the scope, so the draft never asks for it: a Part
 * exit records one exit leg, and All Remaining is the explicit Final Close.
 * Every answer starts unanswered and stays optional; nothing here fills one in.
 *
 * TIMES are the same two-half shape Step 1 uses (`YYYY-MM-DD`, `THH:mm`, or
 * both joined): each half is the trader's own answer, a half on its own can be
 * neither saved nor dropped, and Save asks for the other half first.
 */

export type CloseScope = 'part' | 'all_remaining';
export type CloseCompleteness = 'unanswered' | ExitHistoryCompleteness;

/** One exit leg's answers — every one optional (contract §10). */
export interface ExitLegDraft {
  readonly pnl: string;
  readonly closedPercent: string;
  readonly exitedAt: string;
  readonly price: string;
  readonly reason: string;
}

export interface CloseTradeDraft {
  readonly scope: CloseScope;
  readonly leg: ExitLegDraft;
  /** All Remaining only: the Trade's final exit time. Never filled in for the trader. */
  readonly finalExitedAt: string;
  /** All Remaining only: the authoritative Final Net P&L, as typed or explicitly adopted. */
  readonly finalPnl: string;
  /** The Final Net P&L currently shown came from "Use recorded exits". */
  readonly finalPnlAdopted: boolean;
  readonly outcome: OutcomeValue | null;
  readonly completeness: CloseCompleteness;
}

/** What Stage 5 needs to know about the Trade it closes. */
export interface CloseTradeContext {
  readonly currency: string;
  readonly timezone: string;
  readonly now: Date;
  /** ISO instant, or null when the entry time was not recorded. */
  readonly enteredAt: string | null;
  /** Risk at Entry in minor units — the one 1R baseline. */
  readonly riskMinor: string | null;
  readonly exits: readonly {
    readonly closedBps: number | null;
    readonly realizedPnlMinor: string | null;
    readonly exitedAt: string | null;
  }[];
}

export type CloseField =
  'leg.exitedAt' | 'leg.pnl' | 'leg.closedPercent' | 'leg.price' | 'finalExitedAt' | 'finalPnl';

/** Reading order: where a blocked Save sends focus first. */
export const CLOSE_FIELD_ORDER: readonly CloseField[] = [
  'finalExitedAt',
  'finalPnl',
  'leg.exitedAt',
  'leg.pnl',
  'leg.closedPercent',
  'leg.price',
];

export type CloseErrorCode =
  | 'invalid_money'
  | 'invalid_price'
  | 'invalid_percent'
  /** A Part can never account for the whole position: only All Remaining closes it. */
  | 'part_closes_position'
  | 'percent_over_total'
  | 'invalid_datetime'
  | 'exit_time_required'
  | 'exit_date_required'
  | 'exit_time_before_entry'
  | 'exit_time_in_future'
  | 'final_exit_before_recorded_exit'
  | 'exit_history_not_adoptable'
  /** Server-side only: a field the server refused that no specific code describes. */
  | 'not_accepted';

export type CloseErrors = Partial<Record<CloseField, CloseErrorCode>>;

export type ActualRReadout =
  | { readonly status: 'known'; readonly value: string }
  | {
      readonly status: 'unavailable';
      readonly reason: 'needs_pnl_and_risk' | 'needs_risk' | 'needs_pnl';
    };

export interface CloseValidation {
  readonly errors: CloseErrors;
  readonly finalPnlMinor: string | null;
  readonly actualR: ActualRReadout;
  /** Every recorded exit plus this one, when each carries a valid P&L. */
  readonly exitSubtotalMinor: string | null;
  /** "Use recorded exits" may be offered: a Complete history, every leg priced. */
  readonly canAdoptExitSubtotal: boolean;
  readonly outcomeContradictsPnl: boolean;
}

export function blankExitLeg(): ExitLegDraft {
  return { pnl: '', closedPercent: '', exitedAt: '', price: '', reason: '' };
}

export function createCloseTradeDraft(scope: CloseScope): CloseTradeDraft {
  return {
    scope,
    leg: blankExitLeg(),
    finalExitedAt: '',
    finalPnl: '',
    finalPnlAdopted: false,
    outcome: null,
    completeness: 'unanswered',
  };
}

// ---------------------------------------------------------------------------
// Times: two halves, one instant
// ---------------------------------------------------------------------------

export function setTimeDate(value: string, date: string): string {
  return composeEntryTimestamp(date, entryTimestampParts(value).time);
}

export function setTimeTime(value: string, time: string): string {
  return composeEntryTimestamp(entryTimestampParts(value).date, time);
}

/** The latest time any recorded exit leg states, for "Use last recorded exit time". */
export function lastRecordedExitTime(context: CloseTradeContext): string | null {
  let latest: string | null = null;
  for (const exit of context.exits) {
    if (exit.exitedAt === null) continue;
    if (latest === null || Date.parse(exit.exitedAt) > Date.parse(latest)) latest = exit.exitedAt;
  }
  return latest;
}

type TimeCheck = { readonly time: number | null; readonly error: CloseErrorCode | null };

function checkTime(value: string, context: CloseTradeContext): TimeCheck {
  if (value === '') return { time: null, error: null };
  const parts = entryTimestampParts(value);
  if (parts.date !== '' && parts.time === '') return { time: null, error: 'exit_time_required' };
  if (parts.date === '' && parts.time !== '') return { time: null, error: 'exit_date_required' };
  const parsed = datetimeLocalToIso(value, context.timezone);
  if (!parsed.ok) return { time: null, error: 'invalid_datetime' };
  const time = Date.parse(parsed.value);
  if (time > context.now.getTime()) return { time, error: 'exit_time_in_future' };
  if (context.enteredAt !== null && time < Date.parse(context.enteredAt)) {
    return { time, error: 'exit_time_before_entry' };
  }
  return { time, error: null };
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export function updateLeg(draft: CloseTradeDraft, patch: Partial<ExitLegDraft>): CloseTradeDraft {
  return { ...draft, leg: { ...draft.leg, ...patch } };
}

/** Typing the Final Net P&L makes it the trader's own figure again. */
export function setFinalPnl(draft: CloseTradeDraft, finalPnl: string): CloseTradeDraft {
  return { ...draft, finalPnl, finalPnlAdopted: false };
}

/** The explicit "Use recorded exits": the subtotal becomes the Final Net P&L, and says so. */
export function adoptRecordedExits(draft: CloseTradeDraft, subtotalText: string): CloseTradeDraft {
  return { ...draft, finalPnl: subtotalText, finalPnlAdopted: true };
}

export function setOutcome(draft: CloseTradeDraft, outcome: OutcomeValue | null): CloseTradeDraft {
  return { ...draft, outcome };
}

export function setCompleteness(
  draft: CloseTradeDraft,
  completeness: CloseCompleteness,
): CloseTradeDraft {
  return { ...draft, completeness };
}

// ---------------------------------------------------------------------------
// Validation and derived figures
// ---------------------------------------------------------------------------

const PRICE = /^\d+(\.\d+)?$/;

export function validateCloseDraft(
  draft: CloseTradeDraft,
  context: CloseTradeContext,
): CloseValidation {
  const errors: CloseErrors = {};
  const allRemaining = draft.scope === 'all_remaining';

  const legTime = checkTime(draft.leg.exitedAt, context);
  if (legTime.error !== null) errors['leg.exitedAt'] = legTime.error;

  let legPnlMinor: string | null = null;
  if (draft.leg.pnl.trim() !== '') {
    const parsed = parseTradeMoneyInput(draft.leg.pnl, context.currency, {
      allowNegative: true,
      allowZero: true,
    });
    if (parsed.ok) legPnlMinor = parsed.value;
    else errors['leg.pnl'] = 'invalid_money';
  }

  const bps = percentToBps(draft.leg.closedPercent);
  if (bps === 'invalid') {
    errors['leg.closedPercent'] = 'invalid_percent';
  } else if (bps !== null) {
    const recorded = context.exits.reduce((sum, exit) => sum + (exit.closedBps ?? 0), 0);
    if (allRemaining ? recorded + bps > 10_000 : recorded + bps >= 10_000) {
      errors['leg.closedPercent'] = allRemaining ? 'percent_over_total' : 'part_closes_position';
    }
  }

  const price = draft.leg.price.trim();
  if (price !== '' && (!PRICE.test(price) || new Decimal(price).lte(0))) {
    errors['leg.price'] = 'invalid_price';
  }

  let finalPnlMinor: string | null = null;
  if (allRemaining) {
    const finalTime = checkTime(draft.finalExitedAt, context);
    if (finalTime.error !== null) {
      errors.finalExitedAt = finalTime.error;
    } else if (finalTime.time !== null) {
      const legTimes = [
        ...context.exits.map((exit) => (exit.exitedAt === null ? null : Date.parse(exit.exitedAt))),
        legTime.time,
      ];
      if (legTimes.some((time) => time !== null && time > (finalTime.time ?? 0))) {
        errors.finalExitedAt = 'final_exit_before_recorded_exit';
      }
    }
    if (draft.finalPnl.trim() !== '') {
      const parsed = parseTradeMoneyInput(draft.finalPnl, context.currency, {
        allowNegative: true,
        allowZero: true,
      });
      if (parsed.ok) finalPnlMinor = parsed.value;
      else errors.finalPnl = 'invalid_money';
    }
  }

  const legPnls = allRemaining
    ? [
        ...context.exits.map((exit) =>
          exit.realizedPnlMinor === null ? null : BigInt(exit.realizedPnlMinor),
        ),
        errors['leg.pnl'] === undefined && legPnlMinor !== null ? BigInt(legPnlMinor) : null,
      ]
    : [];
  const reconciliation = reconcileExitHistory({
    completeness: draft.completeness === 'unanswered' ? null : draft.completeness,
    exitPnlMinor: legPnls,
    finalNetPnlMinor: finalPnlMinor === null ? null : BigInt(finalPnlMinor),
  });
  // An adopted figure that no longer matches the evidence is not adoptable any more.
  if (
    allRemaining &&
    draft.finalPnlAdopted &&
    finalPnlMinor !== null &&
    (draft.completeness !== 'complete' ||
      reconciliation.subtotalMinor === null ||
      reconciliation.subtotalMinor.toString() !== finalPnlMinor)
  ) {
    errors.finalPnl ??= 'exit_history_not_adoptable';
  }

  let readout: ActualRReadout;
  if (finalPnlMinor === null || context.riskMinor === null) {
    readout = {
      status: 'unavailable',
      reason:
        finalPnlMinor === null && context.riskMinor === null
          ? 'needs_pnl_and_risk'
          : context.riskMinor === null
            ? 'needs_risk'
            : 'needs_pnl',
    };
  } else {
    const measured = actualR(BigInt(finalPnlMinor), BigInt(context.riskMinor));
    readout = measured.ok
      ? { status: 'known', value: measured.value }
      : { status: 'unavailable', reason: 'needs_risk' };
  }

  return {
    errors,
    finalPnlMinor,
    actualR: readout,
    exitSubtotalMinor:
      reconciliation.subtotalMinor === null ? null : reconciliation.subtotalMinor.toString(),
    canAdoptExitSubtotal: allRemaining && reconciliation.adoptable,
    outcomeContradictsPnl:
      allRemaining &&
      traderOutcomeContradictsPnl(
        draft.outcome,
        finalPnlMinor === null ? null : BigInt(finalPnlMinor),
      ),
  };
}

export function firstCloseErrorField(errors: CloseErrors): CloseField | null {
  return CLOSE_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

/**
 * Where a server refusal belongs on screen. The precise exit-time codes name
 * which time they are about; the client re-reads the draft to tell the leg's
 * own time from the Trade's final one.
 */
export function serverErrorField(
  code: string,
  draft: CloseTradeDraft,
  context: CloseTradeContext,
): CloseField | null {
  switch (code) {
    case 'exit_time_before_entry':
    case 'exit_time_in_future': {
      if (draft.scope === 'part') return 'leg.exitedAt';
      const legError = checkTime(draft.leg.exitedAt, context).error;
      if (draft.leg.exitedAt !== '' && (legError === code || draft.finalExitedAt === '')) {
        return 'leg.exitedAt';
      }
      return 'finalExitedAt';
    }
    case 'final_exit_before_recorded_exit':
      return 'finalExitedAt';
    case 'invalid_closed_bps':
      return 'leg.closedPercent';
    case 'exit_history_not_adoptable':
      return 'finalPnl';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The canonical request
// ---------------------------------------------------------------------------

export type RecordContractExitPayload = z.input<typeof RecordContractExitSchema>;

function localToIso(value: string, timezone: string): string | null {
  if (value === '') return null;
  const parsed = datetimeLocalToIso(value, timezone);
  return parsed.ok ? parsed.value : null;
}

/**
 * The request for `recordContractExitAction`. Built only from a draft that
 * validated clean: unanswered stays absent, never zero, "now" or a guess.
 */
export function buildClosePayload(
  draft: CloseTradeDraft,
  context: CloseTradeContext,
  ids: { readonly tradeId: string; readonly mutationKey: string },
): RecordContractExitPayload {
  const legPnl =
    draft.leg.pnl.trim() === ''
      ? null
      : parseTradeMoneyInput(draft.leg.pnl, context.currency, {
          allowNegative: true,
          allowZero: true,
        });
  const bps = percentToBps(draft.leg.closedPercent);
  const leg = {
    realizedPnlMinor: legPnl !== null && legPnl.ok ? legPnl.value : null,
    closedBps: typeof bps === 'number' ? bps : null,
    exitPrice: draft.leg.price.trim() === '' ? null : draft.leg.price.trim(),
    exitedAt: localToIso(draft.leg.exitedAt, context.timezone),
    ...(draft.leg.reason.trim() === '' ? {} : { exitReason: draft.leg.reason.trim() }),
  };
  if (draft.scope === 'part') {
    return { tradeId: ids.tradeId, mutationKey: ids.mutationKey, scope: 'part', ...leg };
  }
  const final =
    draft.finalPnl.trim() === ''
      ? null
      : parseTradeMoneyInput(draft.finalPnl, context.currency, {
          allowNegative: true,
          allowZero: true,
        });
  return {
    tradeId: ids.tradeId,
    mutationKey: ids.mutationKey,
    scope: 'all_remaining',
    ...leg,
    finalPnlMinor: final !== null && final.ok ? final.value : null,
    ...(draft.finalPnlAdopted ? { finalPnlAdoptedFromExits: true as const } : {}),
    ...(draft.outcome === null ? {} : { traderOutcome: draft.outcome }),
    ...(draft.completeness === 'unanswered' ? {} : { exitHistoryCompleteness: draft.completeness }),
    finalExitedAt: localToIso(draft.finalExitedAt, context.timezone),
  };
}
