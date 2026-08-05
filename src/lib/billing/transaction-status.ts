export type PersistedBillingTransactionStatus =
  'created' | 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export type ProviderBillingTransactionStatus = 'processing' | 'succeeded' | 'failed' | 'canceled';

export type BillingStatusTransitionDecision = 'apply' | 'idempotent' | 'ignore_stale';

export function decideBillingStatusTransition(
  current: PersistedBillingTransactionStatus,
  incoming: ProviderBillingTransactionStatus,
): BillingStatusTransitionDecision {
  if (current === 'succeeded' || current === 'failed' || current === 'canceled') {
    return current === incoming ? 'idempotent' : 'ignore_stale';
  }
  if (current === 'processing' && incoming === 'processing') return 'idempotent';
  return 'apply';
}
