import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { TradeAtEntryForm } from './trade-at-entry-form';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const createTradeMock = vi.fn();
const libraryActions = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  setDefault: vi.fn(),
  removeDefault: vi.fn(),
}));

vi.mock('@/server/actions/exit-plans', () => ({
  createExitPlanAction: (input: unknown) => libraryActions.create(input),
  updateExitPlanAction: (input: unknown) => libraryActions.update(input),
  archiveExitPlanAction: (input: unknown) => libraryActions.archive(input),
  setExitPlanStrategyDefaultAction: (input: unknown) => libraryActions.setDefault(input),
  removeExitPlanStrategyDefaultAction: (input: unknown) => libraryActions.removeDefault(input),
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (input: unknown) => createTradeMock(input),
}));

const ACCOUNT = '018f0000-0000-7000-8000-000000000001';
const BREAKOUT = '018f0000-0000-7000-8000-000000000010';
const REVERSAL = '018f0000-0000-7000-8000-000000000011';
const RETEST = '018f0000-0000-7000-8000-000000000020';
const SCALE_OUT = '018f0000-0000-7000-8000-000000000030';
const TRAIL = '018f0000-0000-7000-8000-000000000031';

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  savedSymbols: [],
  emotionCatalog: [
    { key: 'calm', label: 'Calm' },
    { key: 'fomo', label: 'FOMO' },
  ],
  exitPlans: [
    {
      exitPlanId: SCALE_OUT,
      name: 'Scale out',
      instructions: 'Half at 1R, trail the rest.',
      strategyId: BREAKOUT,
    },
    { exitPlanId: TRAIL, name: 'Trail', instructions: 'Trail behind structure.', strategyId: null },
  ],
  tradingAccounts: [
    {
      tradingAccountId: ACCOUNT,
      name: 'Main USD',
      accountMode: 'live',
      baseCurrency: 'USD',
    },
  ],
  strategies: [
    {
      strategyId: BREAKOUT,
      name: 'Breakout',
      currentVersionNumber: 1,
      setups: [
        {
          setupId: RETEST,
          name: 'Retest',
          sortOrder: 0,
          conditionSetToken: 'token-retest',
          conditions: [
            { conditionKey: 'candle', label: 'Candle closed', sortOrder: 0 },
            { conditionKey: 'volume', label: 'Volume rising', sortOrder: 1 },
          ],
        },
      ],
    },
    { strategyId: REVERSAL, name: 'Reversal', currentVersionNumber: 1, setups: [] },
  ],
} as const satisfies TradeCreateOptions;

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeAtEntryForm
        options={options}
        activeTradingAccountId={ACCOUNT}
        timezone="Asia/Bangkok"
      />
    </NextIntlClientProvider>,
  );
}

/** The one Save: desktop panel and mobile bar render the same action in jsdom. */
function save() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Save open trade' })[0]!);
}

function fillMinimum() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByLabelText('Long'));
  fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
}

function exitPlanState() {
  return document.querySelector('[data-exit-plan-state]')?.getAttribute('data-exit-plan-state');
}

function statusText() {
  return document.querySelector('[data-save-status]')?.textContent ?? '';
}

beforeEach(() => {
  pushMock.mockReset();
  createTradeMock.mockReset();
  createTradeMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-1' } });
  refreshMock.mockReset();
  for (const action of Object.values(libraryActions)) {
    action.mockReset();
    // The server's library is unchanged unless a test says otherwise.
    action.mockResolvedValue({
      ok: true,
      data: { exitPlanId: 'plan-new', replacedExitPlanId: null },
      exitPlans: options.exitPlans,
    });
  }
  window.localStorage.clear();
});

describe('At Entry — the contract write', () => {
  it('saves Account, Symbol, Direction and Risk at Entry alone, with Risk as the 1R baseline', async () => {
    renderForm();
    fillMinimum();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({
      recordingContract: 'add_trade_v1',
      recordingTiming: 'at_entry',
      systemPlanBasis: 'money',
      symbol: 'XAUUSD',
      direction: 'long',
      plannedRiskMinor: '10000',
      actualRiskAnswer: 'matched',
      enteredAtSource: 'default_now',
    });
    const payload = createTradeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('targetState');
    expect(payload).not.toHaveProperty('exitPlan');
    expect(payload).not.toHaveProperty('plannedEntry');
  });

  it('offers no Money/Price switch and keeps price fields as context', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: /Use price levels instead/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Trade idea, chart and price levels/ }));
    expect(screen.getByText('Context only, never used to calculate results')).toBeVisible();
  });
});

