import 'server-only';

import { desc } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { platformVatConfiguration } from '@/server/db/schema';

/**
 * Cross-tenant admin read query for the `/admin/vat` bounded "recent
 * configuration history" list (Phase 11F) — a sibling to
 * `src/server/dal/admin/audit.ts`. No auth check here; `requirePlatformAdmin()`
 * is called once in the service layer before this runs. Deliberately NOT
 * keyset-paginated like the Audit list: the product requirement is a small,
 * fixed-size "recent history" read, not a browsable full history.
 */

export interface VatConfigurationHistoryRow {
  readonly id: string;
  readonly enabled: boolean;
  readonly rateBasisPoints: number;
  readonly effectiveAt: Date;
  readonly createdAt: Date;
  readonly createdByAdminId: string | null;
  readonly reasonCode: string;
  readonly reasonNote: string | null;
}

const VAT_HISTORY_PROJECTION = {
  id: platformVatConfiguration.id,
  enabled: platformVatConfiguration.enabled,
  rateBasisPoints: platformVatConfiguration.rateBasisPoints,
  effectiveAt: platformVatConfiguration.effectiveAt,
  createdAt: platformVatConfiguration.createdAt,
  createdByAdminId: platformVatConfiguration.createdByAdminId,
  reasonCode: platformVatConfiguration.reasonCode,
  reasonNote: platformVatConfiguration.reasonNote,
} as const;

/** The most recent `limit` rows by `effective_at`, ties broken deterministically — the SAME ordering `getEffectivePlatformVatConfiguration` itself uses, so "current" here is unambiguously the first row of a request with `limit >= 1`. */
export async function listRecentVatConfigurationHistory(
  db: Database,
  limit: number,
): Promise<VatConfigurationHistoryRow[]> {
  return db
    .select(VAT_HISTORY_PROJECTION)
    .from(platformVatConfiguration)
    .orderBy(
      desc(platformVatConfiguration.effectiveAt),
      desc(platformVatConfiguration.createdAt),
      desc(platformVatConfiguration.id),
    )
    .limit(limit);
}
