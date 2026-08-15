import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeCreateForm } from './trade-create-form';

const createTradeActionMock = vi.fn();
const uploadChartAttachmentActionMock = vi.fn();
const deleteChartAttachmentActionMock = vi.fn();
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
vi.mock('@/server/actions/chart-attachment', () => ({
  uploadChartAttachmentAction: (...args: unknown[]) => uploadChartAttachmentActionMock(...args),
  deleteChartAttachmentAction: (...args: unknown[]) => deleteChartAttachmentActionMock(...args),
}));

const conditionA = {
  conditionKey: '018f0000-0000-7000-8000-000000000010',
  label: 'Breakout candle closed',
  sortOrder: 0,
} as const;
const conditionB = {
  conditionKey: '018f0000-0000-7000-8000-000000000011',
  label: 'Retest held',
  sortOrder: 1,
} as const;

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
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
        {
          setupId: '018f0000-0000-7000-8000-000000000003',
          name: 'Retest',
          sortOrder: 0,
          conditionSetToken: 'a'.repeat(64),
          conditions: [conditionA, conditionB],
        },
        {
          setupId: '018f0000-0000-7000-8000-000000000004',
          name: 'Momentum',
          sortOrder: 1,
          conditionSetToken: 'b'.repeat(64),
          conditions: [
            {
              conditionKey: '018f0000-0000-7000-8000-000000000012',
              label: 'Momentum expanded',
              sortOrder: 0,
            },
          ],
        },
      ],
    },
    {
      strategyId: '018f0000-0000-7000-8000-000000000005',
      name: 'Reversal',
      currentVersionNumber: 1,
      setups: [
        {
          setupId: '018f0000-0000-7000-8000-000000000006',
          name: 'Sweep',
          sortOrder: 0,
          conditionSetToken: 'c'.repeat(64),
          conditions: [],
        },
      ],
    },
  ],
} as const satisfies TradeCreateOptions;

function renderForm(customOptions: TradeCreateOptions = options) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeCreateForm options={customOptions} />
    </NextIntlClientProvider>,
  );
}

function chooseRetest() {
  fireEvent.change(screen.getByLabelText('Strategy'), {
    target: { value: options.strategies[0].strategyId },
  });
  fireEvent.change(screen.getByLabelText('Setup'), {
    target: { value: options.strategies[0].setups[0].setupId },
  });
}

function fillPricePlan() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('button', { name: 'Long' }));
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Stop'), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText(/Target/), { target: { value: '130' } });
}

function checkAllConditions() {
  fireEvent.click(screen.getByLabelText(conditionA.label));
  fireEvent.click(screen.getByLabelText(conditionB.label));
}

beforeEach(() => {
  createTradeActionMock.mockReset();
  uploadChartAttachmentActionMock.mockReset();
  deleteChartAttachmentActionMock.mockReset();
  deleteChartAttachmentActionMock.mockResolvedValue({ ok: true });
  pushMock.mockReset();
  window.localStorage.clear();
});

