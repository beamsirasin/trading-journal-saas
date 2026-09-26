/**
 * REQUIRED / RECOMMENDED / OPTIONAL — one completion model for Record Open,
 * Record Closed and Close Existing Trade (Add Trade contract decision 59).
 *
 * `Required` is required for COMPLETION, never for saving progress. A trader
 * can always save and come back; what `Required` gates is the operation that
 * truly completes the record:
 *
 *   - Final Close eligibility — every applicable Required item of Steps 1–5
 *     is explicitly answered (Close Existing Trade's Final Close is gated on it);
 *   - Record completeness — Final Close eligibility plus the Step 6 System
 *     Result decision, where that question applies. A derived status, never a
 *     Save gate (Record Closed saves an incomplete record as it is).
 *
 * `Recommended` and `Optional` never count toward either.
 *
 * NOTHING IS ANSWERED BY DEFAULT. Every flag below is an explicit answer the
 * trader gave; Unanswered never satisfies Required. An explicit negative does
 * where the model has one — No Defined Risk, No Fixed Target, Can't determine.
 *
 * ONE DYNAMIC LEVEL. The Exit Plan is Recommended beside a Fixed Target and
 * Required with No Fixed Target (without a target, the exit plan is the plan).
 * While the Target is Unanswered the Exit Plan's level is not decided at all
 * (`conditional`) — an Unanswered Target never silently decides it.
 *
 * Pure: no I/O, no React, no draft shapes. Each flow maps its own answers in.
 */

export type RequirementLevel = 'required' | 'recommended' | 'optional' | 'conditional';

export type RequirementStep = 'trade' | 'plan' | 'setup' | 'context' | 'result' | 'after';

export const REQUIREMENT_STEPS: readonly RequirementStep[] = [
  'trade',
  'plan',
  'setup',
  'context',
  'result',
  'after',
];

export type RequirementKey =
  | 'account'
  | 'symbol'
  | 'direction'
  | 'entryTime'
  | 'risk'
  | 'target'
  | 'exitPlan'
  | 'priceLevels'
  | 'strategy'
  | 'setup'
  | 'conditions'
  | 'confidence'
  | 'entryEmotion'
  | 'entryContext'
  | 'notesEvidence'
  | 'outcome'
  | 'traderResult'
  | 'finalExitTime'
  | 'systemResult'
  | 'afterTradeContext';

/** Explicit answers, as each flow records them. `undefined` = the flow does not ask it. */
export interface RequirementAnswers {
  readonly account?: boolean;
  readonly symbol?: boolean;
  readonly direction?: boolean;
  readonly entryTime?: boolean;
  /** An explicit, valid risk decision: Defined Risk with a valid amount, or No Defined Risk. */
  readonly risk?: boolean;
  readonly target?: 'unanswered' | 'fixed' | 'no_fixed';
  readonly exitPlan?: boolean;
  readonly priceLevels?: boolean;
  readonly strategy?: boolean;
  readonly setup?: boolean;
  readonly conditions?: boolean;
  readonly confidence?: boolean;
  readonly entryEmotion?: boolean;
  readonly entryContext?: boolean;
  readonly notesEvidence?: boolean;
  /** Win, BE or Loss explicitly chosen. */
  readonly outcome?: boolean;
  /** A valid Trader Result under the Step 5 result-authority model (decisions 57–58). */
  readonly traderResult?: boolean;
  readonly finalExitTime?: boolean;
  /**
   * The Step 6 System Result: `null` when the plan asks no question (nothing
   * to answer, so nothing required); otherwise whether an explicit answer —
   * including Can't determine — was given.
   */
  readonly systemResult?: boolean | null;
  readonly afterTradeContext?: boolean;
}

export interface RequirementItem {
  readonly key: RequirementKey;
  readonly step: RequirementStep;
  readonly level: RequirementLevel;
  readonly answered: boolean;
}

