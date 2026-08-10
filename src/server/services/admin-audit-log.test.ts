import { describe, expectTypeOf, it } from 'vitest';

import type { AdminAuditStateSnapshot } from './admin-audit-log';

/**
 * Compile-time proof that `AdminAuditStateSnapshot` is a closed, safe shape
 * — the same posture `src/server/services/audit-log.test.ts` already
 * establishes for `AuditLogMetadata`. Every field here is an entitlement/VAT
 * lifecycle VALUE; a future edit that widens this interface to accidentally
 * include an email, a name, a token, or Trade content fails this test.
 *
 * Deliberately a TYPE-ONLY import: `./admin-audit-log` carries `import
 * 'server-only'` at module scope, which throws outside a server-like
 * environment — `vitest.config.ts`'s own comment documents that this plain
 * jsdom unit config can never execute such a module's runtime code, only
 * import its types. `insertAdminAuditLog`'s runtime behavior (closed-action
 * rejection, actor-id mapping, reason-note length) is exercised against a
 * real database instead, in `admin-foundation-migration.integration.test.ts`
 * and `platform-admin-provisioning.integration.test.ts`.
 */
describe('AdminAuditStateSnapshot is a closed, safe shape', () => {
  it('permits only entitlement/VAT structural fields — never PII or content', () => {
    expectTypeOf<AdminAuditStateSnapshot>().toEqualTypeOf<{
      readonly status?: string;
      readonly planKey?: string | null;
      readonly source?: string;
      readonly trialEndsAt?: string | null;
      readonly periodStart?: string | null;
      readonly periodEnd?: string | null;
      readonly vatEnabled?: boolean;
      readonly vatRateBasisPoints?: number;
    }>();
  });

  it('never has an email/name/token/password/tradeId field, at the type level', () => {
    expectTypeOf<AdminAuditStateSnapshot>().not.toHaveProperty('email');
    expectTypeOf<AdminAuditStateSnapshot>().not.toHaveProperty('name');
    expectTypeOf<AdminAuditStateSnapshot>().not.toHaveProperty('token');
    expectTypeOf<AdminAuditStateSnapshot>().not.toHaveProperty('password');
    expectTypeOf<AdminAuditStateSnapshot>().not.toHaveProperty('tradeId');
    expectTypeOf<AdminAuditStateSnapshot>().not.toHaveProperty('providerId');
  });
});
