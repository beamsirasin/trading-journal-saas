import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  prepare: vi.fn(),
  artifact: null as unknown,
  failure: null as unknown,
}));

vi.mock('@/server/services/workspace-export', () => ({
  prepareCurrentWorkspaceExport: (...args: unknown[]) => {
    state.prepare(...args);
    if (state.failure !== null) throw state.failure;
    return state.artifact;
  },
}));
vi.mock('@/server/auth/dal', () => ({
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock('@/server/dal/workspace-export', () => ({
  WorkspaceExportAccessError: class WorkspaceExportAccessError extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

const { GET } = await import('./route');

function request(format: string) {
  return GET(new Request(`http://localhost/api/settings/export/workspace/${format}`), {
    params: Promise.resolve({ format }),
  });
}

describe('workspace export Route Handler', () => {
  beforeEach(() => state.prepare.mockReset());

  it('returns valid no-store JSON attachment headers and body', async () => {
    state.failure = null;
    state.artifact = {
      filename: 'trading-journal-workspace-2026-08-09.json',
      contentType: 'application/json; charset=utf-8',
      body: '{"schemaVersion":1,"data":{}}',
    };
    const response = await request('json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="trading-journal-workspace-2026-08-09.json"',
    );
    expect(await response.json()).toEqual({ schemaVersion: 1, data: {} });
    expect(state.prepare).toHaveBeenCalledWith('json');
  });

  it('returns a ZIP attachment without decoding or corrupting bytes', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    state.failure = null;
    state.artifact = {
      filename: 'trading-journal-workspace-2026-08-09.zip',
      contentType: 'application/zip',
      body: bytes,
    };
    const response = await request('csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain(
      'trading-journal-workspace-2026-08-09.zip',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  async function expectSafeError(error: unknown, status: number, code: string) {
    state.failure = error;
    state.artifact = null;
    const response = await request('json');
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('content-disposition')).toBe(false);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code } });
    expect(text).not.toMatch(/SQL table secret|stack|workspace_members/i);
  }

  it('returns a safe unauthenticated error without attachment headers', async () => {
    await expectSafeError({ name: 'UnauthenticatedError' }, 401, 'unauthenticated');
  });

  it('returns a safe owner-required error without attachment headers', async () => {
    await expectSafeError(
      { name: 'WorkspaceExportAccessError', code: 'owner_required' },
      403,
      'owner_required',
    );
  });

  it('returns a safe unavailable error without attachment headers', async () => {
    await expectSafeError(
      { name: 'WorkspaceExportAccessError', code: 'workspace_not_found' },
      404,
      'export_unavailable',
    );
  });

  it('returns a safe unexpected error without attachment headers', async () => {
    await expectSafeError('SQL table secret', 500, 'unexpected_error');
  });

  it('rejects unknown formats before authorization or export generation', async () => {
    const response = await request('secrets');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'invalid_format' } });
    expect(state.prepare).not.toHaveBeenCalled();
    expect(response.headers.has('content-disposition')).toBe(false);
  });
});
