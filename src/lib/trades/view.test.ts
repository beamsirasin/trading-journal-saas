import { describe, expect, it } from 'vitest';

import { parseTradesView } from './view';

describe('parseTradesView', () => {
  it('accepts both addressable views', () => {
    expect(parseTradesView('calendar')).toBe('calendar');
    expect(parseTradesView('log')).toBe('log');
  });

  it('defaults missing, invalid, and repeated values to the operational Trade Log', () => {
    expect(parseTradesView(undefined)).toBe('log');
    expect(parseTradesView('unknown')).toBe('log');
    expect(parseTradesView(['calendar', 'log'])).toBe('log');
  });
});
