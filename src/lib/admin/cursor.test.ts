import { describe, expect, it } from 'vitest';

import { clampAdminPageSize, decodeCreatedAtCursor, encodeCreatedAtCursor } from './cursor';

describe('encodeCreatedAtCursor / decodeCreatedAtCursor', () => {
  it('round-trips a createdAt and id exactly', () => {
    const createdAt = new Date('2026-08-10T15:42:03.123Z');
    const id = '01912345-6789-7abc-9def-0123456789ab';
    const cursor = encodeCreatedAtCursor(createdAt, id);
    const decoded = decodeCreatedAtCursor(cursor);
    expect(decoded).toEqual({ createdAt: createdAt.toISOString(), id });
  });

  it('produces an opaque base64url token, not a readable value', () => {
    const cursor = encodeCreatedAtCursor(new Date('2026-08-10T00:00:00Z'), 'abc');
    expect(cursor).not.toContain('2026');
    expect(cursor).not.toContain('abc');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for a non-base64 garbage string', () => {
    expect(decodeCreatedAtCursor('not a valid cursor!!! ///')).toBeNull();
  });

  it('returns null when the decoded payload has no separator', () => {
    const noSeparator = Buffer.from('nodelimiterhere', 'utf8').toString('base64url');
    expect(decodeCreatedAtCursor(noSeparator)).toBeNull();
  });

  it('returns null when the createdAt segment is empty', () => {
    const emptyDate = Buffer.from('|some-id', 'utf8').toString('base64url');
    expect(decodeCreatedAtCursor(emptyDate)).toBeNull();
  });

  it('returns null when the id segment is empty', () => {
    const emptyId = Buffer.from('2026-08-10T00:00:00.000Z|', 'utf8').toString('base64url');
    expect(decodeCreatedAtCursor(emptyId)).toBeNull();
  });

  it('returns null when the createdAt segment is not a parseable date', () => {
    const badDate = Buffer.from('not-a-date|some-id', 'utf8').toString('base64url');
    expect(decodeCreatedAtCursor(badDate)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeCreatedAtCursor('')).toBeNull();
  });

  it('tolerates an id containing the separator character itself, keeping only the first split', () => {
    const id = 'part-one|part-two';
    const cursor = encodeCreatedAtCursor(new Date('2026-08-10T00:00:00Z'), id);
    const decoded = decodeCreatedAtCursor(cursor);
    expect(decoded?.id).toBe(id);
  });
});

describe('clampAdminPageSize', () => {
  it('defaults to 25 when undefined', () => {
    expect(clampAdminPageSize(undefined)).toBe(25);
  });

  it('defaults to 25 for a non-finite value', () => {
    expect(clampAdminPageSize(Number.NaN)).toBe(25);
    expect(clampAdminPageSize(Number.POSITIVE_INFINITY)).toBe(25);
  });

  it('clamps a value above 100 down to 100', () => {
    expect(clampAdminPageSize(9999)).toBe(100);
  });

  it('clamps a value below 1 up to 1', () => {
    expect(clampAdminPageSize(0)).toBe(1);
    expect(clampAdminPageSize(-50)).toBe(1);
  });

  it('truncates a fractional value', () => {
    expect(clampAdminPageSize(10.9)).toBe(10);
  });

  it('passes through an in-range integer unchanged', () => {
    expect(clampAdminPageSize(50)).toBe(50);
  });
});
