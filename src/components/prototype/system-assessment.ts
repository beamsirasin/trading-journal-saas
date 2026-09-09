/**
 * SYSTEM ASSESSMENT — what following the rules that ACTUALLY APPLIED would have
 * produced.
 *
 * THE ONE SENTENCE THAT DEFINES THE SCOPE. It is a rule-assisted, trader-
 * confirmed assessment. TradeChemist does the arithmetic; the trader supplies
 * the causation, because causation is the part no journal can observe. Nothing
 * here simulates a strategy, reads a chart, or looks at what the trade actually
 * made.
 *
 * THREE THINGS IT IS ROUTINELY CONFUSED WITH, AND IS NOT:
 *
 *   TARGET R   what the plan OFFERED — `targetProfit / riskAtEntry`. Known the
 *              moment the plan exists, and true whether or not the target was
 *              ever approached.
 *   ACTUAL R   what the trader TOOK. Known from realized money.
 *   SYSTEM R   what the rules WOULD HAVE PRODUCED. Knowable only when somebody
 *              says which rule resolved the trade first.
 *
 * A trade may have all three, any two, or none, and they may disagree in every
 * direction. The most valuable record in the product — a system win the trader
 * turned into a loss — is precisely a record where they disagree, so nothing in
 * this file may quietly reconcile them.
 *
 * WHY `target_hit` DOES NOT MAKE SYSTEM R EQUAL TARGET R AUTOMATICALLY. It makes
 * them equal once the trader says the target is what closed it — that is a
 * statement about which rule fired, and it is theirs to make. Price reaching a
 * level is not evidence the level was held: a plan that moves to break-even at
 * +1R, or trails, or exits on a signal, resolves somewhere else entirely, and a
 * candle that touched both stop and target says nothing about which came first.
 * `resolveGrossR` therefore reads the trader's declared basis and never the
 * price path, the chart, or the actual result.
 *
 * GROSS AND NET ARE DIFFERENT ANSWERS. A counterfactual with no cost estimate is
 * a GROSS figure; Actual R is net of every fee the trade really paid. Comparing
 * them produces an Execution Gap biased by roughly the cost of trading, in the
 * trader's disfavour, invisibly. So the cost is asked for, `''` means UNKNOWN
 * rather than zero, and `comparability` refuses to certify a comparison that
 * would be gross against net — see `systemNetR`.
 */

import { BREAK_EVEN_TOLERANCE_R } from '@/config/trade-calc';
import { classifyOutcome } from '@/lib/calc/trade';
import type { OutcomeValue } from '@/lib/trades/constants';

import type { ExitPlanDraft } from './add-trade/exit-plan';
import { money } from './exit-model';

/**
 * FOUR STATES, AND THE TWO THAT MUST NEVER MERGE.
 *
 * `not_assessed` — nobody has looked. The default, and SILENT: no badge, no
 *                  count, no "incomplete" styling. Most trades will stay here
 *                  and that is a complete, valid record.
 * `assessed`     — a resolution reason and a magnitude.
 * `no_trade`     — the rules would not have permitted the trade. A FINDING, not
 *                  an absence, and never a System R of zero.
 * `cannot_determine` — the trader looked and the counterfactual is not
 *                  reconstructible. Also a finding.
 *
 * `not_assessed` and `cannot_determine` carry opposite information: one says
 * nothing has been asked, the other says the question was asked and has no
 * answer. Collapsing them would turn every unopened trade into a documented
 * dead end, and every documented dead end into an unopened trade.
 */
export type AssessmentStatus = 'not_assessed' | 'assessed' | 'no_trade' | 'cannot_determine';

/**
 * WHAT WOULD HAVE CLOSED THE TRADE — the production enum, minus one.
 *
 * `setup_invalidated` is deliberately absent: in production it is an exit
 * reason, but a setup that was never valid means the trade should not have
 * existed, which is `no_trade` — a status, not a way of closing. Keeping it here
 * would offer two different answers to one question.
 */
export const SYSTEM_EXIT_REASONS = [
  'target_hit',
  'stop_hit',
  'break_even_rule',
  'trailing_exit',
  'time_exit',
  'rule_exit',
  'manual_system_valid_exit',
] as const;
export type SystemExitReason = (typeof SYSTEM_EXIT_REASONS)[number];

/**
 * WHERE THE MAGNITUDE COMES FROM.
 *
 * `plan_target` / `plan_stop` / `break_even` are the three the plan itself can
 * answer once the trader has named the rule: the recorded target over the
 * recorded risk, minus one R, and zero. `money` and `custom_r` are the trader's
 * own figure, for every plan whose resolution no arithmetic can reach — a
 * trailing stop, a session close, a discretionary signal.
 *
 * PRICE GEOMETRY IS ABSENT ON PURPOSE. Production supports a `price_exit` basis
 * computed from planned entry, planned stop and a system exit price. This
 * prototype's Plan at entry is MONEY — risk and target, no levels — so there is
 * no geometry here to compute from, and inventing levels to enable it would
 * fabricate the very evidence the basis is supposed to rest on. `ResolutionSource`
 * keeps the door open.
 */
