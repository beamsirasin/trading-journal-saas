/**
 * WHAT A PRODUCTION SYSTEM ASSESSMENT MAY CLAIM.
 *
 * The prototype proved these semantics; this proves the production domain layer
 * carries them. Every case is a route to hindsight fiction — a stale
 * counterfactual entering a metric, an unestimated cost read as zero, a
 * dependency change silently re-arithmetic'd into a figure nobody assessed.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSystemDependencySnapshot,
  changedDependency,
  currentSystemGrossRPreview,
  isTrustedSystemComparison,
  parseSystemDependencySnapshot,
  systemAnalyticsEligibility,
  type SystemDependencyInput,
  type SystemEligibilityInput,
} from './system-assessment';

const STRATEGY_V = '11111111-1111-4111-8111-111111111111';
const SETUP_V = '22222222-2222-4222-8222-222222222222';

function deps(overrides: Partial<SystemDependencyInput> = {}): SystemDependencyInput {
  return {
    systemResolutionKind: 'money_target',
    systemExitReason: 'target_hit',
    strategyVersionId: STRATEGY_V,
    setupVersionId: SETUP_V,
    plannedRiskMinor: 10000n,
    plannedRewardMinor: 50000n,
    plannedEntry: null,
    plannedStop: null,
    ...overrides,
  };
}

/** A confirmed, net, current assessment. */
function eligible(overrides: Partial<SystemEligibilityInput> = {}): SystemEligibilityInput {
  const current = overrides.current ?? deps();
  return {
    systemStatus: 'resolved',
    systemResolvedAt: new Date('2026-09-01T10:00:00Z'),
    systemDependencySnapshot: buildSystemDependencySnapshot(current),
    systemGrossR: '5.0000',
    systemR: '4.8000',
    systemOutcome: 'win',
    ...overrides,
    current,
  };
}

describe('the dependency snapshot records only what the basis read', () => {
  it('records risk and reward for a target-based resolution', () => {
    const snapshot = buildSystemDependencySnapshot(deps());
    expect(snapshot.plannedRiskMinor).toBe('10000');
    expect(snapshot.plannedRewardMinor).toBe('50000');
    expect(snapshot.strategyVersionId).toBe(STRATEGY_V);
  });

  it('records the risk but not the reward for an initial-stop resolution', () => {
    // -1R is the definition of R against the INITIAL risk, so the risk is a
    // dependency even though no division happens; the target is irrelevant.
    const snapshot = buildSystemDependencySnapshot(
      deps({ systemResolutionKind: 'money_stop', systemExitReason: 'stop_hit' }),
    );
    expect(snapshot.plannedRiskMinor).toBe('10000');
    expect(snapshot.plannedRewardMinor).toBeNull();
  });

  it('records neither figure for a trader-supplied R', () => {
    // Flagging a typed R because an unrelated target moved would be crying wolf.
    const snapshot = buildSystemDependencySnapshot(
      deps({ systemResolutionKind: 'money_custom', systemExitReason: 'manual_system_valid_exit' }),
    );
    expect(snapshot.plannedRiskMinor).toBeNull();
    expect(snapshot.plannedRewardMinor).toBeNull();
    // The rules are a dependency of every assessment, including this one.
    expect(snapshot.strategyVersionId).toBe(STRATEGY_V);
  });

  it('records the price levels for a price-geometry resolution', () => {
    const snapshot = buildSystemDependencySnapshot(
      deps({
        systemResolutionKind: 'price_exit',
        plannedEntry: '1.08500',
        plannedStop: '1.08000',
      }),
    );
    expect(snapshot.plannedEntry).toBe('1.08500');
    expect(snapshot.plannedStop).toBe('1.08000');
    expect(snapshot.plannedRiskMinor).toBeNull();
  });

  it('rests a no_trade finding on the rules that forbade the trade', () => {
    const snapshot = buildSystemDependencySnapshot(
      deps({ systemResolutionKind: null, systemExitReason: 'setup_invalidated' }),
    );
    expect(snapshot.strategyVersionId).toBe(STRATEGY_V);
    expect(snapshot.setupVersionId).toBe(SETUP_V);
    expect(snapshot.plannedRiskMinor).toBeNull();
  });

  it('names the field that moved, and stays silent when nothing did', () => {
    const confirmed = buildSystemDependencySnapshot(deps());
    expect(changedDependency(confirmed, buildSystemDependencySnapshot(deps()))).toBeNull();
    expect(
      changedDependency(
        confirmed,
        buildSystemDependencySnapshot(deps({ plannedRewardMinor: 90000n })),
      ),
    ).toBe('plannedRewardMinor');
    expect(
      changedDependency(confirmed, buildSystemDependencySnapshot(deps({ setupVersionId: null }))),
    ).toBe('setupVersionId');
  });

  it('refuses a snapshot version it does not understand', () => {
    expect(parseSystemDependencySnapshot(null)).toBeNull();
    expect(parseSystemDependencySnapshot({ v: 2 })).toBeNull();
    expect(parseSystemDependencySnapshot('nope')).toBeNull();
    expect(parseSystemDependencySnapshot(buildSystemDependencySnapshot(deps()))?.v).toBe(1);
  });
});

