import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradingAccountRecord } from '@/server/auth/dal';

import en from '../../../messages/en.json';
import { AccountsManager } from './accounts-manager';

const refreshMock = vi.fn();
const archiveTradingAccountActionMock = vi.fn();
const restoreTradingAccountActionMock = vi.fn();
const setActiveTradingAccountActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/server/actions/trading-accounts', () => ({
  archiveTradingAccountAction: (...args: unknown[]) => archiveTradingAccountActionMock(...args),
  restoreTradingAccountAction: (...args: unknown[]) => restoreTradingAccountActionMock(...args),
  setActiveTradingAccountAction: (...args: unknown[]) => setActiveTradingAccountActionMock(...args),
}));

function account(overrides: Partial<TradingAccountRecord>): TradingAccountRecord {
  return {
    id: 'account-1',
    name: 'Main Account',
    brokerName: null,
    platformName: null,
    accountMode: 'live',
    baseCurrency: 'USD',
    startingBalance: '10000',
    timezone: 'Asia/Bangkok',
    riskPerTradePercent: null,
    maximumDailyLossPercent: null,
    isArchived: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function renderManager(props: Partial<Parameters<typeof AccountsManager>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountsManager
        activeAccounts={[account({ id: 'account-1', name: 'Main Account' })]}
        archivedAccounts={[]}
        activeAccountId="account-1"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refreshMock.mockClear();
  archiveTradingAccountActionMock.mockReset();
  restoreTradingAccountActionMock.mockReset();
  setActiveTradingAccountActionMock.mockReset();
});

describe('AccountsManager — active account status', () => {
  it('marks the current active account and hides its Set-active button', () => {
    renderManager();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as active' })).not.toBeInTheDocument();
  });

  it('offers Set-active for a non-active account', () => {
    renderManager({
      activeAccounts: [
        account({ id: 'account-1', name: 'Main Account' }),
        account({ id: 'account-2', name: 'Second Account' }),
      ],
    });
    expect(screen.getByRole('button', { name: 'Set as active' })).toBeInTheDocument();
  });
});

describe('AccountsManager — archive confirmation', () => {
  it('requires confirmation before archiving — clicking Archive does not call the action directly', () => {
    renderManager({
      activeAccounts: [
        account({ id: 'account-1', name: 'Main Account' }),
        account({ id: 'account-2', name: 'Second Account' }),
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement);
    expect(archiveTradingAccountActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('shows the account name in the confirmation dialog', () => {
    renderManager({
      activeAccounts: [
        account({ id: 'account-1', name: 'Main Account' }),
        account({ id: 'account-2', name: 'Second Account' }),
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Archive Main Account?');
  });

  it('cancel closes the dialog without archiving', () => {
    renderManager({
      activeAccounts: [
        account({ id: 'account-1', name: 'Main Account' }),
        account({ id: 'account-2', name: 'Second Account' }),
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(archiveTradingAccountActionMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('confirming archive calls the action and refreshes', async () => {
    archiveTradingAccountActionMock.mockResolvedValue({ ok: true });
    renderManager({
      activeAccounts: [
        account({ id: 'account-1', name: 'Main Account' }),
        account({ id: 'account-2', name: 'Second Account' }),
      ],
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Archive account' }));

    await waitFor(() => expect(archiveTradingAccountActionMock).toHaveBeenCalledWith('account-1'));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(await screen.findByText('Account archived.')).toBeInTheDocument();
  });

  it('shows the localized final-account error when archiving is rejected', async () => {
    archiveTradingAccountActionMock.mockResolvedValue({ ok: false, code: 'last_account' });
    renderManager({
      activeAccounts: [account({ id: 'account-1', name: 'Main Account' })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive account' }));

    expect(
      await screen.findByText(
        'You cannot archive your last trading account. Create another trading account first.',
      ),
    ).toBeInTheDocument();
  });
});

describe('AccountsManager — archived section', () => {
  it('shows "no archived accounts" when there are none', () => {
    renderManager({ archivedAccounts: [] });
    expect(screen.getByText('No archived accounts.')).toBeInTheDocument();
  });

  it('lists an archived account with a Restore action and no Edit/Set-active action', () => {
    renderManager({
      activeAccounts: [],
      archivedAccounts: [account({ id: 'account-2', name: 'Old Account', isArchived: true })],
    });
    expect(screen.getByText('Old Account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set as active' })).not.toBeInTheDocument();
  });

  it('restoring calls the action and shows a localized success message', async () => {
    restoreTradingAccountActionMock.mockResolvedValue({ ok: true });
    renderManager({
      archivedAccounts: [account({ id: 'account-2', name: 'Old Account', isArchived: true })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(restoreTradingAccountActionMock).toHaveBeenCalledWith('account-2'));
    expect(await screen.findByText('Account restored.')).toBeInTheDocument();
  });
});

describe('AccountsManager — set active', () => {
  it('activating a non-active account calls the action and shows a localized success message', async () => {
    setActiveTradingAccountActionMock.mockResolvedValue({ ok: true });
    renderManager({
      activeAccounts: [
        account({ id: 'account-1', name: 'Main Account' }),
        account({ id: 'account-2', name: 'Second Account' }),
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set as active' }));

    await waitFor(() =>
      expect(setActiveTradingAccountActionMock).toHaveBeenCalledWith('account-2'),
    );
    expect(await screen.findByText('Active account changed.')).toBeInTheDocument();
  });
});

describe('AccountsManager — initial feedback from a redirect', () => {
  it('shows the localized message for the status carried by the URL', () => {
    renderManager({ initialFeedback: 'created' });
    expect(screen.getByRole('status')).toHaveTextContent('Account created.');
  });
});
