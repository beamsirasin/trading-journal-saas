import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
/*
  The Saved Symbol library is server-backed. These tests are not about it, so
  its actions answer the way the server would for a single browser: saving
  puts a symbol first, once, and the list comes back.
*/
vi.mock('@/server/actions/saved-symbols', () => {
  let symbols: string[] = [];
  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  return {
    saveSymbolAction: async ({ symbol }: { symbol: string }) => {
      if (!symbols.some((item) => same(item, symbol))) symbols = [symbol.trim(), ...symbols];
      return { ok: true, symbols: [...symbols] };
    },
    removeSymbolAction: async ({ symbol }: { symbol: string }) => {
      symbols = symbols.filter((item) => !same(item, symbol));
      return { ok: true, symbols: [...symbols] };
    },
    importSavedSymbolsAction: async () => ({ ok: true, symbols: [...symbols] }),
  };
});
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
  savedSymbols: [],
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

/**
 * The Symbol this mode holds. Both modes show it on a Step 1 row and keep the
 * input inside that row’s editor, so the row reports what is recorded without
 * one having to be opened.
 */
function symbolValue() {
  const row = document.querySelector('[data-concept="symbol"]');
  return (row?.getAttribute('data-value') ?? '').toUpperCase();
}

/** Record Symbol and Direction through their Step 1 editors — the same in both modes. */
function fillIdentity(symbol: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Symbol' }));
  const symbolEditor = within(screen.getByRole('dialog'));
  fireEvent.change(symbolEditor.getByLabelText('Symbol'), { target: { value: symbol } });
  /*
    Typing only searches. Adding puts it in the saved library, and tapping its
    row is what records it for the Trade — which closes the sheet on its own,
    so there is no Done to press.
  */
  fireEvent.click(symbolEditor.getByRole('button', { name: /^Add/ }));
  fireEvent.click(symbolEditor.getByRole('option', { name: new RegExp('^' + symbol, 'i') }));
  // Direction is one tap too: the choice records it and closes the sheet.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Direction' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Long' }));
}

/** Record Open's Save minimum: identity on Step 1, Risk at Entry on Plan & Risk. */
function fillAtEntry() {
  fillIdentity('xauusd');
  fireEvent.click(screen.getByRole('button', { name: /^Step 2 of 4: / }));
  fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
}

/**
 * Save Open Trade: the last step's button, or Save now from Plan & Risk on.
 * From Step 1 there is neither, so a trader goes on to Plan & Risk first.
 */
function saveAtEntry() {
  if (screen.queryAllByRole('button', { name: 'Save open trade' }).length === 0) {
    fireEvent.click(screen.getByRole('button', { name: /^Step 2 of 4: / }));
  }
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
    // Both step flows say it as one compact row.
    expect(screen.getByRole('status')).toHaveTextContent(copy.recoveredCompact);
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Direction' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Long' }));
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
    // After Trade says it as one compact row.
    expect(screen.getByRole('status')).toHaveTextContent(copy.recoveredCompact);
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
    fillIdentity('eurusd');
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

  /*
    AFTER TRADE NEVER GIVES DISCARD A ROW OF ITS OWN. With work but nothing
    restored, it sits in the step's mode row after Change; the page's status row
    is not rendered at all. It is the same confirmed action.
  */
  it('puts After Trade’s Discard in the mode row, not a row of its own', () => {
    mount('after_trade');
    fillIdentity('XAUUSD');
    expect(stored()).not.toBeNull();
    expect(document.querySelector('[data-recording-draft-status]')).toBeNull();
    const discard = screen.getByRole('button', { name: copy.discard });
    expect(discard).toHaveTextContent(copy.discardShort);
    // Beside Change, in the row that says which mode this is.
    const modeRow = document.querySelector('[data-recording-mode="after_trade"]')!.parentElement!;
    expect(modeRow).toContainElement(discard);

    fireEvent.click(discard);
    fireEvent.click(screen.getByRole('button', { name: copy.keep }));
    expect(stored()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.discard }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: copy.discardConfirm }),
    );
    expect(stored()).toBeNull();
    expect(screen.queryByRole('button', { name: copy.discard })).toBeNull();
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

