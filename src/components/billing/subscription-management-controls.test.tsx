import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubscriptionManagementPresentation } from '@/lib/billing/subscription-management-types';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { SubscriptionManagementControls } from './subscription-management-controls';

const actions = vi.hoisted(() => ({
  scheduleDowngrade: vi.fn(),
  cancelDowngrade: vi.fn(),
  scheduleCancellation: vi.fn(),
  cancelCancellation: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/server/actions/subscription-management', () => ({
  schedulePlanDowngradeAction: actions.scheduleDowngrade,
  cancelPlanDowngradeAction: actions.cancelDowngrade,
  scheduleSubscriptionCancellationAction: actions.scheduleCancellation,
  cancelSubscriptionCancellationAction: actions.cancelCancellation,
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }));

function model(
  overrides: Partial<SubscriptionManagementPresentation> = {},
): SubscriptionManagementPresentation {
  return {
    persistedStatus: 'active',
    effectiveStatus: 'active',
    accessMode: 'writable',
    currentPlan: {
      id: 'professional',
      name: 'Professional',
      activeTradingAccountLimit: 15,
      priceFormatted: '$15.00',
    },
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    trialEndsAt: null,
    currentPeriodEndsAt: '01 Sept 2026',
    activeAccountCount: 7,
    accountLimit: 15,
    overLimit: false,
    hasNonTerminalCheckout: false,
    blockReason: null,
    upgradeOptions: [],
    downgradeOptions: [
      {
        id: 'starter',
        name: 'Starter',
        activeTradingAccountLimit: 1,
        priceFormatted: '$5.00',
        effectiveAt: '01 Sept 2026',
        willBeOverLimit: true,
      },
    ],
    pendingDowngrade: null,
    cancellationScheduled: false,
    canCancelPendingDowngrade: false,
    canScheduleCancellation: true,
    canReverseCancellation: false,
    ...overrides,
  };
}

function renderControls(snapshot: SubscriptionManagementPresentation, locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <SubscriptionManagementControls model={snapshot} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.scheduleDowngrade.mockResolvedValue({ ok: true, changed: true });
  actions.cancelDowngrade.mockResolvedValue({ ok: true, changed: true });
  actions.scheduleCancellation.mockResolvedValue({ ok: true, changed: true });
  actions.cancelCancellation.mockResolvedValue({ ok: true, changed: true });
});

describe('subscription management controls', () => {
  it('shows downgrade impact and submits only the target plan', async () => {
    const user = userEvent.setup();
    renderControls(model());
    expect(screen.getByText('Future active-account limit')).toBeInTheDocument();
    expect(
      screen.getByText('This workspace will be over limit when the downgrade takes effect.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schedule downgrade' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Schedule downgrade to Starter?' }),
    ).toBeVisible();
    expect(screen.getByText(/never deleted or automatically archived/i)).toBeVisible();
    expect(screen.getByText(/continue switching accounts/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Confirm downgrade' }));
    expect(actions.scheduleDowngrade).toHaveBeenCalledWith({ targetPlanKey: 'starter' });
  });

  it('can cancel a pending downgrade and reverse scheduled cancellation', async () => {
    const user = userEvent.setup();
    renderControls(
      model({
        downgradeOptions: [],
        pendingDowngrade: {
          plan: {
            id: 'starter',
            name: 'Starter',
            activeTradingAccountLimit: 1,
            priceFormatted: '$5.00',
          },
          effectiveAt: '01 Sept 2026',
          willBeOverLimit: true,
        },
        canCancelPendingDowngrade: true,
        cancellationScheduled: true,
        canScheduleCancellation: false,
        canReverseCancellation: true,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel scheduled downgrade' }));
    await user.click(screen.getByRole('button', { name: 'Keep current plan' }));
    expect(actions.cancelDowngrade).toHaveBeenCalledWith({});
    await user.click(screen.getByRole('button', { name: 'Reverse cancellation' }));
    await user.click(screen.getByRole('button', { name: 'Continue subscription' }));
    expect(actions.cancelCancellation).toHaveBeenCalledWith({});
  });

  it('shows cancellation retention/read-only terms and is keyboard operable', async () => {
    const user = userEvent.setup();
    renderControls(model({ downgradeOptions: [] }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Schedule cancellation' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alertdialog', { name: 'Schedule cancellation?' })).toBeVisible();
    expect(screen.getByText(/workspace becomes read-only/i)).toBeVisible();
    expect(screen.getByText(/No data is deleted/i)).toBeVisible();
  });

  it('renders Thai checkout-blocked messaging without lifecycle buttons', () => {
    renderControls(
      model({
        blockReason: 'checkout_in_progress',
        downgradeOptions: [],
        canScheduleCancellation: false,
      }),
      'th',
    );
    expect(screen.getAllByText(/mock checkout/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /ลดระดับ/ })).not.toBeInTheDocument();
  });
});
