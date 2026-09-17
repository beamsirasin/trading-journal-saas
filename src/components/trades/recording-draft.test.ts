import { beforeEach, describe, expect, it } from 'vitest';

import { createAfterTradeDraft } from './after-trade-draft';
import {
  answerCondition,
  answerNoStrategy,
  chooseSavedExitPlan,
  confirmEntryTime,
  createAtEntryDraft,
  editEntryTime,
  followClock,
  selectSetup,
  selectStrategy,
  setActualRiskAmount,
  setConfidence,
  setTargetValue,
  toggleEmotion,
  type AtEntryDraft,
} from './at-entry-draft';
import {
  createRecordingDraft,
  parseRecordingDraft,
  RECORDING_DRAFT_RETENTION_MS,
  recordingDraftHasWork,
  serializeRecordingDraft,
  switchRecordingMode,
  type RecordingDraftEnvelope,
} from './recording-draft';
import {
  clearOwnerRecordingDrafts,
  loadRecordingDraft,
  ownerRecordingDrafts,
  removeRecordingDraft,
  saveRecordingDraft,
} from './recording-draft-storage';

const ACCOUNT = '018f0000-0000-7000-8000-000000000001';
const OTHER_ACCOUNT = '018f0000-0000-7000-8000-000000000002';
const BREAKOUT = '018f0000-0000-7000-8000-000000000010';
const RETEST = '018f0000-0000-7000-8000-000000000020';
const SCALE_OUT = '018f0000-0000-7000-8000-000000000030';
const KEY = '018f0000-0000-7000-8000-0000000000aa';
const NOW = new Date('2026-09-17T08:00:00.000Z');
const CONTEXT = { defaultTradingAccountId: ACCOUNT, now: NOW };

function envelopeWith(atEntry: AtEntryDraft): RecordingDraftEnvelope {
  return {
    ...createRecordingDraft({
      mode: 'at_entry',
      tradingAccountId: ACCOUNT,
      mutationKey: KEY,
      now: NOW,
    }),
    atEntry,
  };
}

/** An At Entry draft full of explicit answers AND untouched defaults. */
function workedAtEntry(): AtEntryDraft {
  let draft = createAtEntryDraft(ACCOUNT);
  draft = { ...draft, symbol: 'XAUUSD', direction: 'long', risk: '100' };
  draft = selectStrategy(draft, BREAKOUT);
  draft = selectSetup(draft, RETEST);
  draft = answerCondition(draft, 'candle', 'met');
  draft = setConfidence(draft, 75);
  draft = toggleEmotion(draft, 'calm');
  draft = setTargetValue(draft, 'profit', '200');
  draft = chooseSavedExitPlan(draft, SCALE_OUT, { exitPlans: [] });
  draft = {
    ...draft,
    context: { ...draft.context, reason: 'Breakout retest held', entryPrice: '2400' },
  };
  // The entry time still follows the clock: an untouched default.
  return followClock(draft, '2026-09-17T15:00');
}

