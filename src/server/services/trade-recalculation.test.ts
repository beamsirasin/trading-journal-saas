import { describe, expect, it } from 'vitest';

import {
  canCancelFromStatus,
  canCloseFromStatus,
  canOpenFromStatus,
  hasActualExecution,
  matchesCloseRetry,
  matchesSystemResolveRetry,
  resolvePlanFieldsPatch,
} from './trade-recalculation';

describe('trade-recalculation (pure)', () => {
  describe('status-transition predicates', () => {
    it('canOpenFromStatus: only planned', () => {
      expect(canOpenFromStatus('planned')).toBe(true);
      expect(canOpenFromStatus('open')).toBe(false);
      expect(canOpenFromStatus('closed')).toBe(false);
      expect(canOpenFromStatus('canceled')).toBe(false);
    });

    it('canCloseFromStatus: only open', () => {
      expect(canCloseFromStatus('open')).toBe(true);
      expect(canCloseFromStatus('planned')).toBe(false);
      expect(canCloseFromStatus('closed')).toBe(false);
      expect(canCloseFromStatus('canceled')).toBe(false);
    });

    it('canCancelFromStatus: only planned — open/closed can never become canceled', () => {
      expect(canCancelFromStatus('planned')).toBe(true);
      expect(canCancelFromStatus('open')).toBe(false);
      expect(canCancelFromStatus('closed')).toBe(false);
      expect(canCancelFromStatus('canceled')).toBe(false);
    });

    it('hasActualExecution: open and closed only', () => {
      expect(hasActualExecution('open')).toBe(true);
      expect(hasActualExecution('closed')).toBe(true);
      expect(hasActualExecution('planned')).toBe(false);
      expect(hasActualExecution('canceled')).toBe(false);
    });
  });

  describe('resolvePlanFieldsPatch', () => {
    const current = {
      plannedEntry: '1.1000000000',
      plannedStop: '1.0950000000',
      plannedTarget: '1.1100000000',
      plannedRiskMinor: null as bigint | null,
      plannedRewardMinor: null as bigint | null,
    };

    it('an empty patch changes nothing and touches no plan fields', () => {
      const resolved = resolvePlanFieldsPatch(current, {});
      expect(resolved).toEqual({
        plannedEntry: current.plannedEntry,
        plannedStop: current.plannedStop,
        plannedTarget: current.plannedTarget,
        plannedRiskMinor: null,
        plannedRewardMinor: null,
        planFieldsTouched: false,
        entryOrStopChanged: false,
      });
    });

    it('changing only Entry touches plan fields and marks entryOrStopChanged', () => {
      const resolved = resolvePlanFieldsPatch(current, { plannedEntry: '1.1050000000' });
      expect(resolved.plannedEntry).toBe('1.1050000000');
      expect(resolved.plannedStop).toBe(current.plannedStop);
      expect(resolved.plannedTarget).toBe(current.plannedTarget);
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(true);
    });

    it('changing only Target touches plan fields but does NOT mark entryOrStopChanged', () => {
      const resolved = resolvePlanFieldsPatch(current, { plannedTarget: '1.1200000000' });
      expect(resolved.plannedTarget).toBe('1.1200000000');
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(false);
    });

    it('explicitly clearing Target (null) yields plannedTarget: null and touches plan fields', () => {
      const resolved = resolvePlanFieldsPatch(current, { plannedTarget: null });
      expect(resolved.plannedTarget).toBeNull();
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(false);
    });

    it('a Trade created with no Target (current.plannedTarget null) stays null when untouched', () => {
      const noTarget = { ...current, plannedTarget: null };
      const resolved = resolvePlanFieldsPatch(noTarget, { plannedEntry: '1.1050000000' });
      expect(resolved.plannedTarget).toBeNull();
      expect(resolved.entryOrStopChanged).toBe(true);
    });

    it('setting a Target where none existed touches plan fields without marking entryOrStopChanged', () => {
      const noTarget = { ...current, plannedTarget: null };
      const resolved = resolvePlanFieldsPatch(noTarget, { plannedTarget: '1.1300000000' });
      expect(resolved.plannedTarget).toBe('1.1300000000');
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(false);
    });

    it('supplying a value identical to the current one does not mark entryOrStopChanged', () => {
      const resolved = resolvePlanFieldsPatch(current, { plannedEntry: current.plannedEntry });
      expect(resolved.entryOrStopChanged).toBe(false);
      expect(resolved.planFieldsTouched).toBe(true);
    });

    it('explicitly clearing Entry AND Stop (migration 0010: down to a Money-only plan) touches plan fields and marks entryOrStopChanged', () => {
      const resolved = resolvePlanFieldsPatch(current, { plannedEntry: null, plannedStop: null });
      expect(resolved.plannedEntry).toBeNull();
      expect(resolved.plannedStop).toBeNull();
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(true);
    });

    it('a Money-only current Trade (null Price fields) stays null when untouched', () => {
      const moneyOnly = {
        plannedEntry: null,
        plannedStop: null,
        plannedTarget: null,
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 3000n,
      };
      const resolved = resolvePlanFieldsPatch(moneyOnly, {});
      expect(resolved).toEqual({
        ...moneyOnly,
        planFieldsTouched: false,
        entryOrStopChanged: false,
      });
    });

    it('setting Risk/Reward on a Price-only Trade touches plan fields but never marks entryOrStopChanged', () => {
      const resolved = resolvePlanFieldsPatch(current, {
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 3000n,
      });
      expect(resolved.plannedRiskMinor).toBe(1000n);
      expect(resolved.plannedRewardMinor).toBe(3000n);
      expect(resolved.plannedEntry).toBe(current.plannedEntry);
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(false);
    });

    it('explicitly clearing Risk (null) touches plan fields without marking entryOrStopChanged', () => {
      const withMoney = { ...current, plannedRiskMinor: 1000n, plannedRewardMinor: 3000n };
      const resolved = resolvePlanFieldsPatch(withMoney, { plannedRiskMinor: null });
      expect(resolved.plannedRiskMinor).toBeNull();
      expect(resolved.plannedRewardMinor).toBe(3000n);
      expect(resolved.planFieldsTouched).toBe(true);
      expect(resolved.entryOrStopChanged).toBe(false);
    });
  });

  describe('matchesCloseRetry', () => {
    const stored = {
      actualExit: '1.1050000000',
      netPnlMinor: 50000n,
      exitedAt: new Date('2026-08-01T12:00:00Z'),
    };

    it('true for byte-identical primitives', () => {
      expect(matchesCloseRetry(stored, { ...stored })).toBe(true);
    });

    it('false when netPnlMinor differs', () => {
      expect(matchesCloseRetry(stored, { ...stored, netPnlMinor: 50001n })).toBe(false);
    });

    it('false when exitedAt differs, even by one millisecond', () => {
      expect(
        matchesCloseRetry(stored, {
          ...stored,
          exitedAt: new Date(stored.exitedAt.getTime() + 1),
        }),
      ).toBe(false);
    });

    it('false when actualExit differs', () => {
      expect(matchesCloseRetry(stored, { ...stored, actualExit: '1.1060000000' })).toBe(false);
    });
  });

  describe('matchesSystemResolveRetry', () => {
    const stored = {
      systemResolutionKind: 'price_exit',
      systemExitPrice: '1.1100000000',
      systemGrossRInput: null,
      systemExitedAt: new Date('2026-08-01T12:00:00Z'),
      systemExitReason: 'target_hit',
      systemCostR: '0.0500',
    };

    it('true for byte-identical primitives', () => {
      expect(matchesSystemResolveRetry(stored, { ...stored })).toBe(true);
    });

    it('false when systemCostR differs', () => {
      expect(matchesSystemResolveRetry(stored, { ...stored, systemCostR: '0.1000' })).toBe(false);
    });

    it('false when systemExitReason differs', () => {
      expect(matchesSystemResolveRetry(stored, { ...stored, systemExitReason: 'stop_hit' })).toBe(
        false,
      );
    });
  });
});
