import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { TradeRecordingForm } from './trade-recording-form';

const createTradeActionMock = vi.fn();
const createCompletedTradeActionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (...args: unknown[]) => createTradeActionMock(...args),
  createCompletedTradeAction: (...args: unknown[]) => createCompletedTradeActionMock(...args),
}));

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  emotionCatalog: [
    { key: 'calm', label: 'Calm' },
    { key: 'focused', label: 'Focused' },
  ],
  tradingAccounts: [
    {
      tradingAccountId: '018f0000-0000-7000-8000-000000000001',
      name: 'Main USD',
      accountMode: 'live',
      baseCurrency: 'USD',
    },
  ],
  strategies: [],
} as const satisfies TradeCreateOptions;

function renderForm(locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <TradeRecordingForm options={options} timezone="Asia/Bangkok" />
    </NextIntlClientProvider>,
  );
}

function fillIdentityAndPricePlan() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('button', { name: 'Long' }));
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '90' } });
}

function chooseAfterTrade() {
  fireEvent.click(screen.getByRole('button', { name: 'After Trade' }));
  fillIdentityAndPricePlan();
  fireEvent.change(screen.getByLabelText('Exited At'), {
    target: { value: '2026-08-23T12:00' },
  });
  fireEvent.change(screen.getByLabelText('Entered At'), {
    target: { value: '2026-08-23T10:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Result' }));
}

beforeEach(() => {
  createTradeActionMock.mockReset();
  createCompletedTradeActionMock.mockReset();
  pushMock.mockReset();
});

