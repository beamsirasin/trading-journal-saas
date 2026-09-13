import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateCompletedTradeSchema } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeRecordingForm } from './trade-recording-form';

const createCompletedTradeActionMock = vi.fn();
const createTradeActionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeRecordingForm options={options} timing="after_trade" timezone="Asia/Bangkok" />
    </NextIntlClientProvider>,
  );
}

function fillIdentity() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
}

function openExits() {
  fireEvent.click(screen.getByRole('button', { name: 'Add exit details' }));
}

function addExit({ amount = '', percent = '' }: { amount?: string; percent?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
  const value = screen.getAllByLabelText(/Realized P&L/).at(-1);
  const allocation = screen.getAllByLabelText(/Closed %/).at(-1);
  if (amount !== '' && value) fireEvent.change(value, { target: { value: amount } });
  if (percent !== '' && allocation) fireEvent.change(allocation, { target: { value: percent } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}

function payload() {
  return createCompletedTradeActionMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  createCompletedTradeActionMock.mockReset();
  createCompletedTradeActionMock.mockResolvedValue({
    ok: true,
    data: { tradeId: '018f0000-0000-7000-8000-000000000099' },
  });
  createTradeActionMock.mockReset();
  pushMock.mockReset();
});

describe('production After Trade recording', () => {
  it('renders one linear Record journey without the obsolete panel navigation', () => {
    renderForm();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['The trade', 'Plan at entry', 'Actual Result', 'Journal at entry']);
    expect(
      screen.queryByRole('navigation', { name: 'New Trade sections' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-after-trade-linear-form]')).not.toBeNull();
  });

  it('starts both historical timestamps blank and optional', () => {
    renderForm();
    expect(screen.getByLabelText(/Entry time/)).toHaveValue('');
    expect(screen.getByLabelText(/Final exit time/)).toHaveValue('');
  });

  it('waits for a Save attempt before showing required identity errors', () => {
    renderForm();
    expect(screen.queryByText('Enter a symbol.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    expect(screen.getByText('Enter a symbol.')).toBeVisible();
    expect(screen.getByText('Choose Long or Short.')).toBeVisible();
  });

  it('permits unknown timestamps, plan, risk, final result and exits', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      enteredAt: null,
      exitedAt: null,
      systemPlanBasis: null,
      actualInitialRiskMinor: null,
      finalPnlMinor: null,
      exits: [],
    });
  });

  it('derives a known outcome from P&L without fabricating Actual R', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Final net P&L/), { target: { value: '400' } });
    const summary = document.querySelector('[data-result-summary]');
    expect(summary).toHaveTextContent('Win');
    expect(summary).toHaveTextContent('Unavailable');
    expect(summary).toHaveTextContent('Actual R needs a recorded actual risk');
  });

  it('derives Actual R only after actual risk is known', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Final net P&L/), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText(/Actual risk at entry/), { target: { value: '200' } });
    expect(document.querySelector('[data-result-summary]')).toHaveTextContent('+2.00R');
  });

  it('renders zero exits as an honest empty state', () => {
    renderForm();
    openExits();
    expect(screen.getByText(/No exits recorded/)).toBeVisible();
    expect(document.querySelector('[data-reconciliation]')).toBeNull();
  });

  it('adds the first sparse exit without requiring allocation or time', () => {
    renderForm();
    openExits();
    addExit({ amount: '100' });
    expect(screen.getByRole('button', { name: /Exit 1/ })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Is this the complete exit history?' })).toBeVisible();
  });

  it('supports multiple reconstructed exits', () => {
    renderForm();
    openExits();
    addExit({ amount: '100' });
    addExit({ amount: '150' });
    expect(screen.getByRole('button', { name: /Exit 1/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Exit 2/ })).toBeVisible();
  });

  it('starts recorded history at explicit unsure completeness', () => {
    renderForm();
    openExits();
    addExit({ amount: '100', percent: '100' });
    expect(screen.getByRole('radio', { name: /not sure/, checked: true })).toBeVisible();
  });

  it('lets the trader explicitly declare an incomplete history', () => {
    renderForm();
    openExits();
    addExit({ amount: '100' });
    fireEvent.click(screen.getByRole('radio', { name: 'Some exits are missing' }));
    expect(screen.getByRole('radio', { name: 'Some exits are missing' })).toBeChecked();
    expect(document.querySelector('[data-reconciliation="unreconciled"]')).not.toBeNull();
  });

  it('lets the trader explicitly declare a complete history', () => {
    renderForm();
    openExits();
    addExit({ amount: '100' });
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByRole('radio', { name: 'These are all the exits' })).toBeChecked();
  });

  it('does not infer complete from 100% allocation', () => {
    renderForm();
    openExits();
    addExit({ amount: '100', percent: '100' });
    expect(screen.getByRole('radio', { name: /not sure/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'These are all the exits' })).not.toBeChecked();
  });

  it('keeps a manual final authoritative beside an incomplete subtotal', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Final net P&L/), { target: { value: '400' } });
    openExits();
    addExit({ amount: '100' });
    addExit({ amount: '150' });
    fireEvent.click(screen.getByRole('radio', { name: 'Some exits are missing' }));
    const status = document.querySelector('[data-reconciliation="unreconciled"]');
    expect(status).toHaveTextContent('+250.00 USD');
    expect(status).toHaveTextContent('+400.00 USD');
  });

  it('derives a matched complete reconstruction', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Final net P&L/), { target: { value: '250' } });
    openExits();
    addExit({ amount: '100' });
    addExit({ amount: '150' });
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(document.querySelector('[data-reconciliation="matched"]')).toHaveTextContent(
      'matches the final result',
    );
  });

  it('shows a complete conflict without choosing either figure', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Final net P&L/), { target: { value: '400' } });
    openExits();
    addExit({ amount: '100' });
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    const status = document.querySelector('[data-reconciliation="conflict"]');
    expect(status).toHaveTextContent('+100.00 USD');
    expect(status).toHaveTextContent('+400.00 USD');
  });

  it('keeps complete priced exits with no final saveable and defers adoption', async () => {
    renderForm();
    fillIdentity();
    openExits();
    addExit({ amount: '100', percent: '25' });
    addExit({ amount: '150', percent: '75' });
    fireEvent.click(screen.getByRole('radio', { name: 'These are all the exits' }));
    expect(screen.getByText(/After saving, you can explicitly use this subtotal/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Use .* as final result/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ finalPnlMinor: null, exitHistoryCompleteness: 'complete' });
    expect(CreateCompletedTradeSchema.safeParse(payload()).success).toBe(true);
  });

  it('uses retrospective Trade idea wording and persists it only after Done', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Trade idea/ }));
    expect(screen.getByLabelText('Why did you take this trade?')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Why did you take this trade?'), {
      target: { value: 'Breakout from the range' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ confirmationNotes: 'Breakout from the range' });
  });

  it('keeps Journal optional and has no pre-save Review write path', () => {
    renderForm();
    expect(screen.getByRole('heading', { name: 'Journal at entry' })).toBeVisible();
    expect(screen.queryByText('Reflection')).not.toBeInTheDocument();
    expect(screen.queryByText('System assessment')).not.toBeInTheDocument();
  });

  it('records recalled feelings independently from the result', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ emotionKeys: ['calm'] });
  });

  it('navigates a successful Save directly to the persisted Review tab', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        '/app/trades?trade=018f0000-0000-7000-8000-000000000099&tab=review',
      ),
    );
  });

  it('keeps the local exit action in charge while an exit editor is active', () => {
    renderForm();
    openExits();
    fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
    expect(document.querySelector('[data-exit-editor]')).not.toBeNull();
    expect(document.querySelector('[data-global-save]')).toHaveClass('hidden');
  });

  it('keeps the At Entry form on the other branch', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeRecordingForm options={options} timing="at_entry" timezone="Asia/Bangkok" />
      </NextIntlClientProvider>,
    );
    expect(document.querySelector('[data-at-entry-linear-form]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save open trade' })).toBeVisible();
    expect(document.querySelector('[data-after-trade-linear-form]')).toBeNull();
  });
});