describe('TradeCreateForm — Phase 13C single-page entry', () => {
  it('renders all sections together with one Save Trade action and no wizard', () => {
    renderForm();
    expect(screen.getByLabelText('Trading Account')).toBeVisible();
    expect(screen.getByLabelText('Strategy')).toBeVisible();
    expect(screen.getByLabelText('Symbol')).toBeVisible();
    expect(screen.getByText('Setup Conditions')).toBeVisible();
    expect(screen.getAllByText('Confidence').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Entry Reason').length).toBeGreaterThan(0);
    expect(screen.getByText('Chart attachment')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Save Trade' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByText('Review the planned Trade')).not.toBeInTheDocument();
  });

  it('loads Conditions and previews adherence without a 0/0 state', () => {
    renderForm();
    chooseRetest();
    expect(screen.getByText(conditionA.label)).toBeVisible();
    expect(screen.getByText(conditionB.label)).toBeVisible();
    expect(screen.getByText('0/2 met · 0%')).toBeVisible();
    fireEvent.click(screen.getByLabelText(conditionA.label));
    expect(screen.getByText('1/2 met · 50%')).toBeVisible();
  });

  it('derives the required 3/5 and 60% preview from checkbox state', () => {
    const fiveConditions = Array.from({ length: 5 }, (_, index) => ({
      conditionKey: `018f0000-0000-7000-8000-00000000002${index}`,
      label: `Condition ${index + 1}`,
      sortOrder: index,
    }));
    renderForm({
      ...options,
      strategies: [
        {
          ...options.strategies[0],
          setups: [
            {
              ...options.strategies[0].setups[0],
              conditions: fiveConditions,
            },
          ],
        },
      ],
    });
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[0].strategyId },
    });
    for (const label of ['Condition 1', 'Condition 2', 'Condition 3']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect(screen.getByText('3/5 met · 60%')).toBeVisible();
  });

  it('shows zero-Condition N/A and saves directly with an empty answer set', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[1].strategyId },
    });
    expect(screen.getByText('Not configured')).toBeVisible();
    expect(screen.queryByText(/0\/0/)).not.toBeInTheDocument();
    fillPricePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock.mock.calls[0]?.[0]).toMatchObject({
      conditionSetToken: 'c'.repeat(64),
      conditionAnswers: [],
    });
  });

  it('saves all-met Conditions directly using keys and statuses only', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradeActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.conditionSetToken).toBe('a'.repeat(64));
    expect(payload.conditionAnswers).toEqual([
      { conditionKey: conditionA.conditionKey, status: 'met' },
      { conditionKey: conditionB.conditionKey, status: 'met' },
    ]);
    expect(JSON.stringify(payload.conditionAnswers)).not.toContain('label');
    expect(payload).not.toHaveProperty('setupVersionId');
    expect(payload).not.toHaveProperty('strategyVersionId');
  });

  it('still submits a Money-only Plan with optional Entry Reason and Confidence', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    chooseRetest();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'EURUSD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Short' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '100.00' } });
    fireEvent.change(screen.getByLabelText(/Planned reward/), { target: { value: '300.00' } });
    fireEvent.click(screen.getByLabelText(/75%/));
    fireEvent.change(screen.getByLabelText(/Entry Reason/), {
      target: { value: 'Clear confirmation at the level.' },
    });
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock.mock.calls[0]?.[0]).toMatchObject({
      plannedEntry: null,
      plannedStop: null,
      plannedRiskMinor: '10000',
      plannedRewardMinor: '30000',
      confidence: 75,
      confirmationNotes: 'Clear confirmation at the level.',
    });
  });

  it('keeps Price/Money mismatch as a blocking validation error', async () => {
    renderForm();
    chooseRetest();
    fillPricePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50.00' } });
    fireEvent.change(screen.getByLabelText(/Planned reward/), { target: { value: '500.00' } });
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    expect(screen.getAllByText('Price and Money plans disagree').length).toBeGreaterThan(0);
    expect(createTradeActionMock).not.toHaveBeenCalled();
  });

  it('requires confirmation when a Condition is unmet', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    chooseRetest();
    fillPricePlan();
    fireEvent.click(screen.getByLabelText(conditionA.label));
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    expect(createTradeActionMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/1 of 2 Conditions are met \(50%\)/)).toBeVisible();
    expect(within(dialog).getByText(/saved as Not Met/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock.mock.calls[0]?.[0].conditionAnswers).toEqual([
      { conditionKey: conditionA.conditionKey, status: 'met' },
      { conditionKey: conditionB.conditionKey, status: 'not_met' },
    ]);
  });

  it('resets answers when Setup or Strategy changes', () => {
    renderForm();
    chooseRetest();
    fireEvent.click(screen.getByLabelText(conditionA.label));
    fireEvent.change(screen.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[1].setupId },
    });
    fireEvent.change(screen.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[0].setupId },
    });
    expect(screen.getByLabelText(conditionA.label)).not.toBeChecked();
    fireEvent.click(screen.getByLabelText(conditionA.label));
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[1].strategyId },
    });
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[0].strategyId },
    });
    fireEvent.change(screen.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[0].setupId },
    });
    expect(screen.getByLabelText(conditionA.label)).not.toBeChecked();
  });

  it('keeps a stable mutation key across server failure and retry', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm();
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(2));
    expect(createTradeActionMock.mock.calls[0]?.[0].mutationKey).toBe(
      createTradeActionMock.mock.calls[1]?.[0].mutationKey,
    );
  });

  it('keeps values and shows stale-version recovery guidance', async () => {
    createTradeActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'stale_setup_conditions' },
    });
    renderForm();
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    expect(await screen.findByText(/Setup changed while you were entering/)).toBeVisible();
    expect(screen.getByLabelText('Symbol')).toHaveValue('XAUUSD');
  });

  it('navigates to the canonical Trade after success', async () => {
    createTradeActionMock.mockResolvedValue({
      ok: true,
      data: { tradeId: '018f0000-0000-7000-8000-000000000099', alreadyCreated: false },
    });
    renderForm();
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        '/app/trades?trade=018f0000-0000-7000-8000-000000000099',
      ),
    );
  });

  it('blocks Save with an accessible Account error and clears it after a valid selection', async () => {
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
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

    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    expect(createTradeActionMock).not.toHaveBeenCalled();
    const account = screen.getByLabelText('Trading Account');
    expect(account).toHaveAttribute('aria-invalid', 'true');
    expect(account).toHaveAttribute('aria-describedby', 'trade-account-error');
    expect(document.getElementById('trade-account-error')).toHaveTextContent(
      'Choose a Trading Account.',
    );

    fireEvent.change(account, { target: { value: options.tradingAccounts[0].tradingAccountId } });
    expect(account).toHaveAttribute('aria-invalid', 'false');
    expect(account).not.toHaveAttribute('aria-describedby');
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[1].strategyId },
    });
    fillPricePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
  });

  it('presents and clears accessible Strategy and Setup errors on the single page', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));

    const strategy = screen.getByLabelText('Strategy');
    const setup = screen.getByLabelText('Setup');
    expect(strategy).toHaveAttribute('aria-invalid', 'true');
    expect(strategy).toHaveAttribute('aria-describedby', 'trade-strategy-error');
    expect(document.getElementById('trade-strategy-error')).toHaveTextContent('Choose a Strategy.');
    expect(setup).toHaveAttribute('aria-invalid', 'true');
    expect(setup).toHaveAttribute('aria-describedby', 'trade-setup-error');
    expect(document.getElementById('trade-setup-error')).toHaveTextContent('Choose a Setup.');
    expect(createTradeActionMock).not.toHaveBeenCalled();

    fireEvent.change(strategy, { target: { value: options.strategies[0].strategyId } });
    expect(strategy).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('option', { name: 'Retest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Momentum' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    expect(setup).toHaveAttribute('aria-invalid', 'true');
    expect(setup).toHaveAttribute('aria-describedby', 'trade-setup-error');
    expect(document.getElementById('trade-setup-error')).toHaveTextContent('Choose a Setup.');

    fireEvent.change(setup, { target: { value: options.strategies[0].setups[0].setupId } });
    expect(setup).toHaveAttribute('aria-invalid', 'false');
    expect(setup).not.toHaveAttribute('aria-describedby');
  });

  it('maps a server Stop error accessibly while preserving and correcting single-page state', async () => {
    createTradeActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'invalid_plan', fieldErrors: { plannedStop: ['invalid_risk_direction'] } },
    });
    renderForm();
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.change(screen.getByLabelText(/Entry Reason/), {
      target: { value: 'Retest confirmation remained intact.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));

    expect(
      await screen.findByText('The Stop is on the wrong side of Entry for this direction.'),
    ).toBeVisible();
    const stop = screen.getByLabelText('Stop');
    expect(stop).toHaveValue('90');
    expect(stop).toHaveAttribute('aria-invalid', 'true');
    expect(stop).toHaveAttribute('aria-describedby', 'trade-stop-error');
    expect(screen.getByLabelText('Symbol')).toHaveValue('XAUUSD');
    expect(screen.getByLabelText('Entry', { exact: true })).toHaveValue('100');
    expect(screen.getByLabelText(/Target/)).toHaveValue('130');
    expect(screen.getByLabelText(conditionA.label)).toBeChecked();
    expect(screen.getByLabelText(/Entry Reason/)).toHaveValue(
      'Retest confirmation remained intact.',
    );

    fireEvent.change(stop, { target: { value: '85' } });
    expect(stop).toHaveAttribute('aria-invalid', 'false');
    expect(stop).not.toHaveAttribute('aria-describedby');
    expect(screen.getByLabelText('Entry', { exact: true })).toHaveValue('100');
    expect(screen.getByLabelText(/Target/)).toHaveValue('130');
    expect(screen.getByLabelText(conditionB.label)).toBeChecked();
  });

  it('preserves Price and Money values when the Money disclosure is closed and reopened', () => {
    renderForm();
    fillPricePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50.00' } });
    fireEvent.change(screen.getByLabelText(/Planned reward/), { target: { value: '150.00' } });

    fireEvent.click(screen.getByRole('button', { name: 'Hide Money plan' }));
    expect(screen.queryByLabelText('Planned risk')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Entry', { exact: true })).toHaveValue('100');
    expect(screen.getByLabelText('Stop')).toHaveValue('90');
    expect(screen.getByLabelText(/Target/)).toHaveValue('130');

    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    expect(screen.getByLabelText('Planned risk')).toHaveValue('50.00');
    expect(screen.getByLabelText(/Planned reward/)).toHaveValue('150.00');
    expect(screen.getByLabelText('Entry', { exact: true })).toHaveValue('100');
    expect(screen.getByLabelText('Stop')).toHaveValue('90');
  });

  it('shows the live Planned R preview for a complete Price-only plan', () => {
    renderForm();
    fillPricePlan();
    expect(screen.getByText('Planned R: +3.00R')).toBeVisible();
  });

  it('omits Upload UI when chart storage is unconfigured while retaining TradingView URL', () => {
    renderForm({ ...options, chartUploadConfigured: false });
    expect(screen.queryByRole('button', { name: 'Upload image' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload image')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/TradingView URL/)).toBeVisible();
  });

  it('uploads a private chart and submits only its authoritative storage key', async () => {
    uploadChartAttachmentActionMock.mockResolvedValue({
      ok: true,
      data: { storageKey: 'trade-charts/ws/obj.png' },
    });
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm({ ...options, chartUploadConfigured: true });
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));

    const file = new File(['fake-png-bytes'], 'chart.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } });
    const preview = (await screen.findByAltText('Uploaded chart preview')) as HTMLImageElement;
    expect(preview.src).toBe('blob:mock-object-url');
    expect(uploadChartAttachmentActionMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradeActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.chartAttachmentStorageKey).toBe('trade-charts/ws/obj.png');
    expect(payload).not.toHaveProperty('chartAttachmentUrl');
    expect(payload.tradingviewUrl).toBe('');
  });

  it('removes an uploaded chart, clears the payload key, and invokes best-effort deletion', async () => {
    uploadChartAttachmentActionMock.mockResolvedValue({
      ok: true,
      data: { storageKey: 'trade-charts/ws/remove-me.png' },
    });
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm({ ...options, chartUploadConfigured: true });
    chooseRetest();
    fillPricePlan();
    checkAllConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    const file = new File(['fake-webp-bytes'], 'chart.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } });
    await screen.findByAltText('Uploaded chart preview');

    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByAltText('Uploaded chart preview')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Upload image')).toBeInTheDocument();
    expect(deleteChartAttachmentActionMock).toHaveBeenCalledWith('trade-charts/ws/remove-me.png');

    fireEvent.click(screen.getByRole('button', { name: 'Save Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock.mock.calls[0]?.[0].chartAttachmentStorageKey).toBeNull();
  });

  it('persists a Symbol favorite across remounts and scopes it to the Workspace', () => {
    const firstRender = renderForm();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'btcusd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add "BTCUSD" to favorites' }));
    firstRender.unmount();

    const sameWorkspace = renderForm();
    expect(screen.getByRole('button', { name: /^BTCUSD$/ })).toBeInTheDocument();
    sameWorkspace.unmount();

    renderForm({
      ...options,
      workspaceId: '018f0000-0000-7000-8000-0000000000ee',
    });
    expect(screen.queryByRole('button', { name: /^BTCUSD$/ })).not.toBeInTheDocument();
  });
});