describe('At Entry → After Trade', () => {
  it('carries explicit shared values', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.activeMode).toBe('after_trade');
    expect(switched.afterTrade?.values).toMatchObject({
      tradingAccountId: ACCOUNT,
      symbol: 'XAUUSD',
      direction: 'long',
      plannedRisk: '100',
      strategyId: BREAKOUT,
      setupId: RETEST,
      confidence: '75',
      confirmationNotes: 'Breakout retest held',
    });
    expect(switched.afterTrade?.emotions).toEqual(['calm']);
  });

  it('never turns an untouched "now" entry time into a historical answer', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.values.enteredAt).toBe('');
  });

  it('carries an entry time the trader confirmed or edited', () => {
    const confirmed = confirmEntryTime(workedAtEntry());
    expect(
      switchRecordingMode(envelopeWith(confirmed), 'after_trade', CONTEXT).afterTrade?.values
        .enteredAt,
    ).toBe('2026-09-17T15:00');
    const edited = editEntryTime(workedAtEntry(), '2026-09-17T09:30');
    expect(
      switchRecordingMode(envelopeWith(edited), 'after_trade', CONTEXT).afterTrade?.values
        .enteredAt,
    ).toBe('2026-09-17T09:30');
  });

  it('leaves Actual Risk, the Exit Plan, Target and conditions out of After Trade', () => {
    // A Different Actual Risk amount, a saved Exit Plan, a Fixed Target and a Met
    // condition exist At Entry. Current After Trade cannot represent any of
    // them honestly, so none becomes an After Trade answer.
    const atEntry = setActualRiskAmount(workedAtEntry(), '150');
    const switched = switchRecordingMode(envelopeWith(atEntry), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.values).toMatchObject({
      actualRisk: '',
      plannedReward: '',
      plannedEntry: '',
    });
    expect(switched.afterTrade?.conditionMet).toEqual({});
    // …and every one of them is still in the draft.
    expect(switched.atEntry).toEqual(atEntry);
  });

  it('does not carry the Matched Actual Risk default', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.values.actualRisk).toBe('');
  });

  it('does not carry an automatically inherited Strategy Exit Plan', () => {
    // `inherit` is the untouched default choice; After Trade has no Exit Plan to receive it.
    const inherited = {
      ...workedAtEntry(),
      exitPlan: { choice: { kind: 'inherit' as const }, customText: '', customBaseId: null },
    };
    const switched = switchRecordingMode(envelopeWith(inherited), 'after_trade', CONTEXT);
    expect(JSON.stringify(switched.afterTrade)).not.toContain(SCALE_OUT);
    expect(switched.atEntry?.exitPlan.choice).toEqual({ kind: 'inherit' });
  });
});

describe('round trips', () => {
  it('At Entry → After Trade → At Entry restores every At Entry answer', () => {
    const original = setActualRiskAmount(workedAtEntry(), '150');
    const there = switchRecordingMode(envelopeWith(original), 'after_trade', CONTEXT);
    const back = switchRecordingMode(there, 'at_entry', CONTEXT);
    expect(back.atEntry).toEqual(original);
    expect(back.afterTrade).toEqual(there.afterTrade);
  });

  it('carries back only what was changed in After Trade', () => {
    const noStrategy = answerNoStrategy({ ...createAtEntryDraft(ACCOUNT), symbol: 'EURUSD' });
    const there = switchRecordingMode(envelopeWith(noStrategy), 'after_trade', CONTEXT);
    const edited: RecordingDraftEnvelope = {
      ...there,
      afterTrade: there.afterTrade && {
        ...there.afterTrade,
        values: { ...there.afterTrade.values, symbol: 'GBPUSD', finalPnl: '50' },
      },
    };
    const back = switchRecordingMode(edited, 'at_entry', CONTEXT);
    expect(back.atEntry?.symbol).toBe('GBPUSD');
    // After Trade has no "No Strategy" answer and its blank never erases one.
    expect(back.atEntry?.classification.strategy).toBe('none');
    // The After Trade result stays in the draft.
    expect(back.afterTrade?.values.finalPnl).toBe('50');
  });

  it('After Trade → At Entry → After Trade restores After Trade work and never invents At Entry assertions', () => {
    const afterTrade = createAfterTradeDraft(ACCOUNT);
    const start: RecordingDraftEnvelope = {
      ...createRecordingDraft({
        mode: 'after_trade',
        tradingAccountId: ACCOUNT,
        mutationKey: KEY,
        now: NOW,
      }),
      afterTrade: {
        ...afterTrade,
        values: {
          ...afterTrade.values,
          symbol: 'NAS100',
          direction: 'short',
          finalPnl: '-40',
          exitedAt: '2026-09-16T20:00',
        },
        completeness: 'incomplete',
        exits: [
          { id: 'leg', closedPercent: '50', scope: 'part', value: '-20', exitedAt: '', reason: '' },
        ],
      },
    };
    const atEntry = switchRecordingMode(start, 'at_entry', CONTEXT);
    // Shared identity arrives; no historical answer becomes an At Entry assertion.
    expect(atEntry.atEntry).toMatchObject({ symbol: 'NAS100', direction: 'short' });
    expect(atEntry.atEntry?.entryTime.source).toBe('default_now');
    expect(atEntry.atEntry?.actualRisk.mode).toBe('matched');
    expect(atEntry.atEntry?.target.state).toBe('unanswered');
    const back = switchRecordingMode(atEntry, 'after_trade', CONTEXT);
    expect(back.afterTrade).toEqual(start.afterTrade);
  });

  it('a clear made in the other mode crosses back as a clear', () => {
    const there = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    const cleared: RecordingDraftEnvelope = {
      ...there,
      afterTrade: there.afterTrade && {
        ...there.afterTrade,
        values: { ...there.afterTrade.values, strategyId: '', setupId: '' },
      },
    };
    const back = switchRecordingMode(cleared, 'at_entry', CONTEXT);
    expect(back.atEntry?.classification.strategy).toBe('unanswered');
    // The Setup answer under that Strategy is still preserved as draft data.
    expect(back.atEntry?.classification.setupByStrategy[BREAKOUT]).toEqual({
      answer: 'selected',
      setupId: RETEST,
    });
  });

  it('does not overwrite an account the first time the arriving mode is fresh and the source has none', () => {
    const blank = envelopeWith({ ...createAtEntryDraft(''), symbol: 'XAUUSD' });
    const switched = switchRecordingMode(blank, 'after_trade', {
      defaultTradingAccountId: OTHER_ACCOUNT,
      now: NOW,
    });
    expect(switched.afterTrade?.values.tradingAccountId).toBe(OTHER_ACCOUNT);
  });
});

