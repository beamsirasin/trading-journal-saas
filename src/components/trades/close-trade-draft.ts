import Decimal from 'decimal.js';
import type { z } from 'zod';

import { actualR } from '@/lib/calc/trade';
import { traderOutcomeContradictsPnl } from '@/lib/trades/add-trade-contract';
import type { OutcomeValue } from '@/lib/trades/constants';
import type { RecordContractExitSchema } from '@/lib/trades/schemas';

import {
  composeEntryTimestamp,
  entryTimestampParts,
  percentToBps,
  type CloseMode,
  type ClosingState,
  type PartsResult,
} from './after-trade-draft';
import type { ExitPlanDraft } from './at-entry-draft';
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
export type { CloseMode, PartsResult };

/** One exit leg's answers — every one optional (contract §10). */
export interface ExitLegDraft {
  readonly pnl: string;
  readonly closedPercent: string;
  readonly exitedAt: string;
  readonly price: string;
  readonly reason: string;
}

/**
 * THE REQUIRED PLAN ANSWERS A FINAL CLOSE MAY GIVE (decision 59): the Risk
 * decision, the Target and — with No Fixed Target — the Exit Plan, asked only
 * when the Trade does not hold them yet. Nothing here overwrites an answer the
 * Trade already has; it fills what is missing, at the close.
 */
export interface ClosePlanDraft {
  readonly riskState: 'unanswered' | 'defined' | 'no_defined';
  readonly risk: string;
  readonly target: {
    readonly state: 'unanswered' | 'fixed' | 'no_fixed';
    readonly profit: string;
    readonly price: string;
  };
  readonly exitPlan: ExitPlanDraft;
}

export const BLANK_CLOSE_PLAN: ClosePlanDraft = {
  riskState: 'unanswered',
  risk: '',
  target: { state: 'unanswered', profit: '', price: '' },
  exitPlan: { choice: { kind: 'unanswered' }, customText: '', customBaseId: null },
};

/**
 * THE FINAL CLOSE READS AS CANONICAL STEP 5 (decisions 57–58), exactly as
 * Record Closed asks it: how the Trade closed, and — closed in parts — how its
 * result is recorded. One source for the result:
 *
 * - "Closed all at once": the closing exit is the only exit; its P&L is the
 *   Final Net P&L (adopted from the exits, never typed beside them).
 * - "Record each exit": the exits recorded before this close plus the closing
 *   exit; their sum is the result once every one states its P&L.
 * - "I only know the final result": a stated total (`finalPnl`); no exit P&L
 *   is made up for it.
 *
 * The closing exit (`leg`) is always All remaining: a Final Close closes
 * whatever is left. A Trade that already has exits was closed in parts — the
 * recorded exits say so — so only the second question is asked then.
 */
export interface CloseTradeDraft {
  readonly scope: CloseScope;
  /** Part: the one exit. All Remaining: the closing exit. */
  readonly leg: ExitLegDraft;
  /** All Remaining only: the Trade's final exit time. Never filled in for the trader. */
  readonly finalExitedAt: string;
  /** All Remaining only: how the Trade closed. */
  readonly closeMode: CloseMode;
  /** All Remaining, closed in parts: how the result is recorded. */
  readonly partsResult: PartsResult;
  /** All Remaining, "I only know the final result": the stated Final Net P&L. */
  readonly finalPnl: string;
  readonly outcome: OutcomeValue | null;
  /** All Remaining only: Required plan answers the Trade lacks (decision 59). */
  readonly plan: ClosePlanDraft;
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
  /**
   * What the Trade already answers of its Required plan (decision 59). A
   * Risk counts once No Defined Risk or a 1R is on record.
   */
  readonly plan?: {
    readonly riskAnswered: boolean;
    readonly noDefinedRisk: boolean;
    readonly targetState: 'fixed' | 'no_fixed' | null;
    readonly exitPlanAnswered: boolean;
  };
}

export type CloseField =
  | 'leg.exitedAt'
  | 'leg.pnl'
  | 'leg.closedPercent'
  | 'leg.price'
  | 'finalExitedAt'
  | 'finalPnl'
  | 'plan.risk'
  | 'plan.targetProfit'
  | 'plan.targetPrice';

