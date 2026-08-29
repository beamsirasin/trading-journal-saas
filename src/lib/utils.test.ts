import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('applies conditional objects', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });

  it('resolves conflicting tailwind utilities in favour of the last', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-muted', 'text-foreground')).toBe('text-foreground');
  });

  it('keeps semantic typography roles alongside text tones', () => {
    expect(cn('text-metric', 'text-positive')).toBe('text-metric text-positive');
    expect(cn('text-kpi-hero', 'text-negative')).toBe('text-kpi-hero text-negative');
  });

  it('still resolves semantic and standard font-size conflicts in favour of the last', () => {
    expect(cn('text-metric', 'text-xl', 'text-positive')).toBe('text-xl text-positive');
    expect(cn('text-xl', 'text-metric', 'text-positive')).toBe('text-metric text-positive');
  });

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('');
  });
});
