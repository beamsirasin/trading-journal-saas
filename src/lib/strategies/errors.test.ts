import { describe, expect, it } from 'vitest';

import { isStrategyDomainErrorCode, STRATEGY_DOMAIN_ERROR_CODES } from './errors';

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
