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

  it('keeps an unanswered Condition unanswered on an Add Trade contract write', () => {
    // A missing answer is never a Not Met: only the answered subset is kept.
    expect(
      prepareSetupConditionSnapshots(conditions, [{ conditionKey: 'b', status: 'not_met' }], {
        allowUnanswered: true,
      }),
    ).toEqual({ ok: true, snapshots: [{ ...conditions[0], checkStatus: 'not_met' }] });
    expect(prepareSetupConditionSnapshots(conditions, [], { allowUnanswered: true })).toEqual({
      ok: true,
      snapshots: [],
    });
    // Answers that are present are still validated.
    expect(
      prepareSetupConditionSnapshots(conditions, [{ conditionKey: 'invented', status: 'met' }], {
        allowUnanswered: true,
      }),
    ).toEqual({ ok: false, code: 'unknown_condition_answer' });
  });

  it('accepts an explicit empty answer set for a zero-Condition Setup', () => {
    expect(prepareSetupConditionSnapshots([], [])).toEqual({ ok: true, snapshots: [] });
    expect(deriveSetupAdherence([])).toBeNull();
  });

  it('derives adherence only when Conditions exist', () => {
    expect(deriveSetupAdherence([{ checkStatus: 'met' }, { checkStatus: 'not_met' }])).toBe(0.5);
  });
});

describe('"Don’t remember" (contract §8)', () => {
  const conditions = [
    { id: 'a', conditionKey: 'k1', label: 'Trend', sortOrder: 0 },
    { id: 'b', conditionKey: 'k2', label: 'Retest', sortOrder: 1 },
  ];

  it('is accepted only where it is allowed', () => {
    const answers = [{ conditionKey: 'k1', status: 'unknown' }];
    expect(prepareSetupConditionSnapshots(conditions, answers, { allowUnanswered: true })).toEqual({
      ok: false,
      code: 'invalid_condition_status',
    });
    expect(
      prepareSetupConditionSnapshots(conditions, answers, {
        allowUnanswered: true,
        allowUnknown: true,
      }),
    ).toMatchObject({ ok: true, snapshots: [{ conditionKey: 'k1', checkStatus: 'unknown' }] });
  });

  it('never counts as Not Met in adherence', () => {
    expect(deriveSetupAdherence([{ checkStatus: 'met' }, { checkStatus: 'unknown' }])).toBe(1);
    expect(deriveSetupAdherence([{ checkStatus: 'unknown' }])).toBeNull();
  });
});