/** Reading order: where a blocked Save sends focus first. */
export const CLOSE_FIELD_ORDER: readonly CloseField[] = [
  'plan.risk',
  'plan.targetProfit',
  'plan.targetPrice',
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
  /** A Defined Risk given at the close needs its amount — or the answer removed. */
  | 'risk_amount_required'
  /** A Fixed Target given at the close needs Target Profit or a TP price. */
  | 'fixed_target_requires_value'
  /** Server-side only: a field the server refused that no specific code describes. */
  | 'not_accepted';

export type CloseErrors = Partial<Record<CloseField, CloseErrorCode>>;

export type ActualRReadout =
  | { readonly status: 'known'; readonly value: string }
  | {
      readonly status: 'unavailable';
      /** 'no_defined_risk': the trader stated there was no planned 1R (decision 54). */
      readonly reason: 'needs_pnl_and_risk' | 'needs_risk' | 'needs_pnl' | 'no_defined_risk';
    };

export interface CloseValidation {
  readonly errors: CloseErrors;
  /** The Final Net P&L the close proves — never a running figure. */
  readonly finalPnlMinor: string | null;
  readonly actualR: ActualRReadout;
  /** Where the close stands, in Record Closed's own terms (decision 57). */
  readonly closing: ClosingState;
  readonly outcomeContradictsPnl: boolean;
  /** A Defined Risk amount given at the close, when valid. */
  readonly planRiskMinor: string | null;
}

export function blankExitLeg(): ExitLegDraft {
  return { pnl: '', closedPercent: '', exitedAt: '', price: '', reason: '' };
}

export function createCloseTradeDraft(scope: CloseScope): CloseTradeDraft {
  return {
    scope,
    leg: blankExitLeg(),
    finalExitedAt: '',
    closeMode: 'unanswered',
    partsResult: 'unanswered',
    finalPnl: '',
    outcome: null,
    plan: BLANK_CLOSE_PLAN,
  };
}

export function updateClosePlan(
  draft: CloseTradeDraft,
  patch: Partial<ClosePlanDraft>,
): CloseTradeDraft {
  return { ...draft, plan: { ...draft.plan, ...patch } };
}

/** An Exit Plan answer given here: a library plan, the trader's own words, or No exit rule. */
function exitPlanChosen(exitPlan: ExitPlanDraft): boolean {
  const { choice } = exitPlan;
  return (
    choice.kind === 'saved' ||
    choice.kind === 'no_rule' ||
    (choice.kind === 'customized' && exitPlan.customText.trim() !== '')
  );
}

/** The Target the Trade will hold after this close: its own, else the one given here. */
export function effectiveCloseTarget(
  draft: CloseTradeDraft,
  context: CloseTradeContext,
): 'fixed' | 'no_fixed' | null {
  const own = context.plan?.targetState ?? null;
  if (own !== null) return own;
  return draft.plan.target.state === 'unanswered' ? null : draft.plan.target.state;
}

/**
 * FINAL CLOSE ELIGIBILITY, AS THE SERVER CHECKS IT (decision 59): every
 * applicable Required item of Steps 1–5, from what the Trade holds plus this
 * close. Recommended and Optional never appear here.
 */
export function missingForFinalClose(
  draft: CloseTradeDraft,
  context: CloseTradeContext,
  validation: Pick<CloseValidation, 'finalPnlMinor' | 'planRiskMinor'>,
): readonly ('risk' | 'target' | 'exitPlan' | 'outcome' | 'traderResult')[] {
  if (draft.scope !== 'all_remaining') return [];
  const trade = context.plan ?? {
    riskAnswered: true,
    noDefinedRisk: false,
    targetState: null,
    exitPlanAnswered: false,
  };
  const missing: ('risk' | 'target' | 'exitPlan' | 'outcome' | 'traderResult')[] = [];
  const riskGiven =
    draft.plan.riskState === 'no_defined' ||
    (draft.plan.riskState === 'defined' && validation.planRiskMinor !== null);
  if (!trade.riskAnswered && !riskGiven) missing.push('risk');
  const target = effectiveCloseTarget(draft, context);
  if (target === null) missing.push('target');
  if (target === 'no_fixed' && !trade.exitPlanAnswered && !exitPlanChosen(draft.plan.exitPlan)) {
    missing.push('exitPlan');
  }
  if (draft.outcome === null) missing.push('outcome');
  if (validation.finalPnlMinor === null) missing.push('traderResult');
  return missing;
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

/** "I only know the final result": the trader's own total. */
export function setFinalPnl(draft: CloseTradeDraft, finalPnl: string): CloseTradeDraft {
  return { ...draft, finalPnl };
}

export function setOutcome(draft: CloseTradeDraft, outcome: OutcomeValue | null): CloseTradeDraft {
  return { ...draft, outcome };
}

/** Choosing how the Trade closed; each way keeps its own answers. */
export function setCloseMode(draft: CloseTradeDraft, closeMode: CloseMode): CloseTradeDraft {
  return { ...draft, closeMode };
}

/** Choosing how a close in parts is recorded; each way keeps its own answers. */
export function setPartsResult(draft: CloseTradeDraft, partsResult: PartsResult): CloseTradeDraft {
  return { ...draft, partsResult };
}

/**
 * HOW THIS TRADE CLOSED, AS THE STEP READS IT. Exits recorded before the
 * Final Close already prove it closed in parts, so that is not asked again;
 * otherwise it is the trader's own answer, Unanswered until given.
 */
export function effectiveCloseMode(draft: CloseTradeDraft, context: CloseTradeContext): CloseMode {
  return context.exits.length > 0 ? 'in_parts' : draft.closeMode;
}

/** Whether the closing exit carries answers in this way of recording the close. */
function closingLegUsed(mode: CloseMode, partsResult: PartsResult): boolean {
  return mode === 'all_at_once' || (mode === 'in_parts' && partsResult === 'each_exit');
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
  const mode = allRemaining ? effectiveCloseMode(draft, context) : 'unanswered';
  // The closing exit is read only where the chosen way of closing records it.
  const legUsed = !allRemaining || closingLegUsed(mode, draft.partsResult);

  // A Final Close's closing exit takes the final exit time, asked once on its own.
  const legTime: TimeCheck = allRemaining
    ? { time: null, error: null }
    : checkTime(draft.leg.exitedAt, context);
  if (legTime.error !== null) errors['leg.exitedAt'] = legTime.error;

  let legPnlMinor: string | null = null;
  if (legUsed && draft.leg.pnl.trim() !== '') {
    const parsed = parseTradeMoneyInput(draft.leg.pnl, context.currency, {
      allowNegative: true,
      allowZero: true,
    });
    if (parsed.ok) legPnlMinor = parsed.value;
    else errors['leg.pnl'] = 'invalid_money';
  }

  // "Closed all at once" asks no share: the one exit is the whole position.
  const percentAsked = !allRemaining || (mode === 'in_parts' && draft.partsResult === 'each_exit');
  const bps = percentAsked ? percentToBps(draft.leg.closedPercent) : null;
  if (bps === 'invalid') {
    errors['leg.closedPercent'] = 'invalid_percent';
  } else if (bps !== null) {
    const recorded = context.exits.reduce((sum, exit) => sum + (exit.closedBps ?? 0), 0);
    if (allRemaining ? recorded + bps > 10_000 : recorded + bps >= 10_000) {
      errors['leg.closedPercent'] = allRemaining ? 'percent_over_total' : 'part_closes_position';
    }
  }

  const price = draft.leg.price.trim();
  if (legUsed && price !== '' && (!PRICE.test(price) || new Decimal(price).lte(0))) {
    errors['leg.price'] = 'invalid_price';
  }

  if (allRemaining) {
    const finalTime = checkTime(draft.finalExitedAt, context);
    if (finalTime.error !== null) {
      errors.finalExitedAt = finalTime.error;
    } else if (finalTime.time !== null) {
      const recordedTimes = context.exits.map((exit) =>
        exit.exitedAt === null ? null : Date.parse(exit.exitedAt),
      );
      if (recordedTimes.some((time) => time !== null && time > (finalTime.time ?? 0))) {
        errors.finalExitedAt = 'final_exit_before_recorded_exit';
      }
    }
  }

  /*
    ONE SOURCE (decisions 57–58), read exactly as Record Closed reads it. The
    closing exit is All remaining, so a close recorded exit by exit is always
    proven closed; its Final Net P&L is the sum of the exits once every one
    states its P&L. A stated total is the trader's own, and nothing else.
  */
  const legsCounted = allRemaining && closingLegUsed(mode, draft.partsResult);
  const priorPnl = context.exits.map((exit) =>
    exit.realizedPnlMinor === null ? null : BigInt(exit.realizedPnlMinor),
  );
  const closingPnl = legPnlMinor === null ? null : BigInt(legPnlMinor);
  const exitPnl = !legsCounted
    ? []
    : mode === 'all_at_once'
      ? [closingPnl]
      : [...priorPnl, closingPnl];
  const knownPnl = exitPnl.filter((pnl): pnl is bigint => pnl !== null);
  const sum = knownPnl.reduce((total, pnl) => total + pnl, 0n);
  const everyPnl = exitPnl.length > 0 && exitPnl.every((pnl) => pnl !== null);
  let finalPnlMinor: string | null = null;
  let source: ClosingState['source'] = null;
  if (legsCounted && everyPnl) {
    finalPnlMinor = sum.toString();
    source = mode === 'all_at_once' ? 'full_close' : 'exit_legs';
  }
  if (allRemaining && mode === 'in_parts' && draft.partsResult === 'total_only') {
    if (draft.finalPnl.trim() !== '') {
      const stated = parseTradeMoneyInput(draft.finalPnl, context.currency, {
        allowNegative: true,
        allowZero: true,
      });
      if (stated.ok) {
        finalPnlMinor = stated.value;
        source = 'stated_total';
      } else errors.finalPnl = 'invalid_money';
    }
  }
  const closing: ClosingState = {
    mode,
    partsResult: draft.partsResult,
    source,
    exitCount: exitPnl.length,
    accountedBps: legsCounted ? 10_000 : null,
    closed: legsCounted,
    missingPnl: legsCounted && !everyPnl,
    recordedSoFarMinor: finalPnlMinor === null && knownPnl.length > 0 ? sum.toString() : null,
  };

  /*
    PLAN ANSWERS GIVEN AT THE CLOSE (decision 59) — checked only where the
    Trade does not already hold them. Defined Risk needs its amount; a Fixed
    Target needs Target Profit or a TP price; both are half answers otherwise.
  */
  let planRiskMinor: string | null = null;
  const tradePlan = context.plan;
  if (allRemaining && tradePlan !== undefined && !tradePlan.riskAnswered) {
    if (draft.plan.riskState === 'defined') {
      if (draft.plan.risk.trim() === '') errors['plan.risk'] = 'risk_amount_required';
      else {
        const parsed = parseTradeMoneyInput(draft.plan.risk, context.currency);
        if (parsed.ok) planRiskMinor = parsed.value;
        else errors['plan.risk'] = 'invalid_money';
      }
    }
  }
  if (allRemaining && tradePlan !== undefined && tradePlan.targetState === null) {
    if (draft.plan.target.state === 'fixed') {
      const profit = draft.plan.target.profit.trim();
      const tp = draft.plan.target.price.trim();
      if (profit === '' && tp === '') errors['plan.targetProfit'] = 'fixed_target_requires_value';
      if (profit !== '' && !parseTradeMoneyInput(profit, context.currency).ok) {
        errors['plan.targetProfit'] = 'invalid_money';
      }
      if (tp !== '' && (!PRICE.test(tp) || new Decimal(tp).lte(0))) {
        errors['plan.targetPrice'] = 'invalid_price';
      }
    }
  }
  // The 1R this close measures against: the Trade's own, else the one given here.
  const riskMinor = context.riskMinor ?? planRiskMinor;
  const noDefinedRisk =
    tradePlan?.noDefinedRisk === true ||
    (tradePlan !== undefined && !tradePlan.riskAnswered && draft.plan.riskState === 'no_defined');

  let readout: ActualRReadout;
  if (noDefinedRisk) {
    readout = { status: 'unavailable', reason: 'no_defined_risk' };
  } else if (finalPnlMinor === null || riskMinor === null) {
    readout = {
      status: 'unavailable',
      reason:
        finalPnlMinor === null && riskMinor === null
          ? 'needs_pnl_and_risk'
          : riskMinor === null
            ? 'needs_risk'
            : 'needs_pnl',
    };
  } else {
    const measured = actualR(BigInt(finalPnlMinor), BigInt(riskMinor));
    readout = measured.ok
      ? { status: 'known', value: measured.value }
      : { status: 'unavailable', reason: 'needs_risk' };
  }

  return {
    errors,
    finalPnlMinor,
    actualR: readout,
    closing,
    outcomeContradictsPnl:
      allRemaining &&
      traderOutcomeContradictsPnl(
        draft.outcome,
        finalPnlMinor === null ? null : BigInt(finalPnlMinor),
      ),
    planRiskMinor,
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
export function serverErrorField(code: string, draft: CloseTradeDraft): CloseField | null {
  switch (code) {
    case 'exit_time_before_entry':
    case 'exit_time_in_future':
      // A Final Close sends one time: the final exit time.
      return draft.scope === 'part' ? 'leg.exitedAt' : 'finalExitedAt';
    case 'final_exit_before_recorded_exit':
      return 'finalExitedAt';
    case 'invalid_closed_bps':
      return 'leg.closedPercent';
    case 'exit_history_not_adoptable':
      // The result is the exits' own sum; a refusal belongs to the closing exit's P&L.
      return 'leg.pnl';
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
 * THE PLAN ANSWERS THIS CLOSE COMPLETES (decision 59), for items the Trade
 * does not hold. Unanswered here stays absent; an Exit Plan is sent only where
 * it is Required — with No Fixed Target — and was given.
 */
function closePlanPayload(
  draft: CloseTradeDraft,
  context: CloseTradeContext,
): NonNullable<Extract<RecordContractExitPayload, { scope: 'all_remaining' }>['plan']> | null {
  const trade = context.plan;
  if (trade === undefined) return null;
  const plan: Record<string, unknown> = {};
  if (!trade.riskAnswered && draft.plan.riskState !== 'unanswered') {
    plan.plannedRiskState = draft.plan.riskState;
    if (draft.plan.riskState === 'defined') {
      const risk = parseTradeMoneyInput(draft.plan.risk, context.currency);
      plan.plannedRiskMinor = risk.ok ? risk.value : null;
    }
  }
  if (trade.targetState === null && draft.plan.target.state !== 'unanswered') {
    plan.targetState = draft.plan.target.state;
    if (draft.plan.target.state === 'fixed') {
      const profit = draft.plan.target.profit.trim();
      const parsed = profit === '' ? null : parseTradeMoneyInput(profit, context.currency);
      plan.plannedRewardMinor = parsed !== null && parsed.ok ? parsed.value : null;
      const tp = draft.plan.target.price.trim();
      plan.targetPrice = tp === '' ? null : tp;
    }
  }
  if (effectiveCloseTarget(draft, context) === 'no_fixed' && !trade.exitPlanAnswered) {
    const { choice } = draft.plan.exitPlan;
    if (choice.kind === 'saved') {
      plan.exitPlan = { state: 'saved', exitPlanId: choice.exitPlanId, provenance: 'selected' };
    } else if (choice.kind === 'no_rule') {
      plan.exitPlan = { state: 'no_rule' };
    } else if (choice.kind === 'customized' && draft.plan.exitPlan.customText.trim() !== '') {
      plan.exitPlan = {
        state: 'customized',
        baseExitPlanId: draft.plan.exitPlan.customBaseId,
        instructions: draft.plan.exitPlan.customText.trim(),
      };
    }
  }
  return Object.keys(plan).length === 0 ? null : (plan as never);
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
  const money = (value: string) => {
    if (value.trim() === '') return null;
    const parsed = parseTradeMoneyInput(value, context.currency, {
      allowNegative: true,
      allowZero: true,
    });
    return parsed.ok ? parsed.value : null;
  };
  const bps = percentToBps(draft.leg.closedPercent);
  const reason = draft.leg.reason.trim();
  const price = draft.leg.price.trim();
  if (draft.scope === 'part') {
    return {
      tradeId: ids.tradeId,
      mutationKey: ids.mutationKey,
      scope: 'part',
      realizedPnlMinor: money(draft.leg.pnl),
      closedBps: typeof bps === 'number' ? bps : null,
      exitPrice: price === '' ? null : price,
      exitedAt: localToIso(draft.leg.exitedAt, context.timezone),
      ...(reason === '' ? {} : { exitReason: reason }),
    };
  }
  const validation = validateCloseDraft(draft, context);
  const { closing } = validation;
  // Only the way of closing the trader chose is sent; a stated total makes no exit P&L up.
  const legUsed = closingLegUsed(closing.mode, closing.partsResult);
  const eachExit = closing.mode === 'in_parts' && closing.partsResult === 'each_exit';
  const plan = closePlanPayload(draft, context);
  const fromExits = closing.source === 'full_close' || closing.source === 'exit_legs';
  return {
    tradeId: ids.tradeId,
    mutationKey: ids.mutationKey,
    scope: 'all_remaining',
    realizedPnlMinor: legUsed ? money(draft.leg.pnl) : null,
    closedBps: eachExit && typeof bps === 'number' ? bps : null,
    exitPrice: legUsed && price !== '' ? price : null,
    // The closing exit's time is the final exit time, sent once.
    exitedAt: null,
    ...(legUsed && reason !== '' ? { exitReason: reason } : {}),
    ...(plan === null ? {} : { plan }),
    finalPnlMinor: validation.finalPnlMinor,
    /*
      ONE SOURCE, RE-CHECKED BY THE SERVER. A result the exits add up to is
      sent as adopted from them, with the history Complete — the closing exit
      is All remaining, so the exits are every exit there is.
    */
    ...(fromExits
      ? { finalPnlAdoptedFromExits: true as const, exitHistoryCompleteness: 'complete' as const }
      : {}),
    ...(draft.outcome === null ? {} : { traderOutcome: draft.outcome }),
    finalExitedAt: localToIso(draft.finalExitedAt, context.timezone),
  };
}