describe('At Entry — Actual Risk', () => {
  it('shows the matched assumption only beside a real Risk at Entry, and makes it reversible', () => {
    renderForm();
    expect(screen.queryByText('Your actual risk matched this amount.')).toBeNull();
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
    expect(screen.getByText('Your actual risk matched this amount.')).toBeVisible();
    expect(screen.getByText('Assumed until you say otherwise.')).toBeVisible();
  });

  it('keeps a Different amount through Matched and back', () => {
    renderForm();
    fillMinimum();
    fireEvent.click(screen.getByRole('button', { name: 'It was different' }));
    fireEvent.change(screen.getByLabelText('Actual risk'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'It matched after all' }));
    fireEvent.click(screen.getByRole('button', { name: 'It was different' }));
    expect(screen.getByLabelText('Actual risk')).toHaveValue('150');
  });

  it('records Different with the amount unknown without demanding a second figure', async () => {
    renderForm();
    fillMinimum();
    fireEvent.click(screen.getByRole('button', { name: 'It was different' }));
    fireEvent.click(screen.getByRole('button', { name: "I don't know the amount" }));
    expect(screen.getByText('Different, amount not known')).toBeVisible();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    const payload = createTradeMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.actualRiskAnswer).toBe('different');
    expect(payload).not.toHaveProperty('actualInitialRiskMinor');
  });
});

describe('At Entry — Target', () => {
  it('attaches an incomplete Fixed Target to Target profit, never to No fixed target', () => {
    renderForm();
    fillMinimum();
    fireEvent.click(screen.getByLabelText(/Fixed target/));
    save();
    const message = screen.getByText(
      'Add a target profit or a TP price, or choose No fixed target.',
    );
    expect(message).toBeVisible();
    expect(screen.getByLabelText('Target profit')).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining(message.id),
    );
    expect(screen.getByLabelText(/No fixed target/)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('returns Target to Unanswered by an explicit, labelled action', () => {
    renderForm();
    fillMinimum();
    fireEvent.click(screen.getByLabelText(/No fixed target/));
    expect(screen.getByLabelText(/No fixed target/)).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Remove target answer' }));
    expect(screen.getByLabelText(/No fixed target/)).not.toBeChecked();
    expect(screen.getByLabelText(/Fixed target/)).not.toBeChecked();
  });
});

describe('At Entry — readiness and hidden errors', () => {
  it('never reports Ready while a blocking error sits in a collapsed disclosure', () => {
    renderForm();
    fillMinimum();
    expect(statusText()).toContain('Ready to save');

    fireEvent.click(screen.getByRole('button', { name: /Trade idea, chart and price levels/ }));
    fireEvent.change(screen.getByLabelText('SL price'), { target: { value: '12..5' } });
    fireEvent.click(screen.getByRole('button', { name: /Trade idea, chart and price levels/ }));
    expect(statusText()).not.toContain('Ready to save');
    expect(statusText()).toContain('attention');
    // The collapsed summary says an error is inside rather than hiding it.
    expect(screen.getByText('1 thing to fix')).toBeVisible();
  });

  it('opens the section holding a hidden error when Save is attempted', () => {
    renderForm();
    fillMinimum();
    const trigger = screen.getByRole('button', { name: /Trade idea, chart and price levels/ });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('Entry price'), { target: { value: 'abc' } });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    save();
    expect(createTradeMock).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('Enter a price greater than zero, using digits and one decimal point.'),
    ).toBeVisible();
  });
});

