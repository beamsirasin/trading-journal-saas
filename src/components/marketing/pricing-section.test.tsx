import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { BillingPresentation } from '@/lib/billing/presentation-types';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { PricingSection } from './pricing-section';

function presentation(locale: 'en' | 'th', vatEnabled = false): BillingPresentation {
  const planData = [
    ['starter', 'Starter', 1, '฿149.00', '$5.00'],
    ['trader', 'Trader', 5, '฿299.00', '$9.00'],
    ['professional', 'Professional', 15, '฿499.00', '$15.00'],
  ] as const;
  return {
    locale,
    supportedCurrencies: ['THB', 'USD'],
    defaultCurrency: locale === 'th' ? 'THB' : 'USD',
    billingInterval: 'monthly',
    sharedFeatureKeys: [
      'unlimitedStrategies',
      'unlimitedSetups',
      'unlimitedTrades',
      'unlimitedTradeHistory',
      'journal',
      'analytics',
      'performanceComparison',
      'importExport',
    ],
    vat: { enabled: vatEnabled, rateBasisPoints: 700, ratePercent: '7' },
    plans: planData.map(([id, name, limit, thb, usd], index) => ({
      id,
      name,
      activeTradingAccountLimit: limit,
      featured: index === 1,
      prices: {
        THB: { currency: 'THB', amountMinor: `${[149, 299, 499][index]}00`, formatted: thb },
        USD: { currency: 'USD', amountMinor: `${[5, 9, 15][index]}00`, formatted: usd },
      },
    })),
  };
}

function renderPricing(locale: 'en' | 'th', vatEnabled = false) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'th' ? th : en}>
      <PricingSection presentation={presentation(locale, vatEnabled)} />
    </NextIntlClientProvider>,
  );
}

describe('canonical pricing presentation', () => {
  it('defaults English to USD and switches all plans to THB', async () => {
    const user = userEvent.setup();
    renderPricing('en');
    expect(screen.getByText('$5.00 / month')).toBeInTheDocument();
    expect(screen.getByText('$9.00 / month')).toBeInTheDocument();
    expect(screen.getByText('$15.00 / month')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'THB' }));
    expect(screen.getByText('฿149.00 / month')).toBeInTheDocument();
    expect(screen.getByText('฿299.00 / month')).toBeInTheDocument();
    expect(screen.getByText('฿499.00 / month')).toBeInTheDocument();
  });

  it('defaults Thai to THB and presents the one shared feature set on every plan', () => {
    renderPricing('th');
    expect(screen.getByRole('radio', { name: 'THB' })).toBeChecked();
    const region = screen.getByRole('region', { name: /สามแผน/ });
    expect(within(region).getAllByText('การวิเคราะห์ทั้งหมด')).toHaveLength(3);
    for (const limit of ['1', '5', '15']) {
      expect(within(region).getByText(limit)).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/annual|Elite|advanced features/i);
  });

  it('hides VAT launch copy when disabled and uses the exact localized notice when enabled', () => {
    const disabled = renderPricing('en');
    expect(screen.queryByText('Prices exclude 7% VAT.')).not.toBeInTheDocument();
    disabled.unmount();
    renderPricing('en', true);
    expect(screen.getByText('Prices exclude 7% VAT.')).toBeInTheDocument();
  });
});
