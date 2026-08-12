/**
 * Pure, framework-independent parsing of `admin_audit_log.before_state`/
 * `after_state` — Phase 11E. The writer (`insertAdminAuditLog`,
 * `src/server/services/admin-audit-log.ts`) already only ever writes the
 * allowlisted `AdminAuditStateSnapshot` shape, but `jsonb` has no schema of
 * its own once it round-trips through Postgres — this is the read-side
 * boundary that refuses to hand an unvalidated blob to React (Phase 11E's
 * own "never expose raw DB JSON blindly" rule), picking only known keys with
 * the correct primitive type and silently dropping anything else rather than
 * throwing, since a malformed/legacy row must never crash the Audit list.
 */

export interface AdminAuditStateSnapshot {
  readonly status?: string;
  readonly planKey?: string | null;
  readonly source?: string;
  readonly trialEndsAt?: string | null;
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly vatEnabled?: boolean;
  readonly vatRateBasisPoints?: number;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function parseAdminAuditStateSnapshot(value: unknown): AdminAuditStateSnapshot | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  if (typeof record.status === 'string') result.status = record.status;
  if ('planKey' in record && isNullableString(record.planKey)) result.planKey = record.planKey;
  if (typeof record.source === 'string') result.source = record.source;
  if ('trialEndsAt' in record && isNullableString(record.trialEndsAt)) {
    result.trialEndsAt = record.trialEndsAt;
  }
  if ('periodStart' in record && isNullableString(record.periodStart)) {
    result.periodStart = record.periodStart;
  }
  if ('periodEnd' in record && isNullableString(record.periodEnd)) {
    result.periodEnd = record.periodEnd;
  }
  if (typeof record.vatEnabled === 'boolean') result.vatEnabled = record.vatEnabled;
  if (typeof record.vatRateBasisPoints === 'number') {
    result.vatRateBasisPoints = record.vatRateBasisPoints;
  }

  return Object.keys(result).length === 0 ? null : (result as AdminAuditStateSnapshot);
}

/** Ordered, human-readable labels for every allowlisted field — the Audit UI renders exactly these pairs, never a JSON dump. */
export const ADMIN_AUDIT_STATE_FIELD_LABELS: readonly {
  readonly key: keyof AdminAuditStateSnapshot;
  readonly label: string;
}[] = [
  { key: 'status', label: 'Status' },
  { key: 'planKey', label: 'Plan' },
  { key: 'source', label: 'Source' },
  { key: 'trialEndsAt', label: 'Trial end' },
  { key: 'periodStart', label: 'Period start' },
  { key: 'periodEnd', label: 'Period end' },
  { key: 'vatEnabled', label: 'VAT enabled' },
  { key: 'vatRateBasisPoints', label: 'VAT rate' },
];
