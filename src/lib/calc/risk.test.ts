import { describe, expect, it } from 'vitest';

import { plannedRiskPerUnit, resolvePlannedRiskContext } from './risk';

describe('plannedRiskPerUnit', () => {
  describe('long', () => {
    it('computes entry - stop', () => {
      const result = plannedRiskPerUnit('long', '100', '90');
      expect(result.ok).toBe(true);
      expect(result.ok && result.value.toString()).toBe('10');
    });

    it('rejects a Stop above Entry (wrong side)', () => {
      const result = plannedRiskPerUnit('long', '100', '105');
      expect(result).toEqual({ ok: false, reason: 'invalid_risk_direction' });
    });

    it('rejects a Stop exactly equal to Entry (zero risk)', () => {
      const result = plannedRiskPerUnit('long', '100', '100');
      expect(result).toEqual({ ok: false, reason: 'zero_risk' });
    });
  });

  describe('short', () => {
    it('computes stop - entry', () => {
      const result = plannedRiskPerUnit('short', '100', '110');
      expect(result.ok).toBe(true);
      expect(result.ok && result.value.toString()).toBe('10');
    });

    it('rejects a Stop below Entry (wrong side)', () => {
      const result = plannedRiskPerUnit('short', '100', '95');
      expect(result).toEqual({ ok: false, reason: 'invalid_risk_direction' });
    });

    it('rejects a Stop exactly equal to Entry (zero risk)', () => {
      const result = plannedRiskPerUnit('short', '100', '100');
      expect(result).toEqual({ ok: false, reason: 'zero_risk' });
    });
  });

  it('rejects an unsupported direction', () => {
    expect(plannedRiskPerUnit('sideways', '100', '90')).toEqual({
      ok: false,
      reason: 'invalid_direction',
    });
  });

  it('rejects missing input', () => {
    expect(plannedRiskPerUnit(null, '100', '90')).toEqual({ ok: false, reason: 'missing_input' });
    expect(plannedRiskPerUnit('long', undefined, '90')).toEqual({
      ok: false,
      reason: 'missing_input',
    });
    expect(plannedRiskPerUnit('long', '100', undefined)).toEqual({
      ok: false,
      reason: 'missing_input',
    });
  });

  it('rejects a malformed decimal', () => {
    expect(plannedRiskPerUnit('long', 'abc', '90')).toEqual({
      ok: false,
      reason: 'invalid_decimal',
    });
    expect(plannedRiskPerUnit('long', '100', '1.2.3')).toEqual({
      ok: false,
      reason: 'invalid_decimal',
    });
  });

  it('handles a huge but representable decimal input without precision loss', () => {
    const result = plannedRiskPerUnit('long', '99999999999.1234567890', '99999999998.1234567890');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.toString()).toBe('1');
  });

  it('handles fractional FX-like prices exactly', () => {
    const result = plannedRiskPerUnit('long', '1.08500', '1.08000');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.toString()).toBe('0.005');
  });

  it('handles JPY-like 2-3 decimal prices exactly', () => {
    const result = plannedRiskPerUnit('short', '150.250', '150.500');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.toString()).toBe('0.25');
  });

  it('handles crypto-like high-precision prices exactly', () => {
    const result = plannedRiskPerUnit('long', '43210.12345678', '43000.00000001');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.toString()).toBe('210.12345677');
  });
});

describe('resolvePlannedRiskContext', () => {
  it('returns the parsed direction, entry, stop and risk together', () => {
    const result = resolvePlannedRiskContext('long', '100', '90');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.direction).toBe('long');
    expect(result.value.entry.toString()).toBe('100');
    expect(result.value.stop.toString()).toBe('90');
    expect(result.value.riskPerUnit.toString()).toBe('10');
  });
});
