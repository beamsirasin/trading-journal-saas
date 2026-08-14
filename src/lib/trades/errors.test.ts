import { describe, expect, it } from 'vitest';

import {
  isTradeDomainErrorCode,
  isTradePublicErrorCode,
  mapPlanCalcReasonToFieldErrors,
  mapServiceErrorToPublicCode,
  mapSystemCalcReasonToFieldErrors,
  TRADE_DOMAIN_ERROR_CODES,
  TRADE_PUBLIC_ERROR_CODES,
} from './errors';

describe('trades/errors — public code closure', () => {
  it('never includes a "conflict" code', () => {
    expect(TRADE_PUBLIC_ERROR_CODES).not.toContain('conflict');
  });

  it('every domain code maps to a member of the public set', () => {
    for (const code of TRADE_DOMAIN_ERROR_CODES) {
      const mapped = mapServiceErrorToPublicCode(code);
      expect(TRADE_PUBLIC_ERROR_CODES).toContain(mapped);
    }
  });

  it('folds Zod-catchable domain codes into validation_error', () => {
    expect(mapServiceErrorToPublicCode('blank_symbol')).toBe('validation_error');
    expect(mapServiceErrorToPublicCode('invalid_direction')).toBe('validation_error');
    expect(mapServiceErrorToPublicCode('invalid_check_status')).toBe('validation_error');
  });

  it('passes through every other domain code unchanged', () => {
    expect(mapServiceErrorToPublicCode('trade_not_found')).toBe('trade_not_found');
    expect(mapServiceErrorToPublicCode('setup_snapshot_missing')).toBe('setup_snapshot_missing');
    expect(mapServiceErrorToPublicCode('invalid_system_exit_reason')).toBe(
      'invalid_system_exit_reason',
    );
  });

  it('reuses read_only_workspace/over_limit_workspace directly, never redefining them', () => {
    expect(mapServiceErrorToPublicCode('read_only_workspace')).toBe('read_only_workspace');
    expect(mapServiceErrorToPublicCode('over_limit_workspace')).toBe('over_limit_workspace');
  });

  it('maps an unrecognized code to unexpected_error rather than crashing', () => {
    expect(mapServiceErrorToPublicCode('something_never_returned_by_any_service')).toBe(
      'unexpected_error',
    );
  });

  it('isTradeDomainErrorCode / isTradePublicErrorCode are accurate type guards', () => {
    expect(isTradeDomainErrorCode('trade_not_found')).toBe(true);
    expect(isTradeDomainErrorCode('not_a_real_code')).toBe(false);
    expect(isTradePublicErrorCode('validation_error')).toBe(true);
    expect(isTradePublicErrorCode('blank_symbol')).toBe(false); // folded away, never public
  });
});

describe('trades/errors — mapPlanCalcReasonToFieldErrors', () => {
  it('wrong-side Stop (invalid_risk_direction) maps to plannedStop', () => {
    expect(mapPlanCalcReasonToFieldErrors('invalid_risk_direction')).toEqual({
      plannedStop: ['invalid_risk_direction'],
    });
  });

  it('zero_risk also maps to plannedStop', () => {
    expect(mapPlanCalcReasonToFieldErrors('zero_risk')).toEqual({ plannedStop: ['zero_risk'] });
  });

  it('wrong-side Target maps to plannedTarget', () => {
    expect(mapPlanCalcReasonToFieldErrors('invalid_target_direction')).toEqual({
      plannedTarget: ['invalid_target_direction'],
    });
  });

  it('falls back to plannedEntry for other reasons', () => {
    expect(mapPlanCalcReasonToFieldErrors('invalid_decimal')).toEqual({
      plannedEntry: ['invalid_decimal'],
    });
  });

  it('invalid_planned_risk maps to plannedRiskMinor', () => {
    expect(mapPlanCalcReasonToFieldErrors('invalid_planned_risk')).toEqual({
      plannedRiskMinor: ['invalid_planned_risk'],
    });
  });

  it('invalid_planned_reward maps to plannedRewardMinor', () => {
    expect(mapPlanCalcReasonToFieldErrors('invalid_planned_reward')).toEqual({
      plannedRewardMinor: ['invalid_planned_reward'],
    });
  });
});

describe('trades/errors — mapSystemCalcReasonToFieldErrors', () => {
  it('invalid System cost maps to systemCostR', () => {
    expect(mapSystemCalcReasonToFieldErrors('invalid_system_cost')).toEqual({
      systemCostR: ['invalid_system_cost'],
    });
  });

  it('a Plan-denominator failure maps to plannedStop, not a System-only field', () => {
    expect(mapSystemCalcReasonToFieldErrors('invalid_risk_direction')).toEqual({
      plannedStop: ['invalid_risk_direction'],
    });
  });

  it('falls back to systemExitPrice for other reasons', () => {
    expect(mapSystemCalcReasonToFieldErrors('invalid_decimal')).toEqual({
      systemExitPrice: ['invalid_decimal'],
    });
  });
});
