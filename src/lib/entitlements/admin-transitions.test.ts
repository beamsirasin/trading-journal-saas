import { describe, expect, it } from 'vitest';

import {
  AdminSubscriptionMutationError,
  evaluateComplimentaryGrant,
  evaluateComplimentaryRevoke,
  evaluateTrialExtension,
  MAX_TRIAL_EXTENSION_MS,
  type AdminEntitlementTransitionRow,
} from './admin-transitions';

const NOW = new Date('2026-08-10T12:00:00Z');

function trialRow(
  overrides: Partial<AdminEntitlementTransitionRow> = {},
): AdminEntitlementTransitionRow {
  return {
    source: 'trial',
    status: 'trialing',
    planKey: null,
    trialStartedAt: new Date('2026-08-01T00:00:00Z'),
    trialEndsAt: new Date('2026-08-08T00:00:00Z'),
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    ...overrides,
  };
}

function complimentaryRow(
  overrides: Partial<AdminEntitlementTransitionRow> = {},
): AdminEntitlementTransitionRow {
  return {
    source: 'complimentary',
    status: 'active',
    planKey: 'starter',
    trialStartedAt: new Date('2026-08-01T00:00:00Z'),
    trialEndsAt: new Date('2026-08-08T00:00:00Z'),
    // Complimentary access has no commercial period at all — this fixture
    // mirrors the truthful shape `subscription-support.ts` actually writes.
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    ...overrides,
  };
}

function paidRow(
  overrides: Partial<AdminEntitlementTransitionRow> = {},
): AdminEntitlementTransitionRow {
  return {
    source: 'paid',
    status: 'active',
    planKey: 'professional',
    trialStartedAt: new Date('2026-01-01T00:00:00Z'),
    trialEndsAt: new Date('2026-01-08T00:00:00Z'),
    currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
    currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
    throw new Error('expected evaluate function to throw');
  } catch (error) {
    if (error instanceof AdminSubscriptionMutationError) return error.code;
    throw error;
  }
}