describe('At Entry — Exit Plan', () => {
  function selectBreakout() {
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: BREAKOUT } });
  }

  it('inherits the Strategy default with local, discoverable feedback and no redundant confirm', () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    expect(exitPlanState()).toBe('inherited');
    expect(screen.getByText('From Strategy: Breakout')).toBeVisible();
    expect(
      screen.getByText('Breakout currently supplies this exit plan unless you change it.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Breakout currently supplies the exit plan “Scale out” unless you change it.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use this plan' })).toBeNull();
  });

  it('opening the chooser and closing without a change never manufactures an override', () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('inherited');

    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(exitPlanState()).toBe('inherited');
  });

  it('opening Customize claims nothing until the wording really changes', () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByLabelText('Your plan for this trade')).toHaveValue(
      'Half at 1R, trail the rest.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('inherited');

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.change(screen.getByLabelText('Your plan for this trade'), {
      target: { value: 'Half at 1R, close the rest at 2R.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('customized');
    expect(screen.getByText('Customized for this trade')).toBeVisible();
  });

  it('discards an edit only when Discard changes is chosen', () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.change(screen.getByLabelText('Your plan for this trade'), {
      target: { value: 'Something else entirely.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(exitPlanState()).toBe('inherited');
  });

  it('keeps custom wording through another choice and restores it', async () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.change(screen.getByLabelText('Your plan for this trade'), {
      target: { value: 'Close before the news.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(exitPlanState()).toBe('customized');

    fireEvent.click(screen.getByRole('button', { name: 'Use strategy default' }));
    expect(exitPlanState()).toBe('inherited');
    fireEvent.click(screen.getByRole('button', { name: 'Use your custom plan' }));
    expect(exitPlanState()).toBe('customized');
    expect(screen.getByText('Close before the news.')).toBeVisible();

    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({
      exitPlan: {
        state: 'customized',
        instructions: 'Close before the news.',
      },
      exitPlanInheritanceDeclined: true,
    });
  });

  it('sends an inherited plan with its Strategy-default provenance', async () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({
      strategyId: BREAKOUT,
      exitPlan: { state: 'saved', exitPlanId: SCALE_OUT, provenance: 'strategy_default' },
    });
  });
});

describe('At Entry — managing saved exit plans', () => {
  function selectBreakout() {
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: BREAKOUT } });
  }

  function openManage() {
    fireEvent.click(screen.getByRole('button', { name: /^(Choose another|Choose exit plan)$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage saved plans' }));
  }

  function libraryItem(name: string): HTMLElement {
    const item = document.querySelector(`[data-exit-plan-library-item="${name}"]`);
    if (!(item instanceof HTMLElement)) throw new Error(`no library item ${name}`);
    return item;
  }

  it('creates a saved plan as a library decision, never as this trade’s answer', async () => {
    const NEWS = '018f0000-0000-7000-8000-000000000032';
    libraryActions.create.mockResolvedValue({
      ok: true,
      data: { exitPlanId: NEWS },
      exitPlans: [
        {
          exitPlanId: NEWS,
          name: 'News exit',
          instructions: 'Flat before news.',
          strategyId: null,
        },
        ...options.exitPlans,
      ],
    });
    renderForm();
    fillMinimum();
    selectBreakout();
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'New saved plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'News exit' } });
    fireEvent.change(screen.getByLabelText('Instructions'), {
      target: { value: 'Flat before high-impact news.\nNo re-entry for 15 minutes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await vi.waitFor(() => expect(libraryActions.create).toHaveBeenCalledTimes(1));
    // The plan form lives in a portal inside the At Entry form's React tree: its
    // submit must never bubble up and save the Trade.
    expect(createTradeMock).not.toHaveBeenCalled();
    expect(libraryActions.create.mock.calls[0]![0]).toMatchObject({
      name: 'News exit',
      instructions: 'Flat before high-impact news.\nNo re-entry for 15 minutes.',
      mutationKey: expect.any(String),
    });
    expect(
      await screen.findByText('News exit saved. Go back to choose it for this trade.'),
    ).toBeVisible();

    /*
      THE NEW PLAN IS OFFERED FROM THE ACTION'S OWN RESULT, with no router
      refresh at all. Waiting for the page's props to catch up raced the
      action's revalidation and could leave the saved plan missing.
    */
    expect(refreshMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to exit plan choices' }));
    expect(screen.getByRole('radio', { name: /News exit/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // The inherited default is untouched: creating a plan chose nothing.
    expect(exitPlanState()).toBe('inherited');
  });

  it('refuses a blank plan at its fields without calling the server', () => {
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'New saved plan' }));
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(screen.getByText('Enter a name for this plan.')).toBeVisible();
    expect(screen.getByText("Write the plan's instructions.")).toBeVisible();
    expect(libraryActions.create).not.toHaveBeenCalled();
  });

  it('keeps a half-written plan when the editor is closed and reopened', () => {
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'New saved plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Half written' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose exit plan' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Half written');
  });

  it('makes, replaces and removes a default only for the Strategy this trade uses', async () => {
    renderForm();
    fillMinimum();
    openManage();
    // No Strategy chosen: no default can be set from here.
    expect(screen.queryByRole('button', { name: /default for/ })).toBeNull();
    expect(
      screen.getByText('To set a Strategy default, choose a Strategy for this trade first.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    selectBreakout();
    openManage();
    fireEvent.click(
      within(libraryItem('Trail')).getByRole('button', {
        name: 'Make this the default for Breakout instead',
      }),
    );
    await vi.waitFor(() =>
      expect(libraryActions.setDefault).toHaveBeenCalledWith({
        exitPlanId: TRAIL,
        strategyId: BREAKOUT,
      }),
    );
    fireEvent.click(
      within(libraryItem('Scale out')).getByRole('button', {
        name: 'Remove as default for Breakout',
      }),
    );
    await vi.waitFor(() =>
      expect(libraryActions.removeDefault).toHaveBeenCalledWith({ exitPlanId: SCALE_OUT }),
    );
  });

  it('confirms an archive and says when this trade’s own answer depends on the plan', async () => {
    renderForm();
    fillMinimum();
    selectBreakout();
    openManage();
    const scaleOut = libraryItem('Scale out');
    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Archive Scale out' }));
    expect(libraryActions.archive).not.toHaveBeenCalled();
    expect(within(scaleOut).getByText('It also stops being a Strategy default.')).toBeVisible();
    expect(
      within(scaleOut).getByText(
        "This trade's exit plan currently uses it, so that answer will become Not recorded.",
      ),
    ).toBeVisible();
    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Keep plan' }));
    expect(libraryActions.archive).not.toHaveBeenCalled();

    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Archive Scale out' }));
    fireEvent.click(within(scaleOut).getByRole('button', { name: 'Archive plan' }));
    await vi.waitFor(() =>
      expect(libraryActions.archive).toHaveBeenCalledWith({ exitPlanId: SCALE_OUT }),
    );
  });

  it('drops an archived plan from the choices as soon as the archive succeeds', async () => {
    libraryActions.archive.mockResolvedValue({
      ok: true,
      data: { exitPlanId: TRAIL },
      exitPlans: options.exitPlans.filter((plan) => plan.exitPlanId !== TRAIL),
    });
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(within(libraryItem('Trail')).getByRole('button', { name: 'Archive Trail' }));
    fireEvent.click(within(libraryItem('Trail')).getByRole('button', { name: 'Archive plan' }));
    expect(await screen.findByText('Trail archived.')).toBeVisible();
    expect(document.querySelector('[data-exit-plan-library-item="Trail"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to exit plan choices' }));
    expect(screen.queryByRole('radio', { name: /Trail/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Scale out/ })).toBeInTheDocument();
  });

  it('shows a failed library change and changes nothing', async () => {
    libraryActions.update.mockResolvedValue({ ok: false, error: { code: 'read_only_workspace' } });
    renderForm();
    fillMinimum();
    openManage();
    fireEvent.click(within(libraryItem('Trail')).getByRole('button', { name: 'Edit Trail' }));
    expect(screen.getByLabelText('Instructions')).toHaveValue('Trail behind structure.');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(
      await screen.findByText(
        'Your workspace is read-only, so saved plans cannot be changed right now.',
      ),
    ).toBeVisible();
    expect(document.querySelector('[data-exit-plan-library-item="Trail"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(libraryItem('Trail')).toHaveTextContent('Trail behind structure.');
  });
});

describe('At Entry — the analytical questions', () => {
  it('restores Setup and condition answers when a Strategy is returned to', async () => {
    renderForm();
    fillMinimum();
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: BREAKOUT } });
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: RETEST } });
    const candle = screen.getByRole('group', { name: /Candle closed/ });
    fireEvent.click(within(candle).getByLabelText('Met'));

    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: REVERSAL } });
    expect(screen.getByLabelText('Setup')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: BREAKOUT } });
    expect(screen.getByLabelText('Setup')).toHaveValue(RETEST);
    expect(
      within(screen.getByRole('group', { name: /Candle closed/ })).getByLabelText('Met'),
    ).toBeChecked();

    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    // Only the answered condition travels; the unanswered one is never a Not Met.
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({
      setupId: RETEST,
      conditionAnswers: [{ conditionKey: 'candle', status: 'met' }],
    });
  });

  it('holds No strategy, a selection and Unanswered apart', async () => {
    renderForm();
    fillMinimum();
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: '__none' } });
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({ noStrategy: true });

    fireEvent.click(screen.getByRole('button', { name: 'Remove strategy answer' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    const second = createTradeMock.mock.calls[1]![0] as Record<string, unknown>;
    expect(second).not.toHaveProperty('noStrategy');
    expect(second).not.toHaveProperty('strategyId');
  });

  it('refuses to turn the last selected emotion into silence', () => {
    renderForm();
    fillMinimum();
    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
    expect(screen.getByRole('button', { name: 'Calm' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
    expect(screen.getByRole('button', { name: 'Calm' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText('To clear this answer, choose None of these or Remove answer.'),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Remove emotions answer' }));
    expect(screen.getByRole('button', { name: 'Calm' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps Not answered, None of these and a selection as three different answers', async () => {
    renderForm();
    fillMinimum();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).not.toHaveProperty('emotionKeys');

    fireEvent.click(screen.getByRole('button', { name: 'None of these' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(createTradeMock.mock.calls[1]![0]).toMatchObject({ emotionKeys: [] });

    fireEvent.click(screen.getByRole('button', { name: 'FOMO' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(3));
    expect(createTradeMock.mock.calls[2]![0]).toMatchObject({ emotionKeys: ['fomo'] });
  });

  it('has no Confidence default and removes it explicitly', async () => {
    renderForm();
    fillMinimum();
    for (const level of ['Very Low', 'Low', 'Neutral', 'High', 'Very High']) {
      expect(screen.getByLabelText(level)).not.toBeChecked();
    }
    fireEvent.click(screen.getByLabelText('High'));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({ confidence: 75 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove confidence answer' }));
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(createTradeMock.mock.calls[1]![0]).not.toHaveProperty('confidence');
  });

  it('summarizes answered analytical coverage honestly', () => {
    renderForm();
    fillMinimum();
    const summary = () => document.querySelector('[data-analysis-summary]')?.textContent ?? '';
    expect(summary()).toContain('Not answered yet');

    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: BREAKOUT } });
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: RETEST } });
    fireEvent.click(
      within(screen.getByRole('group', { name: /Candle closed/ })).getByLabelText('Met'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'None of these' }));
    expect(summary()).toContain('Breakout · Retest');
    expect(summary()).toContain('1 of 2 conditions answered');
    expect(summary()).toContain('No emotions');
  });
});

describe('At Entry — entry time', () => {
  it('keeps an untouched default distinct from a confirmed time, and can clear it', async () => {
    renderForm();
    fillMinimum();
    expect(screen.getByText('Set automatically to now')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'This time is right' }));
    expect(screen.queryByText('Set automatically to now')).toBeNull();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(createTradeMock.mock.calls[0]![0]).toMatchObject({ enteredAtSource: 'trader' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear time' }));
    expect(screen.getByText('Not set')).toBeVisible();
    save();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    const cleared = createTradeMock.mock.calls[1]![0] as Record<string, unknown>;
    expect(cleared).not.toHaveProperty('enteredAt');
    expect(cleared).not.toHaveProperty('enteredAtSource');
  });
});