const STEP_OF: Readonly<Record<RequirementKey, RequirementStep>> = {
  account: 'trade',
  symbol: 'trade',
  direction: 'trade',
  entryTime: 'trade',
  risk: 'plan',
  target: 'plan',
  exitPlan: 'plan',
  priceLevels: 'plan',
  strategy: 'setup',
  setup: 'setup',
  conditions: 'setup',
  confidence: 'context',
  entryEmotion: 'context',
  entryContext: 'context',
  notesEvidence: 'context',
  outcome: 'result',
  traderResult: 'result',
  finalExitTime: 'result',
  systemResult: 'after',
  afterTradeContext: 'after',
};

const FIXED_LEVEL: Readonly<Record<Exclude<RequirementKey, 'exitPlan'>, RequirementLevel>> = {
  account: 'required',
  symbol: 'required',
  direction: 'required',
  entryTime: 'optional',
  risk: 'required',
  target: 'required',
  priceLevels: 'optional',
  strategy: 'recommended',
  setup: 'optional',
  conditions: 'optional',
  confidence: 'recommended',
  entryEmotion: 'recommended',
  entryContext: 'optional',
  notesEvidence: 'optional',
  outcome: 'required',
  traderResult: 'required',
  finalExitTime: 'optional',
  systemResult: 'required',
  afterTradeContext: 'optional',
};

/** The Exit Plan's level follows the Target answer — and waits while it is Unanswered. */
export function exitPlanLevel(target: RequirementAnswers['target']): RequirementLevel {
  if (target === 'fixed') return 'recommended';
  if (target === 'no_fixed') return 'required';
  return 'conditional';
}

export function requirementLevel(
  key: RequirementKey,
  answers: RequirementAnswers,
): RequirementLevel {
  return key === 'exitPlan' ? exitPlanLevel(answers.target) : FIXED_LEVEL[key];
}

/** Every item the flow asks, with its level and whether it is explicitly answered. */
export function requirementItems(answers: RequirementAnswers): readonly RequirementItem[] {
  const items: RequirementItem[] = [];
  for (const key of Object.keys(STEP_OF) as RequirementKey[]) {
    const value = answers[key];
    if (value === undefined) continue;
    // A System Result question the plan does not ask is not an item at all.
    if (key === 'systemResult' && value === null) continue;
    const answered = key === 'target' ? value === 'fixed' || value === 'no_fixed' : value === true;
    items.push({ key, step: STEP_OF[key], level: requirementLevel(key, answers), answered });
  }
  return items;
}

/** Required items not yet explicitly answered — optionally only in some steps. */
export function missingRequired(
  items: readonly RequirementItem[],
  steps: readonly RequirementStep[] = REQUIREMENT_STEPS,
): readonly RequirementItem[] {
  return items.filter(
    (item) => item.level === 'required' && !item.answered && steps.includes(item.step),
  );
}

const CLOSE_STEPS: readonly RequirementStep[] = ['trade', 'plan', 'setup', 'context', 'result'];

/** Final Close eligibility: every applicable Required item of Steps 1–5 answered. */
export function finalCloseEligible(items: readonly RequirementItem[]): boolean {
  return missingRequired(items, CLOSE_STEPS).length === 0;
}

/** Record completeness: Final Close eligibility plus Step 6's Required System Result. */
export function recordComplete(items: readonly RequirementItem[]): boolean {
  return missingRequired(items).length === 0;
}

export interface StepRequirementStatus {
  readonly required: number;
  readonly requiredLeft: number;
  readonly recommended: number;
}

/** What one step asks, for a rail or summary that must not call a step with Required items Optional. */
export function stepRequirementStatus(
  items: readonly RequirementItem[],
  step: RequirementStep,
): StepRequirementStatus {
  const inStep = items.filter((item) => item.step === step);
  return {
    required: inStep.filter((item) => item.level === 'required').length,
    requiredLeft: inStep.filter((item) => item.level === 'required' && !item.answered).length,
    recommended: inStep.filter((item) => item.level === 'recommended').length,
  };
}
