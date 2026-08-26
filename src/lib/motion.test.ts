import { describe, expect, it } from 'vitest';

import { DURATION, EASING, REDUCED_TRANSITION, transition } from './motion';

describe('motion policy', () => {
  it('preserves the requested normal duration and standard easing', () => {
    expect(transition(false, DURATION.fast)).toEqual({
      duration: DURATION.fast,
      ease: EASING.standard,
    });
  });

  it('uses short non-spring feedback instead of an instant reduced transition', () => {
    const reduced = transition(true);

    expect(reduced).toEqual(REDUCED_TRANSITION);
    expect(reduced.duration).toBeGreaterThanOrEqual(0.08);
    expect(reduced.duration).toBeLessThanOrEqual(0.12);
    expect(reduced).not.toHaveProperty('type', 'spring');
  });
});
