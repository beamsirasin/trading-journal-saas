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

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('');
  });
});
