import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeTradeAction, openTradeAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { CloseTradeDialog, OpenTradeDialog } from './trade-execution-actions';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server/actions/trades', () => ({
  openTradeAction: vi.fn(),
  closeTradeAction: vi.fn(),
  correctTradeExecutionAction: vi.fn(),
}));

const base = {
  tradeId: '018f0000-0000-7000-8000-000000000001',
  tradingAccountBaseCurrency: 'JPY',
  plannedEntry: '100',
  plannedStop: '90',
  plannedPositionSize: '2',
  actualResultMode: 'money',
  actualEntry: '101',
  actualInitialStop: '91',
  actualPositionSize: '2',
  actualInitialRiskMinor: '500',
  actualExit: null,
  netPnlMinor: null,
  grossPnlMinor: null,
  commissionMinor: '0',
  feesMinor: '0',
  swapMinor: '0',
  enteredAt: '2026-08-08T01:00:00.000Z',
  exitedAt: null,
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

describe('Trade execution lifecycle dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openTradeAction).mockResolvedValue({
      ok: true,
      data: { tradeId: base.tradeId, status: 'open' },
    });
    vi.mocked(closeTradeAction).mockResolvedValue({
      ok: true,
      data: { tradeId: base.tradeId, status: 'closed', actualR: '-0.2000', traderOutcome: 'loss' },
    });
  });

  it('opens with authoritative risk minor units and no Rule payload', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <OpenTradeDialog trade={{ ...base, status: 'planned' }} timezone="Asia/Bangkok" />,
    );
    await user.click(screen.getByRole('button', { name: 'Open Trade' }));
    await user.selectOptions(screen.getByLabelText('Actual result mode'), 'money');
    await user.type(screen.getByLabelText('Initial risk'), '500');
    await user.click(screen.getByRole('button', { name: 'Open Trade' }));

    await waitFor(() => expect(openTradeAction).toHaveBeenCalledOnce());
    expect(openTradeAction).toHaveBeenCalledWith({
      tradeId: base.tradeId,
      actualResultMode: 'money',
      actualEntry: '100',
      actualInitialStop: '90',
      actualInitialRiskMinor: '500',
      actualPositionSize: '2',
      enteredAt: expect.stringMatching(/Z$/),
    });
    expect(Object.keys(vi.mocked(openTradeAction).mock.calls[0]?.[0] as object)).not.toContain(
      'ruleChecks',
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('closes with authoritative signed net and informational costs without subtracting them', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <CloseTradeDialog trade={{ ...base, status: 'open' }} timezone="Asia/Bangkok" />,
    );
    await user.click(screen.getByRole('button', { name: 'Close Trade' }));
    await user.type(screen.getByLabelText('Exit'), '99');
    await user.type(screen.getByLabelText('Net P&L'), '-100');
    await user.type(screen.getByLabelText('Commission'), '10');
    await user.click(screen.getByRole('button', { name: 'Close Trade' }));

    await waitFor(() => expect(closeTradeAction).toHaveBeenCalledOnce());
    expect(closeTradeAction).toHaveBeenCalledWith({
      tradeId: base.tradeId,
      actualExit: '99',
      netPnlMinor: '-100',
      exitedAt: expect.stringMatching(/Z$/),
      grossPnlMinor: null,
      commissionMinor: '10',
      feesMinor: '0',
      swapMinor: '0',
    });
  });

  it('rejects decimal JPY amounts before calling the server action', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <OpenTradeDialog trade={{ ...base, status: 'planned' }} timezone="Asia/Bangkok" />,
    );
    await user.click(screen.getByRole('button', { name: 'Open Trade' }));
    await user.selectOptions(screen.getByLabelText('Actual result mode'), 'money');
    await user.type(screen.getByLabelText('Initial risk'), '500.5');
    await user.click(screen.getByRole('button', { name: 'Open Trade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/supported precision/);
    expect(openTradeAction).not.toHaveBeenCalled();
  });
});
