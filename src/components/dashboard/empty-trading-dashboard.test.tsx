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
    // The account NAME is a value beside its label, not a section title: it
    // used to be an `<h3>` sitting directly under the page's `<h1>`, which
    // skipped a heading level for a string that titles nothing. The region
    // names itself with `aria-label`, so nothing depended on the heading.
    expect(within(region).getByText('My First Account')).toBeVisible();
    expect(within(region).queryByRole('heading')).not.toBeInTheDocument();
  });

  it("shows the real account's mode, currency and starting balance", () => {
    renderDashboard();
    expect(screen.getByText('Live', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('USD', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('$10,000.00')).toBeInTheDocument();
  });

  /**
   * The stored column is `NUMERIC(20, 10)`, so the value that actually
   * arrives from the database carries ten decimal places. Rendering it raw is
   * what this asserts against; the fixture above uses the shorter `'10000'`
   * and would pass either way.
   */
  it('formats the stored NUMERIC scale rather than printing it raw', () => {
    renderDashboard({ ...ACCOUNT, startingBalance: '10000.0000000000' });
    expect(screen.getByText('$10,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/10000\.0000000000/)).not.toBeInTheDocument();
  });

  it('keeps a non-registry crypto ticker readable and truthful', () => {
    renderDashboard({
      ...ACCOUNT,
      baseCurrency: 'BTC',
      startingBalance: '2.5000000000',
    });
    expect(screen.getByText('2.5 BTC')).toBeInTheDocument();
  });

  /**
   * D4.5 §2, tightened again by the visual refinement pass. The account bar is
   * context, so it is one compact strip on desktop rather than the 173px card
   * it used to be — but "compact" must never mean "fewer facts", which is what
   * this asserts alongside the geometry.
   *
   * Two of the five labels are now `sr-only` beside their chip, so this
   * deliberately asserts PRESENCE rather than visibility: the compaction is
   * allowed to take a caption off the screen, never out of the accessibility
   * tree.
   */
  it('states every account fact on one labelled desktop row', () => {
    const { container } = renderDashboard();
    const region = screen.getByRole('region', { name: 'Active trading account summary' });
    expect(region.className).toContain('sm:flex-row');
    expect(region.className).toContain('sm:items-center');
    // The old three-across grid is what spread three facts over the full page.
    expect(region.className).not.toContain('sm:grid-cols-3');
    expect(container.querySelector('[data-dashboard-region="account-context"]')).toBe(region);

    for (const label of ['Active account', 'Account mode', 'Base currency', 'Starting balance']) {
      expect(within(region).getByText(label)).toBeInTheDocument();
    }
    // Every value is still on screen, whatever happened to its caption.
    for (const value of ['My First Account', 'Live', 'USD', '$10,000.00']) {
      expect(within(region).getByText(value)).toBeVisible();
    }
  });

  it('shows the honest no-trades explanation', () => {
    renderDashboard();
    expect(screen.getByText('No trades recorded yet')).toBeInTheDocument();
    expect(screen.getByText(/log a trade to begin/i)).toBeInTheDocument();
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
    const link = screen.getByRole('link', { name: 'Manage trading accounts' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/app/accounts'));
  });
});
