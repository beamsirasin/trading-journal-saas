import { describe, expect, it } from 'vitest';

import { resolveAnalyticsDateBounds } from '@/lib/analytics/filters';

import {
  DASHBOARD_DATE_PRESET_ORDER,
  describeAppliedDateRange,
  describeDraftDateRange,
  formatCalendarDateLabel,
  formatCalendarDateRangeLabel,
  formatCalendarMonthLabel,
  summarizeDraftDates,
} from './date-range-presentation';

describe('DASHBOARD_DATE_PRESET_ORDER', () => {
  it('offers every canonical bounded preset plus All, and never Custom', () => {
    expect([...DASHBOARD_DATE_PRESET_ORDER]).toEqual([
      'today',
      'week',
      'month',
      '30d',
      '90d',
      'quarter',
      'ytd',
      'all',
    ]);
    expect(DASHBOARD_DATE_PRESET_ORDER).not.toContain('custom');
  });
});

describe('describeAppliedDateRange', () => {
  it('describes a preset without inventing dates for it', () => {
    expect(describeAppliedDateRange({ datePreset: '90d', customDateRange: null })).toEqual({
      kind: 'preset',
      preset: '90d',
    });
  });

  it('describes a complete custom range by its two inclusive local dates', () => {
    expect(
      describeAppliedDateRange({
        datePreset: 'custom',
        customDateRange: { from: '2026-07-10', to: '2026-08-12' },
      }),
    ).toEqual({ kind: 'custom', from: '2026-07-10', to: '2026-08-12' });
  });

  it('reports a custom preset with no bounds as pending rather than as a range', () => {
    expect(describeAppliedDateRange({ datePreset: 'custom', customDateRange: null })).toEqual({
      kind: 'custom-pending',
      from: null,
    });
  });
});

describe('describeDraftDateRange', () => {
  it('reports a half-finished custom draft as pending, carrying the chosen start', () => {
    expect(describeDraftDateRange({ datePreset: 'custom', from: '2026-07-10', to: null })).toEqual({
      kind: 'custom-pending',
      from: '2026-07-10',
    });
  });
});

describe('summarizeDraftDates', () => {
  /**
   * THE CONTRACT THAT MATTERS. The picker must show the same two dates the
   * server bounds the query with — so this asserts the summary against
   * `resolveAnalyticsDateBounds` itself rather than against literals typed out
   * a second time. If the preset arithmetic ever moved, both would move
   * together or this would fail.
   */
  it.each(['today', 'week', 'month', '30d', '90d', 'quarter', 'ytd'] as const)(
    'agrees with the canonical query bounds for %s',
    (preset) => {
      const localToday = '2026-08-29';
      const summary = summarizeDraftDates({ datePreset: preset, from: null, to: null }, localToday);
      expect(summary.kind).toBe('bounded');
      if (summary.kind !== 'bounded') return;

      // UTC as the display timezone, so the half-open instant bounds convert
      // back to exactly the local dates the summary claims.
      const bounds = resolveAnalyticsDateBounds(preset, 'UTC', new Date(`${localToday}T12:00:00Z`));
      expect(bounds.ok).toBe(true);
      if (!bounds.ok || bounds.bounds.kind !== 'bounded') return;
      expect(bounds.bounds.start.slice(0, 10)).toBe(summary.from);
      expect(summary.to).toBe(localToday);
    },
  );

  it('reports All as unbounded rather than as a pair of dates', () => {
    expect(summarizeDraftDates({ datePreset: 'all', from: null, to: null }, '2026-08-29')).toEqual({
      kind: 'all',
    });
  });

  it('uses the drafted dates for a complete custom range', () => {
    expect(
      summarizeDraftDates(
        { datePreset: 'custom', from: '2026-07-10', to: '2026-08-12' },
        '2026-08-29',
      ),
    ).toEqual({ kind: 'bounded', from: '2026-07-10', to: '2026-08-12' });
  });

  it('stays pending — and therefore un-appliable — while an end date is missing', () => {
    expect(
      summarizeDraftDates({ datePreset: 'custom', from: '2026-07-10', to: null }, '2026-08-29'),
    ).toEqual({ kind: 'pending', from: '2026-07-10' });
  });
});

describe('date formatting', () => {
  it('formats a calendar date as a date, not as an instant in the viewer zone', () => {
    // A viewer west of Greenwich must still read the 10th. The formatter is
    // pinned to UTC noon precisely so this cannot drift by a day.
    expect(formatCalendarDateLabel('2026-07-10', 'en-GB')).toBe('10 Jul 2026');
    expect(formatCalendarDateLabel('2026-07-10', 'en-US')).toBe('Jul 10, 2026');
  });

  it('returns null for an impossible date rather than a plausible wrong one', () => {
    expect(formatCalendarDateLabel('2026-02-31', 'en-GB')).toBeNull();
    expect(formatCalendarDateLabel('nonsense', 'en-GB')).toBeNull();
    expect(formatCalendarDateRangeLabel('2026-02-31', '2026-08-12', 'en-GB')).toBeNull();
  });

  it('collapses the shared year across a range', () => {
    const label = formatCalendarDateRangeLabel('2026-07-10', '2026-08-12', 'en-US');
    expect(label).not.toBeNull();
    expect(label).toContain('Jul 10');
    expect(label).toContain('Aug 12');
    expect(label).toContain('2026');
    // Both endpoints share a year, so it is stated once.
    expect(label?.match(/2026/g)).toHaveLength(1);
  });

  it('keeps both years when a range crosses one', () => {
    const label = formatCalendarDateRangeLabel('2025-12-28', '2026-01-04', 'en-US');
    expect(label?.match(/202[56]/g)).toHaveLength(2);
  });

  it('names a month in the reader locale', () => {
    expect(formatCalendarMonthLabel(2026, 7, 'en-GB')).toBe('July 2026');
    expect(formatCalendarMonthLabel(2026, 12, 'en-GB')).toBe('December 2026');
  });
});
