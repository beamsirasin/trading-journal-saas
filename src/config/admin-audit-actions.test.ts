import { describe, expect, it } from 'vitest';

import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_REASON_CODES,
  isAdminAuditAction,
  isAdminAuditReasonCode,
} from './admin-audit-actions';

describe('ADMIN_AUDIT_ACTIONS', () => {
  it('is exactly the Phase 11B closed vocabulary — no more, no less', () => {
    expect([...ADMIN_AUDIT_ACTIONS].sort()).toEqual(
      [
        'platform_admin.granted',
        'platform_admin.revoked',
        'subscription.trial_extended',
        'subscription.complimentary_granted',
        'subscription.complimentary_revoked',
        'vat.configuration_changed',
      ].sort(),
    );
  });

  it('has no duplicate actions', () => {
    expect(new Set(ADMIN_AUDIT_ACTIONS).size).toBe(ADMIN_AUDIT_ACTIONS.length);
  });

  it('never includes a payment/refund/delete/impersonation action', () => {
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(action).not.toMatch(/refund|payment|delete|impersonat/i);
    }
  });

  it('isAdminAuditAction accepts every listed action and rejects unknown strings', () => {
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(isAdminAuditAction(action)).toBe(true);
    }
    expect(isAdminAuditAction('platform_admin.deleted')).toBe(false);
    expect(isAdminAuditAction('')).toBe(false);
  });
});

describe('ADMIN_AUDIT_REASON_CODES', () => {
  it('is the reviewed closed vocabulary', () => {
    expect([...ADMIN_AUDIT_REASON_CODES].sort()).toEqual(
      [
        'bootstrap',
        'access_grant',
        'access_revoke',
        'trial_extension_goodwill',
        'complimentary_access',
        'support_adjustment',
        'configuration_change',
        'other',
      ].sort(),
    );
  });

  it('has no duplicate reason codes', () => {
    expect(new Set(ADMIN_AUDIT_REASON_CODES).size).toBe(ADMIN_AUDIT_REASON_CODES.length);
  });

  it('isAdminAuditReasonCode accepts every listed code and rejects unknown strings', () => {
    for (const code of ADMIN_AUDIT_REASON_CODES) {
      expect(isAdminAuditReasonCode(code)).toBe(true);
    }
    expect(isAdminAuditReasonCode('because_i_said_so')).toBe(false);
  });
});
