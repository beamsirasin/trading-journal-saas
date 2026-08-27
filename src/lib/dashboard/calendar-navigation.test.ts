import { describe, expect, it } from 'vitest';

import {
  buildCalendarHref,
  clearDayNavigation,
  DEFAULT_CALENDAR_MODE,
  parseCalendarNavigation,
  selectDayNavigation,
  selectModeNavigation,
  serializeCalendarState,
  type CalendarNavigationState,
} from './calendar-navigation';
import { parseDashboardFilterState, type DashboardFilterState } from './filters';

const TRADE_ID = '019fd752-2c97-76e2-8af5-178c49d17ab9';

const FILTERS: DashboardFilterState = {
  datePreset: '30d',
  accountScope: { kind: 'account', accountId: '019c43dc-8c6c-7000-8000-000000000001' },
  strategyId: '019c43dc-8c6c-7000-8000-000000000002',
  setupId: null,
  strategyVersionId: null,
  unitMode: 'r',
  dimensions: {
    symbol: null,
    side: null,
    session: null,
    timeframe: null,
    ruleAdherence: null,
    mistake: null,
    emotion: null,
  },
};

const BASE: CalendarNavigationState = {
  mode: 'actual',
  month: { year: 2026, month: 3 },
  selectedDate: null,
  selectedTradeId: null,
};

function parsed(raw: Record<string, unknown>) {
  const result = parseCalendarNavigation(raw);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result.state;
}

describe('calendar navigation parsing', () => {
  it('defaults to the Actual mode and the current month', () => {
    expect(parsed({})).toEqual({
      mode: DEFAULT_CALENDAR_MODE,
      month: null,
      selectedDate: null,
      selectedTradeId: null,
    });
  });

  it('parses a full month, mode, day and Trade selection', () => {
    expect(parsed({ mode: 'gap', month: '2026-03', day: '2026-03-05', trade: TRADE_ID })).toEqual({
      mode: 'gap',
      month: { year: 2026, month: 3 },
      selectedDate: '2026-03-05',
      selectedTradeId: TRADE_ID,
    });
  });

  it.each([
    ['an unknown mode', { mode: 'trader' }],
    ['a malformed month', { month: '2026-3' }],
    ['a month 13', { month: '2026-13' }],
    ['a malformed day', { day: '2026-3-5' }],
    ['an impossible day', { day: '2026-02-31' }],
    ['a non-UUID trade', { day: '2026-03-05', trade: 'not-a-uuid' }],
    ['an unknown key', { surprise: 'x' }],
    ['an array value', { mode: ['gap'] }],
  ])('fails closed on %s', (_label, raw) => {
    expect(parseCalendarNavigation(raw).ok).toBe(false);
  });

  /**
   * A Day Review for August opened underneath a September calendar is an
   * inconsistent state that would show the reader the wrong context without
   * ever looking broken.
   */
  it('rejects a selected day outside the requested month', () => {
    expect(parseCalendarNavigation({ month: '2026-03', day: '2026-04-01' }).ok).toBe(false);
    expect(parseCalendarNavigation({ month: '2026-03', day: '2026-03-31' }).ok).toBe(true);
  });

  /**
   * A Trade can only be previewed FROM a day. Allowing `trade` alone would be
   * a second, undocumented way to open the preview with no Calendar context
   * behind it.
   */
  it('rejects a Trade preview with no selected day', () => {
    expect(parseCalendarNavigation({ trade: TRADE_ID }).ok).toBe(false);
  });
});

describe('calendar navigation serialization', () => {
  /**
   * §20 — the whole point. Opening a day, changing mode, paging the month or
   * opening a Trade must never drop the Dashboard's own scope.
   */
  it('preserves every Dashboard filter through a day selection', () => {
    const href = buildCalendarHref('/app', FILTERS, selectDayNavigation(BASE, '2026-03-05'));
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('range')).toBe('30d');
    expect(params.get('account')).toBe(
      FILTERS.accountScope.kind === 'account' ? FILTERS.accountScope.accountId : null,
    );
    expect(params.get('strategy')).toBe(FILTERS.strategyId);
    expect(params.get('unit')).toBe('r');
    expect(params.get('month')).toBe('2026-03');
    expect(params.get('day')).toBe('2026-03-05');
  });

  it('omits defaults so a closed Day Review and one never opened share a URL', () => {
    const params = serializeCalendarState(FILTERS, {
      mode: 'actual',
      month: null,
      selectedDate: null,
      selectedTradeId: null,
    });
    expect(params.has('mode')).toBe(false);
    expect(params.has('month')).toBe(false);
    expect(params.has('day')).toBe(false);
    expect(params.has('trade')).toBe(false);
  });

  it('round-trips through both parsers without either rejecting the other keys', () => {
    const params = serializeCalendarState(FILTERS, {
      mode: 'gap',
      month: { year: 2026, month: 3 },
      selectedDate: '2026-03-05',
      selectedTradeId: TRADE_ID,
    });
    const raw = Object.fromEntries(params.entries());

    // The Dashboard filter parser tolerates the calendar keys...
    const filterResult = parseDashboardFilterState(raw);
    expect(filterResult.ok).toBe(true);
    if (!filterResult.ok) throw new Error('unreachable');
    expect(filterResult.state.datePreset).toBe('30d');
    expect(filterResult.state.strategyId).toBe(FILTERS.strategyId);

    // ...and the calendar parser ignores the filter keys.
    expect(parsed(raw)).toEqual({
      mode: 'gap',
      month: { year: 2026, month: 3 },
      selectedDate: '2026-03-05',
      selectedTradeId: TRADE_ID,
    });
  });

  it('still fails the filter parser on a genuinely unknown key', () => {
    expect(parseDashboardFilterState({ range: '30d', surprise: 'x' }).ok).toBe(false);
  });
});

describe('calendar navigation transitions', () => {
  it('keeps month and mode when a day is opened, and closes any Trade preview', () => {
    const withTrade = { ...BASE, selectedDate: '2026-03-01', selectedTradeId: TRADE_ID };
    expect(selectDayNavigation(withTrade, '2026-03-05')).toEqual({
      mode: 'actual',
      month: { year: 2026, month: 3 },
      selectedDate: '2026-03-05',
      selectedTradeId: null,
    });
  });

  it('closes the Trade preview along with the Day Review', () => {
    const open = { ...BASE, selectedDate: '2026-03-05', selectedTradeId: TRADE_ID };
    expect(clearDayNavigation(open)).toMatchObject({
      selectedDate: null,
      selectedTradeId: null,
      month: { year: 2026, month: 3 },
    });
  });

  /**
   * Each mode has its own population and even its own date axis, so a day
   * selected in Actual may hold nothing at all in System.
   */
  it('clears the selected day when the mode changes, keeping the month', () => {
    const open = { ...BASE, selectedDate: '2026-03-05', selectedTradeId: TRADE_ID };
    expect(selectModeNavigation(open, 'system')).toEqual({
      mode: 'system',
      month: { year: 2026, month: 3 },
      selectedDate: null,
      selectedTradeId: null,
    });
  });
});