describe('Recording Draft — a Save key never reports a Save that did not happen', () => {
  const replay = en.trades.create.replay;

  it('keeps the draft on a replay conflict, and only an explicit press saves with a new key', async () => {
    createTradeMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'mutation_replay_conflict', existingTradeId: 'trade-saved-elsewhere' },
    });
    mount();
    fillAtEntry();
    saveAtEntry();
    await screen.findAllByText(replay.conflictTitle);
    expect(pushMock).not.toHaveBeenCalled();
    expect(stored()?.atEntry?.symbol).toBe('xauusd');
    const openSaved = screen.getAllByRole('link', { name: replay.openSaved })[0]!;
    expect(openSaved.getAttribute('href')).toBe('/app/trades?trade=trade-saved-elsewhere');
    // Nothing regenerates the key on its own: a plain retry replays the old one.
    const firstKey = sentMutationKey(0);
    expect(stored()?.mutationKey).toBe(firstKey);

    fireEvent.click(screen.getAllByRole('button', { name: replay.saveAsNew })[0]!);
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(sentMutationKey(1)).not.toBe(firstKey);
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=trade-1'));
    expect(stored()).toBeNull();
  });

  it('treats a key owned by a pre-fingerprint Trade as unverifiable: the draft stays, Save as new is explicit', async () => {
    createTradeMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'mutation_replay_conflict',
        existingTradeId: 'trade-before-0024',
        replayConflict: 'unverifiable',
      },
    });
    mount();
    fillAtEntry();
    saveAtEntry();
    await screen.findAllByText(replay.unverifiableTitle);
    expect(screen.queryByText(replay.conflictTitle)).toBeNull();
    expect(screen.queryByRole('heading', { name: replay.alreadyTitle })).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    const draft = stored();
    expect(draft?.atEntry?.symbol).toBe('xauusd');
    expect(draft?.atEntry?.risk).toBe('100');
    expect(screen.getAllByRole('link', { name: replay.openSaved })[0]!.getAttribute('href')).toBe(
      '/app/trades?trade=trade-before-0024',
    );

    const firstKey = sentMutationKey(0);
    fireEvent.click(screen.getAllByRole('button', { name: replay.saveAsNew })[0]!);
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(2));
    expect(sentMutationKey(1)).not.toBe(firstKey);
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=trade-1'));
    expect(stored()).toBeNull();
  });

  it('says an honest replay was already saved instead of presenting a new Save', async () => {
    createTradeMock.mockResolvedValueOnce({
      ok: true,
      data: { tradeId: 'trade-1', alreadyCreated: true },
    });
    mount();
    fillAtEntry();
    saveAtEntry();
    expect(await screen.findByRole('heading', { name: replay.alreadyTitle })).toBeVisible();
    expect(pushMock).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: replay.openTrade }));
    expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=trade-1');
  });

  it('shows the After Trade replay conflict and keeps both modes of the draft', async () => {
    createCompletedTradeMock.mockResolvedValueOnce({
      ok: false,
      error: { code: 'mutation_replay_conflict', existingTradeId: 'trade-open' },
    });
    mount('after_trade');
    fillIdentity('eurusd');
    // Save lives on the After Trade flow's last step.
    fireEvent.click(screen.getByRole('button', { name: /^Step 5 of 5: / }));
    fireEvent.click(screen.getByRole('button', { name: 'Save closed trade' }));
    await screen.findAllByText(replay.conflictTitle);
    expect(screen.queryByRole('heading', { name: 'Trade saved' })).toBeNull();
    expect(stored()?.afterTrade?.symbol).toBe('eurusd');
  });
});

describe('Recording Draft — another tab on the same draft', () => {
  it('says when another tab saved or discarded the draft', async () => {
    mount();
    fillAtEntry();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: null }));
    });
    expect(await screen.findByText(copy.removedElsewhere)).toBeVisible();
  });

  it('offers the other tab latest version instead of overwriting it silently', async () => {
    mount();
    fillAtEntry();
    const current = stored()!;
    const theirs = { ...current, atEntry: { ...current.atEntry!, symbol: 'gbpjpy' } };
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(theirs) }),
      );
    });
    expect(await screen.findByText(copy.changedElsewhere)).toBeVisible();
    // The other tab's write is what storage holds; loading it shows it here.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theirs));
    fireEvent.click(screen.getByRole('button', { name: copy.loadLatest }));
    expect(symbolValue()).toBe('GBPJPY');
  });

  it('ignores storage events for another user or workspace', () => {
    mount();
    fillAtEntry();
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'tradechemist:recording-draft:owner-b:workspace-a',
          newValue: null,
        }),
      );
    });
    expect(screen.queryByText(copy.removedElsewhere)).toBeNull();
  });
});

