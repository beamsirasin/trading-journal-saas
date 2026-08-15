import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  uploadChartAttachmentActionMock.mockReset();
  deleteChartAttachmentActionMock.mockReset();
  deleteChartAttachmentActionMock.mockResolvedValue({ ok: true });
  pushMock.mockReset();
  window.localStorage.clear();
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
    expect(payload.plannedRiskMinor).toBeNull();
    expect(payload.plannedRewardMinor).toBeNull();
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

describe('TradeCreateForm — clickable stepper', () => {
  it('renders every future step disabled before its prerequisites are met', () => {
    // The single Trading Account auto-fills stage 0, so Strategy & Setup
    // (stage 1) is immediately reachable — only steps beyond the first
    // unmet prerequisite (Plan, Review) stay disabled.
    renderForm();
    expect(screen.getByRole('button', { name: /Strategy & Setup/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /^Plan/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Review & Create/ })).toBeDisabled();
  });

  it('rejects a direct forward click to Plan before Strategy/Setup are chosen', () => {
    renderForm();
    // The single Trading Account pre-fills stage 0, but stage 1
    // (Strategy/Setup) is still empty — Plan must stay unreachable.
    const planStepButton = screen.getByRole('button', { name: /^Plan/ });
    expect(planStepButton).toBeDisabled();
    fireEvent.click(planStepButton);
    expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();
  });

  it('allows a direct forward click once prerequisites are satisfied, and allows a direct backward click preserving state', () => {
    renderForm();
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[0].strategyId },
    });
    fireEvent.change(screen.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[0].setupId },
    });
    fireEvent.click(continueButton());
    fillPlan('130');

    // Jump straight back to the Account step via the stepper (not Back).
    fireEvent.click(screen.getByRole('button', { name: /^Account/ }));
    expect(screen.getByLabelText('Trading Account')).toBeInTheDocument();

    // Jump forward again directly to Plan (now reachable) — Symbol/Direction/Entry/Stop survive.
    fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    expect(screen.getByLabelText('Symbol')).toHaveValue('XAUUSD');
    expect(screen.getByRole('button', { name: 'Long' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Entry')).toHaveValue('100');
  });

  it('marks the current step and passed-through steps distinctly', () => {
    renderForm();
    fireEvent.click(continueButton());
    const accountStep = screen.getByRole('button', { name: /^Account/ });
    const strategyStep = screen.getByRole('button', { name: /^Strategy & Setup/ });
    expect(accountStep).not.toBeDisabled();
    expect(strategyStep).toHaveAttribute('aria-current', 'step');
  });

  it('blocks jumping directly to Review while the live Price/Money Planned R disagree', () => {
    renderForm();
    reachPlan();
    fillPlan('130'); // Price plan implies +3R
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Planned reward/), { target: { value: '500' } }); // Money implies +10R
    fireEvent.click(screen.getByRole('button', { name: /^Review & Create/ }));
    expect(
      screen.queryByRole('heading', { name: 'Review the planned Trade' }),
    ).not.toBeInTheDocument();
  });
});

