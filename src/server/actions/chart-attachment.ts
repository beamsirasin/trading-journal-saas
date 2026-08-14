'use server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import {
  CHART_ATTACHMENT_MAX_BYTES,
  detectImageSignature,
  isChartAttachmentContentType,
  workspaceIdFromStorageKey,
} from '@/lib/storage/chart-attachment';
import {
  getChartAttachmentStorage,
  isChartAttachmentStorageConfigured,
} from '@/lib/storage/chart-attachment-storage';
import {
  ForbiddenError,
  getActiveWorkspaceContext,
  getWorkspaceEntitlement,
  requireTradeManagement,
} from '@/server/auth/dal';

/**
 * Founder-UAT Trade Plan UX correction slice (migration 0010) — the one
 * upload boundary for a Trade's Chart attachment. Deliberately a STANDALONE
 * Server Action, not a `trade-management.ts` service function: the upload
 * must happen BEFORE a Trade exists (preview during the multi-step creation
 * wizard, per the product brief), so it cannot live inside `createTrade`'s
 * own transaction. `createTradeAction` receives only the resulting
 * `storageKey` — this action never touches the `trades` table, and the
 * uploaded object is private (see `chart-attachment-storage.ts`).
 *
 * Authorization mirrors `trades.ts`'s own posture exactly (session ->
 * active membership -> `'ordinary_write'` entitlement) even though no Trade
 * row is involved yet — an upload still consumes real storage, so a
 * read-only or over-limit Workspace must not be able to run it up.
 */

export type ChartAttachmentUploadErrorCode =
  | 'unauthenticated'
  | 'workspace_access_denied'
  | 'read_only_workspace'
  | 'over_limit_workspace'
  | 'storage_not_configured'
  | 'unsupported_file_type'
  | 'invalid_file_signature'
  | 'file_too_large'
  | 'invalid_file'
  | 'unexpected_error';

export interface UploadChartAttachmentData {
  readonly storageKey: string;
}

export type UploadChartAttachmentResult =
  | { readonly ok: true; readonly data: UploadChartAttachmentData }
  | { readonly ok: false; readonly error: { readonly code: ChartAttachmentUploadErrorCode } };

function failure(code: ChartAttachmentUploadErrorCode): UploadChartAttachmentResult {
  return { ok: false, error: { code } };
}

/** The subset of error codes both the upload and delete actions can produce from authorization alone — shared so neither action's own broader error-code union leaks into the other. */
type WorkspaceStorageAuthErrorCode =
  | 'unauthenticated'
  | 'workspace_access_denied'
  | 'read_only_workspace'
  | 'over_limit_workspace'
  | 'unexpected_error';

async function authorizeWorkspaceStorageWrite(): Promise<
  | { readonly ok: true; readonly workspaceId: string }
  | { readonly ok: false; readonly code: WorkspaceStorageAuthErrorCode }
> {
  let workspaceId: string;
  try {
    const context = await getActiveWorkspaceContext();
    workspaceId = context.workspaceId;
    await requireTradeManagement(workspaceId);
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: 'workspace_access_denied' };
    if (error instanceof Error && error.name === 'UnauthenticatedError') {
      return { ok: false, code: 'unauthenticated' };
    }
    return { ok: false, code: 'unexpected_error' };
  }

  const entitlement = await getWorkspaceEntitlement();
  const authorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');
  if (!authorization.allowed) {
    return {
      ok: false,
      code:
        authorization.code === 'read_only_workspace' ||
        authorization.code === 'over_limit_workspace'
          ? authorization.code
          : 'workspace_access_denied',
    };
  }
  return { ok: true, workspaceId };
}

export async function uploadChartAttachmentAction(
  formData: FormData,
): Promise<UploadChartAttachmentResult> {
  if (!isChartAttachmentStorageConfigured()) {
    return failure('storage_not_configured');
  }

  const authorized = await authorizeWorkspaceStorageWrite();
  if (!authorized.ok) return failure(authorized.code);
  const { workspaceId } = authorized;

  try {
    const file = formData.get('file');
    if (!(file instanceof File)) return failure('invalid_file');
    if (!isChartAttachmentContentType(file.type)) return failure('unsupported_file_type');
    if (file.size <= 0 || file.size > CHART_ATTACHMENT_MAX_BYTES) return failure('file_too_large');

    const storage = getChartAttachmentStorage();
    if (storage === null) return failure('storage_not_configured');

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Never trust the browser-supplied `File.type` alone — verify the
    // actual bytes match one of the allowed formats (Founder review §2).
    const detected = detectImageSignature(bytes);
    if (detected === null || detected !== file.type) {
      return failure('invalid_file_signature');
    }

    const uploaded = await storage.upload({ workspaceId, contentType: file.type, bytes });
    return { ok: true, data: { storageKey: uploaded.storageKey } };
  } catch {
    return failure('unexpected_error');
  }
}

export type DeleteChartAttachmentErrorCode =
  | 'unauthenticated'
  | 'workspace_access_denied'
  | 'read_only_workspace'
  | 'over_limit_workspace'
  | 'storage_not_configured'
  | 'invalid_storage_key'
  | 'unexpected_error';

export type DeleteChartAttachmentResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: DeleteChartAttachmentErrorCode } };

/**
 * Best-effort cleanup for a file the user uploaded but removed/replaced
 * BEFORE the Trade was ever created (Founder review §5's orphan-cleanup
 * requirement extended to the pre-creation case, where the client is the
 * only party that still knows the key). Never invoked as part of Trade
 * creation itself — `createTrade`'s own failure path performs its own
 * server-side cleanup (`trade-management.ts`). `storageKey` is only ever
 * accepted from a client that already received it from THIS session's own
 * `uploadChartAttachmentAction` call; the Workspace-prefix check below
 * still defends against a forged key naming another Workspace's object.
 */
export async function deleteChartAttachmentAction(
  storageKey: string,
): Promise<DeleteChartAttachmentResult> {
  if (!isChartAttachmentStorageConfigured()) {
    return { ok: false, error: { code: 'storage_not_configured' } };
  }

  const authorized = await authorizeWorkspaceStorageWrite();
  if (!authorized.ok) {
    return { ok: false, error: { code: authorized.code } };
  }
  const { workspaceId } = authorized;

  if (workspaceIdFromStorageKey(storageKey) !== workspaceId) {
    return { ok: false, error: { code: 'invalid_storage_key' } };
  }

  try {
    const storage = getChartAttachmentStorage();
    if (storage === null) return { ok: false, error: { code: 'storage_not_configured' } };
    await storage.delete(storageKey);
    return { ok: true };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}
