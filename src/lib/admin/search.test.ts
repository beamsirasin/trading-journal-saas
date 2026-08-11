import { describe, expect, it } from 'vitest';

import { escapeLikePrefix, isUuidLike, parseAdminSearchQuery } from './search';

describe('isUuidLike', () => {
  it('accepts a well-formed UUID', () => {
    expect(isUuidLike('01912345-6789-7abc-9def-0123456789ab')).toBe(true);
  });

  it('accepts a UUID regardless of case', () => {
    expect(isUuidLike('01912345-6789-7ABC-9DEF-0123456789AB')).toBe(true);
  });

  it('rejects a plain string', () => {
    expect(isUuidLike('not-a-uuid')).toBe(false);
  });

  it('rejects a UUID missing a segment', () => {
    expect(isUuidLike('01912345-6789-7abc-9def')).toBe(false);
  });

  it('rejects an email that merely contains hyphens', () => {
    expect(isUuidLike('a-b-c-d-e@example.com')).toBe(false);
  });
});

describe('parseAdminSearchQuery', () => {
  it('returns kind "none" for null', () => {
    expect(parseAdminSearchQuery(null)).toEqual({ kind: 'none' });
  });

  it('returns kind "none" for undefined', () => {
    expect(parseAdminSearchQuery(undefined)).toEqual({ kind: 'none' });
  });

  it('returns kind "none" for an empty string', () => {
    expect(parseAdminSearchQuery('')).toEqual({ kind: 'none' });
  });

  it('returns kind "none" for a whitespace-only string', () => {
    expect(parseAdminSearchQuery('   ')).toEqual({ kind: 'none' });
  });

  it('returns kind "none" for a query longer than 200 characters', () => {
    expect(parseAdminSearchQuery('a'.repeat(201))).toEqual({ kind: 'none' });
  });

  it('accepts a query exactly at the 200 character boundary', () => {
    const query = 'a'.repeat(200);
    expect(parseAdminSearchQuery(query)).toEqual({ kind: 'prefix', text: query });
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(parseAdminSearchQuery('  jane@example.com  ')).toEqual({
      kind: 'prefix',
      text: 'jane@example.com',
    });
  });

  it('classifies a UUID-shaped query as kind "id" and lowercases it', () => {
    expect(parseAdminSearchQuery('01912345-6789-7ABC-9DEF-0123456789AB')).toEqual({
      kind: 'id',
      id: '01912345-6789-7abc-9def-0123456789ab',
    });
  });

  it('classifies a non-UUID query as a prefix search, preserving case', () => {
    expect(parseAdminSearchQuery('Jane Doe')).toEqual({ kind: 'prefix', text: 'Jane Doe' });
  });
});

describe('escapeLikePrefix', () => {
  it('appends a trailing % for prefix matching', () => {
    expect(escapeLikePrefix('jane')).toBe('jane%');
  });

  it('escapes a literal percent sign', () => {
    expect(escapeLikePrefix('100% Trader')).toBe('100\\% Trader%');
  });

  it('escapes a literal underscore', () => {
    expect(escapeLikePrefix('jane_doe')).toBe('jane\\_doe%');
  });

  it('escapes a literal backslash', () => {
    expect(escapeLikePrefix('a\\b')).toBe('a\\\\b%');
  });

  it('escapes mixed special characters in one pass, order-independent', () => {
    expect(escapeLikePrefix('100%_off\\now')).toBe('100\\%\\_off\\\\now%');
  });

  it('leaves ordinary text untouched aside from the trailing %', () => {
    expect(escapeLikePrefix('trading os')).toBe('trading os%');
  });
});
