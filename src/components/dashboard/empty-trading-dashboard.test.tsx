import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ActiveTradingAccountSummary } from '@/server/auth/dal';

import en from '../../../messages/en.json';
import { EmptyTradingDashboard, NoActiveTradingAccountRecovery } from './empty-trading-dashboard';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ACCOUNT: ActiveTradingAccountSummary = {
  id: 'a-1',
  name: 'My First Account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
};

function renderDashboard(account: ActiveTradingAccountSummary = ACCOUNT) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EmptyTradingDashboard account={account} />
    </NextIntlClientProvider>,
  );
}

/**
 * The dashboard must show only what onboarding actually recorded — never a
 * fabricated P&L, win rate, or chart, which is exactly what `DemoDashboard`
 * shows instead. These assertions are structural (no KPI-card hook, no
 * Recharts wrapper) rather than a page-text regex, because explanatory copy
 * is allowed to mention "win rate" in a sentence that says none exists yet.
 */
describe('EmptyTradingDashboard', () => {
  it('exposes the active account inside a named, uniquely identifiable region', () => {
    renderDashboard();
    const region = screen.getByRole('region', { name: 'Active trading account summary' });
    expect(within(region).getByRole('heading', { name: 'My First Account' })).toBeInTheDocument();
  });

  it("shows the real account's mode, currency and starting balance", () => {
    renderDashboard();
    expect(screen.getByText('Live', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('USD', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('10000 USD')).toBeInTheDocument();
  });

  it('shows the honest no-trades explanation', () => {
    renderDashboard();
    expect(screen.getByText('No trades recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/trade journaling is coming/i)).toBeInTheDocument();
  });

  it('renders no KPI/metric cards', () => {
    const { container } = renderDashboard();
    expect(container.querySelectorAll('[data-kpi]')).toHaveLength(0);
  });

  it('renders no chart', () => {
    // `.recharts-wrapper` is the library's own marker — it, not "any svg", is
    // what distinguishes an actual chart from the plain decorative icon this
    // empty state uses.
    const { container } = renderDashboard();
    expect(container.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
  });

  it('never renders a fabricated numeric P&L or percentage figure', () => {
    const { container } = renderDashboard();
    // The only figures on this page are the account's own starting balance
    // and (elsewhere) risk percentages entered during onboarding — never an
    // invented result. There is no percentage sign at all on this page: mode,
    // currency and starting balance carry none.
    expect(container.textContent).not.toMatch(/%/);
  });
});

describe('NoActiveTradingAccountRecovery', () => {
  it('offers a real link back into onboarding rather than a dead end', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NoActiveTradingAccountRecovery />
      </NextIntlClientProvider>,
    );
    const link = screen.getByRole('link', { name: 'Set up a trading account' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/app/onboarding'));
  });
});
