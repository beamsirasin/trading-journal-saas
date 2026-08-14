import { describe, expect, it } from 'vitest';

import { CONFIDENCE_MAX, CONFIDENCE_MIN, confidenceLevelKey } from './constants';

describe('confidenceLevelKey', () => {
  it('maps every boundary to the correct qualitative range (inclusive upper bound)', () => {
    expect(confidenceLevelKey(0)).toBe('veryLow');
    expect(confidenceLevelKey(20)).toBe('veryLow');
    expect(confidenceLevelKey(21)).toBe('low');
    expect(confidenceLevelKey(40)).toBe('low');
    expect(confidenceLevelKey(41)).toBe('neutral');
    expect(confidenceLevelKey(60)).toBe('neutral');
    expect(confidenceLevelKey(61)).toBe('high');
    expect(confidenceLevelKey(80)).toBe('high');
    expect(confidenceLevelKey(81)).toBe('veryHigh');
    expect(confidenceLevelKey(100)).toBe('veryHigh');
  });

  it('matches CONFIDENCE_MIN/CONFIDENCE_MAX at the extremes', () => {
    expect(confidenceLevelKey(CONFIDENCE_MIN)).toBe('veryLow');
    expect(confidenceLevelKey(CONFIDENCE_MAX)).toBe('veryHigh');
  });
});
