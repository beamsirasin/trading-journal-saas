import 'server-only';

import { isAuditAction, type AuditAction } from '@/config/audit-actions';
import { auditLogs } from '@/server/db/schema';

import type { Database } from '../db/client';

/** Structurally matches both Database and a Drizzle transaction handle. */
type Executor = Pick<Database, 'insert'>;

/**
 * The complete, closed set of metadata fields any caller may ever record —
 * Phase 3B's approved widening of the boundary the schema comment on
 * `auditLogs` warned about ("a future structured schema must explicitly
 * allow fields before this boundary is widened"). Every field here is a safe
 * identifier or a field NAME, never a value: no balance, no percentage, no
 * form payload, no credential. Adding a new field to this interface is
 * itself the review point for whether it is safe to log.
 */
export interface AuditLogMetadata {
  /** Names of fields that changed in an update — never their old/new values. */
  readonly changedFields?: readonly string[];
  /** Security-sensitive data export structure only — never exported content. */
  readonly format?: string;
  readonly scope?: string;
  readonly schemaVersion?: number;
  readonly revokedCount?: number;
  readonly previousActiveTradingAccountId?: string;
  readonly newActiveTradingAccountId?: string;
  readonly billingTransactionId?: string;
  readonly planKey?: string;
  readonly currency?: string;
  readonly subtotalMinor?: string;
  readonly vatAmountMinor?: string;
  readonly totalMinor?: string;
  readonly providerKind?: string;
  readonly providerCheckoutId?: string;
  readonly providerPaymentId?: string;
  readonly status?: string;
  readonly failureCode?: string;
  /** Strategy-domain structural metadata only — see the module comment. */
  readonly strategyId?: string;
  readonly strategyVersionId?: string;
  readonly previousStrategyVersionId?: string;
  readonly setupId?: string;
  readonly setupVersionId?: string;
  readonly ruleId?: string;
  readonly ruleKey?: string;
  readonly versionNumber?: number;
  readonly ruleCategory?: string;
  /** `'strategy' | 'setup'` — never rule/setup/strategy content itself. */
  readonly ruleScope?: string;
  readonly isNoop?: boolean;
  /**
   * Trade-domain structural metadata only (Phase 08B) — identifiers and
   * lifecycle state NAMES, never symbol, notes, prices, risk, P&L, R values,
   * costs, or a TradingView URL. `previousStatus`/`newStatus` cover both the
   * Trader (`status`) and System (`system_status`) axes; the metadata itself
   * never says which axis without the surrounding `action` making it obvious.
   */
  readonly tradeId?: string;
  readonly tradingAccountId?: string;
  readonly mistakeTypeId?: string;
  readonly previousStatus?: string;
  readonly newStatus?: string;
}

export interface AuditLogInput {
  action: AuditAction;
  workspaceId?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: AuditLogMetadata;
}

/** The only application path that inserts an append-only audit row. */
export async function insertAuditLog(db: Executor, input: AuditLogInput): Promise<void> {
  if (!isAuditAction(input.action)) {
    throw new Error(`Refusing to record unknown audit action: ${String(input.action)}`);
  }

  await db.insert(auditLogs).values({
    action: input.action,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}
