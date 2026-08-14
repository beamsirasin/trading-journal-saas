import 'server-only';

import { del, get, put } from '@vercel/blob';

import { getBlobReadWriteToken } from '@/config/env.server';
import { generateId } from '@/lib/identifiers';

import {
  buildChartAttachmentStorageKey,
  type ChartAttachmentContentType,
} from './chart-attachment';

/**
 * The one seam between Trade-creation Upload and whatever object-storage
 * provider is actually configured — `trade-management.ts`, the upload
 * Server Action, and anything else that stores a Chart attachment call
 * ONLY this interface, never `@vercel/blob` (or any future provider's SDK)
 * directly. Matches CLAUDE.md §3's "infrastructure (auth provider, email
 * sender, payment provider) sits behind a small adapter" posture, extended
 * to object storage. A future VPS/S3-compatible migration swaps ONE
 * implementation behind {@link getChartAttachmentStorage}, never every call
 * site.
 *
 * Founder review (private-storage correction): every object is uploaded
 * with `access: 'private'` — a Trading chart screenshot is tenant-private
 * user content, never publicly fetchable by URL. `upload` therefore returns
 * only the storage key (no `url`); the only way to read the bytes back is
 * `get`, called exclusively by the authenticated application delivery route
 * (`src/app/api/trades/[tradeId]/chart-attachment/route.ts`) after it has
 * independently re-derived the caller's session and verified the requested
 * Trade belongs to the caller's own Workspace.
 */
export interface ChartAttachmentUploadResult {
  readonly storageKey: string;
}

export interface ChartAttachmentDownload {
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly size: number;
}

export interface ChartAttachmentStorage {
  upload(params: {
    readonly workspaceId: string;
    readonly contentType: ChartAttachmentContentType;
    readonly bytes: Uint8Array;
  }): Promise<ChartAttachmentUploadResult>;
  /** `null` when the object no longer exists — the delivery route treats this identically to "no attachment." */
  get(storageKey: string): Promise<ChartAttachmentDownload | null>;
  delete(storageKey: string): Promise<void>;
}

/**
 * Vercel Blob-backed implementation — the smallest production-safe choice
 * for this stack (CLAUDE.md's Next.js-on-Vercel-or-VPS target already
 * accepts Vercel-specific deployment features where they are the pragmatic
 * default, unlike Vercel-only DATABASE features, which CLAUDE.md explicitly
 * forbids). The installed `@vercel/blob` (2.8.0) supports `access:
 * 'private'` end-to-end: `put(..., { access: 'private' })` for upload and
 * `get(pathname, { access: 'private' })` for a server-side, token-scoped
 * read — no public URL is ever generated or exposed for these objects.
 * `addRandomSuffix: false` because the storage key is already random and
 * server-generated end-to-end (`buildChartAttachmentStorageKey`) — a
 * second, provider-added random suffix would only make the key harder to
 * reason about without adding any real unguessability.
 */
function createVercelBlobChartAttachmentStorage(token: string): ChartAttachmentStorage {
  return {
    async upload({ workspaceId, contentType, bytes }) {
      const storageKey = buildChartAttachmentStorageKey(workspaceId, generateId(), contentType);
      await put(storageKey, Buffer.from(bytes), {
        access: 'private',
        contentType,
        token,
        addRandomSuffix: false,
      });
      return { storageKey };
    },
    async get(storageKey) {
      const result = await get(storageKey, { access: 'private', token });
      if (result === null || result.statusCode !== 200) return null;
      return {
        stream: result.stream,
        contentType: result.blob.contentType,
        size: result.blob.size,
      };
    },
    async delete(storageKey) {
      await del(storageKey, { token });
    },
  };
}

/**
 * Trade-creation Upload's own truthful capability check (Founder-UAT Trade
 * Plan UX correction slice §10) — the UI hides the Upload option entirely
 * when this is `false`, rather than showing a permanently-disabled fake
 * control. Reflects nothing but whether `BLOB_READ_WRITE_TOKEN` is set;
 * never throws.
 */
export function isChartAttachmentStorageConfigured(): boolean {
  return getBlobReadWriteToken() !== undefined;
}

/** `null` when unconfigured — every caller must handle that case explicitly rather than assuming a working adapter. */
export function getChartAttachmentStorage(): ChartAttachmentStorage | null {
  const token = getBlobReadWriteToken();
  return token === undefined ? null : createVercelBlobChartAttachmentStorage(token);
}
