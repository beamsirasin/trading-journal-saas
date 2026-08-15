import { describe, expect, it } from 'vitest';

import { deriveSetupAdherence, prepareSetupConditionSnapshots } from './snapshots';

const conditions = [
  { id: 'row-b', conditionKey: 'b', label: 'RSI confirmation', sortOrder: 2 },
  { id: 'row-a', conditionKey: 'a', label: 'Wave structure', sortOrder: 1 },
] as const;

describe('prepareSetupConditionSnapshots', () => {
  it('builds ordered snapshots exclusively from authoritative content', () => {
    expect(
      prepareSetupConditionSnapshots(conditions, [
        { conditionKey: 'a', status: 'met' },
        { conditionKey: 'b', status: 'not_met' },
      ]),
    ).toEqual({
      ok: true,
      snapshots: [
        { ...conditions[1], checkStatus: 'met' },
        { ...conditions[0], checkStatus: 'not_met' },
      ],
    });
  });

  it('rejects duplicates, unknown keys, omissions, and non-binary status', () => {
    expect(
      prepareSetupConditionSnapshots(conditions, [
        { conditionKey: 'a', status: 'met' },
        { conditionKey: 'a', status: 'not_met' },
      ]),
    ).toEqual({ ok: false, code: 'duplicate_condition_answer' });
    expect(
      prepareSetupConditionSnapshots(conditions, [
        { conditionKey: 'a', status: 'met' },
        { conditionKey: 'invented', status: 'not_met' },
      ]),
    ).toEqual({ ok: false, code: 'unknown_condition_answer' });
    expect(
      prepareSetupConditionSnapshots(conditions, [{ conditionKey: 'a', status: 'met' }]),
    ).toEqual({ ok: false, code: 'incomplete_condition_answers' });
    expect(
      prepareSetupConditionSnapshots(conditions, [
        { conditionKey: 'a', status: 'not_checked' },
        { conditionKey: 'b', status: 'met' },
      ]),
    ).toEqual({ ok: false, code: 'invalid_condition_status' });
  });

  it('accepts an explicit empty answer set for a zero-Condition Setup', () => {
    expect(prepareSetupConditionSnapshots([], [])).toEqual({ ok: true, snapshots: [] });
    expect(deriveSetupAdherence([])).toBeNull();
  });

  it('derives adherence only when Conditions exist', () => {
    expect(deriveSetupAdherence([{ checkStatus: 'met' }, { checkStatus: 'not_met' }])).toBe(0.5);
  });
});