describe('analytics eligibility', () => {
  it('admits only a confirmed, net, current assessment', () => {
    expect(systemAnalyticsEligibility(eligible())).toBe('eligible');
    expect(isTrustedSystemComparison(eligible())).toBe(true);
  });

  it('reports a confirmed assessment with an unknown cost as gross-only', () => {
    const grossOnly = eligible({ systemR: null, systemOutcome: null });
    expect(systemAnalyticsEligibility(grossOnly)).toBe('gross_only');
    expect(isTrustedSystemComparison(grossOnly)).toBe(false);
  });

  it('flags a moved dependency for review rather than recomputing', () => {
    const stale = eligible();
    const moved = { ...stale, current: deps({ plannedRewardMinor: 90000n }) };
    expect(systemAnalyticsEligibility(moved)).toBe('needs_review');
    expect(isTrustedSystemComparison(moved)).toBe(false);
    // The confirmed figures are untouched by the change.
    expect(moved.systemR).toBe('4.8000');
    expect(moved.systemGrossR).toBe('5.0000');
  });

  it('reports the current +10R preview separately from the frozen +5R confirmation', () => {
    const confirmed = eligible();
    const preview = currentSystemGrossRPreview({
      systemStatus: confirmed.systemStatus,
      systemResolutionKind: 'money_target',
      direction: 'long',
      plannedEntry: null,
      plannedStop: null,
      plannedRiskMinor: 10_000n,
      plannedRewardMinor: 100_000n,
      systemExitPrice: null,
      systemGrossRInput: '5.0000',
    });

    expect(preview).toEqual({ ok: true, value: '10.0000' });
    expect(confirmed.systemGrossR).toBe('5.0000');
    expect(confirmed.systemR).toBe('4.8000');
    expect(confirmed.systemOutcome).toBe('win');
  });

  it('stales only resolution bases that actually read a moved risk', () => {
    for (const [systemResolutionKind, systemExitReason, expected] of [
      ['money_target', 'target_hit', 'needs_review'],
      ['money_stop', 'stop_hit', 'needs_review'],
      ['money_break_even', 'break_even_rule', 'needs_review'],
      ['money_custom', 'manual_system_valid_exit', 'eligible'],
      ['price_exit', 'target_hit', 'eligible'],
    ] as const) {
      const atConfirmation = deps({
        systemResolutionKind,
        systemExitReason,
        plannedEntry: systemResolutionKind === 'price_exit' ? '1.1000' : null,
        plannedStop: systemResolutionKind === 'price_exit' ? '1.0900' : null,
      });
      const assessment = eligible({
        current: atConfirmation,
        systemDependencySnapshot: buildSystemDependencySnapshot(atConfirmation),
      });

      expect(
        systemAnalyticsEligibility({
          ...assessment,
          current: { ...atConfirmation, plannedRiskMinor: 20_000n },
        }),
      ).toBe(expected);
    }
  });

  it('does not stale a custom-R assessment when only the target changes', () => {
    const atConfirmation = deps({
      systemResolutionKind: 'money_custom',
      systemExitReason: 'manual_system_valid_exit',
    });
    const assessment = eligible({
      current: atConfirmation,
      systemDependencySnapshot: buildSystemDependencySnapshot(atConfirmation),
    });
    expect(
      systemAnalyticsEligibility({
        ...assessment,
        current: { ...atConfirmation, plannedRewardMinor: 100_000n },
      }),
    ).toBe('eligible');
  });

  it('stales a custom-R assessment when its Money Plan is replaced by a Price Plan', () => {
    const atConfirmation = deps({
      systemResolutionKind: 'money_custom',
      systemExitReason: 'manual_system_valid_exit',
      plannedEntry: null,
      plannedStop: null,
    });
    const assessment = eligible({
      current: atConfirmation,
      systemDependencySnapshot: buildSystemDependencySnapshot(atConfirmation),
    });
    expect(
      systemAnalyticsEligibility({
        ...assessment,
        current: {
          ...atConfirmation,
          plannedRiskMinor: null,
          plannedRewardMinor: null,
          plannedEntry: '1.1000000000',
          plannedStop: '1.0950000000',
        },
      }),
    ).toBe('needs_review');
  });

  it('ignores reflection and Actual P&L because neither is a System dependency', () => {
    const confirmed = eligible();
    const editedOutsideSystem = {
      ...confirmed,
      reviewNotes: 'A corrected reflection',
      netPnlMinor: 12_500n,
      actualR: '1.2500',
    };
    expect(systemAnalyticsEligibility(editedOutsideSystem)).toBe('eligible');
  });

  it('checks staleness BEFORE the result shape, so a stale no_trade is excluded too', () => {
    const finding = eligible({
      systemStatus: 'no_trade',
      systemGrossR: null,
      systemR: null,
      systemOutcome: null,
    });
    expect(systemAnalyticsEligibility(finding)).toBe('no_trade');
    expect(
      systemAnalyticsEligibility({ ...finding, current: deps({ setupVersionId: null }) }),
    ).toBe('needs_review');
  });

  it('never admits pending and keeps a current cannot_determine unavailable', () => {
    expect(systemAnalyticsEligibility(eligible({ systemStatus: 'pending' }))).toBe('not_available');
    expect(systemAnalyticsEligibility(eligible({ systemStatus: 'cannot_determine' }))).toBe(
      'not_available',
    );
  });

  it('marks cannot_determine needs_review when its rule dependencies move', () => {
    const finding = eligible({
      systemStatus: 'cannot_determine',
      systemGrossR: null,
      systemR: null,
      systemOutcome: null,
    });
    expect(
      systemAnalyticsEligibility({ ...finding, current: deps({ setupVersionId: null }) }),
    ).toBe('needs_review');
  });

  it('keeps cannot_determine distinct from pending in the record itself', () => {
    // Both are `not_available` to analytics and carry opposite information about
    // whether anyone looked; the status is what preserves the difference.
    const asked = eligible({ systemStatus: 'cannot_determine' });
    const untouched = eligible({ systemStatus: 'pending' });
    expect(asked.systemStatus).not.toBe(untouched.systemStatus);
  });

  it('does not trust a legacy confirmed row that carries no dependency snapshot', () => {
    /*
      THE SINGLE PRE-MIGRATION ROW. It is resolved, it has a net R and an
      outcome, and its `system_cost_r` of 0 may equally be a considered estimate
      or the resolve dialog's untouched default. It stays readable and
      exportable; it is not new-model comparison evidence.
    */
    const legacy = eligible({ systemDependencySnapshot: null });
    expect(systemAnalyticsEligibility(legacy)).toBe('not_available');
    expect(isTrustedSystemComparison(legacy)).toBe(false);
  });

  it('does not trust a confirmed row with no confirmation timestamp', () => {
    expect(systemAnalyticsEligibility(eligible({ systemResolvedAt: null }))).toBe('not_available');
  });
});
