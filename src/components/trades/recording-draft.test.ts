import { beforeEach, describe, expect, it } from 'vitest';

import {
  answerCondition as answerAfterTradeCondition,
  createAfterTradeDraft,
  selectSetup as selectAfterTradeSetup,
  selectStrategy as selectAfterTradeStrategy,
  type AfterTradeDraft,
} from './after-trade-draft';
import {
  answerCondition,
  answerNoStrategy,
  buildAtEntryPayload,
  chooseNoExitRule,
  chooseSavedExitPlan,
  confirmEntryTime,
  createAtEntryDraft,
  editEntryTime,
  followClock,
  selectSetup,
  selectStrategy,
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

  it('carries no Actual Risk either way: neither section holds one (decision 56)', () => {
    const switched = switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT);
    expect(switched.afterTrade).not.toHaveProperty('actualRisk');
    expect(switched.atEntry).not.toHaveProperty('actualRisk');
    expect(switched.lastCarried).not.toHaveProperty('actualRiskDifferent');
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
    const atEntry = workedAtEntry();
    const switched = switchRecordingMode(envelopeWith(atEntry), 'after_trade', CONTEXT);
    expect(switched.atEntry).toEqual(atEntry);
  });
});

describe('round trips', () => {
  it('At Entry → After Trade → At Entry restores every At Entry answer', () => {
    const original = workedAtEntry();
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
        closeMode: 'all_at_once',
        fullClose: { pnl: '50', price: '', reason: '' },
        outcome: 'win',
      },
    };
    const back = switchRecordingMode(edited, 'at_entry', CONTEXT);
    expect(back.atEntry?.symbol).toBe('GBPUSD');
    expect(back.atEntry?.classification.strategy).toBe('none');
    // The After Trade result stays in its own section, never an At Entry answer.
    expect(back.afterTrade).toMatchObject({ fullClose: { pnl: '50' }, outcome: 'win' });
  });

  it('After Trade → At Entry → After Trade restores After Trade work and never invents At Entry assertions', () => {
    const afterTrade: AfterTradeDraft = {
      ...createAfterTradeDraft(ACCOUNT),
      symbol: 'NAS100',
      direction: 'short',
      outcome: 'loss',
      exitedAt: '2026-09-16T20:00',
      closeMode: 'in_parts',
      partsResult: 'each_exit',
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
    ACTUAL RISK IS DISCARDED FROM EVERY OLDER DRAFT (decision 56). Whatever a
    stored draft said about it — v2's ambiguous Matched, v3's stated Matched,
    a Different with or without its amount, in either section or in the last
    carry — it is dropped on read and nothing replaces it. Everything else the
    draft held is kept, and a Save from it sends no Actual Risk.
  */
  it('drops a stored Actual Risk from any draft version, and keeps the rest', () => {
    // A real draft that has been switched once: both sections and a last carry.
    const current = JSON.parse(
      serializeRecordingDraft(
        switchRecordingMode(envelopeWith(workedAtEntry()), 'after_trade', CONTEXT),
      ),
    );
    for (const version of [2, 3, RECORDING_DRAFT_VERSION]) {
      for (const [atEntryRisk, afterRisk] of [
        [
          { mode: 'matched', amount: '' },
          { answer: 'matched', amount: '' },
        ],
        [
          { mode: 'different', amount: '150' },
          { answer: 'different', amount: '150' },
        ],
        [
          { mode: 'different_unknown', amount: '' },
          { answer: 'unknown', amount: '' },
        ],
      ]) {
        const { riskState: _decision, ...olderAtEntry } = current.atEntry;
        const stored = {
          ...current,
          version,
          atEntry: { ...(version < 4 ? olderAtEntry : current.atEntry), actualRisk: atEntryRisk },
          afterTrade: { ...current.afterTrade, actualRisk: afterRisk },
          lastCarried: { ...current.lastCarried, actualRiskDifferent: { amount: '150' } },
        };
        const parsed = parseRecordingDraft(JSON.stringify(stored), NOW);
        if (parsed.status !== 'recovered') throw new Error(`v${version} draft not recovered`);
        expect(parsed.envelope.version).toBe(RECORDING_DRAFT_VERSION);
        expect(parsed.envelope.atEntry).not.toHaveProperty('actualRisk');
        expect(parsed.envelope.afterTrade).not.toHaveProperty('actualRisk');
        expect(parsed.envelope.lastCarried ?? {}).not.toHaveProperty('actualRiskDifferent');
        // Nothing else is lost with it.
        expect(parsed.envelope.atEntry?.symbol).toBe('XAUUSD');
        expect(parsed.envelope.atEntry?.risk).toBe('100');
        expect(parsed.envelope.afterTrade?.symbol).toBe('XAUUSD');
        // And a Save from it carries none.
        // A real payload (library answers set aside — they are not what this is
        // about, and a Strategy the test offers nothing for would stop the Save).
        const fresh = createAtEntryDraft(ACCOUNT);
        const payload = buildAtEntryPayload(
          {
            ...parsed.envelope.atEntry!,
            riskState: 'defined',
            classification: fresh.classification,
            exitPlan: fresh.exitPlan,
          },
          {
            currency: 'USD',
            timezone: 'UTC',
            mutationKey: KEY,
            options: { strategies: [], exitPlans: [] },
          },
        );
        expect(payload).not.toBeNull();
        expect(payload).toMatchObject({ plannedRiskMinor: '10000' });
        expect(payload).not.toHaveProperty('actualRiskAnswer');
        expect(payload).not.toHaveProperty('actualInitialRiskMinor');
      }
    }
  });

  /*
    STOP METHOD SURVIVES A RELOAD with its explicitness: one the trader chose
    must still differ from the state nobody answered (decision 53).
  */
  it('keeps Stop Method, answered or not, across a reload', () => {
    const answered = envelopeWith(setStopMethod(workedAtEntry(), 'mental'));
    const parsed = parseRecordingDraft(serializeRecordingDraft(answered), NOW);
    expect(parsed.status).toBe('recovered');
    if (parsed.status !== 'recovered') throw new Error('unreachable');
    expect(parsed.envelope.atEntry?.stopMethod).toBe('mental');

    const untouched = envelopeWith(workedAtEntry());
    const plain = parseRecordingDraft(serializeRecordingDraft(untouched), NOW);
    if (plain.status !== 'recovered') throw new Error('unreachable');
    expect(plain.envelope.atEntry?.stopMethod).toBe('unanswered');
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
      // Exits beside a typed total (decisions 57–58): both kept, no way chosen.
      closeMode: 'in_parts',
      partsResult: 'unanswered',
      statedTotal: '120',
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
    // Completeness is derived from the exits now, never carried as an answer.
    expect(upgraded).not.toHaveProperty('completeness');
    expect(upgraded).not.toHaveProperty('finalPnl');
    expect(upgraded).not.toHaveProperty('actualRisk');
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
    expect(parsed.envelope.afterTrade?.fullClose.pnl).toBe('');
  });
});

describe('a stored After Trade draft from before the closing model (decision 57)', () => {
  function storedWith(afterTrade: Record<string, unknown>) {
    const envelope = serializeRecordingDraft({
      version: RECORDING_DRAFT_VERSION,
      activeMode: 'after_trade',
      mutationKey: KEY,
      updatedAt: NOW.toISOString(),
      atEntry: null,
      afterTrade: createAfterTradeDraft(ACCOUNT),
      lastCarried: null,
    });
    const raw = JSON.parse(envelope) as { afterTrade: Record<string, unknown> };
    const {
      closeMode: _m,
      fullClose: _f,
      partsResult: _p,
      statedTotal: _t,
      ...legacy
    } = raw.afterTrade;
    raw.afterTrade = { ...legacy, completeness: 'unanswered', ...afterTrade };
    return JSON.stringify(raw);
  }

  it('keeps the chosen way of recording a close in parts through a reload', () => {
    const envelope: RecordingDraftEnvelope = {
      version: RECORDING_DRAFT_VERSION,
      activeMode: 'after_trade',
      mutationKey: KEY,
      updatedAt: NOW.toISOString(),
      atEntry: null,
      afterTrade: {
        ...createAfterTradeDraft(ACCOUNT),
        closeMode: 'in_parts' as const,
        partsResult: 'total_only' as const,
        statedTotal: '80',
      },
      lastCarried: null,
    };
    const parsed = parseRecordingDraft(serializeRecordingDraft(envelope), NOW);
    if (parsed.status !== 'recovered') throw new Error('expected recovery');
    expect(parsed.envelope.afterTrade).toMatchObject({
      closeMode: 'in_parts',
      partsResult: 'total_only',
      statedTotal: '80',
    });
  });

  it('reads a decision-57 close in parts as recorded exit by exit', () => {
    const raw = JSON.parse(storedWith({})) as { afterTrade: Record<string, unknown> };
    raw.afterTrade = {
      ...raw.afterTrade,
      closeMode: 'in_parts',
      fullClose: { pnl: '', price: '', reason: '' },
    };
    const parsed = parseRecordingDraft(JSON.stringify(raw), NOW);
    if (parsed.status !== 'recovered') throw new Error('expected recovery');
    expect(parsed.envelope.afterTrade).toMatchObject({
      closeMode: 'in_parts',
      partsResult: 'each_exit',
      statedTotal: '',
    });
  });

  it('keeps a typed Final Net P&L with no exits, choosing no way of closing', () => {
    const parsed = parseRecordingDraft(storedWith({ finalPnl: '80' }), NOW);
    if (parsed.status !== 'recovered') throw new Error('expected recovery');
    expect(parsed.envelope.afterTrade).toMatchObject({
      closeMode: 'unanswered',
      partsResult: 'unanswered',
      fullClose: { pnl: '80', price: '', reason: '' },
      statedTotal: '80',
    });
    expect(parsed.envelope.afterTrade).not.toHaveProperty('finalPnl');
  });

  it('turns recorded exits into a close in parts, keeping them as they were', () => {
    const exit = {
      id: 'e',
      scope: 'part',
      pnl: '20',
      closedPercent: '30',
      exitedAt: '',
      price: '',
      reason: '',
    };
    const parsed = parseRecordingDraft(
      storedWith({ finalPnl: '80', exits: [exit], completeness: 'complete' }),
      NOW,
    );
    if (parsed.status !== 'recovered') throw new Error('expected recovery');
    expect(parsed.envelope.afterTrade).toMatchObject({
      closeMode: 'in_parts',
      partsResult: 'unanswered',
      exits: [exit],
      statedTotal: '80',
    });
    expect(parsed.envelope.afterTrade).not.toHaveProperty('completeness');
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
        outcome: 'win',
        closeMode: 'in_parts',
        partsResult: 'each_exit',
        exits: [
          { id: 'e', scope: '', pnl: '', closedPercent: '', exitedAt: '', price: '', reason: 'r' },
        ],
        exitedAt: '2026-09-18T10:00',
        postTradeEmotions: { answer: 'none', keys: [] },
        classification: {
          strategy: 'selected',
          strategyId: 's',
          setupByStrategy: {},
          conditions: { s: { u: { c: 'unknown' } } },
        },
      }),
    ).map((item) => item.kind);
    expect(items).toEqual([
      'outcome',
      'exits',
      'exitedAt',
      'postTradeEmotions',
      'conditionsUnknown',
    ]);
    // A full close's P&L is the result it is.
    expect(
      inactiveModeWork(
        withAfterTrade({
          closeMode: 'all_at_once',
          fullClose: { pnl: '10', price: '', reason: '' },
        }),
      ).map((item) => item.kind),
    ).toEqual(['finalPnl']);
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
    const envelope = {
      ...withAfterTrade({
        closeMode: 'all_at_once',
        fullClose: { pnl: '10', price: '', reason: '' },
      }),
      activeMode: 'after_trade' as const,
    };
    expect(inactiveModeWork(envelope)).toEqual([]);
  });
});
