import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { loadRecordingDraft, type RecordingDraftScope } from './recording-draft-storage';
import { TradeRecordingForm } from './trade-recording-form';

const pushMock = vi.fn();
const createTradeMock = vi.fn();
const createCompletedTradeMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/server/actions/exit-plans', () => ({}));
vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (input: unknown) => createTradeMock(input),
  createCompletedTradeAction: (input: unknown) => createCompletedTradeMock(input),
}));

const ACCOUNT = '018f0000-0000-7000-8000-000000000001';
const SCOPE: RecordingDraftScope = { ownerKey: 'owner-a', workspaceKey: 'workspace-a' };
const OTHER_WORKSPACE: RecordingDraftScope = { ownerKey: 'owner-a', workspaceKey: 'workspace-b' };
const OTHER_USER: RecordingDraftScope = { ownerKey: 'owner-b', workspaceKey: 'workspace-a' };
const STORAGE_KEY = 'tradechemist:recording-draft:owner-a:workspace-a';
const copy = en.trades.create.draft;

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  exitPlans: [],
  emotionCatalog: [{ key: 'calm', label: 'Calm' }],
  tradingAccounts: [
    { tradingAccountId: ACCOUNT, name: 'Main USD', accountMode: 'live', baseCurrency: 'USD' },
  ],
  strategies: [],
} as const satisfies TradeCreateOptions;

/** One mount of Add Trade. Unmounting it stands for a reload, a Back, or leaving the page. */
function mount(timing: RecordingTiming = 'at_entry', scope: RecordingDraftScope = SCOPE) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeRecordingForm
        options={options}
        timing={timing}
        activeTradingAccountId={ACCOUNT}
        timezone="Asia/Bangkok"
        draftScope={scope}
      />
    </NextIntlClientProvider>,
  );
}

function symbolValue() {
  return (screen.getByLabelText('Symbol') as HTMLInputElement).value.toUpperCase();
}

function fillAtEntry() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByLabelText('Long'));
  fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
}

function saveAtEntry() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Save open trade' })[0]!);
}

function stored(scope: RecordingDraftScope = SCOPE) {
  const loaded = loadRecordingDraft(scope, new Date());
  return loaded.status === 'recovered' ? loaded.envelope : null;
}

function sentMutationKey(call: number) {
  return (createTradeMock.mock.calls[call]![0] as { mutationKey: string }).mutationKey;
}

beforeEach(() => {
  pushMock.mockReset();
  createTradeMock.mockReset();
  createTradeMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-1' } });
  createCompletedTradeMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Recording Draft — Type → Draft and reload recovery', () => {
  it('restores what was typed after a remount and says it was restored', () => {
    const first = mount();
    fillAtEntry();
    first.unmount();

    mount();
    expect(symbolValue()).toBe('XAUUSD');
    expect((screen.getByLabelText('Risk at entry') as HTMLInputElement).value).toBe('100');
    expect(screen.getByRole('status')).toHaveTextContent(copy.recovered);
  });

  it('keeps nothing and claims nothing for an untouched form', () => {
    const first = mount();
    first.unmount();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    mount();
    expect(screen.queryByText(copy.recovered)).toBeNull();
    expect(document.querySelector('[data-recording-draft-discard]')).toBeNull();
  });

  it('keeps an untouched entry time a default rather than freezing a stale "now"', () => {
    const first = mount();
    fillAtEntry();
    first.unmount();
    expect(stored()?.atEntry?.entryTime.source).toBe('default_now');
  });

  it('names a stored draft it cannot read, and fills in nothing from it', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    mount();
    expect(screen.getByRole('status')).toHaveTextContent(copy.unrecoverable);
    expect(symbolValue()).toBe('');
  });

  it('says so when this browser cannot keep the draft', () => {
    mount();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
    expect(screen.getByRole('status')).toHaveTextContent(copy.notDurable);
  });
});

