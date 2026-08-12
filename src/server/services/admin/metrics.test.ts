import { describe, expectTypeOf, it } from 'vitest';

import type { AdminOverviewDashboard } from './metrics';

/**
 * Compile-time proof that `AdminOverviewDashboard` is a strict,
 * JSON-serializable DTO — Phase 11C's own contract: no `Date`, no `bigint`,
 * no DB row, no session/grant object, and (the privacy boundary) no email,
 * name, user ID, or workspace ID anywhere in the shape that crosses into
 * React. `generatedAt` is a plain ISO string, not a `Date`.
 */
describe('AdminOverviewDashboard is a strict, privacy-limited, JSON-safe DTO', () => {
  it('has exactly the locked shape — totals, subscriptions, activity', () => {
    expectTypeOf<AdminOverviewDashboard>().toEqualTypeOf<{
      readonly generatedAt: string;
      readonly totals: {
        readonly users: number;
        readonly workspaces: number;
      };
      readonly subscriptions: {
        readonly byEffectiveStatus: readonly {
          readonly status: 'trialing' | 'active' | 'expired' | 'canceled';
          readonly count: number;
        }[];
        readonly byPlan: readonly {
          readonly plan: 'starter' | 'trader' | 'professional' | 'none';
          readonly count: number;
        }[];
        readonly bySource: readonly {
          readonly source: 'trial' | 'paid' | 'complimentary';
          readonly count: number;
        }[];
      };
      readonly activity: {
        readonly newUsers30d: readonly { readonly day: string; readonly count: number }[];
        readonly tradesLogged30d: readonly { readonly day: string; readonly count: number }[];
      };
    }>();
  });

  it('never carries an email/name/userId/workspaceId/tradeId field anywhere, at the type level', () => {
    expectTypeOf<AdminOverviewDashboard>().not.toHaveProperty('email');
    expectTypeOf<AdminOverviewDashboard>().not.toHaveProperty('name');
    expectTypeOf<AdminOverviewDashboard>().not.toHaveProperty('userId');
    expectTypeOf<AdminOverviewDashboard>().not.toHaveProperty('workspaceId');
    expectTypeOf<AdminOverviewDashboard['subscriptions']>().not.toHaveProperty('workspaceId');
    expectTypeOf<AdminOverviewDashboard['activity']>().not.toHaveProperty('userId');
  });

  it('generatedAt is a plain string, never a Date', () => {
    expectTypeOf<AdminOverviewDashboard['generatedAt']>().toEqualTypeOf<string>();
  });
});
