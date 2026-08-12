import 'server-only';

import {
  isAdminAuditAction,
  isAdminAuditReasonCode,
  type AdminAuditAction,
  type AdminAuditReasonCode,
} from '@/config/admin-audit-actions';
import { adminAuditLog } from '@/server/db/schema';

import type { Database } from '../db/client';

/** Structurally matches both Database and a Drizzle transaction handle — same shape as `audit-log.ts`'s `Executor`, so admin mutations can inject a `tx` and get atomicity with the state change (Phase 11B contract: never write an audit event after the transaction that made it true has already committed). */
type Executor = Pick<Database, 'insert'>;

/**
 * The complete, closed set of structural fields any admin mutation may ever
 * snapshot into `before_state`/`after_state` — Phase 11's own redaction
 * contract. Every field here is a lifecycle VALUE (a status name, a plan
 * key, a rate), never PII, a token, a payment payload, or Trade/journal
 * content. Adding a field to this interface is itself the review point for
 * whether it is safe to log, exactly like `AuditLogMetadata`'s own comment.
 *
 * Dates are ISO strings, not `Date` objects — jsonb has no native timestamp
 * type, and a consistent string representation avoids ambiguity about
 * timezone-less serialization at the call site.
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

/**
 * `actor_admin_id` is required with `platform_admin` and forbidden with
 * `system` at the type level — the same invariant migration 0009's
 * `admin_audit_log_actor_invariant_check` CHECK enforces in the database, so
 * a caller cannot construct a value that would fail the insert.
 */
export type AdminAuditActorInput =
  | { readonly actorKind: 'platform_admin'; readonly actorAdminId: string }
  | { readonly actorKind: 'system' };

const REASON_NOTE_MAX_LENGTH = 500;

export interface AdminAuditLogInput {
  readonly actor: AdminAuditActorInput;
  readonly action: AdminAuditAction;
  readonly subjectUserId?: string;
  readonly subjectWorkspaceId?: string;
  readonly reasonCode: AdminAuditReasonCode;
  /** Optional, bounded plain text — never required merely to satisfy validation when the reason code is enough. Must not contain secrets/credentials. */
  readonly reasonNote?: string;
  readonly beforeState?: AdminAuditStateSnapshot;
  readonly afterState?: AdminAuditStateSnapshot;
}

/**
 * The only application path that inserts an append-only platform-admin audit
 * row — mirrors `src/server/services/audit-log.ts`'s `insertAuditLog()`
 * exactly, for the separate admin trust register (module comment on
 * `src/server/db/schema/admin-audit-log.ts`).
 */
export async function insertAdminAuditLog(db: Executor, input: AdminAuditLogInput): Promise<void> {
  if (!isAdminAuditAction(input.action)) {
    throw new Error(`Refusing to record unknown admin audit action: ${String(input.action)}`);
  }
  if (!isAdminAuditReasonCode(input.reasonCode)) {
    throw new Error(
      `Refusing to record unknown admin audit reason code: ${String(input.reasonCode)}`,
    );
  }
  if (input.reasonNote !== undefined && input.reasonNote.length > REASON_NOTE_MAX_LENGTH) {
    throw new Error(`Admin audit reason note exceeds ${REASON_NOTE_MAX_LENGTH} characters.`);
  }

  await db.insert(adminAuditLog).values({
    actorKind: input.actor.actorKind,
    actorAdminId: input.actor.actorKind === 'platform_admin' ? input.actor.actorAdminId : null,
    action: input.action,
    subjectUserId: input.subjectUserId,
    subjectWorkspaceId: input.subjectWorkspaceId,
    reasonCode: input.reasonCode,
    reasonNote: input.reasonNote,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
  });
}
