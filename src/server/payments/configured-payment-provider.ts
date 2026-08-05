import 'server-only';

import { eq } from 'drizzle-orm';

import { getServerEnv } from '@/config/env.server';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';

import { MockPaymentProvider, type MockPaymentOutcome } from './mock-payment-provider';
import type { PaymentProvider } from './payment-provider';

const configuredProviders = new Map<MockPaymentOutcome, PaymentProvider>();

function oneMonthAfter(start: Date): Date {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

/** Trusted server factory. Browser input can neither select nor configure the mock outcome. */
function providerForOutcome(outcome: MockPaymentOutcome): PaymentProvider {
  let configuredProvider = configuredProviders.get(outcome);
  if (configuredProvider === undefined) {
    const periodStart = new Date();
    configuredProvider = new MockPaymentProvider({
      outcome,
      periodStart,
      periodEnd: oneMonthAfter(periodStart),
    });
    configuredProviders.set(outcome, configuredProvider);
  }
  return configuredProvider;
}

function isLoopback(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

async function trustedE2eOutcome(userId: string): Promise<MockPaymentOutcome | null> {
  const env = getServerEnv();
  if (env.E2E_TEST_MODE !== 'true' || !isLoopback(env.BETTER_AUTH_URL)) return null;
  const [user] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (/^e2e-checkout-processing-[a-z0-9-]+@example\.test$/.test(user?.email ?? '')) {
    return 'processing_then_success';
  }
  if (/^e2e-checkout-failed-[a-z0-9-]+@example\.test$/.test(user?.email ?? '')) {
    return 'immediate_decline';
  }
  return null;
}

export async function getConfiguredPaymentProvider(userId: string): Promise<PaymentProvider> {
  return providerForOutcome((await trustedE2eOutcome(userId)) ?? 'immediate_success');
}
