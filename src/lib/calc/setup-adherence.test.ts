import { describe, expect, it } from 'vitest';

import { CalcDecimal } from './decimal';
import {
  averageSetupAdherence,
  conditionsMetRate,
  setupAdherenceBucket,
  setupAdherenceRatio,
  type SetupAdherenceCounts,
} from './setup-adherence';

function counts(metCount: number, totalCount: number): SetupAdherenceCounts {
  return { metCount, totalCount };
}

describe('setupAdherenceRatio', () => {
  it('3 met / 5 applicable => 0.6000 (60%)', () => {
    expect(setupAdherenceRatio(counts(3, 5))).toEqual({ ok: true, value: '0.6000' });
  });

  it('zero applicable is rejected, never a fake 0%', () => {
    expect(setupAdherenceRatio(counts(0, 0))).toEqual({
      ok: false,
      reason: 'no_conditions_applicable',
    });
  });
});

describe('averageSetupAdherence (primary)', () => {
  it('50% and 90% average to 70%, each Trade weighted equally', () => {
    const records = [counts(1, 2), counts(9, 10)];
    expect(averageSetupAdherence(records)).toEqual({ ok: true, value: '0.7000' });
  });

  it('is NOT the same as SUM/SUM (would be 10/12 = 83.33%, not 70%)', () => {
    const records = [counts(1, 2), counts(9, 10)];
    const average = averageSetupAdherence(records);
    const metRate = conditionsMetRate(records);
    expect(average).toEqual({ ok: true, value: '0.7000' });
    expect(metRate).toEqual({ ok: true, value: '0.8333' });
  });

  it('empty population => no_conditions_applicable', () => {
    expect(averageSetupAdherence([])).toEqual({ ok: false, reason: 'no_conditions_applicable' });
  });
});

describe('conditionsMetRate (secondary)', () => {
  it('1/2 and 9/10 => 10/12 = 83.3333%, each Condition weighted equally', () => {
    const records = [counts(1, 2), counts(9, 10)];
    expect(conditionsMetRate(records)).toEqual({ ok: true, value: '0.8333' });
  });

  it('empty population => no_conditions_applicable', () => {
    expect(conditionsMetRate([])).toEqual({ ok: false, reason: 'no_conditions_applicable' });
  });
});

describe('setupAdherenceBucket', () => {
  it.each([
    [0, '0-24'],
    [0.1, '0-24'],
    [0.24, '0-24'],
    [0.25, '25-49'],
    [0.49, '25-49'],
    [0.5, '50-74'],
    [0.74, '50-74'],
    [0.75, '75-99'],
    [0.99, '75-99'],
    [1, '100'],
  ] as const)('ratio %s => bucket %s', (ratio, bucket) => {
    expect(setupAdherenceBucket(new CalcDecimal(ratio))).toBe(bucket);
  });
});
