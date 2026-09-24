import { beforeEach, describe, expect, it } from 'vitest';

import {
  answerCondition as answerAfterTradeCondition,
  createAfterTradeDraft,
  selectSetup as selectAfterTradeSetup,
  selectStrategy as selectAfterTradeStrategy,
  setActualRiskAnswer,
  type AfterTradeDraft,
} from './after-trade-draft';
import {
  answerCondition,
  answerNoStrategy,
  chooseNoExitRule,
  chooseSavedExitPlan,
  confirmEntryTime,
  createAtEntryDraft,
  editEntryTime,
  followClock,
  selectSetup,
  selectStrategy,
  setActualRiskAmount,
  setActualRiskMode,
  setConfidence,
  setRiskState,
  setStopMethod,
  setTargetValue,
  toggleEmotion,
  type AtEntryDraft,
} from './at-entry-draft';
import {
  createRecordingDraft,
  inactiveModeWork,
  parseRecordingDraft,
  RECORDING_DRAFT_RETENTION_MS,
  RECORDING_DRAFT_VERSION,
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

function afterTradeEnvelope(afterTrade: AfterTradeDraft): RecordingDraftEnvelope {
  return {
    ...createRecordingDraft({
      mode: 'after_trade',
      tradingAccountId: ACCOUNT,
      mutationKey: KEY,
      now: NOW,
    }),
    afterTrade,
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
  // The entry time still follows the clock, and Actual Risk is still the
  // Matched assumption: two untouched defaults.
  return followClock(draft, '2026-09-17T15:00');
}

describe('At Entry → After Trade', () => {
  it('carries explicit shared answers whose meaning is the same in both modes', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.activeMode).toBe('after_trade');
    expect(switched.afterTrade).toMatchObject({
      tradingAccountId: ACCOUNT,
      symbol: 'XAUUSD',
      direction: 'long',
      risk: '100',
      target: { state: 'fixed', profit: '200', price: '' },
      exitPlan: { choice: { kind: 'saved', exitPlanId: SCALE_OUT } },
      confidence: 75,
      emotions: { answer: 'selected', keys: ['calm'] },
      context: { reason: 'Breakout retest held', entryPrice: '2400' },
      classification: {
        strategy: 'selected',
        strategyId: BREAKOUT,
        setupByStrategy: { [BREAKOUT]: { answer: 'selected', setupId: RETEST } },
        conditions: { [BREAKOUT]: { [RETEST]: { candle: 'met' } } },
      },
    });
  });

  it('never turns an untouched "now" entry time into a historical answer', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.enteredAt).toBe('');
  });

  it('carries an entry time the trader confirmed or edited', () => {
    const confirmed = confirmEntryTime(workedAtEntry());
    expect(
      switchRecordingMode(envelopeWith(confirmed), 'after_trade', CONTEXT).afterTrade?.enteredAt,
    ).toBe('2026-09-17T15:00');
    const edited = editEntryTime(workedAtEntry(), '2026-09-17T09:30');
    expect(
      switchRecordingMode(envelopeWith(edited), 'after_trade', CONTEXT).afterTrade?.enteredAt,
    ).toBe('2026-09-17T09:30');
  });

  it('does not carry the Matched Actual Risk assumption: After Trade starts Unanswered', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.actualRisk).toEqual({ answer: 'unanswered', amount: '' });
  });

  it('carries an explicit Actual Risk "Different", with or without its amount', () => {
    const withAmount = switchRecordingMode(
      envelopeWith(setActualRiskAmount(workedAtEntry(), '150')),
      'after_trade',
      CONTEXT,
    );
    expect(withAmount.afterTrade?.actualRisk).toEqual({ answer: 'different', amount: '150' });
    const unknownAmount = switchRecordingMode(
      envelopeWith(setActualRiskMode(workedAtEntry(), 'different_unknown')),
      'after_trade',
      CONTEXT,
    );
    expect(unknownAmount.afterTrade?.actualRisk).toEqual({ answer: 'different', amount: '' });
  });

  it('does not carry an automatically inherited Strategy Exit Plan', () => {
    const inherited = {
      ...workedAtEntry(),
      exitPlan: { choice: { kind: 'inherit' as const }, customText: '', customBaseId: null },
    };
    const switched = switchRecordingMode(envelopeWith(inherited), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.exitPlan.choice).toEqual({ kind: 'unanswered' });
    expect(switched.atEntry?.exitPlan.choice).toEqual({ kind: 'inherit' });
  });

  it('carries an explicit No Defined Exit Rule and No Strategy', () => {
    const answered = answerNoStrategy(chooseNoExitRule(workedAtEntry()));
    const switched = switchRecordingMode(envelopeWith(answered), 'after_trade', CONTEXT);
    expect(switched.afterTrade?.exitPlan.choice).toEqual({ kind: 'no_rule' });
    expect(switched.afterTrade?.classification.strategy).toBe('none');
  });

  it('keeps every At Entry answer in its own section', () => {
    const atEntry = setActualRiskAmount(workedAtEntry(), '150');
    const switched = switchRecordingMode(envelopeWith(atEntry), 'after_trade', CONTEXT);
    expect(switched.atEntry).toEqual(atEntry);
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

  it('carries back only what was changed in After Trade, and keeps After Trade work', () => {
    const noStrategy = answerNoStrategy({ ...createAtEntryDraft(ACCOUNT), symbol: 'EURUSD' });
    const there = switchRecordingMode(envelopeWith(noStrategy), 'after_trade', CONTEXT);
    const edited: RecordingDraftEnvelope = {
      ...there,
      afterTrade: there.afterTrade && {
        ...there.afterTrade,
        symbol: 'GBPUSD',
        finalPnl: '50',
        outcome: 'win',
      },
    };
    const back = switchRecordingMode(edited, 'at_entry', CONTEXT);
    expect(back.atEntry?.symbol).toBe('GBPUSD');
    expect(back.atEntry?.classification.strategy).toBe('none');
    // The After Trade result stays in its own section, never an At Entry answer.
    expect(back.afterTrade).toMatchObject({ finalPnl: '50', outcome: 'win' });
  });

  it('After Trade → At Entry → After Trade restores After Trade work and never invents At Entry assertions', () => {
    const afterTrade: AfterTradeDraft = {
      ...setActualRiskAnswer(createAfterTradeDraft(ACCOUNT), 'unknown'),
      symbol: 'NAS100',
      direction: 'short',
      finalPnl: '-40',
      outcome: 'loss',
      exitedAt: '2026-09-16T20:00',
      completeness: 'incomplete',
      exits: [
        {
          id: 'leg',
          scope: 'unknown',
          pnl: '-20',
          closedPercent: '',
          exitedAt: '',
          price: '',
          reason: 'Stopped out',
        },
      ],
      postTradeEmotions: { answer: 'selected', keys: ['frustrated'] },
    };
    const start = afterTradeEnvelope(afterTrade);
    const atEntry = switchRecordingMode(start, 'at_entry', CONTEXT);
    // Shared identity arrives; no historical answer becomes an At Entry assertion.
    expect(atEntry.atEntry).toMatchObject({ symbol: 'NAS100', direction: 'short' });
    expect(atEntry.atEntry?.entryTime.source).toBe('default_now');
    // Not even a match: an answer about a historical Trade says nothing about
    // the risk carried on this one (contract §2, §8).
    expect(atEntry.atEntry?.actualRisk.mode).toBe('unanswered');
    expect(atEntry.atEntry?.target.state).toBe('unanswered');
    const back = switchRecordingMode(atEntry, 'after_trade', CONTEXT);
    expect(back.afterTrade).toEqual(start.afterTrade);
  });

  it('never shows a "Don’t remember" condition in At Entry, and keeps it in After Trade', () => {
    let afterTrade = selectAfterTradeStrategy(createAfterTradeDraft(ACCOUNT), BREAKOUT);
    afterTrade = selectAfterTradeSetup(afterTrade, RETEST);
    afterTrade = answerAfterTradeCondition(afterTrade, 'candle', 'met');
    afterTrade = answerAfterTradeCondition(afterTrade, 'retest', 'unknown');
    const atEntry = switchRecordingMode(afterTradeEnvelope(afterTrade), 'at_entry', CONTEXT);
    expect(atEntry.atEntry?.classification.conditions).toEqual({
      [BREAKOUT]: { [RETEST]: { candle: 'met' } },
    });
    // Answering the Met condition differently in At Entry crosses back; the
    // unknown one At Entry never saw stays as it was.
    const changed: RecordingDraftEnvelope = {
      ...atEntry,
      atEntry: atEntry.atEntry && answerCondition(atEntry.atEntry, 'candle', 'not_met'),
    };
    const back = switchRecordingMode(changed, 'after_trade', CONTEXT);
    expect(back.afterTrade?.classification.conditions).toEqual({
      [BREAKOUT]: { [RETEST]: { candle: 'not_met', retest: 'unknown' } },
    });
  });

  it('a clear made in the other mode crosses back as a clear', () => {
    const there = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    const cleared: RecordingDraftEnvelope = {
      ...there,
      afterTrade: there.afterTrade && {
        ...there.afterTrade,
        classification: { ...there.afterTrade.classification, strategy: 'unanswered' },
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

  it('withdrawing "Different" in After Trade returns At Entry to Unanswered, never to Matched', () => {
    const there = switchRecordingMode(
      envelopeWith(setActualRiskAmount(workedAtEntry(), '150')),
      'after_trade',
      CONTEXT,
    );
    const withdrawn: RecordingDraftEnvelope = {
      ...there,
      afterTrade: there.afterTrade && setActualRiskAnswer(there.afterTrade, 'unknown'),
    };
    const back = switchRecordingMode(withdrawn, 'at_entry', CONTEXT);
    expect(back.atEntry?.actualRisk.mode).toBe('unanswered');
  });

  it('does not overwrite an account the first time the arriving mode is fresh and the source has none', () => {
    const blank = envelopeWith({ ...createAtEntryDraft(''), symbol: 'XAUUSD' });
    const switched = switchRecordingMode(blank, 'after_trade', {
      defaultTradingAccountId: OTHER_ACCOUNT,
      now: NOW,
    });
    expect(switched.afterTrade?.tradingAccountId).toBe(OTHER_ACCOUNT);
  });
});

describe('persisted shape', () => {
  const envelope = () => switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);

  it('keeps a typed System Result through a reload, and reads an older draft as Unanswered', () => {
    const answered: AfterTradeDraft = {
      ...createAfterTradeDraft(ACCOUNT),
      planOutcome: { outcome: 'exit_plan_result', amount: '300' },
    };
    const stored = afterTradeEnvelope(answered);
    const parsed = parseRecordingDraft(serializeRecordingDraft(stored), NOW);
    expect(parsed).toEqual({ status: 'recovered', envelope: stored });

    // Written before decision 55: no System Result at all — never an answer.
    const older = JSON.parse(serializeRecordingDraft(stored)) as {
      afterTrade: Record<string, unknown>;
    };
    delete older.afterTrade.planOutcome;
    const reread = parseRecordingDraft(JSON.stringify(older), NOW);
    expect(reread.status).toBe('recovered');
    expect(reread.status === 'recovered' && reread.envelope.afterTrade?.planOutcome).toEqual({
      outcome: null,
      amount: '',
    });
  });

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

  /*
    RELOAD KEEPS THE DISTINCTION. An answer the trader gave and an answer
    nobody gave must still be different after a round trip through storage —
    otherwise the Save that follows a reload would claim what the Save before
    it did not.
  */
  it('keeps a stated Matched, an Unanswered and a Different apart across a reload', () => {
    for (const mode of ['unanswered', 'matched', 'different_unknown'] as const) {
      const stored = envelopeWith({
        ...workedAtEntry(),
        actualRisk: { mode, amount: '' },
      });
      const parsed = parseRecordingDraft(serializeRecordingDraft(stored), NOW);
      expect(parsed.status).toBe('recovered');
      expect(parsed.status === 'recovered' ? parsed.envelope.atEntry?.actualRisk.mode : null).toBe(
        mode,
      );
    }
    const different = envelopeWith(setActualRiskAmount(workedAtEntry(), '150'));
    const parsed = parseRecordingDraft(serializeRecordingDraft(different), NOW);
    expect(parsed.status === 'recovered' ? parsed.envelope.atEntry?.actualRisk : null).toEqual({
      mode: 'different',
      amount: '150',
    });
  });

  /*
    A v2 DRAFT CANNOT TELL THE TWO APART, because v2 spelled the untouched
    default `matched`. It is read as Unanswered: re-answering costs one tap,
    while the other reading would manufacture a positive observation.
  */
  it("reads a v2 draft's Matched as Unanswered, and leaves its Different alone", () => {
    const current = JSON.parse(serializeRecordingDraft(envelopeWith(workedAtEntry())));
    const v2Matched = {
      ...current,
      version: 2,
      atEntry: { ...current.atEntry, actualRisk: { mode: 'matched', amount: '' } },
    };
    const matched = parseRecordingDraft(JSON.stringify(v2Matched), NOW);
    expect(matched.status).toBe('recovered');
    expect(matched.status === 'recovered' ? matched.envelope.atEntry?.actualRisk.mode : null).toBe(
      'unanswered',
    );
    expect(matched.status === 'recovered' ? matched.envelope.version : null).toBe(
      RECORDING_DRAFT_VERSION,
    );
    // Everything else the v2 draft held is kept.
    expect(matched.status === 'recovered' ? matched.envelope.atEntry?.symbol : null).toBe('XAUUSD');

    const v2Different = {
      ...current,
      version: 2,
      atEntry: { ...current.atEntry, actualRisk: { mode: 'different', amount: '150' } },
    };
    const different = parseRecordingDraft(JSON.stringify(v2Different), NOW);
    expect(
      different.status === 'recovered' ? different.envelope.atEntry?.actualRisk : null,
    ).toEqual({ mode: 'different', amount: '150' });
  });

  /*
    FROM v3 ON, `matched` IS A STATEMENT. v3 introduced the Unanswered default,
    so a v3 draft's Matched can only have been chosen. It must survive the v3 →
    v4 upgrade as Matched — only v2, where Matched was also the untouched
    default, is ambiguous and read as Unanswered.
  */
  it("keeps a v3 draft's explicit Matched, and its Unanswered stays Unanswered", () => {
    const current = JSON.parse(serializeRecordingDraft(envelopeWith(workedAtEntry())));
    const v3 = (actualRisk: { mode: string; amount: string }) => {
      // A v3 envelope: no risk decision yet (v4 added it), Actual Risk as stored.
      const { riskState: _decision, ...atEntry } = current.atEntry;
      return JSON.stringify({ ...current, version: 3, atEntry: { ...atEntry, actualRisk } });
    };

    const matched = parseRecordingDraft(v3({ mode: 'matched', amount: '' }), NOW);
    if (matched.status !== 'recovered') throw new Error('v3 draft not recovered');
    expect(matched.envelope.version).toBe(RECORDING_DRAFT_VERSION);
    expect(matched.envelope.atEntry?.actualRisk).toEqual({ mode: 'matched', amount: '' });
    // The v4 upgrade itself still runs: the typed amount makes the risk Defined.
    expect(matched.envelope.atEntry?.riskState).toBe('defined');

    const untouched = parseRecordingDraft(v3({ mode: 'unanswered', amount: '' }), NOW);
    if (untouched.status !== 'recovered') throw new Error('v3 draft not recovered');
    expect(untouched.envelope.atEntry?.actualRisk.mode).toBe('unanswered');

    const different = parseRecordingDraft(v3({ mode: 'different', amount: '150' }), NOW);
    if (different.status !== 'recovered') throw new Error('v3 draft not recovered');
    expect(different.envelope.atEntry?.actualRisk).toEqual({ mode: 'different', amount: '150' });
  });

  /*
    BOTH ANSWERS SURVIVE A RELOAD, and keep their explicitness: a Stop Method
    the trader chose and an Actual Risk they stated must still be different
    from the states nobody answered (contract decisions 52–53).
  */
  it('keeps Stop Method and Actual Risk, answered or not, across a reload', () => {
    const answered = envelopeWith({
      ...setStopMethod(workedAtEntry(), 'mental'),
      actualRisk: { mode: 'matched', amount: '' },
    });
    const parsed = parseRecordingDraft(serializeRecordingDraft(answered), NOW);
    expect(parsed.status).toBe('recovered');
    if (parsed.status !== 'recovered') throw new Error('unreachable');
    expect(parsed.envelope.atEntry?.stopMethod).toBe('mental');
    expect(parsed.envelope.atEntry?.actualRisk.mode).toBe('matched');

    const untouched = envelopeWith(workedAtEntry());
    const plain = parseRecordingDraft(serializeRecordingDraft(untouched), NOW);
    if (plain.status !== 'recovered') throw new Error('unreachable');
    expect(plain.envelope.atEntry?.stopMethod).toBe('unanswered');
    expect(plain.envelope.atEntry?.actualRisk.mode).toBe('unanswered');
  });

  /*
    A DRAFT WRITTEN BEFORE DECISION 53 simply has no Stop Method key. Absent
    IS Unanswered, so the draft loads whole rather than being lost, and no
    answer is invented for it.
  */
  it('loads a draft saved before Stop Method existed, as Unanswered', () => {
    const current = JSON.parse(
      serializeRecordingDraft(envelopeWith(setStopMethod(workedAtEntry(), 'broker'))),
    );
    delete current.atEntry.stopMethod;
    const parsed = parseRecordingDraft(JSON.stringify(current), NOW);
    expect(parsed.status).toBe('recovered');
    if (parsed.status !== 'recovered') throw new Error('unreachable');
    expect(parsed.envelope.atEntry?.stopMethod).toBe('unanswered');
    // And everything that draft did hold is still there.
    expect(parsed.envelope.atEntry?.symbol).toBe('XAUUSD');
    expect(parsed.envelope.atEntry?.risk).toBe('100');
  });

  /*
    THE RISK DECISION SURVIVES A RELOAD (contract decision 54), and the three
    states stay apart: a stated No Defined Risk is not an Unanswered draft.
  */
  it('keeps Unanswered, Defined and No Defined Risk apart across a reload', () => {
    for (const [riskState, risk] of [
      ['unanswered', ''],
      ['defined', '100'],
      ['no_defined', ''],
    ] as const) {
      const stored = envelopeWith({ ...workedAtEntry(), riskState, risk });
      const parsed = parseRecordingDraft(serializeRecordingDraft(stored), NOW);
      if (parsed.status !== 'recovered') throw new Error('unreachable');
      expect(parsed.envelope.atEntry?.riskState).toBe(riskState);
      expect(parsed.envelope.atEntry?.risk).toBe(risk);
    }
  });

  /*
    A DRAFT WRITTEN BEFORE THE DECISION EXISTED has only the amount the trader
    typed. An amount means they had decided a 1R; a blank means they had not
    decided yet. It NEVER becomes No Defined Risk — nobody answered that.
  */
  it('reads a pre-decision draft from its amount, and never invents No Defined Risk', () => {
    const withAmount = JSON.parse(serializeRecordingDraft(envelopeWith(workedAtEntry())));
    delete withAmount.atEntry.riskState;
    withAmount.version = 3;
    const defined = parseRecordingDraft(JSON.stringify(withAmount), NOW);
    if (defined.status !== 'recovered') throw new Error('unreachable');
    expect(defined.envelope.atEntry?.riskState).toBe('defined');
    expect(defined.envelope.atEntry?.risk).toBe('100');
    expect(defined.envelope.version).toBe(RECORDING_DRAFT_VERSION);

    const blank = JSON.parse(
      serializeRecordingDraft(envelopeWith({ ...workedAtEntry(), risk: '' })),
    );
    delete blank.atEntry.riskState;
    blank.version = 3;
    const undecided = parseRecordingDraft(JSON.stringify(blank), NOW);
    if (undecided.status !== 'recovered') throw new Error('unreachable');
    expect(undecided.envelope.atEntry?.riskState).toBe('unanswered');
  });

  it('carries the risk decision across a mode switch, with the amount it explains', () => {
    const defined = envelopeWith({ ...workedAtEntry(), riskState: 'defined', risk: '100' });
    const switched = switchRecordingMode(defined, 'after_trade', CONTEXT);
    expect(switched.afterTrade?.riskState).toBe('defined');
    expect(switched.afterTrade?.risk).toBe('100');

    // An explicit No Defined Risk is an answer, and travels as one.
    const none = envelopeWith(setRiskState(workedAtEntry(), 'no_defined'));
    const carried = switchRecordingMode(none, 'after_trade', CONTEXT);
    expect(carried.afterTrade?.riskState).toBe('no_defined');
    expect(carried.afterTrade?.risk).toBe('');
  });

  it('refuses an unknown schema version instead of reinterpreting its answers', () => {
    const future = { ...JSON.parse(serializeRecordingDraft(envelope())), version: 5 };
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

  it('knows a pristine draft holds no work, in either mode', () => {
    for (const mode of ['at_entry', 'after_trade'] as const) {
      const pristine = createRecordingDraft({
        mode,
        tradingAccountId: ACCOUNT,
        mutationKey: KEY,
        now: NOW,
      });
      expect(recordingDraftHasWork(pristine, ACCOUNT)).toBe(false);
    }
    expect(recordingDraftHasWork(envelope(), ACCOUNT)).toBe(true);
  });
});

describe('version 1 drafts', () => {
  /** A v1 draft exactly as the pre-contract After Trade form stored it. */
  function v1Draft(overrides: Record<string, unknown> = {}) {
    return {
      version: 1,
      activeMode: 'after_trade',
      mutationKey: KEY,
      updatedAt: NOW.toISOString(),
      atEntry: workedAtEntry(),
      afterTrade: {
        values: {
          tradingAccountId: ACCOUNT,
          symbol: 'XAUUSD',
          direction: 'long',
          enteredAt: '2026-09-16T09:00',
          exitedAt: '2026-09-16T11:00',
          strategyId: BREAKOUT,
          setupId: RETEST,
          timeframe: '15m',
          session: 'London',
          plannedEntry: '',
          plannedStop: '',
          plannedTarget: '',
          plannedPositionSize: '',
          plannedRisk: '100',
          plannedReward: '250',
          actualEntry: '',
          actualStop: '',
          actualPositionSize: '',
          actualRisk: '80',
          finalPnl: '120',
          confirmationNotes: 'Retest',
          tradingviewUrl: '',
          notes: 'Kept my stop',
          confidence: '50',
        },
        planBasis: 'money',
        actualBasis: 'money',
        exits: [
          {
            id: 'leg',
            closedPercent: '100',
            scope: 'all_remaining',
            value: '120',
            exitedAt: '2026-09-16T11:00',
            reason: 'Target',
          },
        ],
        completeness: 'unknown',
        conditionMet: { candle: true, retest: false },
        emotions: [],
      },
      lastCarried: null,
      ...overrides,
    };
  }

  it('is upgraded, keeping the At Entry section whole and only unchanged-meaning After Trade values', () => {
    const parsed = parseRecordingDraft(JSON.stringify(v1Draft()), NOW);
    expect(parsed.status).toBe('recovered');
    if (parsed.status !== 'recovered') return;
    const { envelope } = parsed;
    expect(envelope.version).toBe(RECORDING_DRAFT_VERSION);
    expect(envelope.mutationKey).toBe(KEY);
    expect(envelope.atEntry).toEqual(workedAtEntry());
    expect(envelope.afterTrade).toMatchObject({
      symbol: 'XAUUSD',
      direction: 'long',
      enteredAt: '2026-09-16T09:00',
      exitedAt: '2026-09-16T11:00',
      risk: '100',
      finalPnl: '120',
      confidence: 50,
      emotions: { answer: 'none', keys: [] },
      context: { timeframe: '15m', session: 'London', reason: 'Retest', notes: 'Kept my stop' },
      exits: [
        {
          id: 'leg',
          scope: 'all_remaining',
          pnl: '120',
          closedPercent: '100',
          exitedAt: '2026-09-16T11:00',
          price: '',
          reason: 'Target',
        },
      ],
    });
  });

  it('leaves behind what the old form could not say honestly', () => {
    const parsed = parseRecordingDraft(JSON.stringify(v1Draft()), NOW);
    if (parsed.status !== 'recovered') throw new Error('expected recovery');
    const upgraded = parsed.envelope.afterTrade;
    // An unchecked box was saved as Not Met; "Not sure" was preselected; the old
    // actual risk was a denominator; the reward implied no explicit Target answer.
    expect(upgraded?.classification.conditions).toEqual({});
    expect(upgraded?.completeness).toBe('unanswered');
    expect(upgraded?.actualRisk).toEqual({ answer: 'unanswered', amount: '' });
    expect(upgraded?.target.state).toBe('unanswered');
    expect(upgraded?.outcome).toBeNull();
  });

  it('keeps a Price exit value as the exit price, never as a P&L', () => {
    const priceDraft = v1Draft();
    priceDraft.afterTrade.actualBasis = 'price';
    priceDraft.afterTrade.exits[0]!.value = '2410.5';
    const parsed = parseRecordingDraft(JSON.stringify(priceDraft), NOW);
    if (parsed.status !== 'recovered') throw new Error('expected recovery');
    expect(parsed.envelope.afterTrade?.exits[0]).toMatchObject({ pnl: '', price: '2410.5' });
    expect(parsed.envelope.afterTrade?.finalPnl).toBe('');
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

describe('inactive-mode work a Save would remove (contract §23)', () => {
  const NOW_DATE = new Date('2026-09-18T12:00:00.000Z');
  const KEY_ID = '018f0000-0000-7000-8000-0000000000aa';
  const ACCOUNT_ID = '018f0000-0000-7000-8000-000000000001';

  function withAfterTrade(patch: Partial<ReturnType<typeof createAfterTradeDraft>>) {
    const envelope = createRecordingDraft({
      mode: 'at_entry',
      tradingAccountId: ACCOUNT_ID,
      mutationKey: KEY_ID,
      now: NOW_DATE,
    });
    return { ...envelope, afterTrade: { ...createAfterTradeDraft(ACCOUNT_ID), ...patch } };
  }

  it('names every After Trade answer an open Trade cannot hold', () => {
    const items = inactiveModeWork(
      withAfterTrade({
        finalPnl: '10',
        outcome: 'win',
        exits: [
          { id: 'e', scope: '', pnl: '', closedPercent: '', exitedAt: '', price: '', reason: 'r' },
        ],
        completeness: 'complete',
        exitedAt: '2026-09-18T10:00',
        postTradeEmotions: { answer: 'none', keys: [] },
        actualRisk: { answer: 'unknown', amount: '' },
        classification: {
          strategy: 'selected',
          strategyId: 's',
          setupByStrategy: {},
          conditions: { s: { u: { c: 'unknown' } } },
        },
      }),
    ).map((item) => item.kind);
    expect(items).toEqual([
      'finalPnl',
      'outcome',
      'exits',
      'completeness',
      'exitedAt',
      'postTradeEmotions',
      'actualRiskUnknown',
      'conditionsUnknown',
    ]);
  });

  it('names nothing for shared answers, blank exit rows or an untouched section', () => {
    expect(inactiveModeWork(withAfterTrade({ symbol: 'x', risk: '50' }))).toEqual([]);
    expect(
      inactiveModeWork(
        withAfterTrade({
          exits: [
            { id: 'e', scope: '', pnl: '', closedPercent: '', exitedAt: '', price: '', reason: '' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('never asks when After Trade is the mode being saved', () => {
    const envelope = { ...withAfterTrade({ finalPnl: '10' }), activeMode: 'after_trade' as const };
    expect(inactiveModeWork(envelope)).toEqual([]);
  });
});
