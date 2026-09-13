import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_FAVORITES_STATE,
  favoritesStorageKey,
  recordRecent,
  serializeFavoritesState,
} from '@/lib/trades/local-favorites';
import { CreateTradeSchema } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { TradeRecordingForm } from './trade-recording-form';

const createTradeActionMock = vi.fn();
const createCompletedTradeActionMock = vi.fn();
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

const USD = {
  tradingAccountId: '018f0000-0000-7000-8000-000000000001',
  name: 'Main USD',
  accountMode: 'live',
  baseCurrency: 'USD',
} as const;
const THB = {
  tradingAccountId: '018f0000-0000-7000-8000-000000000002',
  name: 'Prop THB',
  accountMode: 'live',
  baseCurrency: 'THB',
} as const;

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  emotionCatalog: [
    { key: 'calm', label: 'Calm' },
    { key: 'fomo', label: 'FOMO' },
  ],
  tradingAccounts: [USD],
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
          conditions: [
            { conditionKey: 'retest', label: 'Retest held', sortOrder: 0 },
            { conditionKey: 'volume', label: 'Volume expanded', sortOrder: 1 },
          ],
        },
      ],
    },
  ],
} as const satisfies TradeCreateOptions;

function renderForm({
  locale = 'en',
  formOptions = options,
  activeTradingAccountId = null,
}: {
  locale?: 'en' | 'th';
  formOptions?: TradeCreateOptions;
  activeTradingAccountId?: string | null;
} = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <TradeRecordingForm
        options={formOptions}
        timing="at_entry"
        activeTradingAccountId={activeTradingAccountId}
        timezone="Asia/Bangkok"
      />
    </NextIntlClientProvider>,
  );
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save open trade' }));
const dialog = () => screen.getByRole('dialog');

function fillShortPath({ risk = '200' }: { risk?: string } = {}) {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
  fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: risk } });
}

