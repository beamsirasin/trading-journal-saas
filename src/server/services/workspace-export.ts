import 'server-only';

import { PRODUCT_VERSION } from '@/config/product';
import {
  createWorkspaceExportCsvZip,
  createWorkspaceExportEnvelope,
  serializeWorkspaceExportJson,
  WORKSPACE_EXPORT_SCHEMA_VERSION,
  type WorkspaceExportEnvelope,
  type WorkspaceExportFormat,
} from '@/lib/export/workspace-export';
import { systemClock, type Clock } from '@/lib/time';
import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { readWorkspaceExportSource } from '@/server/dal/workspace-export';
import { getDb } from '@/server/db/client';

import { insertAuditLog } from './audit-log';

export interface WorkspaceExportArtifact {
  readonly format: WorkspaceExportFormat;
  readonly filename: string;
  readonly contentType: 'application/json; charset=utf-8' | 'application/zip';
  readonly body: string | Uint8Array;
  readonly envelope: WorkspaceExportEnvelope;
}

type AuditWriter = typeof insertAuditLog;

/**
 * Builds the complete direct-download artifact before recording the required
 * security audit. Once this returns, generation succeeded and `data.exported`
 * is durable; a later client/network interruption cannot be observed by this
 * synchronous MVP and does not retract that event.
 */
export async function prepareCurrentWorkspaceExport(
  format: WorkspaceExportFormat,
  dependencies: { readonly clock?: Clock; readonly auditWriter?: AuditWriter } = {},
): Promise<WorkspaceExportArtifact> {
  const clock = dependencies.clock ?? systemClock;
  const auditWriter = dependencies.auditWriter ?? insertAuditLog;
  const { workspaceId, userId } = await getActiveWorkspaceContext();
  const source = await readWorkspaceExportSource(workspaceId, userId);
  const exportedAt = clock.now();
  const envelope = createWorkspaceExportEnvelope({
    exportedAt,
    productVersion: PRODUCT_VERSION,
    workspaceId,
    source,
  });
  const body =
    format === 'json'
      ? serializeWorkspaceExportJson(envelope)
      : createWorkspaceExportCsvZip(envelope);

  await auditWriter(getDb(), {
    action: 'data.exported',
    workspaceId,
    actorUserId: userId,
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: {
      format,
      scope: 'workspace',
      schemaVersion: WORKSPACE_EXPORT_SCHEMA_VERSION,
    },
  });

  const date = exportedAt.toISOString().slice(0, 10);
  return {
    format,
    filename: `trading-journal-workspace-${date}.${format === 'json' ? 'json' : 'zip'}`,
    contentType: format === 'json' ? 'application/json; charset=utf-8' : 'application/zip',
    body,
    envelope,
  };
}
