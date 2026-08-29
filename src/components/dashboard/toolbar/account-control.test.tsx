import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { DashboardAccountControl } from './account-control';

vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

type SetActiveResult = { ok: true } | { ok: false; code: string };
const setActiveTradingAccountAction = vi.fn<(accountId: unknown) => Promise<SetActiveResult>>();
vi.mock('@/server/actions/trading-accounts', () => ({
  setActiveTradingAccountAction: (accountId: unknown) => setActiveTradingAccountAction(accountId),
}));

const assign = vi.fn();

const LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const accounts: readonly ActiveTradingAccountSummary[] = [
  {
    id: LIVE,
    name: 'Live USD',
    accountMode: 'live',
    baseCurrency: 'USD',
    startingBalance: '10000.0000000000',
  },
  {
    id: PROP,
    name: 'Prop challenge',
    accountMode: 'prop',
    baseCurrency: 'USD',
    startingBalance: '100000.0000000000',
  },
];

function filters(overrides: Partial<DashboardFilterState> = {}): DashboardFilterState {
  return {
    datePreset: '90d',
    customDateRange: null,
    accountScope: { kind: 'active' },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    unitMode: 'r',
    dimensions: {
      symbol: null,
      side: null,
      session: null,
      timeframe: null,
      ruleAdherence: null,
      mistake: null,
      emotion: null,
    },
    ...overrides,
  };
}

function renderControl(state: DashboardFilterState = filters(), locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <DashboardAccountControl filters={state} accounts={accounts} activeAccountId={LIVE} />
    </NextIntlClientProvider>,
  );
}

const trigger = () => screen.getByRole('button', { name: /Trading account:/ });

/**
 * Scoped to the panel's own option buttons: the TRIGGER also carries the
 * selected account's name, so an unscoped name query would match both and
 * make "clicked the option" indistinguishable from "clicked the trigger".
 */
const option = (value: string) =>
  document.querySelector<HTMLButtonElement>(`[data-dashboard-account-option="${value}"]`);

async function findOption(value: string): Promise<HTMLButtonElement> {
  await waitFor(() => expect(option(value)).not.toBeNull());
  return option(value) as HTMLButtonElement;
}

beforeEach(() => {
  assign.mockClear();
  setActiveTradingAccountAction.mockClear();
  setActiveTradingAccountAction.mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'location', { writable: true, value: { assign } });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('48rem'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

describe('trigger label', () => {
  it('names the persisted active account when the URL carries no override', () => {
    renderControl();
    expect(trigger()).toHaveTextContent('Live USD');
  });

  it('names the explicit all-accounts scope when the URL carries it', () => {
    renderControl(filters({ accountScope: { kind: 'all' } }));
    expect(trigger()).toHaveTextContent('All accounts');
  });

  it('names an explicit account override from a deep link', () => {
    renderControl(filters({ accountScope: { kind: 'account', accountId: PROP } }));
    expect(trigger()).toHaveTextContent('Prop challenge');
  });

  it('renders Thai copy', () => {
    renderControl(filters({ accountScope: { kind: 'all' } }), 'th');
    expect(screen.getByRole('button', { name: /บัญชีเทรด:/ })).toHaveTextContent('ทุกบัญชี');
  });
});

describe('selecting a named account', () => {
  it('persists it through the existing action and lands on a URL with no account key', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /Prop challenge/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(setActiveTradingAccountAction).toHaveBeenCalledWith(PROP);
    // NO uuid in the Dashboard URL: an omitted key means the trusted
    // persisted active Account.
    expect(assign).toHaveBeenCalledWith('/en/app?range=90d&unit=r');
  });

  it('clears an explicit account override that a deep link had carried in', async () => {
    const user = userEvent.setup();
    renderControl(filters({ accountScope: { kind: 'account', accountId: PROP } }));
    await user.click(trigger());
    await user.click(await findOption(LIVE));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith('/en/app?range=90d&unit=r');
  });

  it('does nothing at all when the account is already the applied one', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await findOption(LIVE));

    expect(setActiveTradingAccountAction).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not navigate when the server action refuses the switch', async () => {
    setActiveTradingAccountAction.mockResolvedValue({ ok: false, code: 'forbidden' });
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /Prop challenge/ }));

    await waitFor(() => expect(setActiveTradingAccountAction).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('selecting All accounts', () => {
  it('is a URL scope override and persists nothing', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /All accounts/ }));

    expect(setActiveTradingAccountAction).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/en/app?range=90d&unit=r&account=all');
  });

  it('preserves the applied Date Range and filters', async () => {
    const user = userEvent.setup();
    renderControl(
      filters({
        datePreset: 'custom',
        customDateRange: { from: '2026-07-10', to: '2026-08-12' },
        strategyId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /All accounts/ }));

    expect(assign).toHaveBeenCalledWith(
      '/en/app?range=custom&unit=r&from=2026-07-10&to=2026-08-12&account=all&strategy=11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('accessibility', () => {
  it('marks the current selection for assistive technology, not by the tick alone', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    expect(await findOption(LIVE)).toHaveAttribute('aria-current', 'true');
    expect(await findOption(PROP)).not.toHaveAttribute('aria-current');
  });
});
