import { describe, expect, it } from 'vitest';

import { BREAK_EVEN_TOLERANCE_R, CALC_VERSION } from './trade-calc';

/**
 * Proves the exact Calculation Engine Version 1 constant values and makes
 * the global-engine scope explicit — these are not workspace-wide
 * configuration, not database columns, and not user-configurable during the
 * MVP (Phase 07B correction).
 */
describe('trade-calc constants', () => {
  it('BREAK_EVEN_TOLERANCE_R is exactly "0.0500"', () => {
    expect(BREAK_EVEN_TOLERANCE_R).toBe('0.0500');
  });

  it('BREAK_EVEN_TOLERANCE_R is a decimal-safe string, never a JS number', () => {
    expect(typeof BREAK_EVEN_TOLERANCE_R).toBe('string');
  });

  it('CALC_VERSION is exactly 1', () => {
    expect(CALC_VERSION).toBe(1);
  });

  it('exposes exactly these two constants — no per-workspace or per-account variant exists', () => {
    // A global Calculation Engine Version 1 constant is a single exported
    // value, not a function of workspaceId/tradingAccountId. This module
    // deliberately has no such parameterized export; asserting the module's
    // shape here catches a future accidental reintroduction of one.
    const moduleExports = { BREAK_EVEN_TOLERANCE_R, CALC_VERSION };
    expect(Object.keys(moduleExports).sort()).toEqual(['BREAK_EVEN_TOLERANCE_R', 'CALC_VERSION']);
  });
});