describe('persisted shape', () => {
  const envelope = () => switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);

  it('round-trips exactly', () => {
    expect(parseRecordingDraft(serializeRecordingDraft(envelope()), NOW)).toEqual({
      status: 'recovered',
      envelope: envelope(),
    });
  });

  it('reports malformed storage as unrecoverable and never throws', () => {
    expect(parseRecordingDraft('{not json', NOW)).toEqual({
      status: 'unrecoverable',
      reason: 'corrupt',
    });
    expect(parseRecordingDraft('null', NOW)).toEqual({
      status: 'unrecoverable',
      reason: 'corrupt',
    });
    const truncated = JSON.parse(serializeRecordingDraft(envelope())) as Record<string, unknown>;
    delete truncated.atEntry;
    expect(parseRecordingDraft(JSON.stringify(truncated), NOW)).toEqual({
      status: 'unrecoverable',
      reason: 'corrupt',
    });
    const wrongType = { ...JSON.parse(serializeRecordingDraft(envelope())), activeMode: 'review' };
    expect(parseRecordingDraft(JSON.stringify(wrongType), NOW)).toEqual({
      status: 'unrecoverable',
      reason: 'corrupt',
    });
  });

  it('refuses another schema version instead of reinterpreting its answers', () => {
    const future = { ...JSON.parse(serializeRecordingDraft(envelope())), version: 2 };
    expect(parseRecordingDraft(JSON.stringify(future), NOW)).toEqual({
      status: 'unrecoverable',
      reason: 'unsupported_version',
    });
    const legacy = { symbol: 'XAUUSD', direction: 'long' };
    expect(parseRecordingDraft(JSON.stringify({ ...legacy, version: 0 }), NOW).status).toBe(
      'unrecoverable',
    );
  });

  it('expires a draft untouched beyond the retention window, and keeps one inside it', () => {
    const raw = serializeRecordingDraft(envelope());
    expect(
      parseRecordingDraft(raw, new Date(NOW.getTime() + RECORDING_DRAFT_RETENTION_MS - 1)).status,
    ).toBe('recovered');
    expect(
      parseRecordingDraft(raw, new Date(NOW.getTime() + RECORDING_DRAFT_RETENTION_MS + 1)).status,
    ).toBe('expired');
  });

  it('knows a pristine draft holds no work', () => {
    const pristine = createRecordingDraft({
      mode: 'at_entry',
      tradingAccountId: ACCOUNT,
      mutationKey: KEY,
      now: NOW,
    });
    expect(recordingDraftHasWork(pristine, ACCOUNT)).toBe(false);
    expect(recordingDraftHasWork(envelope(), ACCOUNT)).toBe(true);
  });
});