describe('Recording Draft — saving one mode never silently drops the other', () => {
  function afterTradeWorkThenAtEntry() {
    const after = mount('after_trade');
    fillIdentity('xauusd');
    fireEvent.change(document.getElementById('after-finalPnl')!, { target: { value: '250' } });
    after.unmount();
    mount('at_entry');
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
  }

  it('asks before an At Entry Save removes After Trade answers, and keeping editing keeps them', async () => {
    afterTradeWorkThenAtEntry();
    saveAtEntry();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(copy.inactive.items.finalPnl);
    fireEvent.click(screen.getByRole('button', { name: copy.inactive.keep }));
    await vi.waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(createTradeMock).not.toHaveBeenCalled();
    expect(stored()?.afterTrade?.finalPnl).toBe('250');
  });

  it('saves only after confirmation, and clears the draft only after the server confirms', async () => {
    createTradeMock.mockResolvedValueOnce({ ok: false, error: { code: 'unexpected_error' } });
    afterTradeWorkThenAtEntry();
    saveAtEntry();
    fireEvent.click(await screen.findByRole('button', { name: copy.inactive.confirm }));
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    // A failed Save keeps both modes' work.
    expect(stored()?.afterTrade?.finalPnl).toBe('250');

    saveAtEntry();
    fireEvent.click(await screen.findByRole('button', { name: copy.inactive.confirm }));
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=trade-1'));
    expect(stored()).toBeNull();
  });

  it('does not ask when the other mode holds no answer of its own', async () => {
    const after = mount('after_trade');
    fillIdentity('xauusd');
    after.unmount();
    mount('at_entry');
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '100' } });
    saveAtEntry();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('Recording Draft — a chosen answer whose source went away', () => {
  const entryCopy = en.trades.create.recording.contractEntry;

  function recoverWith(
    patch: (atEntry: NonNullable<ReturnType<typeof stored>>['atEntry']) => object,
  ) {
    const first = mount();
    fillAtEntry();
    first.unmount();
    const envelope = stored()!;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...envelope,
        atEntry: { ...envelope.atEntry!, ...patch(envelope.atEntry) },
      }),
    );
    mount();
  }

  it('keeps an archived Strategy chosen, says so, and waits for the trader before saving', async () => {
    recoverWith((atEntry) => ({
      classification: { ...atEntry!.classification, strategy: 'selected', strategyId: 'gone' },
    }));
    expect(screen.getByText(entryCopy.strategy.strategyUnavailable)).toBeInTheDocument();
    expect(stored()?.atEntry?.classification.strategyId).toBe('gone');
    saveAtEntry();
    await screen.findAllByText(entryCopy.save.staleBlocked);
    expect(createTradeMock).not.toHaveBeenCalled();

    // The explicit resolution: remove the answer in its editor, then Save proceeds.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Strategy' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: entryCopy.strategy.removeStrategyAria,
      }),
    );
    saveAtEntry();
    await vi.waitFor(() => expect(createTradeMock).toHaveBeenCalledTimes(1));
  });

  it('never reads an archived saved Exit Plan as Not recorded', async () => {
    recoverWith((atEntry) => ({
      exitPlan: { ...atEntry!.exitPlan, choice: { kind: 'saved', exitPlanId: 'archived-plan' } },
    }));
    expect(screen.getByText(entryCopy.exitPlan.unavailable)).toBeInTheDocument();
    expect(document.querySelector('[data-exit-plan-state="unavailable"]')).not.toBeNull();
    saveAtEntry();
    await screen.findAllByText(entryCopy.save.staleBlocked);
    expect(createTradeMock).not.toHaveBeenCalled();
    expect(stored()?.atEntry?.exitPlan.choice).toEqual({
      kind: 'saved',
      exitPlanId: 'archived-plan',
    });
  });
});