describe('Recording Draft — scope', () => {
  it('never shows one workspace or user draft in another', () => {
    const first = mount();
    fillAtEntry();
    first.unmount();

    const otherWorkspace = mount('at_entry', OTHER_WORKSPACE);
    expect(symbolValue()).toBe('');
    expect(screen.queryByText(copy.recovered)).toBeNull();
    otherWorkspace.unmount();

    const otherUser = mount('at_entry', OTHER_USER);
    expect(symbolValue()).toBe('');
    otherUser.unmount();

    mount();
    expect(symbolValue()).toBe('XAUUSD');
  });
});

describe('Recording Draft — mode switching through the page', () => {
  it('carries explicit shared values across and back, keeping the draft', () => {
    const atEntry = mount('at_entry');
    fillAtEntry();
    atEntry.unmount();

    const afterTrade = mount('after_trade');
    expect(symbolValue()).toBe('XAUUSD');
    expect(screen.getByText(copy.recovered)).toBeVisible();
    expect(stored()?.activeMode).toBe('after_trade');
    afterTrade.unmount();

    mount('at_entry');
    expect(symbolValue()).toBe('XAUUSD');
    expect((screen.getByLabelText('Risk at entry') as HTMLInputElement).value).toBe('100');
    expect(stored()?.activeMode).toBe('at_entry');
  });
});

describe('Recording Draft — Discard → Destroy', () => {
  it('removes only this scope draft, only after confirmation, and resets the form', () => {
    const other = mount('at_entry', OTHER_WORKSPACE);
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'eurusd' } });
    other.unmount();

    mount();
    fillAtEntry();
    fireEvent.click(screen.getByRole('button', { name: copy.discard }));
    // Nothing is removed before the trader confirms.
    fireEvent.click(screen.getByRole('button', { name: copy.keep }));
    expect(stored()).not.toBeNull();
    expect(symbolValue()).toBe('XAUUSD');

    fireEvent.click(screen.getByRole('button', { name: copy.discard }));
    const dialog = screen.getByRole('alertdialog');
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === copy.discardConfirm,
    );
    fireEvent.click(confirm!);
    expect(stored()).toBeNull();
    expect(symbolValue()).toBe('');
    expect(stored(OTHER_WORKSPACE)).not.toBeNull();
    expect(createTradeMock).not.toHaveBeenCalled();
  });
});

describe('Recording Draft — Save → Persist', () => {
  it('keeps the draft through a server failure and retries with the same mutation key', async () => {
    createTradeMock.mockResolvedValueOnce({ ok: false, error: { code: 'unexpected_error' } });
    mount();
    fillAtEntry();
    saveAtEntry();
    await vi.waitFor(() =>
      expect(screen.getAllByText(en.trades.errors.unexpected_error).length).toBeGreaterThan(0),
    );
    expect(stored()).not.toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sentMutationKey(0)).toBe(stored()?.mutationKey);

    saveAtEntry();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(sentMutationKey(1)).toBe(sentMutationKey(0));
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=trade-1'));
    expect(stored()).toBeNull();
  });

  it('keeps the draft through a network failure, and a reload retries with the same key', async () => {
    createTradeMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const first = mount();
    fillAtEntry();
    saveAtEntry();
    await vi.waitFor(() =>
      expect(screen.getAllByText(en.trades.errors.unexpected_error).length).toBeGreaterThan(0),
    );
    first.unmount();

    mount();
    expect(symbolValue()).toBe('XAUUSD');
    saveAtEntry();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(sentMutationKey(1)).toBe(sentMutationKey(0));
  });

  it('ignores a second Save while the first is in flight, and clears only after success', async () => {
    let resolve: (value: unknown) => void = () => {};
    createTradeMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    fillAtEntry();
    // The same button, pressed twice before the server answers.
    const button = screen.getAllByRole('button', { name: 'Save open trade' })[0]!;
    fireEvent.click(button);
    fireEvent.click(button);
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(stored()).not.toBeNull();
    await act(async () => {
      resolve({ ok: true, data: { tradeId: 'trade-1' } });
    });
    expect(createTradeMock).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
  });
});
