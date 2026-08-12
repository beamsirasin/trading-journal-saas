import 'server-only';

import type { AdminAuditReasonCode } from '@/config/admin-audit-actions';
import { formatExactVatRatePercent } from '@/lib/billing';
import { systemClock, type Clock } from '@/lib/time';
import { requirePlatformAdmin } from '@/server/auth/admin-dal';
import { listActorIdentitiesByGrantIds } from '@/server/dal/admin/audit';
import { listRecentVatConfigurationHistory } from '@/server/dal/admin/vat';
import { getDb } from '@/server/db/client';
import { getEffectivePlatformVatConfiguration } from '@/server/services/platform-vat-configuration';

/**
 * Read-only `/admin/vat` page model (Phase 11F) — `requirePlatformAdmin()`
 * re-checked HERE, not only the `/admin` route layout. "Current" is resolved
 * through the SAME canonical resolver every commercial operation uses
 * (`getEffectivePlatformVatConfiguration`), never re-derived from the
 * bounded history list, so this page can never disagree with what checkout
 * actually applies. History is a small, fixed-size recent list (default 20),
 * not a browsable/paginated archive — a future-dated row (only reachable
 * through direct operational/testing action; this UI never creates one) is
 * labelled `isFuture` rather than silently presented as current.
 */

const DEFAULT_HISTORY_LIMIT = 20;

export type VatConfigurationHistoryActor =
  | { readonly kind: 'system' }
  | {
      readonly kind: 'platform_admin';
      readonly name: string | null;
      readonly email: string | null;
    };

export interface VatConfigurationHistoryEntry {
  readonly id: string;
  readonly enabled: boolean;
  readonly rateBasisPoints: number;
  readonly ratePercent: string;
  readonly effectiveAt: string;
  readonly reasonCode: AdminAuditReasonCode;
  readonly reasonNote: string | null;
  readonly actor: VatConfigurationHistoryActor;
  readonly isFuture: boolean;
}

export interface VatConfigurationCurrent {
  readonly enabled: boolean;
  readonly rateBasisPoints: number;
  readonly ratePercent: string;
  readonly effectiveAt: string;
}

export interface VatConfigurationReadModel {
  readonly current: VatConfigurationCurrent;
  readonly history: readonly VatConfigurationHistoryEntry[];
}

export async function getVatConfigurationReadModel(
  limit: number = DEFAULT_HISTORY_LIMIT,
  clock: Clock = systemClock,
): Promise<VatConfigurationReadModel> {
  await requirePlatformAdmin();

  const db = getDb();
  const now = clock.now();

  const [effective, historyRows] = await Promise.all([
    getEffectivePlatformVatConfiguration(now),
    listRecentVatConfigurationHistory(db, limit),
  ]);

  const currentRow = historyRows.find((row) => row.effectiveAt.getTime() <= now.getTime());

  const adminGrantIds = [
    ...new Set(
      historyRows.map((row) => row.createdByAdminId).filter((id): id is string => id !== null),
    ),
  ];
  const actorRows = await listActorIdentitiesByGrantIds(db, adminGrantIds);
  const actorByGrantId = new Map(actorRows.map((row) => [row.adminGrantId, row]));

  const history = historyRows.map((row): VatConfigurationHistoryEntry => {
    const actor: VatConfigurationHistoryActor =
      row.createdByAdminId === null
        ? { kind: 'system' }
        : {
            kind: 'platform_admin',
            name: actorByGrantId.get(row.createdByAdminId)?.name ?? null,
            email: actorByGrantId.get(row.createdByAdminId)?.email ?? null,
          };

    return {
      id: row.id,
      enabled: row.enabled,
      rateBasisPoints: row.rateBasisPoints,
      ratePercent: formatExactVatRatePercent(row.rateBasisPoints),
      effectiveAt: row.effectiveAt.toISOString(),
      reasonCode: row.reasonCode as AdminAuditReasonCode,
      reasonNote: row.reasonNote,
      actor,
      isFuture: row.effectiveAt.getTime() > now.getTime(),
    };
  });

  return {
    current: {
      enabled: effective.enabled,
      rateBasisPoints: effective.rateBasisPoints,
      ratePercent: formatExactVatRatePercent(effective.rateBasisPoints),
      effectiveAt: (currentRow?.effectiveAt ?? now).toISOString(),
    },
    history,
  };
}
