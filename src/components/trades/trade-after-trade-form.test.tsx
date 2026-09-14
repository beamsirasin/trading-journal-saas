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

const withStrategy = {
  ...options,
  strategies: [
    {
      strategyId: '018f0000-0000-7000-8000-000000000010',
      name: 'Golden Breakout',
      currentVersionNumber: 1,
      setups: [
        {
          setupId: '018f0000-0000-7000-8000-000000000020',
          name: 'Clean Retest',
          sortOrder: 0,
          conditionSetToken: 'condition-set-token',
          conditions: [{ conditionKey: 'retest', label: 'Retest held', sortOrder: 0 }],
        },
      ],
    },
  ],
} as const satisfies TradeCreateOptions;

function renderForm(formOptions: TradeCreateOptions = options) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeRecordingForm options={formOptions} timing="after_trade" timezone="Asia/Bangkok" />
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

  it('clears the previous basis’s Actual values when the result basis changes', async () => {
    renderForm();
    fillIdentity();
    fireEvent.change(screen.getByLabelText(/Final net P&L/), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText(/Actual risk at entry/), { target: { value: '200' } });
    openExits();
    addExit({ amount: '150', percent: '100' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Record the result with price levels instead' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    // A realized P&L of 150 must never be submitted as an exit price of 150.
    expect(payload()).toMatchObject({
      actualResultBasis: 'price',
      finalPnlMinor: null,
      actualInitialRiskMinor: null,
      exits: [{ closedBps: 10_000, exitPrice: null, realizedPnlMinor: null }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record the result as an amount instead' }));
    expect(screen.getByLabelText(/Final net P&L/)).toHaveValue('');
    expect(screen.getByLabelText(/Actual risk at entry/)).toHaveValue('');
  });

  it('clears plan values when the plan basis changes', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Planned risk/), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use price levels instead' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use amounts instead' }));
    expect(screen.getByLabelText(/Planned risk/)).toHaveValue('');
  });

  it('previews a Price result only once every exit carries what saving needs', () => {
    renderForm();
    fillIdentity();
    fireEvent.click(
      screen.getByRole('button', { name: 'Record the result with price levels instead' }),
    );
    fireEvent.change(screen.getByLabelText(/Actual Entry/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Actual Initial Stop/), { target: { value: '90' } });
    openExits();
    fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
    fireEvent.change(screen.getByLabelText(/Exit Price/), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/Closed %/), { target: { value: '100' } });
    const summary = () => document.querySelector('[data-result-summary]');
    // The service derives no Price result while any exit lacks its time.
    expect(summary()).not.toHaveTextContent('+2.00R');
    expect(summary()).toHaveTextContent('Not recorded');
    fireEvent.change(screen.getByLabelText(/Exit time/), { target: { value: '2026-09-01T14:15' } });
    expect(summary()).toHaveTextContent('+2.00R');
    expect(summary()).toHaveTextContent('Win');
  });

  it('offers the closing exit’s time and states a disagreement without blocking Save', async () => {
    renderForm();
    fillIdentity();
    openExits();
    fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
    fireEvent.change(screen.getByLabelText(/What did this exit close\?/), {
      target: { value: 'part' },
    });
    fireEvent.change(screen.getByLabelText(/Exit time/), { target: { value: '2026-09-01T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // A partial leg's time is a mid-trade timestamp, never offered as the final one.
    expect(
      screen.queryByRole('button', { name: /your exit that closed the position/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Record an exit' }));
    fireEvent.change(screen.getByLabelText(/What did this exit close\?/), {
      target: { value: 'all_remaining' },
    });
    fireEvent.change(screen.getByLabelText(/Exit time/), { target: { value: '2026-09-01T14:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByRole('button', { name: /your exit that closed the position/ }));
    expect(screen.getByLabelText(/Final exit time/)).toHaveValue('2026-09-01T14:15');
    expect(
      screen.queryByRole('button', { name: /your exit that closed the position/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-exit-time-mismatch]')).toBeNull();

    fireEvent.change(screen.getByLabelText(/Final exit time/), {
      target: { value: '2026-09-01T15:00' },
    });
    expect(document.querySelector('[data-exit-time-mismatch]')).toHaveTextContent('are different');
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
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

describe('production After Trade recording — shared Add Trade composition', () => {
  it('uses the At Entry task-surface language: account as context, compact plan, no basis radios', () => {
    renderForm();
    expect(document.querySelector('[data-account-context]')).toHaveTextContent('Main USD · USD');
    expect(screen.queryByLabelText('Trading Account')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Plan recorded by' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Actual result by' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use price levels instead' })).toBeVisible();
    // Strategy, Setup, timeframe and session live in the Trade idea, not on the page.
    expect(screen.queryByLabelText(/^Strategy/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Timeframe')).not.toBeInTheDocument();
    // The plan is subordinate; the final result is the one large figure.
    expect(screen.getByLabelText('Planned risk').className).toContain('text-base');
    expect(screen.getByLabelText('Final net P&L').className).toContain('text-[1.375rem]');
  });

  it('keeps reconstruction collapsed and lightweight until asked for', () => {
    renderForm();
    const toggle = screen.getByRole('button', { name: 'Add exit details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Record an exit' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide exit details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('carries Strategy / Setup provenance through the Trade idea, in retrospective wording', async () => {
    renderForm(withStrategy);
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Trade idea/ }));
    const idea = within(screen.getByRole('dialog'));
    expect(idea.getByText('Were you following a strategy?')).toBeVisible();
    fireEvent.change(idea.getByLabelText('Strategy'), {
      target: { value: withStrategy.strategies[0].strategyId },
    });
    fireEvent.change(idea.getByLabelText('Setup'), {
      target: { value: withStrategy.strategies[0].setups[0].setupId },
    });
    fireEvent.click(idea.getByLabelText('Retest held'));
    fireEvent.change(idea.getByLabelText('Timeframe'), { target: { value: 'H4' } });
    fireEvent.click(idea.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Trade idea/ })).toHaveTextContent(
      'Golden Breakout · Clean Retest',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      strategyId: withStrategy.strategies[0].strategyId,
      setupId: withStrategy.strategies[0].setups[0].setupId,
      conditionSetToken: 'condition-set-token',
      conditionAnswers: [{ conditionKey: 'retest', status: 'met' }],
      timeframe: 'H4',
    });
  });

  it('uses the same five confidence choices with the hindsight hint', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    const group = within(
      within(screen.getByRole('dialog')).getByRole('group', { name: 'Confidence' }),
    );
    expect(group.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      '0',
      '25',
      '50',
      '75',
      '100',
    ]);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'answer as the you who had not seen it yet',
    );
    fireEvent.click(group.getByRole('radio', { name: 'Low' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ confidence: 25 });
    expect(payload()).not.toHaveProperty('emotionKeys');
  });

  it('records "None of these" as an explicit empty answer, distinct from never answering', async () => {
    renderForm();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'None of these' }),
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Feelings at entry/ })).toHaveTextContent(
      'None of these',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ emotionKeys: [] });
  });

  it('withdraws the "check the highlighted fields" banner once nothing is highlighted', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    fillIdentity();
    expect(screen.getByRole('status')).not.toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
  });
});
