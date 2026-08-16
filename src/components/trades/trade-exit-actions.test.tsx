import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addTradeExitAction,
  closeRemainingTradeAction,
  correctTradeExitAction,
} from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { AddExitDialog, CorrectExitDialog } from './trade-exit-actions';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server/actions/trades', () => ({
  addTradeExitAction: vi.fn(),
  closeRemainingTradeAction: vi.fn(),
  correctTradeExitAction: vi.fn(),
}));

const exit = {
  exitId: '018f0000-0000-7000-8000-000000000002',
  sequence: 1,
  closedBps: 2_500,
  exitPrice: '120.0000000000',
  realizedPnlMinor: null,
  exitReason: 'First target',
  exitedAt: '2026-08-08T03:00:00.000Z',
};

const base = {
  tradeId: '018f0000-0000-7000-8000-000000000001',
  status: 'open',
  actualResultMode: 'price',
  tradingAccountBaseCurrency: 'USD',
  actualEntry: '100.0000000000',
  actualInitialStop: '90.0000000000',
  actualInitialRiskMinor: null,
  exits: [],
  closedBps: 0,
  remainingBps: 10_000,
  realizedRToDate: null,
} as unknown as TradeDetail;

function renderWithMessages(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Trade Exit dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addTradeExitAction).mockResolvedValue({
      ok: true,
      data: {
        tradeId: base.tradeId,
        exitId: exit.exitId,
        status: 'open',
        closedBps: 2_500,
        remainingBps: 7_500,
        realizedR: '0.5000',
        actualR: null,
        traderOutcome: null,
      },
    });
    vi.mocked(closeRemainingTradeAction).mockResolvedValue({
      ok: true,
      data: {
        tradeId: base.tradeId,
        exitId: exit.exitId,
        status: 'closed',
        closedBps: 10_000,
        remainingBps: 0,
        realizedR: '3.5000',
        actualR: '3.5000',
        traderOutcome: 'win',
      },
    });
    vi.mocked(correctTradeExitAction).mockResolvedValue({
      ok: true,
      data: {
        tradeId: base.tradeId,
        exitId: exit.exitId,
        status: 'open',
        closedBps: 5_000,
        remainingBps: 5_000,
        realizedR: '1.0000',
        actualR: null,
        traderOutcome: null,
      },
    });
  });

  it('maps an exact friendly percentage to basis points for a Price partial close', async () => {
    const user = userEvent.setup();
    renderWithMessages(<AddExitDialog trade={base} timezone="Asia/Bangkok" />);
    await user.click(screen.getByRole('button', { name: 'Partial Close' }));
    await user.clear(screen.getByLabelText('Closed'));
    await user.type(screen.getByLabelText('Closed'), '25.25');
    await user.type(screen.getByLabelText('Exit'), '120');
    await user.type(screen.getByLabelText('Exit reason'), 'First target');
    await user.click(screen.getByRole('button', { name: 'Partial Close' }));

    await waitFor(() => expect(addTradeExitAction).toHaveBeenCalledOnce());
    expect(addTradeExitAction).toHaveBeenCalledWith({
      tradeId: base.tradeId,
      mutationKey: expect.any(String),
      actualResultMode: 'price',
      closedBps: 2_525,
      exitPrice: '120',
      realizedPnlMinor: null,
      exitReason: 'First target',
      exitedAt: expect.stringMatching(/Z$/),
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('uses the server-authoritative remainder and signed Money P&L for Close Remaining', async () => {
    const user = userEvent.setup();
    const trade = {
      ...base,
      actualResultMode: 'money',
      actualInitialRiskMinor: '10000',
      exits: [{ ...exit, realizedPnlMinor: '10000' }],
      closedBps: 7_500,
      remainingBps: 2_500,
    } as unknown as TradeDetail;
    renderWithMessages(<AddExitDialog trade={trade} timezone="Asia/Bangkok" closeRemaining />);
    await user.click(screen.getByRole('button', { name: 'Close Remaining' }));
    expect(screen.getByText('Closing the exact remaining 25%.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Realized net P&L'), '-150');
    await user.click(screen.getByRole('button', { name: 'Close Remaining' }));

    await waitFor(() => expect(closeRemainingTradeAction).toHaveBeenCalledOnce());
    expect(closeRemainingTradeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: base.tradeId,
        actualResultMode: 'money',
        realizedPnlMinor: '-15000',
      }),
    );
    expect(vi.mocked(closeRemainingTradeAction).mock.calls[0]?.[0]).not.toHaveProperty('closedBps');
  });

  it('corrects any Exit with its exact basis points and preserved mode', async () => {
    const user = userEvent.setup();
    const trade = { ...base, exits: [exit], closedBps: 2_500, remainingBps: 7_500 } as TradeDetail;
    renderWithMessages(<CorrectExitDialog trade={trade} exit={exit} timezone="Asia/Bangkok" />);
    await user.click(screen.getByRole('button', { name: 'Correct Exit' }));
    await user.clear(screen.getByLabelText('Closed'));
    await user.type(screen.getByLabelText('Closed'), '50');
    await user.click(screen.getByRole('button', { name: 'Correct Exit' }));

    await waitFor(() => expect(correctTradeExitAction).toHaveBeenCalledOnce());
    expect(correctTradeExitAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: base.tradeId,
        exitId: exit.exitId,
        actualResultMode: 'price',
        closedBps: 5_000,
      }),
    );
  });

  it('rejects percentages that cannot map to integer basis points', async () => {
    const user = userEvent.setup();
    renderWithMessages(<AddExitDialog trade={base} timezone="Asia/Bangkok" />);
    await user.click(screen.getByRole('button', { name: 'Partial Close' }));
    await user.clear(screen.getByLabelText('Closed'));
    await user.type(screen.getByLabelText('Closed'), '25.125');
    await user.type(screen.getByLabelText('Exit'), '120');
    await user.click(screen.getByRole('button', { name: 'Partial Close' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/decimal places/);
    expect(addTradeExitAction).not.toHaveBeenCalled();
  });
});
