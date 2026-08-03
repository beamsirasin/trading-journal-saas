import { describe, expect, it } from 'vitest';

import { pickFormErrors, validateAccountFields, type AccountFormValues } from './form-validation';

const VALID_VALUES: AccountFormValues = {
  name: 'My Trading Account',
  brokerName: '',
  platformName: '',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
  timezone: 'Asia/Bangkok',
  riskPerTradePercent: '1',
  maximumDailyLossPercent: '3',
};

describe('validateAccountFields', () => {
  it('returns no errors for a fully valid set of values', () => {
    expect(validateAccountFields(VALID_VALUES)).toEqual({});
  });

  it('flags an empty name as required', () => {
    const errors = validateAccountFields({ ...VALID_VALUES, name: '   ' });
    expect(errors.name).toBe('required');
  });

  it('flags an invalid base currency', () => {
    const errors = validateAccountFields({ ...VALID_VALUES, baseCurrency: 'usd' });
    expect(errors.baseCurrency).toBe('invalidBaseCurrency');
  });

  it('flags a negative starting balance', () => {
    const errors = validateAccountFields({ ...VALID_VALUES, startingBalance: '-1' });
    expect(errors.startingBalance).toBe('invalidBalance');
  });

  it('flags an invalid IANA timezone', () => {
    const errors = validateAccountFields({ ...VALID_VALUES, timezone: 'Not/AZone' });
    expect(errors.timezone).toBe('invalidTimezone');
  });

  it('does not flag an empty (omitted) risk or max-loss percentage', () => {
    const errors = validateAccountFields({
      ...VALID_VALUES,
      riskPerTradePercent: '',
      maximumDailyLossPercent: '',
    });
    expect(errors.riskPerTradePercent).toBeUndefined();
    expect(errors.maximumDailyLossPercent).toBeUndefined();
  });

  it('flags a risk percentage of exactly zero', () => {
    const errors = validateAccountFields({ ...VALID_VALUES, riskPerTradePercent: '0' });
    expect(errors.riskPerTradePercent).toBe('invalidPercent');
  });

  it('flags broker/platform text containing HTML markup', () => {
    const errors = validateAccountFields({
      ...VALID_VALUES,
      brokerName: '<script>alert(1)</script>',
    });
    expect(errors.brokerName).toBe('invalidCharacters');
  });
});

describe('pickFormErrors', () => {
  it('keeps only the requested keys', () => {
    const errors = validateAccountFields({
      ...VALID_VALUES,
      name: '',
      timezone: 'Not/AZone',
    });
    const stepOne = pickFormErrors(errors, ['name', 'brokerName', 'platformName']);
    expect(stepOne).toEqual({ name: 'required' });
    expect(stepOne).not.toHaveProperty('timezone');
  });

  it('returns an empty object when none of the requested keys have errors', () => {
    const errors = validateAccountFields({ ...VALID_VALUES, timezone: 'Not/AZone' });
    const stepOne = pickFormErrors(errors, ['name', 'brokerName', 'platformName']);
    expect(stepOne).toEqual({});
  });
});