describe('browser storage scope', () => {
  const USER_A = { ownerKey: 'owner-a', workspaceKey: 'workspace-1' };
  const USER_A_OTHER_WORKSPACE = { ownerKey: 'owner-a', workspaceKey: 'workspace-2' };
  const USER_B = { ownerKey: 'owner-b', workspaceKey: 'workspace-1' };
  const draftFor = (symbol: string) => envelopeWith({ ...createAtEntryDraft(ACCOUNT), symbol });

  beforeEach(() => window.localStorage.clear());

  it('keeps each workspace and each user to its own draft', () => {
    saveRecordingDraft(USER_A, draftFor('XAUUSD'));
    expect(loadRecordingDraft(USER_A_OTHER_WORKSPACE, NOW)).toEqual({ status: 'none' });
    expect(loadRecordingDraft(USER_B, NOW)).toEqual({ status: 'none' });
    saveRecordingDraft(USER_A_OTHER_WORKSPACE, draftFor('EURUSD'));
    const back = loadRecordingDraft(USER_A, NOW);
    expect(back.status === 'recovered' && back.envelope.atEntry?.symbol).toBe('XAUUSD');
  });

  it('discarding one scope leaves every other draft alone', () => {
    saveRecordingDraft(USER_A, draftFor('XAUUSD'));
    saveRecordingDraft(USER_A_OTHER_WORKSPACE, draftFor('EURUSD'));
    saveRecordingDraft(USER_B, draftFor('GBPUSD'));
    removeRecordingDraft(USER_A);
    expect(loadRecordingDraft(USER_A, NOW)).toEqual({ status: 'none' });
    expect(loadRecordingDraft(USER_A_OTHER_WORKSPACE, NOW).status).toBe('recovered');
    expect(loadRecordingDraft(USER_B, NOW).status).toBe('recovered');
  });

  it('sign-out clears every draft of that user and nobody else', () => {
    saveRecordingDraft(USER_A, draftFor('XAUUSD'));
    saveRecordingDraft(USER_A_OTHER_WORKSPACE, draftFor(''));
    saveRecordingDraft(USER_B, draftFor('GBPUSD'));
    window.localStorage.setItem('tradechemist:recording-draft:owner-a:broken', '{oops');
    expect(ownerRecordingDrafts('owner-a', NOW)).toEqual(
      expect.arrayContaining([{ symbol: 'XAUUSD' }, { symbol: null }, { symbol: null }]),
    );
    clearOwnerRecordingDrafts('owner-a');
    expect(ownerRecordingDrafts('owner-a', NOW)).toEqual([]);
    expect(loadRecordingDraft(USER_B, NOW).status).toBe('recovered');
  });

  it('reports an unreadable stored draft as unrecoverable without deleting it', () => {
    window.localStorage.setItem('tradechemist:recording-draft:owner-a:workspace-1', '{oops');
    expect(loadRecordingDraft(USER_A, NOW)).toEqual({ status: 'unrecoverable', reason: 'corrupt' });
    expect(window.localStorage.getItem('tradechemist:recording-draft:owner-a:workspace-1')).toBe(
      '{oops',
    );
  });

  it('removes an expired draft on read', () => {
    saveRecordingDraft(USER_A, draftFor('XAUUSD'));
    expect(
      loadRecordingDraft(USER_A, new Date(NOW.getTime() + RECORDING_DRAFT_RETENTION_MS + 1)),
    ).toEqual({ status: 'expired' });
    expect(loadRecordingDraft(USER_A, NOW)).toEqual({ status: 'none' });
  });
});
