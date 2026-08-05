import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BillingCheckoutCapability } from '@/config/billing-capability';
import type { CheckoutQuotePresentation } from '@/lib/billing/presentation-types';

import en from '../../../messages/en.json';
import { CheckoutExperience } from './checkout-experience';

vi.mock('@/server/actions/checkout', () => ({
  checkoutAction: vi.fn(),
  reconcileCheckoutAction: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function quote(vatEnabled: boolean): CheckoutQuotePresentation {
  return {
    plan: {
      id: 'starter',
      name: 'Starter',
      activeTradingAccountLimit: 1,
      featured: false,
      prices: {
        THB: { currency: 'THB', amountMinor: '14900', formatted: '฿149.00' },
        USD: { currency: 'USD', amountMinor: '500', formatted: '$5.00' },
      },
    },
    currency: 'THB',
    billingInterval: 'monthly',
    subtotal: { currency: 'THB', amountMinor: '14900', formatted: '฿149.00' },
    vat: {
      enabled: vatEnabled,
      rateBasisPoints: 700,
      ratePercent: '7',
      amount: {
        currency: 'THB',
        amountMinor: vatEnabled ? '1043' : '0',
        formatted: vatEnabled ? '฿10.43' : '฿0.00',
      },
    },
    total: {
      currency: 'THB',
      amountMinor: vatEnabled ? '15943' : '14900',
      formatted: vatEnabled ? '฿159.43' : '฿149.00',
    },
  };
}

function renderCheckout(
  vatEnabled: boolean,
  capability: BillingCheckoutCapability = 'development_mock',
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CheckoutExperience
        quote={quote(vatEnabled)}
        sharedFeatureKeys={['unlimitedStrategies', 'analytics']}
        context={{ status: 'trialing', currentPlanName: null }}
        capability={capability}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => sessionStorage.clear());

describe('checkout presentation', () => {
  it('omits VAT wording and the tax row when collection is disabled', () => {
    renderCheckout(false);
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.queryByText('VAT 7%')).not.toBeInTheDocument();
    expect(screen.queryByText('Prices exclude 7% VAT.')).not.toBeInTheDocument();
    expect(screen.getAllByText('฿149.00')).toHaveLength(2);
  });

  it('shows trusted subtotal, VAT, total, and exact notice when enabled', () => {
    renderCheckout(true);
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('VAT 7%')).toBeInTheDocument();
    expect(screen.getByText('฿10.43')).toBeInTheDocument();
    expect(screen.getByText('฿159.43')).toBeInTheDocument();
    expect(screen.getByText('Prices exclude 7% VAT.')).toBeInTheDocument();
  });

  it('is explicit about mock payment and renders no credential collection fields', () => {
    renderCheckout(false);
    expect(screen.getByRole('heading', { name: 'Mock payment' })).toBeInTheDocument();
    expect(screen.getByText(/no real charge will occur/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card|cvv|bank/i)).not.toBeInTheDocument();
  });

  it('renders an honest unavailable state with no mock form when capability is unavailable', () => {
    renderCheckout(false, 'unavailable');
    expect(
      screen.getByRole('heading', { name: 'Payments are not available yet' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mock payment' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm mock subscription' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View billing history' })).toHaveAttribute(
      'href',
      '/app/billing',
    );
    // Public pricing/order-summary information remains visible even when payment is unavailable.
    expect(screen.getByText('Starter')).toBeInTheDocument();
  });
});