function payload() {
  return createTradeActionMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

function alerts() {
  return screen.queryAllByRole('alert').map((alert) => alert.textContent);
}

beforeEach(() => {
  window.localStorage.clear();
  createTradeActionMock.mockReset();
  createTradeActionMock.mockResolvedValue({
    ok: true,
    data: { tradeId: '018f0000-0000-7000-8000-000000000099', alreadyCreated: false },
  });
  createCompletedTradeActionMock.mockReset();
  pushMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('production At Entry recording — composition', () => {
  it('renders one task surface, then the optional journal, then Save', () => {
    renderForm();
    expect(document.querySelector('[data-at-entry-linear-form]')).not.toBeNull();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['The trade', 'Plan at entry', 'Journal at entry']);
    expect(screen.getByRole('region', { name: 'Journal at entry' })).toHaveTextContent(
      'Now or later',
    );
    expect(screen.getByRole('button', { name: 'Save open trade' })).toBeEnabled();
  });

  it('no longer renders the tabbed editor, and keeps Strategy out of the main surface', () => {
    renderForm();
    expect(
      screen.queryByRole('navigation', { name: 'New Trade sections' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-trade-view-nav')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Trade' })).not.toBeInTheDocument();
    // Strategy, Setup, timeframe and session describe the trade inside Trade idea.
    expect(screen.queryByLabelText(/^Strategy/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Timeframe')).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
  });

  it('has no lifecycle parts that belong to After Trade, and claims no exit plan', () => {
    renderForm();
    expect(screen.queryByText('Actual Result')).not.toBeInTheDocument();
    expect(screen.queryByText('Exit reconstruction')).not.toBeInTheDocument();
    expect(screen.queryByText('Reflection')).not.toBeInTheDocument();
    expect(screen.queryByText(/Exit plan/)).not.toBeInTheDocument();
    expect(screen.queryByText('No fixed target')).not.toBeInTheDocument();
  });

  it('opens quietly: nothing is flagged before a Save attempt', () => {
    renderForm();
    expect(alerts()).toEqual([]);
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  });
});

describe('production At Entry recording — The trade', () => {
  it('shows a single account as context, not as a decision', () => {
    renderForm();
    const context = document.querySelector('[data-account-context]');
    expect(context).toHaveTextContent('Main USD · USD');
    expect(screen.queryByLabelText('Trading Account')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change account' })).not.toBeInTheDocument();
  });

  it('seeds the active Account and keeps the real select one Change away', async () => {
    renderForm({
      formOptions: { ...options, tradingAccounts: [USD, THB] },
      activeTradingAccountId: THB.tradingAccountId,
    });
    expect(document.querySelector('[data-account-context]')).toHaveTextContent('Prop THB · THB');
    expect(document.querySelector('#entry-risk-currency')).toHaveTextContent('THB');

    fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
    const account = screen.getByLabelText('Trading Account');
    expect(account.tagName).toBe('SELECT');
    expect(account).toHaveValue(THB.tradingAccountId);
    fireEvent.change(account, { target: { value: USD.tradingAccountId } });
    expect(document.querySelector('#entry-risk-currency')).toHaveTextContent('USD');

    fillShortPath();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload().tradingAccountId).toBe(USD.tradingAccountId);
  });

  it('opens on the account decision when no active Account is valid', () => {
    renderForm({
      formOptions: { ...options, tradingAccounts: [USD, THB] },
      activeTradingAccountId: '018f0000-0000-7000-8000-0000000000aa',
    });
    expect(screen.getByLabelText('Trading Account')).toHaveValue('');
  });

  it('defaults Entry time to now in the trader timezone, and says so', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T07:32:00.000Z'));
    renderForm();
    expect(screen.getByLabelText('Entry time')).toHaveValue('2026-09-14T14:32');
    expect(screen.getByText('Set to now. Opened earlier? Change it.')).toBeVisible();
    expect(screen.getByText('Times use Asia/Bangkok.')).toBeVisible();
  });

  it('sends a changed Entry time converted from the trader timezone', async () => {
    renderForm();
    fillShortPath();
    fireEvent.change(screen.getByLabelText('Entry time'), {
      target: { value: '2026-09-10T09:15' },
    });
    expect(screen.queryByText('Set to now. Opened earlier? Change it.')).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(String(payload().enteredAt)).toMatch(/^2026-09-10T02:15:00/);
  });

  it('normalizes Symbol to upper case and records the chosen Direction', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: ' nas100' } });
    expect(screen.getByLabelText('Symbol')).toHaveValue(' NAS100');
    fireEvent.click(screen.getByRole('radio', { name: 'Short' }));
    expect(screen.getByRole('radio', { name: 'Short' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Long' })).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ symbol: 'NAS100', direction: 'short' });
  });

  it('offers this workspace’s recent symbols as one-tap chips, and remembers a saved one', async () => {
    const key = favoritesStorageKey('symbol', options.workspaceId);
    window.localStorage.setItem(
      key,
      serializeFavoritesState(
        recordRecent(recordRecent(EMPTY_FAVORITES_STATE, 'EURUSD'), 'NAS100'),
      ),
    );
    renderForm();
    const chips = within(screen.getByRole('group', { name: 'Recent symbols' }));
    fireEvent.click(chips.getByRole('button', { name: 'NAS100' }));
    expect(screen.getByLabelText('Symbol')).toHaveValue('NAS100');

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'gbpjpy' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '50' } });
    save();
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(window.localStorage.getItem(key) ?? '{}').recents[0]).toBe('GBPJPY');
  });

  it('renders no recent-symbol chips when the workspace has none', () => {
    renderForm();
    expect(screen.queryByRole('group', { name: 'Recent symbols' })).not.toBeInTheDocument();
  });
});

describe('production At Entry recording — Plan at entry', () => {
  it('leads with Risk at entry as the primary figure, Target profit optional beside it', () => {
    renderForm();
    const risk = screen.getByLabelText('Risk at entry');
    expect(risk.className).toContain('text-[1.375rem]');
    expect(risk).toHaveAccessibleDescription(/USD/);
    expect(screen.getByLabelText('Target profit')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Plan by' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Entry')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use price levels instead' })).toBeVisible();
  });

  it('derives Target R as a line, only once both amounts exist, never as zero', () => {
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200' } });
    expect(document.querySelector('[data-target-r]')).toBeNull();
    expect(screen.queryByText(/0\.00R/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Target profit'), { target: { value: '1000' } });
    const line = document.querySelector('[data-target-r]');
    expect(line).toHaveTextContent('Target R');
    expect(line).toHaveTextContent('+5.00R');
    expect(line).toHaveTextContent('1R = 200.00 USD');
    expect(screen.queryByLabelText('Target R')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Target profit'), { target: { value: '' } });
    expect(document.querySelector('[data-target-r]')).toBeNull();
  });

  it('saves without a target: the plan is sent with no reward', async () => {
    renderForm();
    fillShortPath();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      recordingTiming: 'at_entry',
      systemPlanBasis: 'money',
      plannedRiskMinor: '20000',
      plannedRewardMinor: null,
    });
    expect(CreateTradeSchema.safeParse(payload()).success).toBe(true);
  });

  it('keeps Price capability behind a quiet switch, with its money consequence stated', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'eurusd' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use price levels instead' }));
    expect(screen.queryByLabelText('Risk at entry')).not.toBeInTheDocument();
    expect(document.querySelector('[data-price-no-money-notice]')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Take Profit'), { target: { value: '130' } });
    expect(document.querySelector('[data-target-r]')).toHaveTextContent('+3.00R');
    expect(document.querySelector('[data-target-r]')).not.toHaveTextContent('1R =');

    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      systemPlanBasis: 'price',
      plannedEntry: '100',
      plannedStop: '90',
      plannedTarget: '130',
      plannedRiskMinor: null,
    });
    expect(payload()).not.toHaveProperty('actualResultMode');

    fireEvent.click(screen.getByRole('button', { name: 'Use amounts instead' }));
    expect(document.querySelector('[data-price-no-money-notice]')).toBeNull();
    expect(screen.getByLabelText('Risk at entry')).toHaveValue('');
  });

  it('keeps the opening override collapsed until asked for, and sends it only when used', async () => {
    renderForm();
    const toggle = screen.getByRole('button', {
      name: 'Your actual opening differed from this plan',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Actual opening by' })).not.toBeInTheDocument();

    fillShortPath();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actual opening by' })).getByRole('radio', {
        name: 'Price',
      }),
    );
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '101' } });
    fireEvent.change(screen.getByLabelText('Actual Stop'), { target: { value: '90' } });
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      systemPlanBasis: 'money',
      actualResultMode: 'price',
      actualEntry: '101',
      actualInitialStop: '90',
      actualInitialRiskMinor: null,
    });
  });
});

