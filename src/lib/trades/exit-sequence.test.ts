import { describe, expect, it } from 'vitest';

import { isOrderedExitHistory, orderedExitLabel } from './exit-sequence';

const exit = (exitScope: string | null, closedBps: number | null = null) => ({
  exitScope,
  closedBps,
});

describe('an ordered exit history (decision 60)', () => {
  it('is exits with no share, no scope but the last, and the last All remaining', () => {
    expect(isOrderedExitHistory([exit('all_remaining')])).toBe(true);
    expect(isOrderedExitHistory([exit(null), exit(null), exit('all_remaining')])).toBe(true);
  });

  it('is never a history that records allocation the trader gave', () => {
    // A Part, a Don't know or any share is recorded allocation, shown as such.
    expect(isOrderedExitHistory([exit('part'), exit('all_remaining')])).toBe(false);
    expect(isOrderedExitHistory([exit('unknown'), exit('all_remaining')])).toBe(false);
    expect(isOrderedExitHistory([exit(null, 3_000), exit('all_remaining')])).toBe(false);
    expect(isOrderedExitHistory([exit(null), exit('all_remaining', 7_000)])).toBe(false);
    // All remaining anywhere but last, or a last exit that closed nothing stated.
    expect(isOrderedExitHistory([exit('all_remaining'), exit(null)])).toBe(false);
    expect(isOrderedExitHistory([exit(null), exit(null)])).toBe(false);
    expect(isOrderedExitHistory([])).toBe(false);
  });

  it('labels the last exit Final, and the rest by number', () => {
    expect(orderedExitLabel(0, 3)).toEqual({ kind: 'number', number: 1 });
    expect(orderedExitLabel(1, 3)).toEqual({ kind: 'number', number: 2 });
    expect(orderedExitLabel(2, 3)).toEqual({ kind: 'final' });
    expect(orderedExitLabel(0, 1)).toEqual({ kind: 'final' });
  });
});
