import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { TradingAccountIndicator } from './trading-account-indicator';

describe('TradingAccountIndicator', () => {
  it('renders the account name, mode, and currency', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradingAccountIndicator
          account={{
            id: 'account-1',
            name: 'My First Account',
            accountMode: 'live',
            baseCurrency: 'USD',
            startingBalance: '10000',
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('My First Account')).toBeInTheDocument();
    expect(screen.getByText('Live · USD')).toBeInTheDocument();
  });

  it('exposes an accessible label identifying it as the active trading account', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradingAccountIndicator
          account={{
            id: 'account-1',
            name: 'Demo Sandbox',
            accountMode: 'demo',
            baseCurrency: 'BTC',
            startingBalance: '1',
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText('Active trading account')).toBeInTheDocument();
    expect(screen.getByText('Demo · BTC')).toBeInTheDocument();
  });
});
