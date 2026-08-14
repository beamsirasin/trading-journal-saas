import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves the authenticated Chart-attachment delivery route's own
 * authorization/response-shaping logic (Founder review §4) using the
 * storage-adapter boundary as a fake — the same pattern
 * `src/app/api/settings/export/workspace/[format]/route.test.ts` already
 * establishes for a sibling authenticated streaming route. No real Vercel
 * Blob credentials exist in this environment, and none are needed here: the
 * DAL (`getWorkspaceTradeChartAttachmentKey`) is the actual tenant-isolation
 * boundary under test (identical workspace-scoped privacy-safe-denial
 * posture already proven for Trade reads generally by
 * `src/server/dal/trades.integration.test.ts` against a real Postgres
 * database — this file complements that proof at the route layer, it does
 * not replace it), and the fake storage adapter here only proves the route
 * NEVER reaches storage for an invalid/unauthorized case.
 */

const state = vi.hoisted(() => ({
  lookup: vi.fn(),
  storageGet: vi.fn(),
}));

vi.mock('@/server/auth/dal', () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock('@/server/dal/trades', () => ({
  getWorkspaceTradeChartAttachmentKey: (...args: unknown[]) => state.lookup(...args),
}));
vi.mock('@/lib/storage/chart-attachment-storage', () => ({
  getChartAttachmentStorage: () => ({ get: state.storageGet }),
}));

const { GET } = await import('./route');

const VALID_TRADE_ID = '018f0000-0000-7000-8000-0000000000aa';
const VALID_STORAGE_KEY =
  'trade-charts/018f0000-0000-7000-8000-000000000001/018f0000-0000-7000-8000-000000000002.png';

function request(tradeId: string) {
  return GET(new Request(`http://localhost/api/trades/${tradeId}/chart-attachment`), {
    params: Promise.resolve({ tradeId }),
  });
}

function fakeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

describe('Chart-attachment delivery Route Handler', () => {
  beforeEach(() => {
    state.lookup.mockReset();
    state.storageGet.mockReset();
  });

  it("streams the attachment for the owning Workspace's own Trade, with private/no-store/nosniff headers", async () => {
    state.lookup.mockResolvedValue({ ok: true, storageKey: VALID_STORAGE_KEY });
    state.storageGet.mockResolvedValue({
      stream: fakeStream(),
      contentType: 'image/png',
      size: 3,
    });

    const response = await request(VALID_TRADE_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(state.lookup).toHaveBeenCalledWith(VALID_TRADE_ID);
    expect(state.storageGet).toHaveBeenCalledWith(VALID_STORAGE_KEY);
  });

  it('denies an unauthenticated request without ever calling storage', async () => {
    state.lookup.mockRejectedValue({ name: 'UnauthenticatedError' });

    const response = await request(VALID_TRADE_ID);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'unauthenticated' } });
    expect(state.storageGet).not.toHaveBeenCalled();
  });

  it('returns the identical not-found response for a cross-Workspace Trade as for a nonexistent one (privacy-safe denial)', async () => {
    state.lookup.mockResolvedValue({ ok: false, code: 'trade_not_found' });
    const crossWorkspaceResponse = await request(VALID_TRADE_ID);
    expect(crossWorkspaceResponse.status).toBe(404);
    const crossWorkspaceBody = await crossWorkspaceResponse.json();

    state.lookup.mockResolvedValue({ ok: false, code: 'trade_not_found' });
    const nonexistentResponse = await request('018f0000-0000-7000-8000-0000000000ff');
    expect(nonexistentResponse.status).toBe(404);
    const nonexistentBody = await nonexistentResponse.json();

    expect(crossWorkspaceBody).toEqual(nonexistentBody);
    expect(state.storageGet).not.toHaveBeenCalled();
  });

  it('returns the same safe not-found response when the Trade has no attachment', async () => {
    state.lookup.mockResolvedValue({ ok: false, code: 'no_attachment' });
    const response = await request(VALID_TRADE_ID);
    expect(response.status).toBe(404);
    expect(state.storageGet).not.toHaveBeenCalled();
  });

  it('rejects a syntactically invalid Trade id before ever calling the DAL', async () => {
    const response = await request('not-a-uuid');
    expect(response.status).toBe(404);
    expect(state.lookup).not.toHaveBeenCalled();
  });

  it('a malformed stored storage key never reaches the storage adapter (defense-in-depth)', async () => {
    // Simulates a corrupted/impossible DB row — the DAL itself has no shape
    // opinion on the key, so the route's own validation is what must catch
    // this before any `storage.get` call could ever be attempted.
    state.lookup.mockResolvedValue({ ok: true, storageKey: '../../etc/passwd' });

    const response = await request(VALID_TRADE_ID);

    expect(response.status).toBe(404);
    expect(state.storageGet).not.toHaveBeenCalled();
  });

  it('returns not-found when the object no longer exists in storage', async () => {
    state.lookup.mockResolvedValue({ ok: true, storageKey: VALID_STORAGE_KEY });
    state.storageGet.mockResolvedValue(null);

    const response = await request(VALID_TRADE_ID);

    expect(response.status).toBe(404);
  });
});
