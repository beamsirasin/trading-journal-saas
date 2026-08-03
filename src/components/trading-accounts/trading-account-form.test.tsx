import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradingAccountForm, type TradingAccountFormValues } from './trading-account-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const createTradingAccountActionMock = vi.fn();
const updateTradingAccountActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/server/actions/trading-accounts', () => ({
  createTradingAccountAction: (...args: unknown[]) => createTradingAccountActionMock(...args),
  updateTradingAccountAction: (...args: unknown[]) => updateTradingAccountActionMock(...args),
}));

const CREATE_INITIAL_VALUES: TradingAccountFormValues = {
  name: '',
  brokerName: '',
  platformName: '',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '',
  timezone: 'Asia/Bangkok',
  riskPerTradePercent: '1',
  maximumDailyLossPercent: '3',
};

const EDIT_INITIAL_VALUES: TradingAccountFormValues = {
  name: 'Existing Account',
  brokerName: 'Interactive Brokers',
  platformName: 'TWS',
  accountMode: 'demo',
  baseCurrency: 'EUR',
  startingBalance: '5000',
  timezone: 'Asia/Bangkok',
  riskPerTradePercent: '2',
  maximumDailyLossPercent: '5',
};

function renderCreateForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradingAccountForm mode="create" initialValues={CREATE_INITIAL_VALUES} />
    </NextIntlClientProvider>,
  );
}

function renderEditForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradingAccountForm mode="edit" accountId="account-1" initialValues={EDIT_INITIAL_VALUES} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  pushMock.mockClear();
  refreshMock.mockClear();
  createTradingAccountActionMock.mockReset();
  updateTradingAccountActionMock.mockReset();
});

describe('TradingAccountForm — create mode', () => {
  it('renders every account field', () => {
    renderCreateForm();
    expect(screen.getByLabelText('Trading account name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Broker/)).toBeInTheDocument();
    expect(screen.getByLabelText('Base currency')).toBeInTheDocument();
    expect(screen.getByLabelText('Starting balance')).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Set as active account' })).toBeInTheDocument();
  });

  it('blocks submission and shows an error when the name is empty', async () => {
    renderCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Enter a trading account name.')).toBeInTheDocument();
    expect(createTradingAccountActionMock).not.toHaveBeenCalled();
  });

  it('submits a valid form with a generated UUID mutation key and the setActive flag', async () => {
    createTradingAccountActionMock.mockResolvedValue({ ok: true, accountId: 'new-account' });
    renderCreateForm();

    fireEvent.change(screen.getByLabelText('Trading account name'), {
      target: { value: 'Second Account' },
    });
    fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set as active account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(createTradingAccountActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradingAccountActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: 'Second Account',
      startingBalance: '2500',
      setActive: true,
    });
    expect(typeof payload.mutationKey).toBe('string');
    expect(payload.mutationKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(payload).not.toHaveProperty('workspaceId');
  });

  it('redirects to /app/accounts?status=created on success', async () => {
    createTradingAccountActionMock.mockResolvedValue({ ok: true, accountId: 'new-account' });
    renderCreateForm();

    fireEvent.change(screen.getByLabelText('Trading account name'), {
      target: { value: 'Second Account' },
    });
    fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/accounts?status=created'));
  });

  it('prevents a double submission from calling the action twice while pending', async () => {
    let resolveAction: (value: { ok: true; accountId: string }) => void = () => {};
    createTradingAccountActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderCreateForm();

    fireEvent.change(screen.getByLabelText('Trading account name'), {
      target: { value: 'Second Account' },
    });
    fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '2500' } });

    const submitButton = screen.getByRole('button', { name: 'Create account' });
    fireEvent.click(submitButton);
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);

    expect(createTradingAccountActionMock).toHaveBeenCalledTimes(1);
    resolveAction({ ok: true, accountId: 'new-account' });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('shows a localized message and does not redirect on a validation-error result', async () => {
    createTradingAccountActionMock.mockResolvedValue({ ok: false, code: 'validation' });
    renderCreateForm();

    fireEvent.change(screen.getByLabelText('Trading account name'), {
      target: { value: 'Second Account' },
    });
    fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Some details are not valid. Please check the form and try again.'),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe('TradingAccountForm — edit mode', () => {
  it('pre-fills every field from the existing account', () => {
    renderEditForm();
    expect(screen.getByLabelText('Trading account name')).toHaveValue('Existing Account');
    expect(screen.getByLabelText(/Broker/)).toHaveValue('Interactive Brokers');
    expect(screen.getByLabelText('Starting balance')).toHaveValue('5000');
  });

  it('does not offer a "set as active" checkbox', () => {
    renderEditForm();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('submits the accountId and the edited fields, never a mutation key', async () => {
    updateTradingAccountActionMock.mockResolvedValue({ ok: true });
    renderEditForm();

    fireEvent.change(screen.getByLabelText('Trading account name'), {
      target: { value: 'Renamed Account' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateTradingAccountActionMock).toHaveBeenCalledTimes(1));
    const [accountId, payload] = updateTradingAccountActionMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(accountId).toBe('account-1');
    expect(payload.name).toBe('Renamed Account');
    expect(payload).not.toHaveProperty('mutationKey');
    expect(payload).not.toHaveProperty('setActive');
  });

  it('redirects to /app/accounts?status=updated on success', async () => {
    updateTradingAccountActionMock.mockResolvedValue({ ok: true });
    renderEditForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/accounts?status=updated'));
  });

  it('disables the Save button while the update is pending', async () => {
    let resolveAction: (value: { ok: true }) => void = () => {};
    updateTradingAccountActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderEditForm();

    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);

    expect(updateTradingAccountActionMock).toHaveBeenCalledTimes(1);
    resolveAction({ ok: true });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('shows a localized "not found" message for a not_found result', async () => {
    updateTradingAccountActionMock.mockResolvedValue({ ok: false, code: 'not_found' });
    renderEditForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This trading account could not be found.')).toBeInTheDocument();
  });
});
