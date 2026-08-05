import { describe, expect, it } from 'vitest';

import { decideBillingStatusTransition } from './transaction-status';

describe('billing transaction status transitions', () => {
  it.each(['created', 'pending', 'processing'] as const)(
    'allows %s to reach every provider outcome',
    (current) => {
      for (const incoming of ['succeeded', 'failed', 'canceled'] as const) {
        expect(decideBillingStatusTransition(current, incoming)).toBe('apply');
      }
    },
  );

  it('allows created or pending to become processing', () => {
    expect(decideBillingStatusTransition('created', 'processing')).toBe('apply');
    expect(decideBillingStatusTransition('pending', 'processing')).toBe('apply');
  });

  it('treats repeated processing and repeated terminal outcomes as idempotent', () => {
    expect(decideBillingStatusTransition('processing', 'processing')).toBe('idempotent');
    expect(decideBillingStatusTransition('succeeded', 'succeeded')).toBe('idempotent');
    expect(decideBillingStatusTransition('failed', 'failed')).toBe('idempotent');
    expect(decideBillingStatusTransition('canceled', 'canceled')).toBe('idempotent');
  });

  it.each([
    ['succeeded', 'processing'],
    ['succeeded', 'failed'],
    ['failed', 'succeeded'],
    ['failed', 'canceled'],
    ['canceled', 'succeeded'],
    ['canceled', 'failed'],
  ] as const)('ignores stale or conflicting terminal transition %s -> %s', (current, incoming) => {
    expect(decideBillingStatusTransition(current, incoming)).toBe('ignore_stale');
  });
});