describe('TradeCreateForm — Long/Short direction', () => {
  it('gives Long and Short distinguishable selected/unselected states beyond color alone (text + aria-pressed)', () => {
    renderForm();
    reachPlan();
    const long = screen.getByRole('button', { name: 'Long' });
    const short = screen.getByRole('button', { name: 'Short' });
    expect(long).toHaveAttribute('aria-pressed', 'false');
    expect(short).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(long);
    expect(long).toHaveAttribute('aria-pressed', 'true');
    expect(short).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(short);
    expect(long).toHaveAttribute('aria-pressed', 'false');
    expect(short).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('TradeCreateForm — Price/Money progressive disclosure', () => {
  it('shows the Price plan open and the Money plan collapsed behind an "Add" action by default', () => {
    renderForm();
    reachPlan();
    expect(screen.getByLabelText('Entry')).toBeInTheDocument();
    expect(screen.queryByLabelText('Planned risk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a Money plan' })).toBeInTheDocument();
  });

  it('accepts a Money-only Plan (Price left closed and empty) and reaches Review', () => {
    renderForm();
    reachPlan();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'eurusd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Long' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50' } });
    fireEvent.click(continueButton());
    expect(screen.getByRole('heading', { name: 'Review the planned Trade' })).toBeInTheDocument();
    expect(screen.queryByText('Entry')).not.toBeInTheDocument();
  });

  it('preserves Price values when the Money section is opened and closed again', () => {
    renderForm();
    reachPlan();
    fillPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide Money plan' }));
    expect(screen.queryByLabelText('Planned risk')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    expect(screen.getByLabelText('Planned risk')).toHaveValue('50');
    expect(screen.getByLabelText('Entry')).toHaveValue('100');
  });

  it('shows a live Planned R preview once a single representation is complete', () => {
    renderForm();
    reachPlan();
    fillPlan('130');
    expect(screen.getByText('Planned R: +3.00R')).toBeInTheDocument();
  });

  it('shows a disagreement banner and blocks Continue when Price and Money imply different Planned R', () => {
    renderForm();
    reachPlan();
    fillPlan('130'); // +3R
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Planned reward/), { target: { value: '500' } }); // +10R
    expect(screen.getByText('Price and Money plans disagree')).toBeInTheDocument();
    fireEvent.click(continueButton());
    expect(
      screen.getByText('Price and Money plans disagree — adjust one before continuing.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Review the planned Trade' }),
    ).not.toBeInTheDocument();
  });

  it('allows Price and Money together when they agree within tolerance', () => {
    renderForm();
    reachPlan();
    fillPlan('130'); // +3R
    fireEvent.click(screen.getByRole('button', { name: 'Add a Money plan' }));
    fireEvent.change(screen.getByLabelText('Planned risk'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Planned reward/), { target: { value: '150' } }); // +3R
    expect(screen.queryByText('Price and Money plans disagree')).not.toBeInTheDocument();
    fireEvent.click(continueButton());
    expect(screen.getByRole('heading', { name: 'Review the planned Trade' })).toBeInTheDocument();
  });
});

describe('TradeCreateForm — Confidence (five-step selector)', () => {
  it('renders a five-step segmented group and moves by keyboard', () => {
    renderForm();
    reachPlan();
    const group = screen.getByRole('group', { name: 'Confidence' });
    for (const name of [
      '0% · Very Low',
      '25% · Low',
      '50% · Neutral',
      '75% · High',
      '100% · Very High',
    ]) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    fireEvent.keyDown(group, { key: 'End' });
    expect(screen.getByText('100% · Very High')).toBeInTheDocument();
  });

  it('selects a step by clicking it directly', () => {
    renderForm();
    reachPlan();
    fireEvent.click(screen.getByRole('radio', { name: '75% · High' }));
    expect(screen.getByRole('radio', { name: '75% · High' })).toBeChecked();
    expect(screen.getByText('75% · High')).toBeInTheDocument();
  });
});

describe('TradeCreateForm — Review & Create summary', () => {
  it('shows Confidence as "Not set" when omitted, and "X% · Label" once chosen', () => {
    renderForm();
    reachPlan();
    fillPlan('130');
    fireEvent.click(continueButton());
    expect(screen.getByText('Not set')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    fireEvent.click(screen.getByRole('radio', { name: '25% · Low' }));
    fireEvent.click(continueButton());
    expect(screen.getByText('25% · Low')).toBeInTheDocument();
    expect(screen.queryByText(/25\/100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/5\b/)).not.toBeInTheDocument();
  });

  it('shows Chart attachment status truthfully — "Not provided" then "Link provided"', () => {
    renderForm();
    reachPlan();
    fillPlan('130');
    fireEvent.click(continueButton());
    expect(screen.getByText('Not provided')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Plan/ }));
    fireEvent.change(screen.getByLabelText(/TradingView URL/), {
      target: { value: 'https://www.tradingview.com/chart/abc' },
    });
    fireEvent.click(continueButton());
    expect(screen.getByText('Link provided')).toBeInTheDocument();
    expect(screen.queryByText('Not provided')).not.toBeInTheDocument();
  });
});

describe('TradeCreateForm — Chart upload capability', () => {
  it('hides the Upload option entirely when chart storage is not configured', () => {
    renderForm({ ...options, chartUploadConfigured: false });
    reachPlan();
    expect(screen.queryByRole('button', { name: 'Upload image' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/TradingView URL/)).toBeInTheDocument();
  });

  it('shows the Upload option and uploads a valid image when storage is configured', async () => {
    uploadChartAttachmentActionMock.mockResolvedValue({
      ok: true,
      data: { storageKey: 'trade-charts/ws/obj.png' },
    });
    createTradeActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderForm({ ...options, chartUploadConfigured: true });
    reachPlan();
    fillPlan('130');
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));

    const file = new File(['fake-bytes'], 'chart.png', { type: 'image/png' });
    const input = screen.getByLabelText('Upload image') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // The preview is a LOCAL object-URL of the selected file, never a
    // remote URL — the uploaded Blob is private (Founder review).
    const preview = (await screen.findByAltText('Uploaded chart preview')) as HTMLImageElement;
    expect(preview.src).toBe('blob:mock-object-url');
    expect(uploadChartAttachmentActionMock).toHaveBeenCalledTimes(1);

    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole('button', { name: 'Create Trade' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradeActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.chartAttachmentStorageKey).toBe('trade-charts/ws/obj.png');
    expect('chartAttachmentUrl' in payload).toBe(false);
  });

  it('lets the user remove an uploaded image before creating the Trade, and best-effort deletes it from storage', async () => {
    uploadChartAttachmentActionMock.mockResolvedValue({
      ok: true,
      data: { storageKey: 'trade-charts/ws/obj.png' },
    });
    renderForm({ ...options, chartUploadConfigured: true });
    reachPlan();
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    const file = new File(['fake-bytes'], 'chart.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } });
    await screen.findByAltText('Uploaded chart preview');

    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByAltText('Uploaded chart preview')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Upload image')).toBeInTheDocument();
    expect(deleteChartAttachmentActionMock).toHaveBeenCalledWith('trade-charts/ws/obj.png');
  });
});

describe('TradeCreateForm — Symbol favorites (localStorage)', () => {
  it('adds a typed Symbol to favorites and it survives a remount (workspace-scoped persistence)', () => {
    const { unmount } = renderForm();
    reachPlan();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'btcusd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add "BTCUSD" to favorites' }));
    unmount();

    renderForm();
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText('Strategy'), {
      target: { value: options.strategies[0].strategyId },
    });
    fireEvent.change(screen.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[0].setupId },
    });
    fireEvent.click(continueButton());
    expect(screen.getByRole('button', { name: 'BTCUSD' })).toBeInTheDocument();
  });
});
