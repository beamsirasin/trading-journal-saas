import 'server-only';

import { createHash } from 'node:crypto';

/**
 * THE SCOPE OF A BROWSER-LOCAL ADD TRADE RECORDING DRAFT (contract §23).
 *
 * Derived on the server from the session's user and the resolved active
 * workspace — never from anything the client sends — and handed to the client
 * only as opaque hashes, so a storage key names no raw database id.
 *
 * NOT AN AUTHORIZATION BOUNDARY. A draft is the trader's own unsaved input on
 * their own browser; it grants nothing, and every Save is authorized on the
 * server. The hashes exist to keep one user's and one workspace's draft from
 * being read in another's context on a shared device.
 */
function digest(domain: string, id: string): string {
  return createHash('sha256')
    .update(`tradechemist/recording-draft/${domain}/${id}`)
    .digest('hex')
    .slice(0, 32);
}

export interface RecordingDraftScopeKeys {
  readonly ownerKey: string;
  readonly workspaceKey: string;
}

export function recordingDraftOwnerKey(userId: string): string {
  return digest('owner', userId);
}

export function recordingDraftScopeKeys(
  userId: string,
  workspaceId: string,
): RecordingDraftScopeKeys {
  return {
    ownerKey: recordingDraftOwnerKey(userId),
    workspaceKey: digest('workspace', workspaceId),
  };
}
