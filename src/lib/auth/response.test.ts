import { describe, expect, it } from 'vitest';

import { redactAuthResponse } from './response';

describe('redactAuthResponse', () => {
  it('removes nested credentials while preserving safe JSON and response metadata', async () => {
    const sourceHeaders = new Headers({ 'content-type': 'application/json' });
    sourceHeaders.append('set-cookie', 'session=value; HttpOnly');
    sourceHeaders.append('set-cookie', 'cache=value; HttpOnly');
    const response = new Response(
      JSON.stringify({
        token: 'session-secret',
        user: { id: 'user-1', accessToken: 'provider-secret' },
        nested: [{ refreshToken: 'refresh-secret', ok: true }],
      }),
      {
        status: 201,
        headers: sourceHeaders,
      },
    );

    const redacted = await redactAuthResponse(response);

    expect(redacted.status).toBe(201);
    expect(redacted.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await redacted.json()).toEqual({
      user: { id: 'user-1' },
      nested: [{ ok: true }],
    });
  });

  it('leaves non-JSON responses untouched', async () => {
    const response = new Response('redirect', { status: 302 });
    expect(await redactAuthResponse(response)).toBe(response);
  });
});
