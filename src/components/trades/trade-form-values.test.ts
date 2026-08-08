import { describe, expect, it } from 'vitest';

import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
  tradeMoneyInputValue,
} from './trade-form-values';

describe('Trade lifecycle form values', () => {
  it('parses registry currencies without floating point and rejects excess precision', () => {
    expect(parseTradeMoneyInput('1,234.56', 'USD', { allowZero: true })).toEqual({
      ok: true,
      value: '123456',
    });
    expect(parseTradeMoneyInput('12.345', 'USD')).toMatchObject({
      ok: false,
      code: 'too_many_decimal_places',
    });
  });

  it('honours zero-decimal JPY and signed net amounts', () => {
    expect(parseTradeMoneyInput('500', 'JPY')).toEqual({ ok: true, value: '500' });
    expect(parseTradeMoneyInput('500.1', 'JPY')).toMatchObject({
      ok: false,
      code: 'too_many_decimal_places',
    });
    expect(parseTradeMoneyInput('-12.34', 'USD', { allowNegative: true, allowZero: true })).toEqual(
      { ok: true, value: '-1234' },
    );
  });

  it('uses an explicit raw-minor fallback for unknown currencies', () => {
    expect(parseTradeMoneyInput('1250', 'XBT', { allowZero: true })).toEqual({
      ok: true,
      value: '1250',
    });
    expect(parseTradeMoneyInput('12.50', 'XBT')).toMatchObject({
      ok: false,
      code: 'raw_minor_required',
    });
    expect(tradeMoneyInputValue('1250', 'XBT')).toBe('1250');
  });

  it('converts datetime-local values through the persisted IANA timezone', () => {
    expect(datetimeLocalToIso('2026-08-08T12:30', 'Asia/Bangkok')).toEqual({
      ok: true,
      value: '2026-08-08T05:30:00.000Z',
    });
    expect(instantToDatetimeLocal('2026-08-08T05:30:00.000Z', 'Asia/Bangkok')).toBe(
      '2026-08-08T12:30',
    );
  });

  it('rejects malformed wall clocks and invalid zones', () => {
    expect(datetimeLocalToIso('2026-02-30T12:00', 'Asia/Bangkok')).toMatchObject({ ok: false });
    expect(datetimeLocalToIso('2026-08-08T12:00', 'Not/AZone')).toMatchObject({ ok: false });
  });
});
