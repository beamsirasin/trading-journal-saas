import { describe, expectTypeOf, it } from 'vitest';

import type { AuditLogMetadata } from './audit-log';

/**
 * Compile-time proof that `AuditLogMetadata` is a closed, safe shape — the
 * Phase 06C brief's "audit metadata permits IDs/field names but rejects
 * content text" requirement. TypeScript interfaces are structurally typed,
 * so this cannot be enforced by an isolated runtime check; asserting the
 * FULL property set here means a future edit that widens the interface to
 * accidentally include a content field (a Strategy/Setup name, a Rule title,
 * a description, a note, a change note) fails this test, forcing a deliberate
 * review — exactly the posture the module comment on `AuditLogMetadata`
 * already asks for ("adding a new field to this interface is itself the
 * review point for whether it is safe to log").
 */
describe('AuditLogMetadata is a closed, safe shape', () => {
  it('permits only IDs, structural scope, and field-name lists — never content', () => {
    expectTypeOf<AuditLogMetadata>().toEqualTypeOf<{
      readonly changedFields?: readonly string[];
      readonly previousActiveTradingAccountId?: string;
      readonly newActiveTradingAccountId?: string;
      readonly billingTransactionId?: string;
      readonly planKey?: string;
      readonly currency?: string;
      readonly subtotalMinor?: string;
      readonly vatAmountMinor?: string;
      readonly totalMinor?: string;
      readonly providerKind?: string;
      readonly providerCheckoutId?: string;
      readonly providerPaymentId?: string;
      readonly status?: string;
      readonly failureCode?: string;
      readonly strategyId?: string;
      readonly strategyVersionId?: string;
      readonly previousStrategyVersionId?: string;
      readonly setupId?: string;
      readonly setupVersionId?: string;
      readonly ruleId?: string;
      readonly ruleKey?: string;
      readonly versionNumber?: number;
      readonly ruleCategory?: string;
      readonly ruleScope?: string;
      readonly isNoop?: boolean;
    }>();
  });

  it('never has a name/description/notes/changeNote/title field, at the type level', () => {
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('name');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('strategyName');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('setupName');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('description');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('notes');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('changeNote');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('title');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('ruleTitle');
    expectTypeOf<AuditLogMetadata>().not.toHaveProperty('ruleDescription');
  });
});
