import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeCreateForm } from './trade-create-form';

const createTradeActionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (...args: unknown[]) => createTradeActionMock(...args),
}));

const options = {
  tradingAccounts: [
    {
      tradingAccountId: '018f0000-0000-7000-8000-000000000001',
      name: 'Main USD',
      accountMode: 'live',
      baseCurrency: 'USD',
    },
  ],
  strategies: [
    {
      strategyId: '018f0000-0000-7000-8000-000000000002',
      name: 'Breakout',
      currentVersionNumber: 3,
      setups: [
        { setupId: '018f0000-0000-7000-8000-000000000003', name: 'Retest', sortOrder: 0 },
        { setupId: '018f0000-0000-7000-8000-000000000004', name: 'Momentum', sortOrder: 1 },
      ],
    },
    {
      strategyId: '018f0000-0000-7000-8000-000000000005',
      name: 'Reversal',
      currentVersionNumber: 1,
      setups: [{ setupId: '018f0000-0000-7000-8000-000000000006', name: 'Sweep', sortOrder: 0 }],
    },
  ],
} as const;

function renderForm(customOptions: TradeCreateOptions = options) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeCreateForm options={customOptions} />
    </NextIntlClientProvider>,
  );
}

function continueButton() {
  return screen.getByRole('button', { name: /Continue/ });
}

function reachPlan() {
  fireEvent.click(continueButton());
  fireEvent.change(screen.getByLabelText('Strategy'), {
    target: { value: options.strategies[0].strategyId },
  });
  fireEvent.change(screen.getByLabelText('Setup'), {
    target: { value: options.strategies[0].setups[0].setupId },
  });
  fireEvent.click(continueButton());
}

function fillPlan(target = '') {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('button', { name: 'Long' }));
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Stop'), { target: { value: '90' } });
  if (target !== '')
    fireEvent.change(screen.getByLabelText(/Target/), { target: { value: target } });
}

beforeEach(() => {
  createTradeActionMock.mockReset();
  pushMock.mockReset();
});

describe('TradeCreateForm', () => {
  it('requires an Account when multiple active options prevent automatic selection', () => {
    renderForm({
      ...options,
      tradingAccounts: [
        ...options.tradingAccounts,
        {
          tradingAccountId: '018f0000-0000-7000-8000-000000000009',
          name: 'Second USD',
          accountMode: 'demo',
          baseCurrency: 'USD',
        },
      ],
    });
    fireEvent.click(continueButton());
    expect(screen.getByText('Choose a Trading Account.')).toBeInTheDocument();
    expect(screen.getByLabelText('Trading Account')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders real selector options and requires Strategy and Setup', () => {
    renderForm();
    expect(screen.getByRole('option', { name: /Main USD/ })).toBeInTheDocument();
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    expect(screen.getByText('Choose a Strategy.')).toBeInTheDocument();
    expect(screen.getByText('Choose a Setup.')).toBeInTheDocument();
  });

  it('clears an incompatible Setup when Strategy changes', () => {
    renderForm();
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[0].strategyId },
    });
    fireEvent.change(screen.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[1].setupId },
    });
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[1].strategyId },
    });
    expect(screen.getByLabelText('Setup')).toHaveValue(options.strategies[1].setups[0].setupId);
    expect(screen.queryByRole('option', { name: 'Momentum' })).not.toBeInTheDocument();
  });

  it('preserves blank Target as null and never submits Version IDs', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    reachPlan();
    fillPlan();
    fireEvent.click(continueButton());
    expect(screen.queryByText(/^Target$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradeActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.plannedTarget).toBeNull();
    expect(payload).not.toHaveProperty('strategyVersionId');
    expect(payload).not.toHaveProperty('setupVersionId');
  });

  it('keeps one stable mutationKey across server failures, back navigation, and retry', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    reachPlan();
    fillPlan('130');
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole('button', { name: 'Create Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole('button', { name: 'Create Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(2));
    expect(createTradeActionMock.mock.calls[0]?.[0].mutationKey).toBe(
      createTradeActionMock.mock.calls[1]?.[0].mutationKey,
    );
  });

  it('maps a server field error to Stop and keeps values on the form', async () => {
    createTradeActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'invalid_plan', fieldErrors: { plannedStop: ['invalid_risk_direction'] } },
    });
    renderForm();
    reachPlan();
    fillPlan('130');
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole('button', { name: 'Create Trade' }));
    expect(
      await screen.findByText('The Stop is on the wrong side of Entry for this direction.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Stop')).toHaveValue('90');
    expect(screen.getByLabelText('Stop')).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([false, true])(
    'navigates to the canonical Trade on success (replay=%s)',
    async (alreadyCreated) => {
      createTradeActionMock.mockResolvedValue({
        ok: true,
        data: { tradeId: '018f0000-0000-7000-8000-000000000099', alreadyCreated },
      });
      renderForm();
      reachPlan();
      fillPlan('130');
      fireEvent.click(continueButton());
      fireEvent.click(screen.getByRole('button', { name: 'Create Trade' }));
      await waitFor(() =>
        expect(pushMock).toHaveBeenCalledWith(
          '/app/trades?trade=018f0000-0000-7000-8000-000000000099',
        ),
      );
    },
  );
});
