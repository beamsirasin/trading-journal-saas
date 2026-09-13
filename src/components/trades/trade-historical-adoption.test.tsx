import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeHistoricalAdoption } from './trade-historical-adoption';

const actionMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('@/server/actions/trades', () => ({
  adoptHistoricalExitSubtotalAction: (...args: unknown[]) => actionMock(...args),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function trade(overrides: Partial<TradeDetail> = {}): TradeDetail {
  return {
    tradeId: '018f0000-0000-7000-8000-000000000099',
    canAdoptExitSubtotal: true,
    exitSubtotalMinor: '25000',
    tradingAccountBaseCurrency: 'USD',
    ...overrides,
  } as TradeDetail;
}

function renderControl(value: TradeDetail) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeHistoricalAdoption trade={value} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actionMock.mockReset();
  refreshMock.mockReset();
});

describe('persisted historical exit adoption', () => {
  it('stays absent when the accepted read-side contract says adoption is unavailable', () => {
    renderControl(trade({ canAdoptExitSubtotal: false }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses the accepted persisted action and refreshes server state', async () => {
    actionMock.mockResolvedValue({ ok: true, data: {} });
    renderControl(trade());
    fireEvent.click(screen.getByRole('button', { name: 'Use 250.00 USD as final result' }));
    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith({
        tradeId: '018f0000-0000-7000-8000-000000000099',
      }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('reports a server rejection without fabricating a local result', async () => {
    actionMock.mockResolvedValue({ ok: false, error: { code: 'exit_history_not_adoptable' } });
    renderControl(trade());
    fireEvent.click(screen.getByRole('button', { name: 'Use 250.00 USD as final result' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be adopted');
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