describe('evaluateTrialExtension', () => {
  it('allows extension for a canonical trialing row with original trial provenance', () => {
    const result = evaluateTrialExtension(
      trialRow(),
      {
        workspaceId: 'w1',
        newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
        reasonCode: 'trial_extension_goodwill',
      },
      NOW,
    );
    expect(result).toEqual({ changed: true, nextTrialEndsAt: new Date('2026-08-15T00:00:00Z') });
  });

  it('allows reviving an effectively-expired trial by moving trialEndsAt forward', () => {
    const row = trialRow({ trialEndsAt: new Date('2026-08-01T00:00:00Z') }); // already past NOW
    const result = evaluateTrialExtension(
      row,
      {
        workspaceId: 'w1',
        newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
        reasonCode: 'support_adjustment',
      },
      NOW,
    );
    expect(result.changed).toBe(true);
  });

  it('rejects a paid source', () => {
    const code = errorCode(() =>
      evaluateTrialExtension(
        paidRow(),
        {
          workspaceId: 'w1',
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        NOW,
      ),
    );
    expect(code).toBe('incompatible_state');
  });

  it('rejects a complimentary source', () => {
    const code = errorCode(() =>
      evaluateTrialExtension(
        complimentaryRow(),
        {
          workspaceId: 'w1',
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        NOW,
      ),
    );
    expect(code).toBe('incompatible_state');
  });

  it('rejects a trial-sourced row that is not in the canonical trialing status', () => {
    const code = errorCode(() =>
      evaluateTrialExtension(
        trialRow({ status: 'expired' }),
        {
          workspaceId: 'w1',
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        NOW,
      ),
    );
    expect(code).toBe('incompatible_state');
  });

  it('fails closed when the trial baseline is missing', () => {
    const code = errorCode(() =>
      evaluateTrialExtension(
        trialRow({ trialStartedAt: null }),
        {
          workspaceId: 'w1',
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        NOW,
      ),
    );
    expect(code).toBe('data_integrity_error');
  });

  it('rejects a reason code outside the trial-extension vocabulary', () => {
    const code = errorCode(() =>
      evaluateTrialExtension(
        trialRow(),
        {
          workspaceId: 'w1',
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
          reasonCode: 'complimentary_access',
        },
        NOW,
      ),
    );
    expect(code).toBe('validation_error');
  });

  it('is a no-op with the exact same absolute end already stored', () => {
    const row = trialRow();
    const result = evaluateTrialExtension(
      row,
      { workspaceId: 'w1', newTrialEndsAt: row.trialEndsAt as Date, reasonCode: 'other' },
      NOW,
    );
    expect(result).toEqual({ changed: false, nextTrialEndsAt: row.trialEndsAt });
  });

  it('rejects an earlier-but-still-future end as an invalid transition, distinct from a not-future rejection', () => {
    // trialEndsAt is deliberately ahead of NOW here so the "earlier than
    // current" path is reached instead of the "must be future" path first.
    const row = trialRow({ trialEndsAt: new Date('2026-08-20T00:00:00Z') });
    const code = errorCode(() =>
      evaluateTrialExtension(
        row,
        {
          workspaceId: 'w1',
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'), // future, but earlier than row.trialEndsAt
          reasonCode: 'other',
        },
        NOW,
      ),
    );
    expect(code).toBe('invalid_transition');
  });

  it('requires the new end to be in the future', () => {
    const code = errorCode(() =>
      evaluateTrialExtension(
        trialRow({ trialEndsAt: new Date('2026-08-01T00:00:00Z') }),
        { workspaceId: 'w1', newTrialEndsAt: NOW, reasonCode: 'other' },
        NOW,
      ),
    );
    expect(code).toBe('validation_error');
  });

  it('rejects an extension beyond the 90-day maximum', () => {
    const beyond = new Date(NOW.getTime() + MAX_TRIAL_EXTENSION_MS + 1000);
    const code = errorCode(() =>
      evaluateTrialExtension(
        trialRow(),
        { workspaceId: 'w1', newTrialEndsAt: beyond, reasonCode: 'other' },
        NOW,
      ),
    );
    expect(code).toBe('validation_error');
  });

  it('allows an extension exactly at the 90-day boundary', () => {
    const boundary = new Date(NOW.getTime() + MAX_TRIAL_EXTENSION_MS);
    const result = evaluateTrialExtension(
      trialRow(),
      { workspaceId: 'w1', newTrialEndsAt: boundary, reasonCode: 'other' },
      NOW,
    );
    expect(result.changed).toBe(true);
  });

  it('never silently clamps — one millisecond past the boundary is a hard rejection, not a clamp to 90 days', () => {
    const justOver = new Date(NOW.getTime() + MAX_TRIAL_EXTENSION_MS + 1);
    expect(() =>
      evaluateTrialExtension(
        trialRow(),
        { workspaceId: 'w1', newTrialEndsAt: justOver, reasonCode: 'other' },
        NOW,
      ),
    ).toThrow(AdminSubscriptionMutationError);
  });
});

describe('evaluateComplimentaryGrant', () => {
  for (const plan of ['starter', 'trader', 'professional'] as const) {
    it(`grants a fresh complimentary ${plan} plan from a trial-sourced row`, () => {
      const result = evaluateComplimentaryGrant(trialRow(), {
        workspaceId: 'w1',
        planKey: plan,
        reasonCode: 'complimentary_access',
      });
      expect(result).toEqual({ changed: true, fresh: true });
    });
  }

  it('rejects a paid source — this is the critical boundary', () => {
    const code = errorCode(() =>
      evaluateComplimentaryGrant(paidRow(), {
        workspaceId: 'w1',
        planKey: 'starter',
        reasonCode: 'complimentary_access',
      }),
    );
    expect(code).toBe('incompatible_state');
  });

  it('is a no-op when already complimentary on the exact same plan', () => {
    const result = evaluateComplimentaryGrant(complimentaryRow({ planKey: 'starter' }), {
      workspaceId: 'w1',
      planKey: 'starter',
      reasonCode: 'complimentary_access',
    });
    expect(result).toEqual({ changed: false, fresh: false });
  });

  it('allows changing the complimentary plan tier — not fresh, since the baseline is preserved', () => {
    const result = evaluateComplimentaryGrant(complimentaryRow({ planKey: 'starter' }), {
      workspaceId: 'w1',
      planKey: 'professional',
      reasonCode: 'complimentary_access',
    });
    expect(result).toEqual({ changed: true, fresh: false });
  });

  it('fails closed on a trial-sourced row with a missing trial baseline', () => {
    const code = errorCode(() =>
      evaluateComplimentaryGrant(trialRow({ trialEndsAt: null }), {
        workspaceId: 'w1',
        planKey: 'starter',
        reasonCode: 'complimentary_access',
      }),
    );
    expect(code).toBe('data_integrity_error');
  });

  it('fails closed on a legacy complimentary row with no recoverable trial baseline', () => {
    const code = errorCode(() =>
      evaluateComplimentaryGrant(complimentaryRow({ trialStartedAt: null, trialEndsAt: null }), {
        workspaceId: 'w1',
        planKey: 'professional',
        reasonCode: 'complimentary_access',
      }),
    );
    expect(code).toBe('data_integrity_error');
  });

  it('rejects a non-canonical plan key', () => {
    const code = errorCode(() =>
      evaluateComplimentaryGrant(trialRow(), {
        workspaceId: 'w1',
        // @ts-expect-error deliberately invalid for the runtime check
        planKey: 'enterprise',
        reasonCode: 'complimentary_access',
      }),
    );
    expect(code).toBe('validation_error');
  });

  it('rejects a reason code outside the complimentary-grant vocabulary', () => {
    const code = errorCode(() =>
      evaluateComplimentaryGrant(trialRow(), {
        workspaceId: 'w1',
        planKey: 'starter',
        reasonCode: 'trial_extension_goodwill',
      }),
    );
    expect(code).toBe('validation_error');
  });
});

describe('evaluateComplimentaryRevoke', () => {
  it('revokes an active complimentary entitlement', () => {
    const result = evaluateComplimentaryRevoke(complimentaryRow(), {
      workspaceId: 'w1',
      reasonCode: 'access_revoke',
    });
    expect(result).toBe('revoke');
  });

  it('treats an already-trial row as a safe idempotent no-op, not an error', () => {
    const result = evaluateComplimentaryRevoke(trialRow(), {
      workspaceId: 'w1',
      reasonCode: 'access_revoke',
    });
    expect(result).toBe('noop');
  });

  it('rejects a paid source — paid access is never revoked through this action', () => {
    const code = errorCode(() =>
      evaluateComplimentaryRevoke(paidRow(), { workspaceId: 'w1', reasonCode: 'access_revoke' }),
    );
    expect(code).toBe('incompatible_state');
  });

  it('fails closed on a complimentary row with no recoverable trial baseline', () => {
    const code = errorCode(() =>
      evaluateComplimentaryRevoke(complimentaryRow({ trialStartedAt: null, trialEndsAt: null }), {
        workspaceId: 'w1',
        reasonCode: 'access_revoke',
      }),
    );
    expect(code).toBe('data_integrity_error');
  });

  it('rejects a reason code outside the complimentary-revoke vocabulary', () => {
    const code = errorCode(() =>
      evaluateComplimentaryRevoke(complimentaryRow(), {
        workspaceId: 'w1',
        reasonCode: 'complimentary_access',
      }),
    );
    expect(code).toBe('validation_error');
  });
});
