import { render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SubscriptionManagementPresentation } from '@/lib/billing/subscription-management-types';

import en from '../../../../../../../messages/en.json';
import PlanPage from './page';

const state = vi.hoisted(() => ({
  subscription: null as SubscriptionManagementPresentation | null,
}));

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (namespace: string | { namespace: string }) =>
    createTranslator({
      locale: 'en',
      messages: en,
      namespace: (typeof namespace === 'string' ? namespace : namespace.namespace) as never,
    }),
}));

vi.mock('@/server/auth/dal', () => ({
  getCurrentUserPreferences: async () => ({ locale: 'en', theme: 'system', timezone: 'UTC' }),
}));
vi.mock('@/server/billing/subscription-management', () => ({
  getSubscriptionManagementPresentation: async () => state.subscription,
}));
vi.mock('@/server/billing/presentation', () => ({
  getBillingPresentation: () => ({
    locale: 'en',
    supportedCurrencies: ['THB', 'USD'],
    defaultCurrency: 'USD',
    billingInterval: 'monthly',
    sharedFeatureKeys: ['unlimitedStrategies', 'analytics'],
    vat: { enabled: false, rateBasisPoints: 700, ratePercent: '7' },
    plans: [
      ['starter', 'Starter', 1, '$5.00'],
      ['trader', 'Trader', 5, '$9.00'],
      ['professional', 'Professional', 15, '$15.00'],
    ].map(([id, name, limit, formatted], index) => ({
      id,
      name,
      activeTradingAccountLimit: limit,
      featured: index === 1,
      prices: {
        THB: { currency: 'THB', amountMinor: '0', formatted: '฿0.00' },
        USD: { currency: 'USD', amountMinor: '0', formatted },
      },
    })),
  }),
}));
vi.mock('@/server/actions/subscription-management', () => ({
  schedulePlanDowngradeAction: vi.fn(),
  cancelPlanDowngradeAction: vi.fn(),
  scheduleSubscriptionCancellationAction: vi.fn(),
  cancelSubscriptionCancellationAction: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ refresh: vi.fn() }),
}));

function option(id: 'starter' | 'trader' | 'professional') {
  const details = {
    starter: ['Starter', 1, '$5.00'],
    trader: ['Trader', 5, '$9.00'],
    professional: ['Professional', 15, '$15.00'],
  } as const;
  return {
    id,
    name: details[id][0],
    activeTradingAccountLimit: details[id][1],
    priceFormatted: details[id][2],
  };
}

function subscription(
  overrides: Partial<SubscriptionManagementPresentation> = {},
): SubscriptionManagementPresentation {
  return {
    persistedStatus: 'trialing',
    effectiveStatus: 'trialing',
    accessMode: 'writable',
    currentPlan: null,
    billingCurrency: null,
    billingInterval: null,
    trialEndsAt: '08 Aug 2026',
    currentPeriodEndsAt: null,
    activeAccountCount: 1,
    accountLimit: 1,
    overLimit: false,
    hasNonTerminalCheckout: false,
    blockReason: null,
    upgradeOptions: [option('starter'), option('trader'), option('professional')],
    downgradeOptions: [],
    pendingDowngrade: null,
    cancellationScheduled: false,
    canCancelPendingDowngrade: false,
    canScheduleCancellation: false,
    canReverseCancellation: false,
    ...overrides,
  };
}

async function renderPage(snapshot: SubscriptionManagementPresentation) {
  state.subscription = snapshot;
  const element = await PlanPage({ params: Promise.resolve({ locale: 'en' }) });
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe('authenticated plan page', () => {
  it('shows real trial usage and every canonical plan without fake billing data', async () => {
    await renderPage(subscription());
    expect(screen.getByText('Trial active')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    for (const plan of ['Starter', 'Trader', 'Professional']) {
      expect(screen.getByRole('heading', { name: plan })).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/demo subscription|coming soon/i);
  });

  it.each(['starter', 'trader', 'professional'] as const)(
    'shows active %s currency, period, and real limit',
    async (planKey) => {
      const plan = option(planKey);
      await renderPage(
        subscription({
          persistedStatus: 'active',
          effectiveStatus: 'active',
          currentPlan: plan,
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          trialEndsAt: null,
          currentPeriodEndsAt: '01 Sept 2026',
          accountLimit: plan.activeTradingAccountLimit,
          upgradeOptions: [],
          canScheduleCancellation: true,
        }),
      );
      expect(screen.getByText('USD')).toBeInTheDocument();
      expect(screen.getByText(`1 / ${plan.activeTradingAccountLimit}`)).toBeInTheDocument();
      expect(screen.getByText('Monthly')).toBeInTheDocument();
      expect(screen.getByText('01 Sept 2026')).toBeInTheDocument();
    },
  );

  it('shows pending downgrade, scheduled cancellation, and over-limit access state', async () => {
    await renderPage(
      subscription({
        persistedStatus: 'active',
        effectiveStatus: 'active',
        accessMode: 'over_limit',
        currentPlan: option('trader'),
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        trialEndsAt: null,
        currentPeriodEndsAt: '01 Sept 2026',
        activeAccountCount: 6,
        accountLimit: 5,
        overLimit: true,
        pendingDowngrade: {
          plan: option('starter'),
          effectiveAt: '01 Sept 2026',
          willBeOverLimit: true,
        },
        cancellationScheduled: true,
      }),
    );
    expect(screen.getByText('Scheduled at period end')).toBeInTheDocument();
    expect(screen.getByText('Over account limit')).toBeInTheDocument();
    expect(screen.getByText(/Your plan will change to Starter/)).toBeInTheDocument();
  });

  it('shows past_due without a checkout action', async () => {
    await renderPage(
      subscription({
        persistedStatus: 'past_due',
        effectiveStatus: 'canceled',
        accessMode: 'read_only',
        currentPlan: option('starter'),
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        upgradeOptions: [],
        blockReason: 'past_due',
      }),
    );
    expect(
      screen.getByText(/Checkout is unavailable while this subscription is past due/),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument();
  });
});
