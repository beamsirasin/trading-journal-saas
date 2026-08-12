import 'server-only';

import type { AdminAuditAction, AdminAuditReasonCode } from '@/config/admin-audit-actions';
import {
  parseAdminAuditStateSnapshot,
  type AdminAuditStateSnapshot,
} from '@/lib/admin/audit-snapshot';
import { systemClock, type Clock } from '@/lib/time';
import { requirePlatformAdmin } from '@/server/auth/admin-dal';
import { listActorIdentitiesByGrantIds, listAdminAuditLog } from '@/server/dal/admin/audit';
import { getDb } from '@/server/db/client';

/**
 * Read-only Admin Audit list (Phase 11E) — `requirePlatformAdmin()` re-
 * checked HERE, not only the `/admin` route layout. Composes exactly two
 * fixed queries per page (the audit rows, then a batched actor-identity
 * lookup for the page's distinct admin grants) — never one query per row.
 * `before_state`/`after_state` are parsed through the allowlist
 * (`src/lib/admin/audit-snapshot.ts`) before ever reaching a DTO; the raw
 * jsonb value never crosses this boundary unfiltered.
 */

export type AdminAuditActor =
  | { readonly kind: 'system' }
  | {
      readonly kind: 'platform_admin';
      readonly adminGrantId: string;
      readonly name: string | null;
      readonly email: string | null;
    };

export interface AdminAuditEntry {
  readonly id: string;
  readonly createdAt: string;
  readonly action: AdminAuditAction;
  readonly reasonCode: AdminAuditReasonCode;
  readonly reasonNote: string | null;
  readonly actor: AdminAuditActor;
  readonly subjectUserId: string | null;
  readonly subjectWorkspaceId: string | null;
  readonly before: AdminAuditStateSnapshot | null;
  readonly after: AdminAuditStateSnapshot | null;
}

export interface AdminAuditListPage {
  readonly items: readonly AdminAuditEntry[];
  readonly nextCursor: string | null;
}

export type AdminAuditDatePreset = '30d' | 'all';

export interface AdminAuditListParams {
  readonly action?: AdminAuditAction | null;
  readonly reasonCode?: AdminAuditReasonCode | null;
  readonly actorUserId?: string | null;
  readonly subjectUserId?: string | null;
  readonly subjectWorkspaceId?: string | null;
  readonly datePreset?: AdminAuditDatePreset;
  readonly cursor?: string | null;
  readonly limit?: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function getAdminAuditList(
  params: AdminAuditListParams,
  clock: Clock = systemClock,
): Promise<AdminAuditListPage> {
  await requirePlatformAdmin();

  const db = getDb();
  const since =
    params.datePreset === '30d' ? new Date(clock.now().getTime() - THIRTY_DAYS_MS) : null;

  const page = await listAdminAuditLog(db, {
    action: params.action ?? null,
    reasonCode: params.reasonCode ?? null,
    actorUserId: params.actorUserId ?? null,
    subjectUserId: params.subjectUserId ?? null,
    subjectWorkspaceId: params.subjectWorkspaceId ?? null,
    since,
    cursor: params.cursor ?? null,
    ...(params.limit === undefined ? {} : { limit: params.limit }),
  });

  const adminGrantIds = [
    ...new Set(
      page.items
        .filter((row) => row.actorKind === 'platform_admin' && row.actorAdminId !== null)
        .map((row) => row.actorAdminId as string),
    ),
  ];
  const actorRows = await listActorIdentitiesByGrantIds(db, adminGrantIds);
  const actorByGrantId = new Map(actorRows.map((row) => [row.adminGrantId, row]));

  const items = page.items.map((row): AdminAuditEntry => {
    const actor: AdminAuditActor =
      row.actorKind !== 'platform_admin' || row.actorAdminId === null
        ? { kind: 'system' }
        : {
            kind: 'platform_admin',
            adminGrantId: row.actorAdminId,
            name: actorByGrantId.get(row.actorAdminId)?.name ?? null,
            email: actorByGrantId.get(row.actorAdminId)?.email ?? null,
          };

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action as AdminAuditAction,
      reasonCode: row.reasonCode as AdminAuditReasonCode,
      reasonNote: row.reasonNote,
      actor,
      subjectUserId: row.subjectUserId,
      subjectWorkspaceId: row.subjectWorkspaceId,
      before: parseAdminAuditStateSnapshot(row.beforeState),
      after: parseAdminAuditStateSnapshot(row.afterState),
    };
  });

  return { items, nextCursor: page.nextCursor };
}
