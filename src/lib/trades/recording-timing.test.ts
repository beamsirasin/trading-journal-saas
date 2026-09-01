import { describe, expect, it } from 'vitest';

import { parseRecordingTiming, RECORDING_TIMINGS } from './recording-timing';

describe('the two recording situations', () => {
  it('is exactly At Entry and After Trade', () => {
    expect([...RECORDING_TIMINGS]).toEqual(['at_entry', 'after_trade']);
  });
});

describe('parseRecordingTiming', () => {
  it('reads each mode from the URL', () => {
    expect(parseRecordingTiming('at_entry')).toBe('at_entry');
    expect(parseRecordingTiming('after_trade')).toBe('after_trade');
  });

  it('has no default: an absent mode means the choice has not been made', () => {
    // Defaulting would be the flow deciding for the trader which of two
    // genuinely different situations they are in, and getting it wrong half
    // the time.
    expect(parseRecordingTiming(undefined)).toBeNull();
    expect(parseRecordingTiming('')).toBeNull();
  });

  it('returns safely to the choice for anything unrecognised or repeated', () => {
    expect(parseRecordingTiming('atEntry')).toBeNull();
    expect(parseRecordingTiming('planned')).toBeNull();
    expect(parseRecordingTiming(['at_entry', 'after_trade'])).toBeNull();
  });
});
