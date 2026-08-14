/**
 * Pure, framework-independent shape/host rules for a Trade's Chart
 * attachment (Founder-UAT Trade Plan UX correction slice, migration 0010).
 * Shared by the upload boundary
 * (`src/lib/storage/chart-attachment-storage.ts`, server-only) and the
 * Trade Zod schemas (`src/lib/trades/schemas.ts`) so both sides agree on
 * exactly what a valid storage key looks like — never two independently-
 * drifting definitions. No I/O, no `server-only` — safe to import from
 * either side.
 *
 * Founder review (private-storage correction): a Chart attachment is
 * tenant-private user content, never a publicly-fetchable URL. Only the
 * object's stable storage key/pathname is ever persisted or validated here;
 * retrieval always goes through the authenticated application delivery
 * route (`src/app/api/trades/[tradeId]/chart-attachment/route.ts`), which
 * re-derives session + Workspace authorization before streaming the Blob
 * server-side. No public-URL concept exists in this module.
 */

/**
 * 3 MB — see `next.config.ts`'s `experimental.serverActions.bodySizeLimit`
 * doc comment for the full reasoning: this must stay comfortably below
 * Vercel's 4.5 MB per-function request-body ceiling even after multipart
 * `FormData` framing overhead, while remaining generous for a chart
 * screenshot.
 */
export const CHART_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Ordinary raster formats only (Founder review) — SVG is deliberately
 * excluded: an SVG can embed `<script>`/event-handler XSS payloads, and this
 * slice has no justification to build/vet a sanitizing SVG renderer for a
 * chart-screenshot feature. GIF was also dropped from the original draft
 * list — nothing in this product needs animated/palette images, and a
 * smaller allowlist is strictly safer.
 */
export const CHART_ATTACHMENT_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ChartAttachmentContentType = (typeof CHART_ATTACHMENT_CONTENT_TYPES)[number];

export function isChartAttachmentContentType(value: string): value is ChartAttachmentContentType {
  return (CHART_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

const CONTENT_TYPE_EXTENSION: Record<ChartAttachmentContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Magic-byte signatures for the three allowed formats — a lightweight,
 * dependency-free check (no image-processing library pulled in for this)
 * that the file's actual bytes match one of the allowed formats, rather
 * than trusting the browser-supplied `File.type` alone. Returns `null` when
 * no known signature matches. JPEG's signature is its 2-byte SOI marker
 * (`FF D8`) plus the `FF` that starts the very next marker — always present
 * in a real JPEG, unlike relying on a specific APP0/APP1 segment.
 */
export function detectImageSignature(bytes: Uint8Array): ChartAttachmentContentType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * The storage key is always built from this function — never from a
 * user-supplied filename (CLAUDE.md-aligned "random/non-user-controlled
 * storage key" requirement). `workspaceId`/`objectId` are both this
 * repository's own UUIDv7 identifiers (`generateId()`), never client input
 * beyond what session/entitlement already trusts. The key is never exposed
 * to another tenant: the delivery route re-derives the caller's own
 * Workspace and only ever looks up a key already stored on a Trade that
 * query proves belongs to that Workspace (see the route's own doc comment).
 */
export function buildChartAttachmentStorageKey(
  workspaceId: string,
  objectId: string,
  contentType: ChartAttachmentContentType,
): string {
  return `trade-charts/${workspaceId}/${objectId}.${CONTENT_TYPE_EXTENSION[contentType]}`;
}

export const CHART_ATTACHMENT_STORAGE_KEY_MAX_LENGTH = 200;
const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STORAGE_KEY_PATTERN = new RegExp(
  `^trade-charts/${UUID_SEGMENT}/${UUID_SEGMENT}\\.(png|jpg|webp)$`,
);

/**
 * Shape-only — proves the key matches what THIS app would have generated,
 * never that the object still exists. There is no client-supplied
 * storage-key input path anywhere in this product (upload generates it
 * server-side; the delivery route takes only a Trade id and reads the key
 * from the database), so this function exists purely as defense-in-depth
 * against a corrupted/malformed stored value ever being handed to the
 * storage provider's `get`/`delete` calls.
 */
export function isValidChartAttachmentStorageKey(value: string): boolean {
  return value.length <= CHART_ATTACHMENT_STORAGE_KEY_MAX_LENGTH && STORAGE_KEY_PATTERN.test(value);
}

/** The content type implied by an already-validated storage key's extension — used by the delivery route to set `Content-Type` without a second persisted column. */
export function contentTypeForStorageKey(storageKey: string): ChartAttachmentContentType | null {
  if (storageKey.endsWith('.png')) return 'image/png';
  if (storageKey.endsWith('.jpg')) return 'image/jpeg';
  if (storageKey.endsWith('.webp')) return 'image/webp';
  return null;
}

/** A storage key's own `workspaceId` segment — used to defend the delete action against deleting an object outside the caller's Workspace. */
export function workspaceIdFromStorageKey(storageKey: string): string | null {
  if (!isValidChartAttachmentStorageKey(storageKey)) return null;
  const segment = storageKey.split('/')[1];
  return segment ?? null;
}
