/** The answers At Entry offers. Unanswered is the absence of an answer. */
export const SETUP_CONDITION_CHECK_STATUSES = ['met', 'not_met'] as const;
/**
 * The answers After Trade offers: also `unknown`, the trader's "Don't remember"
 * (contract §8). Unknown is an answer, and never a Not Met.
 */
export const RECALLED_SETUP_CONDITION_CHECK_STATUSES = ['met', 'not_met', 'unknown'] as const;
/** Any stored answer. */
export type SetupConditionCheckStatus = (typeof RECALLED_SETUP_CONDITION_CHECK_STATUSES)[number];

export interface SetupConditionAnswer {
  readonly conditionKey: string;
  readonly status: SetupConditionCheckStatus;
}

export interface AuthoritativeSetupCondition {
  readonly id: string;
  readonly conditionKey: string;
  readonly label: string;
  readonly sortOrder: number;
}

export interface PreparedSetupConditionSnapshot extends AuthoritativeSetupCondition {
  readonly checkStatus: SetupConditionCheckStatus;
}

export type PrepareSetupConditionSnapshotsResult =
  | { readonly ok: true; readonly snapshots: readonly PreparedSetupConditionSnapshot[] }
  | {
      readonly ok: false;
      readonly code:
        | 'duplicate_condition_answer'
        | 'unknown_condition_answer'
        | 'incomplete_condition_answers'
        | 'invalid_condition_status';
    };

/**
 * Validates an explicit all-or-nothing answer set against server-authoritative
 * version content. Labels/order/IDs are copied only from authoritative rows;
 * the client supplies a stable key and binary status, nothing else.
 */
export function prepareSetupConditionSnapshots(
  conditions: readonly AuthoritativeSetupCondition[],
  answers: readonly Readonly<{ conditionKey: string; status: string }>[],
  /**
   * Add Trade contract rows keep Unanswered conditions unanswered: only the
   * answered subset is snapshotted, and a missing answer is never a Not Met.
   */
  options: {
    readonly allowUnanswered?: boolean;
    /** After Trade only: accept "Don't remember" as an answer. */
    readonly allowUnknown?: boolean;
  } = {},
): PrepareSetupConditionSnapshotsResult {
  const accepted: readonly string[] =
    options.allowUnknown === true
      ? RECALLED_SETUP_CONDITION_CHECK_STATUSES
      : SETUP_CONDITION_CHECK_STATUSES;
  const answerByKey = new Map<string, string>();
  for (const answer of answers) {
    if (answerByKey.has(answer.conditionKey)) {
      return { ok: false, code: 'duplicate_condition_answer' };
    }
    if (!accepted.includes(answer.status)) {
      return { ok: false, code: 'invalid_condition_status' };
    }
    answerByKey.set(answer.conditionKey, answer.status);
  }

  const conditionKeys = new Set(conditions.map((condition) => condition.conditionKey));
  for (const key of answerByKey.keys()) {
    if (!conditionKeys.has(key)) return { ok: false, code: 'unknown_condition_answer' };
  }
  if (options.allowUnanswered !== true && answerByKey.size !== conditions.length) {
    return { ok: false, code: 'incomplete_condition_answers' };
  }

  return {
    ok: true,
    snapshots: [...conditions]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((condition) => answerByKey.has(condition.conditionKey))
      .map((condition) => ({
        ...condition,
        checkStatus: answerByKey.get(condition.conditionKey) as SetupConditionCheckStatus,
      })),
  };
}

/**
 * Domain-only derivation over Met / Not Met answers only; `null` is the
 * zero-answer N/A state. An Unknown answer is excluded, never counted as a
 * failure (contract §8).
 */
export function deriveSetupAdherence(
  checks: readonly Readonly<{ checkStatus: SetupConditionCheckStatus }>[],
): number | null {
  const answered = checks.filter((check) => check.checkStatus !== 'unknown');
  if (answered.length === 0) return null;
  return answered.filter((check) => check.checkStatus === 'met').length / answered.length;
}
