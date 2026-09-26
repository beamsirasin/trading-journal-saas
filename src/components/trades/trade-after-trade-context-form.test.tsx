import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { BLANK_CLOSE_PLAN } from './close-trade-draft';
import { loadCloseTask, saveCloseTask } from './close-trade-draft-storage';
import { TradeAfterTradeContextForm } from './trade-after-trade-context-form';

vi.setConfig({ testTimeout: 15_000 });

const actionMock = vi.fn();
const pushMock = vi.fn();
vi.mock('@/server/actions/trades', () => ({
  recordAfterTradeContextAction: (input: unknown) => actionMock(input),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const TRADE_ID = '018f0000-0000-7000-8000-000000000099';
const SCOPE = { ownerKey: 'owner-a', workspaceKey: 'ws-1', tradeKey: 'trade-1' };
const DRAFT_KEY = 'tradechemist:close-draft:owner-a:ws-1:trade-1';
const CHART = 'https://www.tradingview.com/x/After0001/';

function trade(overrides: Partial<TradeDetail> = {}): TradeDetail {
  return {
    tradeId: TRADE_ID,
    symbol: 'XAUUSD',
    status: 'closed',
    recordingContract: 'add_trade_v1',
    tradingAccountBaseCurrency: 'USD',
    // No plan on record unless a test gives one: the System Result asks nothing.
    plannedRiskMinor: null,
    plannedRiskState: null,
    targetState: null,
    plannedRewardMinor: null,
    exitPlanState: null,
    exitPlanName: null,
    exitPlanInstructions: null,
    planOutcome: null,
    planOutcomeMinor: null,
    afterTradeNote: null,
    afterTradeTradingviewUrl: null,
    postTradeEmotionsRecordedAt: null,
    postTradeEmotions: [],
    emotionCatalog: [
      { key: 'calm', label: 'Calm' },
      { key: 'frustrated', label: 'Frustrated' },
    ],
    ...overrides,
  } as unknown as TradeDetail;
}

function renderForm(detail: TradeDetail = trade(), fromClose = true, scope = SCOPE) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeAfterTradeContextForm trade={detail} draftScope={scope} fromClose={fromClose} />
    </NextIntlClientProvider>,
  );
}

function stored() {
  const raw = window.localStorage.getItem(DRAFT_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function chooseEmotion(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit post-trade emotion' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
}

beforeEach(() => {
  actionMock.mockReset();
  pushMock.mockReset();
  actionMock.mockResolvedValue({
    ok: true,
    data: {
      tradeId: TRADE_ID,
      alreadyRecorded: false,
      afterTradeNote: null,
      afterTradeTradingviewUrl: null,
      postTradeEmotions: { answer: 'unanswered' },
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('Stage 6 after a Final Close', () => {
  it('says the trade is closed before offering anything optional', () => {
    renderForm();
    const closed = document.querySelector('[data-trade-closed]')!;
    expect(closed).toHaveTextContent('Trade closed');
    // After a Final Close the Trade really is saved, and Stage 6 says so.
    expect(document.querySelector('[data-after-trade-context-step]')).toHaveTextContent(
      'The trade is already saved.',
    );
    const emotion = document.getElementById('stage6-post-emotions')!;
    expect(closed.compareDocumentPosition(emotion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Every part starts Unanswered — never None, never a default.
    expect(emotion).toHaveAttribute('data-post-trade-emotions', 'unanswered');
    expect(screen.getByLabelText('After-trade note')).toHaveValue('');
    expect(screen.getByLabelText('TradingView link')).toHaveValue('');
    // No Review content here.
    expect(screen.queryByText(/reflection|mistake|system assessment/i)).toBeNull();
  });

  it('sends no empty patch: skipping or saving nothing just finishes', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeVisible();
    expect(screen.getByText(/You can add after-trade context later/)).toBeVisible();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it('saves only the answers given, under its own key, then offers Review Trade and Done', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('After-trade note'), {
      target: { value: '  Exited on fear.  ' },
    });
    chooseEmotion('None of these');
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const input = actionMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toEqual({
      tradeId: TRADE_ID,
      mutationKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      afterTradeNote: 'Exited on fear.',
      postTradeEmotionKeys: [],
    });
    expect(input).not.toHaveProperty('afterTradeTradingviewUrl');
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review Trade' }));
    expect(pushMock).toHaveBeenLastCalledWith(`/app/trades?trade=${TRADE_ID}&tab=review`);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(pushMock).toHaveBeenLastCalledWith(`/app/trades?trade=${TRADE_ID}`);
  });

  it('skipping keeps the Trade closed and the answers resumable', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('After-trade note'), { target: { value: 'Later.' } });
    await waitFor(() => expect(stored()?.afterTradeContext).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeVisible();
    expect(actionMock).not.toHaveBeenCalled();
    expect(stored()?.afterTradeContext.answers.note).toBe('Later.');
  });

  it('blocks Save at the after-trade link with the Entry Context rule', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('TradingView link'), {
      target: { value: 'https://example.com/chart' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(screen.getByLabelText('TradingView link')).toHaveFocus());
    expect(screen.getByLabelText('TradingView link')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter an HTTPS TradingView URL.')).toBeVisible();
    expect(actionMock).not.toHaveBeenCalled();
  });
});

describe('editing recorded context later', () => {
  it('starts from what is saved and sends only what changed — clearing as null', async () => {
    renderForm(
      trade({
        afterTradeNote: 'Old note.',
        afterTradeTradingviewUrl: CHART,
        postTradeEmotionsRecordedAt: '2026-09-22T00:00:00.000Z',
        postTradeEmotions: [{ key: 'calm', label: 'Calm' }],
      }),
      false,
    );
    expect(document.querySelector('[data-trade-closed]')).toBeNull();
    expect(screen.getByLabelText('After-trade note')).toHaveValue('Old note.');
    expect(document.getElementById('stage6-post-emotions')).toHaveAttribute(
      'data-post-trade-emotions',
      'selected',
    );
    fireEvent.change(screen.getByLabelText('After-trade note'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    expect(actionMock.mock.calls[0]![0]).toEqual({
      tradeId: TRADE_ID,
      mutationKey: expect.any(String),
      afterTradeNote: null,
    });
  });
});

describe('the Stage 6 draft', () => {
  it('survives a reload, and a successful save clears only Stage 6', async () => {
    // A Part task for the same Trade, as a later close of another task would leave it.
    saveCloseTask(
      SCOPE,
      'part',
      {
        basis: { status: 'open', exitIds: [] },
        exitResult: {
          leg: { pnl: '5', closedPercent: '', exitedAt: '', price: '', reason: '' },
          finalExitedAt: '',
          finalPnl: '',
          finalPnlAdopted: false,
          outcome: null,
          completeness: 'unanswered',
          plan: BLANK_CLOSE_PLAN,
        },
        submission: null,
      },
      { symbol: 'XAUUSD', now: new Date() },
    );
    const first = renderForm();
    fireEvent.change(screen.getByLabelText('After-trade note'), {
      target: { value: 'Keep this.' },
    });
    chooseEmotion('Calm');
    await waitFor(() => expect(stored()?.afterTradeContext).toBeDefined());
    first.unmount();

    renderForm();
    await waitFor(() =>
      expect(screen.getByLabelText('After-trade note')).toHaveValue('Keep this.'),
    );
    expect(document.getElementById('stage6-post-emotions')).toHaveAttribute(
      'data-post-trade-emotions',
      'selected',
    );
    expect(screen.getByText('Your unsaved after-trade context was restored.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await screen.findByRole('heading', { name: 'Trade saved' });
    expect(stored()?.afterTradeContext).toBeUndefined();
    expect(loadCloseTask(SCOPE, 'part', new Date())).not.toBeNull();
  });

  it('re-sends a failed save after a reload under the same Stage 6 key', async () => {
    actionMock.mockResolvedValueOnce({ ok: false, error: { code: 'unexpected_error' } });
    const first = renderForm();
    fireEvent.change(screen.getByLabelText('After-trade note'), { target: { value: 'Once.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const key = (actionMock.mock.calls[0]![0] as { mutationKey: string }).mutationKey;
    await screen.findByRole('button', { name: 'Save context' });
    first.unmount();

    renderForm();
    await waitFor(() => expect(screen.getByLabelText('After-trade note')).toHaveValue('Once.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    expect((actionMock.mock.calls[1]![0] as { mutationKey: string }).mutationKey).toBe(key);
  });
});

describe('Stage 6 System Result on a closed trade (decision 55)', () => {
  const BOUNDED = {
    plannedRiskMinor: '5000',
    plannedRiskState: 'defined',
    targetState: 'fixed',
    plannedRewardMinor: '10000',
  } as const;
  const RULE_BASED = {
    plannedRiskMinor: '5000',
    plannedRiskState: 'defined',
    targetState: 'no_fixed',
    exitPlanState: 'customized',
    exitPlanInstructions: 'Trail behind the 20 EMA.',
  } as const;

  it('comes first, before the after-trade context, and may be left for later', async () => {
    renderForm(trade(BOUNDED));
    const section = document.querySelector('[data-plan-outcome]')!;
    expect(section).toHaveAttribute('data-plan-outcome', 'bounded');
    const emotion = document.getElementById('stage6-post-emotions')!;
    expect(
      section.compareDocumentPosition(emotion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Required for a complete record (decision 59) — never Optional — yet it never blocks.
    expect(section).toHaveTextContent(
      'Needed to complete the record. You can save now and answer it later from the trade.',
    );
    // Nothing answered, nothing sent.
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeVisible();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it('sends a target reached first as the answer alone — the plan supplies the figure', async () => {
    renderForm(trade(BOUNDED));
    const section = document.querySelector<HTMLElement>('[data-plan-outcome]')!;
    fireEvent.click(within(section).getByRole('radio', { name: /^Planned target/ }));
    expect(section.querySelector('[data-plan-outcome-result]')).toHaveTextContent('+2.00R');
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    expect(actionMock.mock.calls[0]![0]).toEqual({
      tradeId: TRADE_ID,
      mutationKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      planOutcome: { outcome: 'planned_target_first', amountMinor: null },
    });
  });

  it('shows a rule-based Exit Plan read-only, and blocks a result without its amount', async () => {
    renderForm(trade(RULE_BASED));
    const section = document.querySelector<HTMLElement>('[data-plan-outcome]')!;
    expect(section.querySelector('[data-plan-outcome-exit-plan]')).toHaveTextContent(
      'Trail behind the 20 EMA.',
    );
    fireEvent.click(within(section).getByRole('radio', { name: 'State the result' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    expect(
      await screen.findByText("Enter the result, or choose Can't determine."),
    ).toBeInTheDocument();
    expect(actionMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Result under the plan'), { target: { value: '300' } });
    expect(section.querySelector('[data-plan-outcome-result]')).toHaveTextContent('+6.00R');
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    expect(actionMock.mock.calls[0]![0]).toMatchObject({
      planOutcome: { outcome: 'exit_plan_result', amountMinor: '30000' },
    });
  });

  it('starts from the saved answer, sends nothing when unchanged, and clears as null', async () => {
    renderForm(
      trade({ ...RULE_BASED, planOutcome: 'exit_plan_result', planOutcomeMinor: '30000' }),
    );
    expect(screen.getByLabelText('Result under the plan')).toHaveValue('300.00');
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    expect(await screen.findByRole('heading', { name: 'Trade saved' })).toBeVisible();
    expect(actionMock).not.toHaveBeenCalled();
    cleanup();

    renderForm(
      trade({ ...RULE_BASED, planOutcome: 'exit_plan_result', planOutcomeMinor: '30000' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove system result answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    expect(actionMock.mock.calls[0]![0]).toMatchObject({ planOutcome: null });
  });

  it('says why nothing is asked when the trade had no defined planned risk', () => {
    renderForm(trade({ plannedRiskState: 'no_defined', targetState: 'fixed' }));
    const section = document.querySelector('[data-plan-outcome]')!;
    expect(section).toHaveAttribute('data-plan-outcome', 'no_defined_risk');
    expect(section).toHaveTextContent(
      "R comparison isn't available because no risk was defined as 1R for this trade.",
    );
    expect(within(section as HTMLElement).queryByRole('radio')).toBeNull();
  });

  it('keeps a typed answer through a reload', async () => {
    const { unmount } = renderForm(trade(BOUNDED));
    fireEvent.click(
      within(document.querySelector<HTMLElement>('[data-plan-outcome]')!).getByRole('radio', {
        name: "Can't determine",
      }),
    );
    await waitFor(() =>
      expect(stored()?.afterTradeContext?.answers?.planOutcome).toEqual({
        outcome: 'cannot_determine',
        amount: '',
      }),
    );
    unmount();
    renderForm(trade(BOUNDED));
    await waitFor(() =>
      expect(
        within(document.querySelector<HTMLElement>('[data-plan-outcome]')!).getByRole('radio', {
          name: "Can't determine",
        }),
      ).toBeChecked(),
    );
  });
});
