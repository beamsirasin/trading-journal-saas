import 'server-only';

import { getDb } from '@/server/db/client';

import { insertAuditLog } from './audit-log';

type AuditWriter = typeof insertAuditLog;

export interface UpdateDisplayNameResult {
  readonly changed: boolean;
  readonly name: string;
}

/**
 * Coordinates the canonical Better Auth mutation supplied by the action with
 * the account-level audit row. Better Auth owns its own transaction, so the
 * audit necessarily follows it and this function deliberately makes no false
 * atomicity claim. Exact no-ops call neither dependency.
 */
export async function updateDisplayName(
  userId: string,
  currentName: string,
  nextName: string,
  updateCanonicalUser: (name: string) => Promise<void>,
  auditWriter: AuditWriter = insertAuditLog,
): Promise<UpdateDisplayNameResult> {
  if (currentName === nextName) {
    return { changed: false, name: currentName };
  }

  await updateCanonicalUser(nextName);
  await auditWriter(getDb(), {
    action: 'user.profile_updated',
    actorUserId: userId,
    entityType: 'user',
    entityId: userId,
    metadata: { changedFields: ['name'] },
  });

  return { changed: true, name: nextName };
}