export const SYSTEM_BASES = [
  'plan_target',
  'plan_stop',
  'break_even',
  'money',
  'custom_r',
] as const;
export type SystemBasis = (typeof SYSTEM_BASES)[number];

/**
 * HOW THE FIGURE WAS ARRIVED AT — never a claim about how good it is.
 *
 * `trader_assessed` covers every basis in this prototype, INCLUDING the ones
 * whose arithmetic the app performs. Computing `-1R` from a declared stop is
 * machine arithmetic over a human judgement, and the judgement is the load-
 * bearing part: labelling the result `price_geometry` because a division
 * happened would dress a retrospective opinion as a measurement.
 */
export type ResolutionSource = 'trader_assessed' | 'price_geometry';

/**
 * WHETHER THE RULES USED AS EVIDENCE WERE THE RULES IN FORCE.
 *
 * `at_entry` — the plan was recorded when the trade was opened.
 * `reconstructed_later` — the trader wrote it down afterwards, from memory.
 * `unknown` — no plan is recorded at all.
 *
 * A historical trade written up today is `reconstructed_later` by construction,
 * and that is not a defect — it is the ordinary state of this whole recording
 * path. What it must never do is pass as `at_entry`.
 */
export type PlanProvenance = 'at_entry' | 'reconstructed_later' | 'unknown';

/**
 * DID THE TRADER FOLLOW THEIR PLAN — a SEPARATE AXIS, four states.
 *
 * INDEPENDENT OF THE SYSTEM RESULT, and the independence is the product. All of
 * these are real, common records:
 *
 *   System −1R + Followed          the rules lost; the trader obeyed them
 *   System +5R + Did not follow    the rules won; the trader did not take it
 *   Actual win + no_trade          money made on a trade the rules forbade
 *
 * NOT A BOOLEAN. `followed_plan` in production is `boolean | null`, which cannot
 * express `partly` — and `partly` is the honest answer for most real trades.
 * Nothing here narrows to that shape.
 */
export type Adherence = 'not_answered' | 'followed' | 'partly' | 'not_followed';

/**
 * WHAT THE ASSESSMENT RESTED ON, captured when it was made.
 *
 * Only the fields the chosen basis ACTUALLY USED are recorded — a `custom_r`
 * assessment does not depend on the risk at entry, and marking it stale because
 * the risk was corrected would be crying wolf. A field the basis did not use is
 * `null` here and is never compared.
 */
export interface AssessmentDependencies {
  /** The rules relied on: strategy, setup, and the adopted exit-plan wording. */
  readonly strategy: string | null;
  readonly setup: string | null;
  readonly exitPlanId: string | null;
  readonly exitPlanInstructions: string | null;
  readonly exitPlanSource: string | null;
  /** The planned figures, when the basis divided by or read them. */
  readonly riskAtEntry: string | null;
  readonly targetProfit: string | null;
}

export interface SystemAssessmentDraft {
  readonly status: AssessmentStatus;
  readonly reason: SystemExitReason | null;
  readonly basis: SystemBasis | null;
  /** The system result in money, for the `money` basis. `''` is unknown. */
  readonly systemMoney: string;
  /** Gross R typed directly, for the `custom_r` basis. `''` is unknown. */
  readonly grossRInput: string;
  /**
   * Cost attributable to the counterfactual, in R. `''` is UNKNOWN.
   *
   * NEVER PREFILLED WITH ZERO. A zero here is a claim that following the rules
   * would have cost nothing, and it is a claim the app would be making on the
   * trader's behalf, in the direction that flatters the system.
   */
  readonly costR: string;
  readonly planProvenance: PlanProvenance;
  readonly resolutionSource: ResolutionSource;
  readonly adherence: Adherence;
  /** Captured at completion; `null` while nothing has been assessed. */
  readonly dependencies: AssessmentDependencies | null;
  /**
   * The trader has re-confirmed the assessment after a dependency moved.
   *
   * Cleared whenever a new dependency change is detected, so confirming once
   * does not silence every future change.
   */
  readonly confirmedDependencies: AssessmentDependencies | null;
}

export const EMPTY_SYSTEM_ASSESSMENT: SystemAssessmentDraft = {
  status: 'not_assessed',
  reason: null,
  basis: null,
  systemMoney: '',
  grossRInput: '',
  costR: '',
  planProvenance: 'unknown',
  resolutionSource: 'trader_assessed',
  adherence: 'not_answered',
  dependencies: null,
  confirmedDependencies: null,
};

