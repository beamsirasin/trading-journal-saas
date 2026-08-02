import { describe, expect, it } from 'vitest';

import { generateId } from './identifiers';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateId', () => {
  it('produces a well-formed UUIDv7 (version nibble 7, RFC 4122 variant)', () => {
    expect(generateId()).toMatch(UUID_V7_PATTERN);
  });

  it('never repeats across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });

  it('sorts chronologically with call order', () => {
    const first = generateId();
    const second = generateId();
    expect(first < second).toBe(true);
  });
});
