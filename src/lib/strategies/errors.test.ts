import { describe, expect, it } from 'vitest';

import {
  isStrategyDomainErrorCode,
  isStrategyPublicErrorCode,
  mapServiceErrorToPublicCode,
  STRATEGY_DOMAIN_ERROR_CODES,
  STRATEGY_PUBLIC_ERROR_CODES,
} from './errors';

describe('STRATEGY_DOMAIN_ERROR_CODES', () => {
  it('includes every code the Phase 06C brief requires at minimum', () => {
    const required = [
      'strategy_not_found',
      'strategy_archived',
      'strategy_current_version_missing',
      'setup_not_found',
      'setup_archived',
      'setup_snapshot_missing',
      'rule_not_found',
      'change_note_required',
      'invalid_rule_category',
      'read_only_workspace',
      'over_limit_workspace',
      'workspace_access_denied',
    ];
    for (const code of required) {
      expect(STRATEGY_DOMAIN_ERROR_CODES).toContain(code);
    }
  });

  it('isStrategyDomainErrorCode accepts every listed code', () => {
    for (const code of STRATEGY_DOMAIN_ERROR_CODES) {
      expect(isStrategyDomainErrorCode(code)).toBe(true);
    }
  });

  it('isStrategyDomainErrorCode rejects an unknown value', () => {
    expect(isStrategyDomainErrorCode('not_a_real_code')).toBe(false);
    expect(isStrategyDomainErrorCode('')).toBe(false);
    expect(isStrategyDomainErrorCode(42)).toBe(false);
    expect(isStrategyDomainErrorCode(null)).toBe(false);
  });
});

describe('STRATEGY_PUBLIC_ERROR_CODES', () => {
  it('isStrategyPublicErrorCode accepts every listed code', () => {
    for (const code of STRATEGY_PUBLIC_ERROR_CODES) {
      expect(isStrategyPublicErrorCode(code)).toBe(true);
    }
  });

  it('isStrategyPublicErrorCode rejects an unknown value', () => {
    expect(isStrategyPublicErrorCode('not_a_real_code')).toBe(false);
    expect(isStrategyPublicErrorCode(null)).toBe(false);
  });

  it('does not include the Zod-catchable blank-label domain codes', () => {
    expect(STRATEGY_PUBLIC_ERROR_CODES).not.toContain('blank_name');
    expect(STRATEGY_PUBLIC_ERROR_CODES).not.toContain('blank_title');
    expect(STRATEGY_PUBLIC_ERROR_CODES).not.toContain('blank_condition_label');
  });

  it('includes the four action-layer-only codes no service ever returns', () => {
    for (const code of ['validation_error', 'unauthenticated', 'conflict', 'unexpected_error']) {
      expect(STRATEGY_PUBLIC_ERROR_CODES).toContain(code);
    }
  });
});

describe('mapServiceErrorToPublicCode', () => {
  it('folds blank required-text errors into validation_error', () => {
    expect(mapServiceErrorToPublicCode('blank_name')).toBe('validation_error');
    expect(mapServiceErrorToPublicCode('blank_title')).toBe('validation_error');
    expect(mapServiceErrorToPublicCode('blank_condition_label')).toBe('validation_error');
  });

  it('passes every domain error code through unchanged, except blank required text', () => {
    for (const code of STRATEGY_DOMAIN_ERROR_CODES) {
      if (code === 'blank_name' || code === 'blank_title' || code === 'blank_condition_label') {
        continue;
      }
      expect(mapServiceErrorToPublicCode(code)).toBe(code);
    }
  });

  it('maps an unrecognized code to unexpected_error rather than throwing', () => {
    expect(mapServiceErrorToPublicCode('some_future_entitlement_reason')).toBe('unexpected_error');
  });

  it('every mapped output is itself a valid public error code', () => {
    for (const code of STRATEGY_DOMAIN_ERROR_CODES) {
      expect(isStrategyPublicErrorCode(mapServiceErrorToPublicCode(code))).toBe(true);
    }
  });
});