describe('production At Entry recording — Trade idea', () => {
  it('asks in the present tense and keeps the draft until Done', async () => {
    renderForm();
    fillShortPath();
    const launcher = screen.getByRole('button', { name: /Trade idea/ });
    expect(launcher).toHaveTextContent('Why are you taking this trade?');

    fireEvent.click(launcher);
    fireEvent.change(within(dialog()).getByLabelText('Why are you taking this trade?'), {
      target: { value: 'Abandoned thought' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(launcher).toHaveTextContent('Why are you taking this trade?');
    expect(screen.queryByText('Why did you take this trade?')).not.toBeInTheDocument();

    fireEvent.click(launcher);
    fireEvent.change(within(dialog()).getByLabelText('Why are you taking this trade?'), {
      target: { value: 'Third push out of the London range' },
    });
    fireEvent.change(within(dialog()).getByLabelText('Timeframe'), { target: { value: 'H1' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(launcher).toHaveTextContent('Third push out of the London range');

    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      confirmationNotes: 'Third push out of the London range',
      timeframe: 'H1',
    });
  });

  it('carries the production Strategy / Setup contract, including the condition snapshot', async () => {
    renderForm();
    fillShortPath();
    fireEvent.click(screen.getByRole('button', { name: /Trade idea/ }));
    const idea = within(dialog());
    expect(idea.getByText('Are you following a strategy?')).toBeVisible();
    expect(idea.queryByLabelText(/^Setup/)).not.toBeInTheDocument();
    fireEvent.change(idea.getByLabelText('Strategy'), {
      target: { value: options.strategies[0].strategyId },
    });
    fireEvent.change(idea.getByLabelText('Setup'), {
      target: { value: options.strategies[0].setups[0].setupId },
    });
    fireEvent.click(idea.getByLabelText('Retest held'));
    expect(idea.getByText('1/2 met · 50%')).toBeVisible();
    fireEvent.click(idea.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Trade idea/ })).toHaveTextContent(
      'Golden Breakout · Clean Retest',
    );

    save();
    const confirm = await screen.findByRole('alertdialog');
    expect(createTradeActionMock).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({
      strategyId: options.strategies[0].strategyId,
      setupId: options.strategies[0].setups[0].setupId,
      conditionSetToken: 'condition-set-token',
      conditionAnswers: [
        { conditionKey: 'retest', status: 'met' },
        { conditionKey: 'volume', status: 'not_met' },
      ],
    });
  });

  it('does not require a Strategy', async () => {
    renderForm();
    fillShortPath();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty('strategyId');
    expect(payload()).not.toHaveProperty('setupId');
  });
});

describe('production At Entry recording — Feelings at entry', () => {
  it('offers five named confidence choices mapped to the stored steps', async () => {
    renderForm();
    fillShortPath();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    const feelings = within(dialog());
    expect(dialog()).toHaveTextContent('Your state as you take this trade.');
    const group = within(feelings.getByRole('group', { name: 'Confidence' }));
    expect(group.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      '0',
      '25',
      '50',
      '75',
      '100',
    ]);
    expect(group.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(
      true,
    );
    expect(document.querySelector('[data-slot="confidence-pill"]')).toBeNull();

    fireEvent.click(group.getByRole('radio', { name: 'High' }));
    fireEvent.click(feelings.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Feelings at entry/ })).toHaveTextContent(
      'High confidence',
    );
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ confidence: 75 });
    // Confidence alone is not an emotion answer.
    expect(payload()).not.toHaveProperty('emotionKeys');
  });

  it('keeps Feelings optional: opened and cancelled sends nothing', async () => {
    renderForm();
    fillShortPath();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Calm' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).not.toHaveProperty('emotionKeys');
    expect(payload()).not.toHaveProperty('confidence');
  });

  it('records chosen emotions once committed', async () => {
    renderForm();
    fillShortPath();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    expect(within(dialog()).getByText('Not recorded')).toBeVisible();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Calm' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Feelings at entry/ })).toHaveTextContent('Calm');
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ emotionKeys: ['calm'] });
  });

  it('keeps an explicit "None of these" distinct from never answering', async () => {
    renderForm();
    fillShortPath();
    fireEvent.click(screen.getByRole('button', { name: /Feelings at entry/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'None of these' }));
    expect(within(dialog()).queryByText('Not recorded')).not.toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: /Feelings at entry/ })).toHaveTextContent(
      'None of these',
    );
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(payload()).toMatchObject({ emotionKeys: [] });
  });
});

