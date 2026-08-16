import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { markSystemNoTradeAction, resolveSystemTradeAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import {
  CorrectSystemDialog,
  MarkSystemNoTradeDialog,
  ResolveSystemDialog,
} from './trade-system-actions';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server/actions/trades', () => ({
  resolveSystemTradeAction: vi.fn(),
  markSystemNoTradeAction: vi.fn(),
  correctSystemResolutionAction: vi.fn(),
}));

const tradeId = '018f0000-0000-7000-8000-000000000001';
const base = {
  tradeId,
  systemStatus: 'pending',
  systemResolutionKind: null,
  systemExitPrice: null,
  systemGrossRInput: null,
  systemExitedAt: null,
  systemExitReason: null,
  systemCostR: '0.0000',
  plannedEntry: '100.0000',
  plannedStop: '90.0000',
  plannedR: null,
} as TradeDetail;

function renderWithMessages(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('System result lifecycle controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSystemTradeAction).mockResolvedValue({
      ok: true,
      data: { tradeId, systemStatus: 'resolved', systemR: '2.0000', systemOutcome: 'win' },
    });
    vi.mocked(markSystemNoTradeAction).mockResolvedValue({
      ok: true,
      data: { tradeId, systemStatus: 'no_trade' },
    });
  });

  it('resolves Pending with primitives and never offers setup_invalidated', async () => {
    const user = userEvent.setup();
    renderWithMessages(<ResolveSystemDialog trade={base} timezone="Asia/Bangkok" />);
    await user.click(screen.getByRole('button', { name: 'Resolve System result' }));
    await user.type(screen.getByLabelText('System exit price'), '120');
    const reason = screen.getByLabelText('Reason') as HTMLSelectElement;
    expect(Array.from(reason.options).map((option) => option.value)).not.toContain(
      'setup_invalidated',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm resolved result' }));
    await waitFor(() =>
      expect(resolveSystemTradeAction).toHaveBeenCalledWith({
        tradeId,
        resolutionKind: 'price_exit',
        systemExitPrice: '120',
        systemExitedAt: expect.stringMatching(/Z$/),
        systemExitReason: 'target_hit',
        systemCostR: '0',
      }),
    );
  });

  it('confirms no_trade independently of actual execution', async () => {
    const user = userEvent.setup();
    renderWithMessages(<MarkSystemNoTradeDialog tradeId={tradeId} />);
    await user.click(screen.getByRole('button', { name: 'Mark no trade' }));
    expect(screen.getByText(/actual execution remains unchanged/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm no trade' }));
    await waitFor(() => expect(markSystemNoTradeAction).toHaveBeenCalledWith({ tradeId }));
  });

  it('uses the Money-only Target flow with a gross/cost/final preview and no exit price', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <ResolveSystemDialog
        trade={{
          ...base,
          plannedEntry: null,
          plannedStop: null,
          plannedRiskMinor: '10',
          plannedRewardMinor: '50',
          plannedR: '5.0000',
        }}
        timezone="Asia/Bangkok"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Resolve System result' }));
    expect(screen.queryByLabelText('System exit price')).not.toBeInTheDocument();
    expect(screen.getAllByText('5.0000R')).toHaveLength(2);
    const cost = screen.getByLabelText('System Cost R');
    await user.clear(cost);
    await user.type(cost, '0.10');
    expect(screen.getByText('4.9000R')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm resolved result' }));
    await waitFor(() =>
      expect(resolveSystemTradeAction).toHaveBeenCalledWith({
        tradeId,
        resolutionKind: 'money_target',
        systemExitedAt: expect.stringMatching(/Z$/),
        systemCostR: '0.10',
      }),
    );
  });

  it('labels Custom as gross System R and does not default it to zero', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <ResolveSystemDialog
        trade={{
          ...base,
          plannedEntry: null,
          plannedStop: null,
          plannedRiskMinor: '10',
          plannedRewardMinor: null,
          plannedR: null,
        }}
        timezone="Asia/Bangkok"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Resolve System result' }));
    await user.selectOptions(screen.getByLabelText('System result'), 'money_custom');
    expect(screen.getByLabelText('Gross System R')).toHaveValue('');
    expect(screen.getByText(/not Actual R/i)).toBeInTheDocument();
  });

  it('offers terminal correction targets only, never Pending', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <CorrectSystemDialog trade={{ ...base, systemStatus: 'no_trade' }} timezone="Asia/Bangkok" />,
    );
    await user.click(screen.getByRole('button', { name: 'Correct System result' }));
    const target = screen.getByLabelText('Corrected result') as HTMLSelectElement;
    expect(Array.from(target.options).map((option) => option.value)).toEqual([
      'resolved',
      'no_trade',
    ]);
  });
});
