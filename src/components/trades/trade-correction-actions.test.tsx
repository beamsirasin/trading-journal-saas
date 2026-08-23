import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateTradePlanAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { PlanCorrectionDialog } from './trade-correction-actions';

vi.mock('@/server/actions/trades', () => ({
  updateTradePlanAction: vi.fn(),
  correctTradeIdentityAction: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const pricePlan = {
  tradeId: '018f0000-0000-7000-8000-000000000001',
  tradingAccountBaseCurrency: 'USD',
  plannedEntry: '100',
  plannedStop: '90',
  plannedTarget: '130',
  plannedPositionSize: '2',
  plannedRiskMinor: null,
  plannedRewardMinor: null,
  timeframe: 'H1',
  session: 'London',
  confirmationNotes: 'Confirmed',
  confidence: 75,
  tradingviewUrl: 'https://www.tradingview.com/chart/example',
  notes: 'Keep context',
} as TradeDetail;

function renderPlan(trade: TradeDetail) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PlanCorrectionDialog trade={trade} />
    </NextIntlClientProvider>,
  );
}

describe('PlanCorrectionDialog', () => {
  beforeEach(() => {
    vi.mocked(updateTradePlanAction).mockReset();
    vi.mocked(updateTradePlanAction).mockResolvedValue({
      ok: true,
      data: { tradeId: pricePlan.tradeId, plannedR: '2.0000' },
    });
  });

  it('switches Price to Money explicitly, submits no stale Price fields, and leaves context unchanged', async () => {
    const user = userEvent.setup();
    renderPlan(pricePlan);
    await user.click(screen.getByRole('button', { name: 'Edit System Plan' }));

    expect(screen.getByLabelText('Plan by')).toHaveValue('price');
    expect(screen.queryByLabelText('Actual Entry')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Confidence')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Plan by'), 'money');
    expect(screen.queryByLabelText('Entry')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stop Loss')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Risk'), '25');
    await user.type(screen.getByLabelText('Target Reward'), '50');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateTradePlanAction).toHaveBeenCalledTimes(1));
    expect(updateTradePlanAction).toHaveBeenCalledWith({
      tradeId: pricePlan.tradeId,
      systemPlanBasis: 'money',
      plannedEntry: null,
      plannedStop: null,
      plannedTarget: null,
      plannedPositionSize: null,
      plannedRiskMinor: '2500',
      plannedRewardMinor: '5000',
      timeframe: 'H1',
      session: 'London',
      confirmationNotes: 'Confirmed',
      confidence: 75,
      tradingviewUrl: 'https://www.tradingview.com/chart/example',
      notes: 'Keep context',
    });
  });

  it('switches Money to Price without Add Plan controls', async () => {
    const user = userEvent.setup();
    renderPlan({
      ...pricePlan,
      plannedEntry: null,
      plannedStop: null,
      plannedTarget: null,
      plannedPositionSize: null,
      plannedRiskMinor: '2500',
      plannedRewardMinor: '5000',
    });
    await user.click(screen.getByRole('button', { name: 'Edit System Plan' }));
    expect(screen.getByLabelText('Plan by')).toHaveValue('money');
    expect(
      screen.queryByRole('button', { name: /Add (?:Price|Money) Plan/i }),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Plan by'), 'price');
    expect(screen.getByLabelText('Entry')).toBeVisible();
    expect(screen.getByLabelText('Stop Loss')).toBeVisible();
    expect(screen.queryByLabelText('Risk')).not.toBeInTheDocument();
  });
});