/** The plan facts an assessment could rest on, as the trade currently states them. */
export interface AssessmentContext {
  readonly strategy: string | null;
  readonly setup: string | null;
  readonly exitPlan: ExitPlanDraft;
  readonly riskAtEntry: string;
  readonly targetProfit: string;
}

/** Which of the context's figures the given basis actually reads. */
function usesRisk(basis: SystemBasis | null): boolean {
  return basis === 'plan_target' || basis === 'money';
}
function usesTarget(basis: SystemBasis | null): boolean {
  return basis === 'plan_target';
}

/**
 * The dependency snapshot for an assessment of this shape, from this context.
 *
 * The rules are always a dependency — every status rests on them, including
 * `no_trade`, whose entire evidence is the strategy and setup that forbade the
 * trade. The figures are dependencies only where the basis divides by them.
 */
export function assessmentDependencies(
  context: AssessmentContext,
  basis: SystemBasis | null,
): AssessmentDependencies {
  return {
    strategy: context.strategy,
    setup: context.setup,
    exitPlanId: context.exitPlan.planId,
    exitPlanInstructions: context.exitPlan.instructions,
    exitPlanSource: context.exitPlan.source,
    riskAtEntry: usesRisk(basis) ? context.riskAtEntry : null,
    targetProfit: usesTarget(basis) ? context.targetProfit : null,
  };
}

function sameDependencies(a: AssessmentDependencies, b: AssessmentDependencies): boolean {
  return (
    a.strategy === b.strategy &&
    a.setup === b.setup &&
    a.exitPlanId === b.exitPlanId &&
    a.exitPlanInstructions === b.exitPlanInstructions &&
    a.exitPlanSource === b.exitPlanSource &&
    a.riskAtEntry === b.riskAtEntry &&
    a.targetProfit === b.targetProfit
  );
}

/**
 * WHETHER SOMETHING THE ASSESSMENT RESTED ON HAS MOVED SINCE.
 *
 * PRESERVING RATHER THAN ERASING. A changed strategy, a rewritten exit plan or a
 * corrected risk does not delete what the trader concluded — it means the
 * conclusion has not been checked against the new facts. The assessment stays
 * exactly as entered, is marked for review, and is withheld from trusted
 * analytics until re-confirmed. Erasing it would destroy real work over a
 * one-character edit; leaving it silently would let a stale counterfactual enter
 * a metric as though it had been made against the current rules.
 *
 * REFLECTION AND THE ACTUAL RESULT ARE NOT DEPENDENCIES. Rewriting a reflection
 * note or correcting the final P&L changes nothing the assessment rested on, and
 * marking it stale for either would train the trader to dismiss the signal.
 */
export function needsReview(draft: SystemAssessmentDraft, context: AssessmentContext): boolean {
  if (draft.status === 'not_assessed') return false;
  if (draft.dependencies === null) return false;
  const current = assessmentDependencies(context, draft.basis);
  if (sameDependencies(draft.dependencies, current)) return false;
  if (draft.confirmedDependencies !== null) {
    return !sameDependencies(draft.confirmedDependencies, current);
  }
  return true;
}

/** Records that the trader has re-checked the assessment against today's facts. */
export function confirmAssessment(
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): SystemAssessmentDraft {
  return { ...draft, confirmedDependencies: assessmentDependencies(context, draft.basis) };
}

/**
 * GROSS SYSTEM R — before any cost, or `null` when it is not knowable.
 *
 * Never zero as a fallback: `break_even` returns zero because the trader said
 * the rules would have closed the trade flat, which is a known zero. Every other
 * absence is `null`.
 */
export function systemGrossR(
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): number | null {
  if (draft.status !== 'assessed' || draft.basis === null) return null;
  const risk = money(context.riskAtEntry);

  switch (draft.basis) {
    case 'break_even':
      return 0;
    /* Hitting the initial stop is exactly −1R: that is what R MEANS. Not an
       assumption about the instrument, and not read from any price. */
    case 'plan_stop':
      return -1;
    case 'plan_target': {
      const target = money(context.targetProfit);
      if (target === null || risk === null || risk <= 0) return null;
      return target / risk;
    }
    case 'money': {
      const amount = money(draft.systemMoney);
      if (amount === null || risk === null || risk <= 0) return null;
      return amount / risk;
    }
    case 'custom_r':
      return money(draft.grossRInput);
  }
}

/** The cost estimate in R, or `null` for UNKNOWN. Never coerced to zero. */
export function systemCostR(draft: SystemAssessmentDraft): number | null {
  return money(draft.costR);
}

