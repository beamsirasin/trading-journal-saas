import { describe, expect, it } from 'vitest';

import { CONFIDENCE_STEPS, confidenceLevelKey, isConfidenceStep } from './constants';

describe('confidenceLevelKey', () => {
  it('maps every one of the five allowed steps to its exact qualitative label', () => {
    expect(confidenceLevelKey(0)).toBe('veryLow');
    expect(confidenceLevelKey(25)).toBe('low');
    expect(confidenceLevelKey(50)).toBe('neutral');
    expect(confidenceLevelKey(75)).toBe('high');
    expect(confidenceLevelKey(100)).toBe('veryHigh');
  });

  it('throws for any value that is not one of the five allowed steps', () => {
    for (const value of [-1, 1, 10, 30, 51, 73, 99, 101]) {
      expect(() => confidenceLevelKey(value)).toThrow();
    }
  });
});

describe('isConfidenceStep', () => {
  it('accepts exactly the five allowed steps', () => {
    for (const step of CONFIDENCE_STEPS) {
      expect(isConfidenceStep(step)).toBe(true);
    }
  });

  it('rejects every value between or outside the steps', () => {
    for (const value of [-1, 1, 10, 30, 51, 73, 99, 101]) {
      expect(isConfidenceStep(value)).toBe(false);
    }
  });
});
