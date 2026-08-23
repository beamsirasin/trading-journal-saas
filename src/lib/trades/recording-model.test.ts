import { describe, expect, it } from 'vitest';

import {
  inferPersistedSystemPlanBasis,
  isRecordedRetrospectively,
  validateCompletedTradeTimestamps,
  validateNewWritePlanAuthority,
} from './recording-model';

describe('recording model foundation', () => {
  it('infers canonical and legacy persisted Plan shapes without rewriting them', () => {
    expect(inferPersistedSystemPlanBasis({})).toBeNull();
    expect(inferPersistedSystemPlanBasis({ plannedEntry: '100', plannedStop: '90' })).toBe('price');
    expect(inferPersistedSystemPlanBasis({ plannedRiskMinor: 1_000n })).toBe('money');
    expect(
      inferPersistedSystemPlanBasis({
        plannedEntry: '100',
        plannedStop: '90',
        plannedRiskMinor: 1_000n,
      }),
    ).toBe('dual');
  });

  it('requires an explicit matching authority for canonical new Plan writes', () => {
    const price = { plannedEntry: '100', plannedStop: '90' };
    const money = { plannedRiskMinor: 1_000n, plannedRewardMinor: 2_000n };
    expect(validateNewWritePlanAuthority(price, 'price')).toEqual({
      ok: true,
      systemPlanBasis: 'price',
    });
    expect(validateNewWritePlanAuthority(money, 'money')).toEqual({
      ok: true,
      systemPlanBasis: 'money',
    });
    expect(validateNewWritePlanAuthority(price, null)).toEqual({
      ok: false,
      code: 'system_plan_basis_required',
    });
  });

  it('rejects cross-basis fields and never silently discards dual input', () => {
    expect(
      validateNewWritePlanAuthority(
        { plannedEntry: '100', plannedStop: '90', plannedRiskMinor: 1_000n },
        'price',
      ),
    ).toEqual({ ok: false, code: 'conflicting_plan_basis' });
    expect(validateNewWritePlanAuthority({ plannedRiskMinor: 1_000n }, 'price')).toEqual({
      ok: false,
      code: 'conflicting_plan_basis',
    });
    expect(validateNewWritePlanAuthority({}, 'money')).toEqual({
      ok: false,
      code: 'system_plan_basis_without_plan',
    });
  });

  it('validates the future completed-Trade timestamp invariant, including equality', () => {
    const now = new Date('2026-08-23T12:00:00.000Z');
    expect(
      validateCompletedTradeTimestamps({
        enteredAt: new Date('2026-08-23T10:00:00.000Z'),
        exitedAt: new Date('2026-08-23T11:00:00.000Z'),
        now,
      }),
    ).toEqual({ ok: true });
    expect(validateCompletedTradeTimestamps({ enteredAt: now, exitedAt: now, now })).toEqual({
      ok: true,
    });
    expect(
      validateCompletedTradeTimestamps({
        enteredAt: new Date('2026-08-23T11:00:00.001Z'),
        exitedAt: new Date('2026-08-23T11:00:00.000Z'),
        now,
      }),
    ).toEqual({ ok: false, code: 'entered_after_exited' });
    expect(
      validateCompletedTradeTimestamps({
        enteredAt: now,
        exitedAt: new Date('2026-08-23T12:00:00.001Z'),
        now,
      }),
    ).toEqual({ ok: false, code: 'exited_in_future' });
  });

  it('marks retrospective recording only when later by at least one observable millisecond', () => {
    const exitedAt = new Date('2026-08-23T11:00:00.000Z');
    expect(isRecordedRetrospectively({ createdAt: exitedAt, exitedAt })).toBe(false);
    expect(
      isRecordedRetrospectively({
        createdAt: new Date('2026-08-23T11:00:00.001Z'),
        exitedAt,
      }),
    ).toBe(true);
    expect(isRecordedRetrospectively({ createdAt: exitedAt, exitedAt: null })).toBe(false);
  });
});
