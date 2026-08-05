import { render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EffectiveEntitlement } from '@/lib/entitlements/resolve';

import en from '../../../../../../../messages/en.json';
import PlanPage from './page';

const state = vi.hoisted(() => ({ entitlement: null as EffectiveEntitlement | null }));

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
  getWorkspaceEntitlement: async () => state.entitlement,
  getCurrentUserPreferences: async () => ({ locale: 'en', theme: 'system', timezone: 'UTC' }),
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

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function entitlement(overrides: Partial<EffectiveEntitlement> = {}): EffectiveEntitlement {
  return {
    workspaceId: 'workspace-1',
    persistedStatus: 'trialing',
    effectiveStatus: 'trialing',
    planKey: null,
    effectivePlanKey: null,
    trialStartedAt: new Date('2026-08-01T00:00:00Z'),
    trialEndsAt: new Date('2026-08-08T00:00:00Z'),
    currentPeriodStartedAt: null,
    currentPeriodEndsAt: null,
    effectivePeriodEnd: new Date('2026-08-08T00:00:00Z'),
    billingCurrency: null,
    billingInterval: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    pendingPlanKey: null,
    pendingPlanEffectiveAt: null,
    pendingPlanDue: false,
    accountLimit: 1,
    activeAccountCount: 1,
    remainingAccountSlots: 0,
    canCreateAccount: false,
    canRestoreAccount: false,
    trialExpired: false,
    overLimit: false,
    accessMode: 'writable',
    denialReason: null,
    blockReason: 'account_limit_reached',
    ...overrides,
  };
}

async function renderPage(snapshot: EffectiveEntitlement) {
  state.entitlement = snapshot;
  const element = await PlanPage({ params: Promise.resolve({ locale: 'en' }) });
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe('authenticated plan page', () => {
  it('shows real trial usage and every canonical plan without fake billing data', async () => {
    await renderPage(entitlement());
    expect(screen.getByText('Trial active')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    for (const plan of ['Starter', 'Trader', 'Professional']) {
      expect(screen.getByRole('heading', { name: plan })).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/demo subscription|coming soon/i);
  });

  it.each([
    ['starter', 1],
    ['trader', 5],
    ['professional', 15],
  ] as const)('shows active %s currency, period, and real limit', async (planKey, limit) => {
    await renderPage(
      entitlement({
        persistedStatus: 'active',
        effectiveStatus: 'active',
        planKey,
        effectivePlanKey: planKey,
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        effectivePeriodEnd: new Date('2026-09-01T00:00:00Z'),
        accountLimit: limit,
        activeAccountCount: 1,
      }),
    );
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText(`1 / ${limit}`)).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getAllByText('01 Sept 2026').length).toBeGreaterThan(0);
  });

  it('shows pending downgrade, scheduled cancellation, and over-limit access state', async () => {
    await renderPage(
      entitlement({
        persistedStatus: 'active',
        effectiveStatus: 'active',
        planKey: 'trader',
        effectivePlanKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        effectivePeriodEnd: new Date('2026-09-01T00:00:00Z'),
        cancelAtPeriodEnd: true,
        pendingPlanKey: 'starter',
        pendingPlanEffectiveAt: new Date('2026-09-01T00:00:00Z'),
        accountLimit: 5,
        activeAccountCount: 6,
        overLimit: true,
        accessMode: 'over_limit',
        denialReason: 'workspace_over_limit',
        blockReason: 'workspace_over_limit',
      }),
    );
    expect(screen.getByText('Scheduled at period end')).toBeInTheDocument();
    expect(screen.getByText('Over account limit')).toBeInTheDocument();
    expect(screen.getByText(/Downgrade to Starter is scheduled/)).toBeInTheDocument();
  });

  it.each(['expired', 'canceled', 'past_due'] as const)(
    'shows %s honestly and blocks past-due checkout',
    async (status) => {
      await renderPage(
        entitlement({
          persistedStatus: status,
          effectiveStatus: status === 'expired' ? 'expired' : 'canceled',
          accessMode: 'read_only',
          denialReason:
            status === 'past_due'
              ? 'subscription_past_due'
              : status === 'canceled'
                ? 'subscription_canceled'
                : 'subscription_expired',
        }),
      );
      if (status === 'past_due') {
        expect(
          screen.getByText(/Checkout is unavailable while this subscription is past due/),
        ).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Checkout unavailable' })).toHaveLength(3);
      }
    },
  );
});