describe('TradeRecordingForm — Phase 15G.5D recording UX', () => {
  it('defaults to At Entry and renders only one short panel at a time with the CTA always reachable', () => {
    renderForm();

    expect(screen.getByRole('heading', { name: 'When are you journaling?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'At Entry' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Symbol')).toBeVisible();
    expect(screen.queryByText('Actual Result')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Trade' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Setup' }));
    expect(screen.getByLabelText(/^Strategy/)).toBeVisible();
    expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Trade' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Entry Context' }));
    expect(screen.getByText('Confidence', { selector: 'label' })).toBeVisible();
    expect(screen.queryByLabelText(/^Strategy/)).not.toBeInTheDocument();
  });

  it('keeps System Plan and Actual Result basis independent in After Trade', () => {
    renderForm();
    chooseAfterTrade();

    expect(screen.getByText('Actual Result')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Price' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actual result by' })).getByRole('button', {
        name: 'Money',
      }),
    );
    expect(screen.getByLabelText('Initial Risk')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
    expect(screen.getByLabelText('Entry')).toHaveValue('100');
    expect(screen.getByLabelText('Stop Loss')).toHaveValue('90');
  });

  it('opens an At Entry Trade in one canonical action without normal-layer Actual overrides', async () => {
    createTradeActionMock.mockResolvedValue({
      ok: true,
      data: { tradeId: '018f0000-0000-7000-8000-000000000099', alreadyCreated: false },
    });
    renderForm();
    fillIdentityAndPricePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Open Trade' }));

    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradeActionMock.mock.calls[0]![0];
    expect(payload).toMatchObject({
      recordingTiming: 'at_entry',
      systemPlanBasis: 'price',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(payload).not.toHaveProperty('actualResultMode');
    expect(payload).not.toHaveProperty('actualEntry');
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=018f0000-0000-7000-8000-000000000099');
  });

  it('saves a simple Price Actual as one 100% exit with Pending System outcome', async () => {
    createCompletedTradeActionMock.mockResolvedValue({
      ok: true,
      data: {
        tradeId: '018f0000-0000-7000-8000-000000000088',
        alreadyCreated: false,
        status: 'closed',
        actualR: '2.0000',
        traderOutcome: 'win',
        systemStatus: 'pending',
        systemR: null,
        systemOutcome: null,
        recordedRetrospectively: true,
      },
    });
    renderForm();
    chooseAfterTrade();
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Actual Initial Stop'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Exit Price'), { target: { value: '120' } });

    expect(screen.getByText('+2.00R')).toBeVisible();
    expect(screen.getByText('Win')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock).not.toHaveBeenCalled();
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
      recordingTiming: 'after_trade',
      systemPlanBasis: 'price',
      actualResultBasis: 'price',
      actualEntry: '100',
      actualInitialStop: '90',
      exits: [{ closedBps: 10_000, exitPrice: '120' }],
    });
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).not.toHaveProperty('systemResult');
  });

  it('supports a Price Plan with Money Actual without double weighting P&L', async () => {
    createCompletedTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
    renderForm();
    chooseAfterTrade();
    fireEvent.click(screen.getByRole('button', { name: 'Money' }));
    fireEvent.change(screen.getByLabelText('Initial Risk'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Realized P&L'), { target: { value: '14' } });

    expect(screen.getByText('+1.40R')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
      systemPlanBasis: 'price',
      actualResultBasis: 'money',
      actualInitialRiskMinor: '1000',
      exits: [{ closedBps: 10_000, realizedPnlMinor: '1400' }],
    });
  });

  it.each(['price', 'money'] as const)(
    'supports a Money Plan with %s Actual',
    async (resultBasis) => {
      createCompletedTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
      renderForm();
      fireEvent.click(screen.getByRole('button', { name: 'After Trade' }));
      fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'eurusd' } });
      fireEvent.click(screen.getByRole('button', { name: 'Short' }));
      fireEvent.change(screen.getByLabelText('Entered At'), {
        target: { value: '2026-08-23T10:00' },
      });
      fireEvent.change(screen.getByLabelText('Exited At'), {
        target: { value: '2026-08-23T12:00' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Money' }));
      fireEvent.change(screen.getByLabelText('Risk'), { target: { value: '20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Result' }));

      if (resultBasis === 'price') {
        fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '1.1' } });
        fireEvent.change(screen.getByLabelText('Actual Initial Stop'), {
          target: { value: '1.2' },
        });
        fireEvent.change(screen.getByLabelText('Exit Price'), { target: { value: '1.0' } });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Money' }));
        fireEvent.change(screen.getByLabelText('Initial Risk'), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText('Realized P&L'), { target: { value: '-5' } });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

      await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
      expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
        systemPlanBasis: 'money',
        plannedRiskMinor: '2000',
        actualResultBasis: resultBasis,
      });
    },
  );

  it('keeps explicit cross-basis At Entry execution inside Advanced only', async () => {
    createTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
    renderForm();
    fillIdentityAndPricePlan();
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByLabelText('Actual opening differs from the System Plan'));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actual opening by' })).getByRole('button', {
        name: 'Money',
      }),
    );
    fireEvent.change(screen.getByLabelText('Initial Risk'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Trade' }));

    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock.mock.calls[0]![0]).toMatchObject({
      systemPlanBasis: 'price',
      actualResultMode: 'money',
      actualInitialRiskMinor: '2500',
    });
  });

  it('maps expanded partial exits to canonical bps only when coverage totals 100%', async () => {
    createCompletedTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
    renderForm();
    chooseAfterTrade();
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Actual Initial Stop'), { target: { value: '90' } });
    fireEvent.click(screen.getByLabelText('Partial exits'));
    const exitPrices = screen.getAllByLabelText('Exit Price');
    fireEvent.change(exitPrices[0]!, { target: { value: '110' } });
    fireEvent.change(exitPrices[1]!, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
      exits: [
        { closedBps: 5000, exitPrice: '110' },
        { closedBps: 5000, exitPrice: '120' },
      ],
    });
  });

  it('disables the Target preset until the selected System Plan has a target', () => {
    renderForm();
    chooseAfterTrade();

    const systemOutcome = screen.getByRole('combobox', { name: 'System Outcome' });
    expect(systemOutcome).toHaveValue('pending');
    expect(screen.getByRole('option', { name: 'Target reached' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Trade' }));
    fireEvent.change(screen.getByLabelText(/^Take Profit/), { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Result' }));
    expect(screen.getByRole('option', { name: 'Target reached' })).toBeEnabled();
  });

  it('clears timing-specific Actual and System fields when switching back to At Entry', () => {
    renderForm();
    chooseAfterTrade();
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '101' } });
    fireEvent.change(screen.getByLabelText('Actual Initial Stop'), { target: { value: '91' } });
    fireEvent.change(screen.getByLabelText('Exit Price'), { target: { value: '111' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'System Outcome' }), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByLabelText('System Exit Price'), { target: { value: '115' } });

    fireEvent.click(screen.getByRole('button', { name: 'At Entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'After Trade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Result' }));

    expect(screen.getByLabelText('Actual Entry')).toHaveValue('');
    expect(screen.getByLabelText('Exit Price')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'System Outcome' })).toHaveValue('pending');
  });

  it('renders the frozen Thai timing and result terminology', () => {
    renderForm('th');
    expect(screen.getByRole('heading', { name: 'คุณกำลังบันทึกเทรดนี้เมื่อไร?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'ตอนเข้าเทรด' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'หลังจบเทรด' }));
    fireEvent.click(screen.getByRole('button', { name: 'ผลลัพธ์' }));
    expect(screen.getByText('ผลลัพธ์จริง')).toBeVisible();
    expect(screen.getByText('คำนวณผลจริงจาก')).toBeVisible();
    expect(screen.getByRole('button', { name: 'บันทึกเทรดที่จบแล้ว' })).toBeVisible();
  });
});
