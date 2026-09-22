import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
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
