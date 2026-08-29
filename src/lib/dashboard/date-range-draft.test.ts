import { describe, expect, it } from 'vitest';

import {
  applyDashboardDateRangeDraft,
  clearDashboardDateRangeDraft,
  createDashboardDateRangeDraft,
  selectDashboardCustomDate,
  selectDashboardDatePreset,
} from './date-range-draft';

describe('Dashboard date-range draft contract', () => {
  it('copies applied state without mutating it while a preset draft is edited', () => {
    const applied = { datePreset: '90d' as const, customDateRange: null };
    const draft = selectDashboardDatePreset(createDashboardDateRangeDraft(applied), 'month');
    expect(applied).toEqual({ datePreset: '90d', customDateRange: null });
    expect(draft).toEqual({ datePreset: 'month', from: null, to: null });
  });

  it('does not apply after either custom calendar click', () => {
    const applied = { datePreset: '30d' as const, customDateRange: null };
    const first = selectDashboardCustomDate(createDashboardDateRangeDraft(applied), '2026-08-10');
    const second = selectDashboardCustomDate(first, '2026-08-12');
    expect(applied.datePreset).toBe('30d');
    expect(first).toEqual({ datePreset: 'custom', from: '2026-08-10', to: null });
    expect(second).toEqual({
      datePreset: 'custom',
      from: '2026-08-10',
      to: '2026-08-12',
    });
  });

  it('orders an earlier second click into start/end', () => {
    const first = { datePreset: 'custom' as const, from: '2026-08-10', to: null };
    expect(selectDashboardCustomDate(first, '2026-08-04')).toEqual({
      datePreset: 'custom',
      from: '2026-08-04',
      to: '2026-08-10',
    });
  });

  it('starts a new selection after a completed range', () => {
    expect(
      selectDashboardCustomDate(
        { datePreset: 'custom', from: '2026-08-04', to: '2026-08-10' },
        '2026-08-20',
      ),
    ).toEqual({ datePreset: 'custom', from: '2026-08-20', to: null });
  });

  it('fails Apply closed until custom range is complete, then returns one applied state', () => {
    expect(
      applyDashboardDateRangeDraft({
        datePreset: 'custom',
        from: '2026-08-10',
        to: null,
      }),
    ).toEqual({ ok: false, code: 'incomplete_or_invalid_range' });
    expect(
      applyDashboardDateRangeDraft({
        datePreset: 'custom',
        from: '2026-08-10',
        to: '2026-08-12',
      }),
    ).toEqual({
      ok: true,
      applied: {
        datePreset: 'custom',
        customDateRange: { from: '2026-08-10', to: '2026-08-12' },
      },
    });
  });

  it('makes Clear a draft All selection that requires Apply', () => {
    const applied = {
      datePreset: 'custom' as const,
      customDateRange: { from: '2026-08-10', to: '2026-08-12' },
    };
    const cleared = clearDashboardDateRangeDraft();
    expect(applied.datePreset).toBe('custom');
    expect(cleared).toEqual({ datePreset: 'all', from: null, to: null });
    expect(applyDashboardDateRangeDraft(cleared)).toEqual({
      ok: true,
      applied: { datePreset: 'all', customDateRange: null },
    });
  });

  it('ignores malformed calendar clicks rather than broadening or corrupting the draft', () => {
    const draft = { datePreset: 'custom' as const, from: '2026-08-10', to: null };
    expect(selectDashboardCustomDate(draft, '2026-02-30')).toBe(draft);
  });
});
