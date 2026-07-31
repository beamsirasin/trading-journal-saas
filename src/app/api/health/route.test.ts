import { describe, expect, it } from 'vitest';

import { GET, type HealthResponse } from './route';

describe('GET /api/health', () => {
  it('returns 200', () => {
    expect(GET().status).toBe(200);
  });

  it('returns the documented shape', async () => {
    const body = (await GET().json()) as HealthResponse;
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true);
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns exactly three fields, so nothing leaks by accident', () => {
    // A stricter assertion than checking for known-bad keys: any new field
    // has to be added here deliberately, which is the point.
    return GET()
      .json()
      .then((body: HealthResponse) => {
        expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'uptimeSeconds']);
      });
  });

  it('leaks no environment values', async () => {
    process.env.HEALTH_LEAK_CANARY = 'super-secret-canary-value';
    try {
      const text = JSON.stringify(await GET().json());
      expect(text).not.toContain('super-secret-canary-value');
      expect(text).not.toContain('DATABASE_URL');
      expect(text).not.toContain('AUTH_SECRET');
      expect(text.toLowerCase()).not.toContain('postgres');
    } finally {
      delete process.env.HEALTH_LEAK_CANARY;
    }
  });

  it('emits an ISO 8601 UTC timestamp', async () => {
    const body = (await GET().json()) as HealthResponse;
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('forbids caching, so the answer is never stale', () => {
    const cacheControl = GET().headers.get('Cache-Control');
    expect(cacheControl).toContain('no-store');
  });

  it('does not require a database connection', () => {
    // DATABASE_URL is deliberately absent here; the handler must still work.
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(GET().status).toBe(200);
    } finally {
      if (previous !== undefined) {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});
