import { describe, expect, it } from 'vitest';

import { normalizeChangeNote, normalizeOptionalText, normalizeRequiredText } from './validation';

describe('normalizeRequiredText', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeRequiredText('  Elliott Wave + RSI  ')).toEqual({
      ok: true,
      value: 'Elliott Wave + RSI',
    });
  });

  it('rejects an empty string', () => {
    expect(normalizeRequiredText('')).toEqual({ ok: false, value: '' });
  });

  it('rejects a whitespace-only string', () => {
    expect(normalizeRequiredText('   ')).toEqual({ ok: false, value: '' });
  });

  it('accepts a single non-whitespace character', () => {
    expect(normalizeRequiredText(' x ')).toEqual({ ok: true, value: 'x' });
  });
});

describe('normalizeOptionalText', () => {
  it('returns null for null', () => {
    expect(normalizeOptionalText(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeOptionalText(undefined)).toBeNull();
  });

  it('returns null for a blank string', () => {
    expect(normalizeOptionalText('   ')).toBeNull();
  });

  it('trims and returns a non-blank string', () => {
    expect(normalizeOptionalText('  some notes  ')).toBe('some notes');
  });
});

describe('normalizeChangeNote', () => {
  it('rejects null', () => {
    expect(normalizeChangeNote(null).ok).toBe(false);
  });

  it('rejects undefined', () => {
    expect(normalizeChangeNote(undefined).ok).toBe(false);
  });

  it('rejects a whitespace-only note', () => {
    expect(normalizeChangeNote('   ').ok).toBe(false);
  });

  it('trims and accepts a non-blank note', () => {
    expect(normalizeChangeNote('  Tightened entry rules  ')).toEqual({
      ok: true,
      value: 'Tightened entry rules',
    });
  });
});
