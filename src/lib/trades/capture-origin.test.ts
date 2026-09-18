import { describe, expect, it } from 'vitest';

import { captureOriginLabel } from './capture-origin';

const CONTRACT = { recordingContract: 'add_trade_v1', enteredAt: '2026-08-01T10:00:00Z' };
const LEGACY = { recordingContract: null, enteredAt: '2026-08-01T10:00:00Z' };

describe('captureOriginLabel', () => {
  it('reports a contract row’s stored origin, and nothing when it has none', () => {
    expect(captureOriginLabel(CONTRACT, 'recalled_after_trade')).toBe('recalled_after_trade');
    expect(captureOriginLabel(CONTRACT, 'recorded_during_trade')).toBe('recorded_during_trade');
    expect(captureOriginLabel(CONTRACT, null, '2026-08-02T10:00:00Z')).toBeNull();
  });

  it('tells a legacy Strategy captured at entry from one added after entry', () => {
    expect(captureOriginLabel(LEGACY, null, '2026-08-01T09:00:00Z')).toBe('legacy_at_entry');
    expect(captureOriginLabel(LEGACY, null, '2026-08-01T10:00:00Z')).toBe('legacy_at_entry');
    expect(captureOriginLabel(LEGACY, null, '2026-08-02T10:00:00Z')).toBe('legacy_after_entry');
  });

  it('claims nothing for a legacy row without both instants', () => {
    expect(captureOriginLabel(LEGACY, null)).toBeNull();
    expect(
      captureOriginLabel(
        { recordingContract: null, enteredAt: null },
        null,
        '2026-08-02T10:00:00Z',
      ),
    ).toBeNull();
  });
});
