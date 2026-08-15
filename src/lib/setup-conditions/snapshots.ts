export const SETUP_CONDITION_CHECK_STATUSES = ['met', 'not_met'] as const;
export type SetupConditionCheckStatus = (typeof SETUP_CONDITION_CHECK_STATUSES)[number];

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
): PrepareSetupConditionSnapshotsResult {
  const answerByKey = new Map<string, string>();
  for (const answer of answers) {
    if (answerByKey.has(answer.conditionKey)) {
      return { ok: false, code: 'duplicate_condition_answer' };
    }
    if (!(SETUP_CONDITION_CHECK_STATUSES as readonly string[]).includes(answer.status)) {
      return { ok: false, code: 'invalid_condition_status' };
    }
    answerByKey.set(answer.conditionKey, answer.status);
  }

  const conditionKeys = new Set(conditions.map((condition) => condition.conditionKey));
  for (const key of answerByKey.keys()) {
    if (!conditionKeys.has(key)) return { ok: false, code: 'unknown_condition_answer' };
  }
  if (answerByKey.size !== conditions.length) {
    return { ok: false, code: 'incomplete_condition_answers' };
  }

  return {
    ok: true,
    snapshots: [...conditions]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((condition) => ({
        ...condition,
        checkStatus: answerByKey.get(condition.conditionKey) as SetupConditionCheckStatus,
      })),
  };
}

/** Domain-only derivation; `null` is the explicit zero-Condition N/A state. */
export function deriveSetupAdherence(
  checks: readonly Readonly<{ checkStatus: SetupConditionCheckStatus }>[],
): number | null {
  if (checks.length === 0) return null;
  return checks.filter((check) => check.checkStatus === 'met').length / checks.length;
}
