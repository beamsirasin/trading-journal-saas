import 'server-only';

import { count, sql } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { users, workspaceEntitlements, workspaces } from '@/server/db/schema';

/**
 * Cross-tenant admin read queries — deliberately a SEPARATE DAL from
 * `src/server/dal/*.ts` (which is always workspace-scoped) and from
 * `src/server/auth/dal.ts` (the tenant authorization boundary). Nothing here
 * accepts a `workspaceId` at all; every query is a fixed, bounded,
 * whole-table aggregate. Ordinary tenant DAL functions are never modified to
 * support this — see the module comment on why that boundary must stay firm.
 *
 * `requirePlatformAdmin()` is NOT called here — it is called once, in
 * `src/server/services/admin/metrics.ts`, before any of these run. This
 * layer trusts its caller the same way `src/server/dal/trades.ts` trusts an
 * already-authorized `workspaceId`.
 */

export async function countAllUsers(db: Database): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users);
  return row?.value ?? 0;
}

export async function countAllWorkspaces(db: Database): Promise<number> {
  const [row] = await db.select({ value: count() }).from(workspaces);
  return row?.value ?? 0;
}

/** Every field `resolveEffectiveEntitlement` (`src/lib/entitlements/resolve.ts`) needs, plus `source` — one fixed, unfiltered query, no per-workspace N+1. */
export interface AdminEntitlementRow {
  readonly workspaceId: string;
  readonly status: string;
  readonly planKey: string | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodStartedAt: Date | null;
  readonly currentPeriodEndsAt: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: Date | null;
  readonly billingCurrency: string | null;
  readonly billingInterval: string | null;
  readonly pendingPlanKey: string | null;
  readonly pendingPlanEffectiveAt: Date | null;
  readonly source: string;
}

export async function listAllEntitlementRows(db: Database): Promise<AdminEntitlementRow[]> {
  return db
    .select({
      workspaceId: workspaceEntitlements.workspaceId,
      status: workspaceEntitlements.status,
      planKey: workspaceEntitlements.planKey,
      trialStartedAt: workspaceEntitlements.trialStartedAt,
      trialEndsAt: workspaceEntitlements.trialEndsAt,
      currentPeriodStartedAt: workspaceEntitlements.currentPeriodStartedAt,
      currentPeriodEndsAt: workspaceEntitlements.currentPeriodEndsAt,
      cancelAtPeriodEnd: workspaceEntitlements.cancelAtPeriodEnd,
      canceledAt: workspaceEntitlements.canceledAt,
      billingCurrency: workspaceEntitlements.billingCurrency,
      billingInterval: workspaceEntitlements.billingInterval,
      pendingPlanKey: workspaceEntitlements.pendingPlanKey,
      pendingPlanEffectiveAt: workspaceEntitlements.pendingPlanEffectiveAt,
      source: workspaceEntitlements.source,
    })
    .from(workspaceEntitlements);
}

export interface AdminDayCountRow {
  readonly day: string;
  readonly count: number;
}

/**
 * Grouped in SQL (not fetched-then-bucketed in JS) — the row-count-at-scale
 * decision this phase's benchmark evidence backs. `AT TIME ZONE 'UTC'`
 * converts the stored instant to the UTC wall-clock reading explicitly,
 * independent of the database session's own `TimeZone` setting — the
 * operator-timezone lock (Phase 11's contract) must not depend on connection
 * configuration. `to_char(..., 'YYYY-MM-DD')` returns a plain string
 * matching this codebase's `CalendarDate` shape exactly, avoiding any
 * driver-level `date` type ambiguity. Bounds are passed as `.toISOString()`
 * strings, not raw `Date` objects — `db.execute(sql\`...\`)` (unlike
 * Drizzle's query builder) hands parameters to `postgres.js` without the
 * builder's own Date-to-wire-format conversion, and a raw `Date` fails at
 * the driver's binary-protocol layer.
 */
export async function countUsersCreatedByUtcDay(
  db: Database,
  startInclusive: Date,
  endExclusive: Date,
): Promise<AdminDayCountRow[]> {
  const rows = await db.execute<{ day: string; count: number }>(sql`
    SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM "users"
    WHERE "created_at" >= ${startInclusive.toISOString()} AND "created_at" < ${endExclusive.toISOString()}
    GROUP BY 1
    ORDER BY 1
  `);
  return [...rows];
}

/**
 * "Trades logged" = Trade records CREATED in the window, by `trades.
 * created_at` — deliberately including soft-deleted rows (`deleted_at IS NOT
 * NULL`): this metric answers "how much journal activity happened", not
 * "how many Trades currently exist". No `exited_at`, no P&L, no R, no
 * journal content — pure creation-timestamp activity count.
 */
export async function countTradesCreatedByUtcDay(
  db: Database,
  startInclusive: Date,
  endExclusive: Date,
): Promise<AdminDayCountRow[]> {
  const rows = await db.execute<{ day: string; count: number }>(sql`
    SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM "trades"
    WHERE "created_at" >= ${startInclusive.toISOString()} AND "created_at" < ${endExclusive.toISOString()}
    GROUP BY 1
    ORDER BY 1
  `);
  return [...rows];
}
