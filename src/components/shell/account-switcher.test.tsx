import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveTradingAccountSummary } from '@/server/auth/dal';

import en from '../../../messages/en.json';
import { AccountSwitcher } from './account-switcher';

const refreshMock = vi.fn();
const setActiveTradingAccountActionMock = vi.fn();

/**
 * Accepts `ref` as a plain prop (React 19 no longer requires `forwardRef`
 * for that) and spreads the rest — role, tabIndex, the collection
 * data-attribute — onto the rendered `<a>`. Radix's `Slot` (from
 * `DropdownMenuItem asChild`) merges all of that onto its child; a mock
 * that dropped it left the roving-focus collection holding a null ref,
 * crashing when the menu tried to focus its first item.
 */
function MockLink({
  href,
  children,
  ref,
  ...rest
}: { href: string; children?: ReactNode; ref?: Ref<HTMLAnchorElement> } & Record<string, unknown>) {
  return (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  );
}

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
  Link: MockLink,
}));

vi.mock('@/server/actions/trading-accounts', () => ({
  setActiveTradingAccountAction: (...args: unknown[]) => setActiveTradingAccountActionMock(...args),
}));

const MAIN: ActiveTradingAccountSummary = {
  id: 'account-1',
  name: 'Main Account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
};
const SECONDARY: ActiveTradingAccountSummary = {
  id: 'account-2',
  name: 'Secondary Account',
  accountMode: 'demo',
  baseCurrency: 'EUR',
  startingBalance: '5000',
};

function renderSwitcher(props: Partial<Parameters<typeof AccountSwitcher>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountSwitcher
        activeAccount={MAIN}
        accounts={[MAIN, SECONDARY]}
        canCreateAccount={true}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refreshMock.mockClear();
  setActiveTradingAccountActionMock.mockReset();
});

describe('AccountSwitcher — rendering', () => {
  it('shows the current active account on the trigger', () => {
    renderSwitcher();
    expect(screen.getByRole('button', { name: 'Switch trading account' })).toBeInTheDocument();
  });

  it('lists every account and marks the current one when opened', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));

    const mainItem = await screen.findByRole('menuitem', { name: /Main Account/ });
    const secondaryItem = screen.getByRole('menuitem', { name: /Secondary Account/ });
    expect(mainItem).toHaveAttribute('aria-current', 'true');
    expect(secondaryItem).not.toHaveAttribute('aria-current');
  });

  it('excludes archived accounts — only what it is given is what it shows', async () => {
    // The switcher never receives archived accounts at all
    // (`listSwitchableTradingAccounts` filters them out server-side); this
    // asserts the component itself renders exactly its `accounts` prop and
    // nothing else, which is the contract that guarantee depends on.
    const user = userEvent.setup();
    renderSwitcher({ accounts: [MAIN] });
    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));

    await screen.findByRole('menuitem', { name: /Main Account/ });
    expect(screen.queryByRole('menuitem', { name: /Secondary Account/ })).not.toBeInTheDocument();
  });

  it('includes a Manage accounts link and a Create account link', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));

    expect(await screen.findByRole('menuitem', { name: /Manage accounts/ })).toHaveAttribute(
      'href',
      '/app/accounts',
    );
    expect(screen.getByRole('menuitem', { name: /Create account/ })).toHaveAttribute(
      'href',
      '/app/accounts/new',
    );
  });
});

describe('AccountSwitcher — keyboard behavior', () => {
  it('opens via the keyboard and reaches every item by tabbing through', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch trading account' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('menuitem', { name: /Main Account/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Secondary Account/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Manage accounts/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Create account/ })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});

describe('AccountSwitcher — switching', () => {
  it('selecting a different account calls the action and refreshes rather than navigating', async () => {
    setActiveTradingAccountActionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));
    await user.click(await screen.findByRole('menuitem', { name: /Secondary Account/ }));

    await waitFor(() =>
      expect(setActiveTradingAccountActionMock).toHaveBeenCalledWith('account-2'),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('closes the menu after a successful selection', async () => {
    setActiveTradingAccountActionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));
    await user.click(await screen.findByRole('menuitem', { name: /Secondary Account/ }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('selecting the already-active account is a no-op — no action call', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Switch trading account' }));
    await user.click(await screen.findByRole('menuitem', { name: /Main Account/ }));

    expect(setActiveTradingAccountActionMock).not.toHaveBeenCalled();
  });
});
