import {
  contentTypeForStorageKey,
  isChartAttachmentContentType,
  isValidChartAttachmentStorageKey,
} from '@/lib/storage/chart-attachment';
import { getChartAttachmentStorage } from '@/lib/storage/chart-attachment-storage';
import { UnauthenticatedError } from '@/server/auth/dal';
import { getWorkspaceTradeChartAttachmentKey } from '@/server/dal/trades';

/**
 * The one authenticated delivery route for a Trade's private Chart
 * attachment (Founder review, private-storage correction). A Chart
 * screenshot is tenant-private user content — the object storage adapter
 * always uploads with `access: 'private'` (`chart-attachment-storage.ts`),
 * and NO public URL is ever generated or persisted. Possessing this route's
 * URL therefore grants nothing by itself: every request independently
 * re-derives the caller's session and re-verifies the requested Trade
 * belongs to the caller's own active Workspace (`getWorkspaceTradeChartAttachmentKey`
 * — the same workspace-scoped, privacy-safe-denial DAL posture
 * `getWorkspaceTradeDetail` already establishes) BEFORE ever touching
 * storage. No browser-supplied Workspace ID is ever accepted or trusted.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type RouteParams = { tradeId: string };

function errorResponse(
  status: number,
  code: 'unauthenticated' | 'not_found' | 'unexpected_error',
): Response {
  return Response.json(
    { ok: false, error: { code } },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<RouteParams> },
): Promise<Response> {
  const { tradeId } = await params;
  if (!UUID_PATTERN.test(tradeId)) {
    return errorResponse(404, 'not_found');
  }

  let lookup: Awaited<ReturnType<typeof getWorkspaceTradeChartAttachmentKey>>;
  try {
    lookup = await getWorkspaceTradeChartAttachmentKey(tradeId);
  } catch (error) {
    if (error instanceof UnauthenticatedError || hasErrorName(error, 'UnauthenticatedError')) {
      return errorResponse(401, 'unauthenticated');
    }
    return errorResponse(500, 'unexpected_error');
  }
  // Nonexistent Trade, another Workspace's Trade, and "no attachment on this
  // Trade" all return the identical safe response — never distinguishable
  // from the caller's perspective (mirrors `getWorkspaceTradeDetail`'s own
  // `trade_not_found` posture).
  if (!lookup.ok) return errorResponse(404, 'not_found');

  // Malformed-key defense-in-depth: the DB-stored key was only ever written
  // by this app's own upload path, but a corrupted row must never be handed
  // to the storage provider's `get` call.
  if (!isValidChartAttachmentStorageKey(lookup.storageKey)) {
    return errorResponse(404, 'not_found');
  }

  const storage = getChartAttachmentStorage();
  if (storage === null) return errorResponse(404, 'not_found');

  const object = await storage.get(lookup.storageKey);
  if (object === null) return errorResponse(404, 'not_found');

  // The Content-Type is clamped to this app's own allowlist regardless of
  // what the storage provider reports, and derived from the validated
  // key's extension as the primary source of truth — never forwarded
  // unchecked from an external system.
  const contentType = contentTypeForStorageKey(lookup.storageKey);
  const safeContentType =
    contentType !== null && isChartAttachmentContentType(contentType)
      ? contentType
      : 'application/octet-stream';

  return new Response(object.stream, {
    status: 200,
    headers: {
      'Content-Type': safeContentType,
      'Content-Length': String(object.size),
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

function hasErrorName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name;
}