/**
 * NET SYSTEM R — gross minus cost, and ONLY when the cost is known.
 *
 * `systemR = systemGrossR − systemCostR` is production's locked formula and this
 * is the same arithmetic. The difference is what happens when the cost is
 * absent: production's column is `NOT NULL DEFAULT 0`, which silently makes
 * every unestimated counterfactual cost-free. Here an unknown cost yields `null`
 * — the gross figure remains available and is labelled gross.
 */
export function systemNetR(
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): number | null {
  const gross = systemGrossR(draft, context);
  const cost = systemCostR(draft);
  if (gross === null || cost === null) return null;
  return gross - cost;
}

/**
 * The system outcome word, derived from NET System R through production's own
 * classifier and the locked break-even tolerance.
 *
 * DERIVED, NEVER STORED BESIDE THE FIGURE. There is no independently editable
 * outcome on this model, so a stored `win` beside a −2R system result is not a
 * state the record can hold — the same rule Pass 2 applied to the adopted
 * result's outcome.
 *
 * It reads the NET figure because that is the one comparable with Actual R. A
 * gross-only assessment has a magnitude and no outcome verdict, which is the
 * honest reading: whether a +0.04R gross result is a win or a break-even depends
 * entirely on the cost nobody has estimated.
 */
export function systemOutcome(
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): OutcomeValue | null {
  const net = systemNetR(draft, context);
  if (net === null) return null;
  const classified = classifyOutcome(net.toFixed(4));
  return classified.ok ? classified.value : null;
}

/** The tolerance band the outcome is classified against — stated, not re-derived. */
export const SYSTEM_BREAK_EVEN_TOLERANCE_R = BREAK_EVEN_TOLERANCE_R;

/**
 * WHETHER THIS ASSESSMENT MAY BE COMPARED WITH THE ACTUAL RESULT.
 *
 * `comparable` — a net System R exists, so `actualR − systemR` is net against
 *                net and means what it appears to mean.
 * `gross_only` — a magnitude exists but no cost estimate. The figure is real and
 *                worth showing; the SUBTRACTION is not, because it would be net
 *                Actual against gross System and would report a gap that is
 *                partly just the cost of trading.
 * `unavailable` — no magnitude: not assessed, no_trade, or cannot_determine.
 *
 * `no_trade` lands in `unavailable` deliberately. It is a finding rather than a
 * gap: there is no counterfactual result to differ from, so the trade belongs in
 * a no-trade count and in every monetary metric, and in no paired comparison.
 */
export type Comparability = 'comparable' | 'gross_only' | 'unavailable';

export function comparability(
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): Comparability {
  if (systemNetR(draft, context) !== null) return 'comparable';
  return systemGrossR(draft, context) === null ? 'unavailable' : 'gross_only';
}

/**
 * Execution Gap in R — `actualR − systemR`, and ONLY where both are net.
 *
 * `null` rather than an approximation whenever the system side is gross-only,
 * missing, or `no_trade`. A gap computed across that boundary is the kind of
 * figure that looks authoritative, reads plausibly, and is wrong by the cost of
 * trading every single time.
 */
export function executionGapR(
  actualR: number | null,
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): number | null {
  if (actualR === null) return null;
  const net = systemNetR(draft, context);
  return net === null ? null : actualR - net;
}

/** A completed assessment carries a magnitude; the terminal findings do not. */
export function isResolved(draft: SystemAssessmentDraft, context: AssessmentContext): boolean {
  return draft.status === 'assessed' && systemGrossR(draft, context) !== null;
}

/**
 * WHAT THE LAUNCHER PREVIEWS — only what has actually been answered.
 *
 * At most two lines, and never a statement of what is missing: an unassessed
 * trade shows the invitation, exactly as the Journal areas do.
 */
export function systemAssessmentSummary(
  draft: SystemAssessmentDraft,
  context: AssessmentContext,
): readonly string[] {
  const lines: string[] = [];

  if (draft.status === 'no_trade') lines.push('Your rules would not have taken this trade');
  else if (draft.status === 'cannot_determine')
    lines.push('Can’t determine what the rules would have done');
  else if (draft.status === 'assessed') {
    const gross = systemGrossR(draft, context);
    const net = systemNetR(draft, context);
    const shown = net ?? gross;
    lines.push(
      shown === null
        ? 'Assessed'
        : `System ${shown > 0 ? '+' : ''}${shown.toFixed(2)}R${net === null ? ' gross' : ''}`,
    );
  }

  if (draft.adherence !== 'not_answered') {
    lines.push(
      draft.adherence === 'followed'
        ? 'Followed your plan'
        : draft.adherence === 'partly'
          ? 'Partly followed your plan'
          : 'Did not follow your plan',
    );
  }

  return lines;
}