describe('production At Entry recording — validation and Save', () => {
  it('shows required errors only after an attempted Save, and does not send', () => {
    renderForm({ formOptions: { ...options, tradingAccounts: [USD, THB] } });
    save();
    expect(alerts()).toEqual([
      'Choose a Trading Account.',
      'Enter a symbol.',
      'Choose Long or Short.',
      'Enter your risk at entry.',
    ]);
    expect(createTradeActionMock).not.toHaveBeenCalled();
  });

  it('clears each corrected error on its own', () => {
    renderForm();
    save();
    expect(alerts()).toEqual([
      'Enter a symbol.',
      'Choose Long or Short.',
      'Enter your risk at entry.',
    ]);

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
    expect(alerts()).toEqual(['Choose Long or Short.', 'Enter your risk at entry.']);

    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '50' } });
    expect(alerts()).toEqual(['Choose Long or Short.']);

    fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
    expect(alerts()).toEqual([]);
  });

  it('withdraws the "check the highlighted fields" banner once nothing is highlighted', () => {
    renderForm();
    save();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Check the highlighted fields and try again.',
    );

    fillShortPath();
    expect(alerts()).toEqual([]);
    expect(screen.getByRole('status')).not.toHaveTextContent(
      'Check the highlighted fields and try again.',
    );
    expect(createTradeActionMock).not.toHaveBeenCalled();
  });

  it('associates each field error with its control', () => {
    renderForm();
    save();
    const risk = screen.getByLabelText('Risk at entry');
    expect(risk).toHaveAttribute('aria-invalid', 'true');
    expect(risk.getAttribute('aria-describedby')).toContain('entry-risk-error');
    expect(screen.getByRole('group', { name: 'Direction' })).toHaveAccessibleDescription(
      'Choose Long or Short.',
    );
  });

  it('rejects a zero risk rather than sending it', () => {
    renderForm();
    fillShortPath({ risk: '0' });
    save();
    expect(createTradeActionMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Risk at entry')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not require the Journal to Save, and redirects to the saved Trade', async () => {
    renderForm();
    fillShortPath();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
    expect(payload()).not.toHaveProperty('systemResult');
    expect(payload()).not.toHaveProperty('actualResultMode');
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        '/app/trades?trade=018f0000-0000-7000-8000-000000000099',
      ),
    );
  });

  it('reuses one mutation key when a failed Save is retried', async () => {
    createTradeActionMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid_initial_risk' },
    });
    renderForm();
    fillShortPath();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const firstKey = payload().mutationKey;
    expect(pushMock).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(2));
    expect(payload().mutationKey).toBe(firstKey);
  });

  it('renders the composition in Thai', () => {
    renderForm({ locale: 'th' });
    expect(screen.getByRole('heading', { name: 'แผนตอนเข้า' })).toBeInTheDocument();
    expect(screen.getByLabelText('ความเสี่ยงตอนเข้า')).toBeVisible();
    expect(screen.getByText('ตอนนี้หรือภายหลัง')).toBeVisible();
    expect(screen.getByRole('button', { name: 'บันทึกเทรดที่ยังเปิดอยู่' })).toBeVisible();
  });
});
