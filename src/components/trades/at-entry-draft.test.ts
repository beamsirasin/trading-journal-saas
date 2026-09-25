import { describe, expect, it } from 'vitest';

import { CreateTradeSchema } from '@/lib/trades/schemas';
import type { TradeCreateOptions } from '@/server/dal/trades';

import {
  activeClassification,
  analysisSummary,
  answerCondition,
  answerNoEmotions,
  answerNoSetup,
  answerNoStrategy,
  atEntryReadiness,
  buildAtEntryPayload,
  chooseCustomExitPlan,
  chooseNoExitRule,
  chooseSavedExitPlan,
  clearEntryTime,
  closeExitPlanEditor,
  commitCustomExitPlanText,
  confirmEntryTime,
  createAtEntryDraft,
  editEntryTime,
  followClock,
  hasUserWork,
  openExitPlanEditor,
  orderedErrorFields,
  removeEmotionsAnswer,
  removeExitPlanAnswer,
  removeSetupAnswer,
  removeStrategyAnswer,
  resolveExitPlan,
  restoreStrategyDefault,
  sectionErrorCount,
  selectSetup,
  selectStrategy,
  setConfidence,
  setExitPlanEditorView,
  setRiskState,
  setTargetState,
  setTargetValue,
  toggleEmotion,
  updateExitPlanEditor,
  validateAtEntryDraft,
  type AtEntryDraft,
} from './at-entry-draft';

const ACCOUNT = '018f0000-0000-7000-8000-000000000001';
const BREAKOUT = '018f0000-0000-7000-8000-000000000010';
const REVERSAL = '018f0000-0000-7000-8000-000000000011';
const RETEST = '018f0000-0000-7000-8000-000000000020';
const SCALE_OUT = '018f0000-0000-7000-8000-000000000030';
const TRAIL = '018f0000-0000-7000-8000-000000000031';

const options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'> = {
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
  exitPlans: [
    {
      exitPlanId: SCALE_OUT,
      name: 'Scale out',
      instructions: 'Half at 1R, trail the rest.',
      strategyId: BREAKOUT,
    },
    { exitPlanId: TRAIL, name: 'Trail', instructions: 'Trail behind structure.', strategyId: null },
  ],
};

const context = { currency: 'USD', timezone: 'Asia/Bangkok' };

/** Save Open Trade's minimum since decision 54: identity and a risk DECISION. */
function minimum(): AtEntryDraft {
  return {
    ...createAtEntryDraft(ACCOUNT),
    symbol: 'xauusd',
    direction: 'long',
    riskState: 'defined',
    risk: '100',
  };
}

describe('At Entry draft — minimum Save and readiness', () => {
  it('is ready with Account, Symbol, Direction and a Defined Risk alone', () => {
    const validation = validateAtEntryDraft(minimum(), context);
    expect(atEntryReadiness(validation)).toEqual({ status: 'ready' });
    expect(
      buildAtEntryPayload(minimum(), { ...context, mutationKey: ACCOUNT, options }),
    ).toMatchObject({
      recordingContract: 'add_trade_v1',
      symbol: 'XAUUSD',
      plannedRiskMinor: '10000',
    });
    // Nobody said anything about the risk actually carried, so nothing is sent:
    // an unanswered observation is never a positive one (contract §2, §8).
    expect(
      buildAtEntryPayload(minimum(), { ...context, mutationKey: ACCOUNT, options }),
    ).not.toHaveProperty('actualRiskAnswer');
  });

  /*
    RECORD OPEN REQUIRES A DECISION, NOT A NUMBER (contract decision 54).
    Unanswered blocks Save; Defined needs its amount; No Defined Risk is a
    complete answer that carries none. A trader is never forced to invent a
    monetary risk to get past this step.
  */
  it('refuses to save while the risk decision is unanswered', () => {
    const undecided = { ...minimum(), riskState: 'unanswered' as const, risk: '' };
    const validation = validateAtEntryDraft(undecided, context);
    expect(validation.errors.risk).toBe('risk_decision_required');
    expect(atEntryReadiness(validation).status).toBe('blocked');
    expect(
      buildAtEntryPayload(undecided, { ...context, mutationKey: ACCOUNT, options }),
    ).toBeNull();
  });

  it('requires an amount greater than zero once risk is Defined', () => {
    const blank = { ...minimum(), risk: '' };
    expect(validateAtEntryDraft(blank, context).errors.risk).toBe('required');
    const zero = { ...minimum(), risk: '0' };
    expect(validateAtEntryDraft(zero, context).errors.risk).toBe('must_be_positive');
    expect(buildAtEntryPayload(zero, { ...context, mutationKey: ACCOUNT, options })).toBeNull();
  });

  it('saves No Defined Risk with no amount at all, and no R can follow', () => {
    const none = setRiskState(minimum(), 'no_defined');
    // The transition clears the amount it contradicts rather than hiding it.
    expect(none.risk).toBe('');
    const validation = validateAtEntryDraft(none, context);
    expect(validation.errors.risk).toBeUndefined();
    expect(validation.riskMinor).toBeNull();
    expect(atEntryReadiness(validation)).toEqual({ status: 'ready' });
    const payload = buildAtEntryPayload(none, { ...context, mutationKey: ACCOUNT, options });
    expect(payload).toMatchObject({ plannedRiskState: 'no_defined' });
    expect(payload).not.toHaveProperty('plannedRiskMinor');
    // Nothing to compare against, so Actual Risk is not carried either.
    expect(payload).not.toHaveProperty('actualRiskAnswer');
    expect(payload).not.toHaveProperty('actualInitialRiskMinor');
  });

  /*
    THE PAYLOAD THIS BUILDER PRODUCES MUST PASS THE REAL BOUNDARY. A No
    Defined Risk Save was refused in the browser while every service test
    passed, because the builder declared `systemPlanBasis: 'money'` over a
    plan that had no figures at all. Parsing what it builds is what catches
    that class of defect; asserting the schema alone never could.
  */
  it.each([
    ['defined risk', () => minimum()],
    ['no defined risk', () => setRiskState(minimum(), 'no_defined')],
    [
      'no defined risk with a fixed target',
      () => setTargetValue(setRiskState(minimum(), 'no_defined'), 'profit', '300'),
    ],
  ])('builds a payload the create schema accepts (%s)', (_label, build) => {
    const payload = buildAtEntryPayload(build(), { ...context, mutationKey: ACCOUNT, options });
    expect(payload).not.toBeNull();
    const parsed = CreateTradeSchema.safeParse(payload);
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)).toEqual([]);
  });

  it('sends a Defined Risk as the decision plus its amount', () => {
    const payload = buildAtEntryPayload(minimum(), { ...context, mutationKey: ACCOUNT, options });
    expect(payload).toMatchObject({ plannedRiskState: 'defined', plannedRiskMinor: '10000' });
  });

  /*
    PRICE DECIDES NOTHING (contract §3, decision 54). An SL price says where a
    stop would sit; it never creates a Defined Risk, and its absence never
    proves there was none.
  */
  it('never reads a risk decision out of an SL price', () => {
    const priced = {
      ...createAtEntryDraft(ACCOUNT),
      symbol: 'xauusd',
      direction: 'long' as const,
      context: { ...createAtEntryDraft(ACCOUNT).context, stopPrice: '2395' },
    };
    const validation = validateAtEntryDraft(priced, context);
    expect(priced.riskState).toBe('unanswered');
    expect(validation.errors.risk).toBe('risk_decision_required');
    expect(buildAtEntryPayload(priced, { ...context, mutationKey: ACCOUNT, options })).toBeNull();
  });

  /* Stop Method is retired from capture: no Save writes one (decision 54). */
  it('never writes a Stop Method again', () => {
    for (const draft of [minimum(), setRiskState(minimum(), 'no_defined')]) {
      expect(
        buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options }),
      ).not.toHaveProperty('plannedStopMethod');
    }
  });

  it('never reports Ready while any blocking error exists, including hidden ones', () => {
    const blank = validateAtEntryDraft(createAtEntryDraft(''), context);
    expect(atEntryReadiness(blank)).toMatchObject({ status: 'blocked', count: 4 });

    // Only a malformed context price — inside a collapsed disclosure — is wrong.
    const hidden = { ...minimum(), context: { ...minimum().context, stopPrice: '12..5' } };
    const validation = validateAtEntryDraft(hidden, context);
    expect(atEntryReadiness(validation)).toEqual({
      status: 'blocked',
      count: 1,
      fields: ['contextStopPrice'],
    });
    expect(sectionErrorCount(validation.errors, 'context')).toBe(1);
    expect(buildAtEntryPayload(hidden, { ...context, mutationKey: ACCOUNT, options })).toBeNull();
  });

  it('refuses a zero Risk at Entry as a field error', () => {
    expect(validateAtEntryDraft({ ...minimum(), risk: '0' }, context).errors.risk).toBe(
      'must_be_positive',
    );
  });

  it('orders errors the way the page reads so focus lands on the first', () => {
    const draft = {
      ...createAtEntryDraft(ACCOUNT),
      target: { state: 'fixed' as const, profit: '', price: '' },
    };
    expect(orderedErrorFields(validateAtEntryDraft(draft, context).errors)).toEqual([
      'symbol',
      'direction',
      'risk',
      'targetProfit',
    ]);
  });
});

describe('At Entry draft — entry time', () => {
  it('follows the clock until touched and keeps defaulted and confirmed distinct', () => {
    const defaulted = followClock(minimum(), '2026-09-16T10:00');
    expect(followClock(defaulted, '2026-09-16T10:05').entryTime).toEqual({
      source: 'default_now',
      value: '2026-09-16T10:05',
    });
    const confirmed = confirmEntryTime(defaulted);
    expect(confirmed.entryTime).toEqual({ source: 'trader', value: '2026-09-16T10:00' });
    expect(followClock(confirmed, '2026-09-16T10:05')).toBe(confirmed);

    const payloadDefault = buildAtEntryPayload(defaulted, {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(payloadDefault).toMatchObject({ enteredAtSource: 'default_now' });
    const payloadEdited = buildAtEntryPayload(editEntryTime(defaulted, '2026-09-16T09:30'), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(payloadEdited).toMatchObject({
      enteredAt: '2026-09-16T02:30:00.000Z',
      enteredAtSource: 'trader',
    });
    const cleared = buildAtEntryPayload(clearEntryTime(defaulted), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(cleared).not.toHaveProperty('enteredAt');
    expect(cleared).not.toHaveProperty('enteredAtSource');
  });
});

/*
  ACTUAL RISK IS RETIRED FROM CAPTURE (contract decision 56). Risk at Entry is
  the one 1R; the draft holds no second risk figure and no Save ever sends one.
*/
describe('At Entry draft — no Actual Risk', () => {
  it('holds no Actual Risk, and a fully answered Save sends none', () => {
    expect(createAtEntryDraft(ACCOUNT)).not.toHaveProperty('actualRisk');
    let draft = setTargetValue(minimum(), 'profit', '300');
    draft = setConfidence(draft, 75);
    const payload = buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options });
    expect(payload).toMatchObject({ plannedRiskState: 'defined', plannedRiskMinor: '10000' });
    expect(payload).not.toHaveProperty('actualRiskAnswer');
    expect(payload).not.toHaveProperty('actualInitialRiskMinor');
  });

  it('No Defined Risk sends neither a 1R nor any risk figure in its place', () => {
    const payload = buildAtEntryPayload(setRiskState(minimum(), 'no_defined'), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(payload).toMatchObject({ plannedRiskState: 'no_defined' });
    for (const field of ['plannedRiskMinor', 'actualRiskAnswer', 'actualInitialRiskMinor']) {
      expect(payload).not.toHaveProperty(field);
    }
  });
});

describe('At Entry draft — Target', () => {
  it('attaches an incomplete Fixed Target to its missing Target Profit, never to No Fixed', () => {
    const fixed = setTargetState(minimum(), 'fixed');
    const errors = validateAtEntryDraft(fixed, context).errors;
    expect(errors).toEqual({ targetProfit: 'fixed_target_requires_value' });
    expect(validateAtEntryDraft(setTargetState(fixed, 'no_fixed'), context).errors).toEqual({});
  });

  it('keeps Target values through No Fixed Target and sends them only when Fixed', () => {
    let draft = setTargetValue(minimum(), 'profit', '200');
    draft = setTargetValue(draft, 'price', '2450.5');
    draft = setTargetState(draft, 'no_fixed');
    const noFixed = buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options });
    expect(noFixed).toMatchObject({ targetState: 'no_fixed' });
    expect(noFixed).not.toHaveProperty('plannedRewardMinor');
    expect(noFixed).not.toHaveProperty('targetPrice');
    draft = setTargetState(draft, 'fixed');
    expect(buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })).toMatchObject(
      {
        targetState: 'fixed',
        plannedRewardMinor: '20000',
        targetPrice: '2450.5',
      },
    );
  });

  it('returns explicitly to Unanswered', () => {
    const draft = setTargetState(setTargetState(minimum(), 'no_fixed'), 'unanswered');
    expect(
      buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options }),
    ).not.toHaveProperty('targetState');
  });
});

describe('At Entry draft — Strategy, Setup and conditions', () => {
  it('restores Setup and condition answers when returning to a Strategy', () => {
    let draft = selectStrategy(minimum(), BREAKOUT);
    draft = selectSetup(draft, RETEST);
    draft = answerCondition(draft, 'candle', 'met');
    draft = answerCondition(draft, 'volume', 'not_met');
    draft = selectStrategy(draft, REVERSAL);
    expect(activeClassification(draft, options)).toMatchObject({
      setup: null,
      setupAnswer: 'unanswered',
      conditionAnswers: {},
    });
    draft = answerNoStrategy(draft);
    draft = selectStrategy(draft, BREAKOUT);
    expect(activeClassification(draft, options)).toMatchObject({
      setup: { setupId: RETEST },
      conditionAnswers: { candle: 'met', volume: 'not_met' },
    });
  });

  it('sends only answered conditions and never an unanswered one as Not Met', () => {
    let draft = selectSetup(selectStrategy(minimum(), BREAKOUT), RETEST);
    draft = answerCondition(draft, 'candle', 'met');
    expect(buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })).toMatchObject(
      {
        strategyId: BREAKOUT,
        setupId: RETEST,
        conditionSetToken: 'token-retest',
        conditionAnswers: [{ conditionKey: 'candle', status: 'met' }],
      },
    );
    draft = answerCondition(draft, 'candle', null);
    expect(
      buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })?.conditionAnswers,
    ).toEqual([]);
  });

  it('holds No Strategy, No Setup and explicit removal apart', () => {
    const none = answerNoStrategy(minimum());
    expect(buildAtEntryPayload(none, { ...context, mutationKey: ACCOUNT, options })).toMatchObject({
      noStrategy: true,
    });
    const noSetup = answerNoSetup(selectStrategy(minimum(), BREAKOUT));
    expect(
      buildAtEntryPayload(noSetup, { ...context, mutationKey: ACCOUNT, options }),
    ).toMatchObject({
      strategyId: BREAKOUT,
      noSetup: true,
    });
    const removedSetup = removeSetupAnswer(noSetup);
    const removedSetupPayload = buildAtEntryPayload(removedSetup, {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(removedSetupPayload).not.toHaveProperty('noSetup');
    expect(removedSetupPayload).not.toHaveProperty('setupId');
    const removed = buildAtEntryPayload(removeStrategyAnswer(none), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(removed).not.toHaveProperty('noStrategy');
    expect(removed).not.toHaveProperty('strategyId');
  });
});

describe('At Entry draft — Exit Plan', () => {
  it('inherits the Strategy default without a redundant selection', () => {
    const draft = selectStrategy(minimum(), BREAKOUT);
    expect(resolveExitPlan(draft, options)).toMatchObject({
      resolved: { status: 'inherited', plan: { exitPlanId: SCALE_OUT } },
      inheritanceDeclined: false,
    });
    // Picking the plan inheritance already supplies stays inheritance.
    expect(chooseSavedExitPlan(draft, SCALE_OUT, options).exitPlan.choice).toEqual({
      kind: 'inherit',
    });
    expect(buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })).toMatchObject(
      {
        exitPlan: { state: 'saved', exitPlanId: SCALE_OUT, provenance: 'strategy_default' },
      },
    );
  });

  it('browsing the chooser or Customize and closing without a change keeps inheritance', () => {
    const draft = selectStrategy(minimum(), BREAKOUT);
    let session = openExitPlanEditor(draft);
    session = setExitPlanEditorView(session, 'choose');
    session = setExitPlanEditorView(session, 'customize');
    expect(closeExitPlanEditor(session, 'keep')).toBe(draft);
    expect(closeExitPlanEditor(session, 'discard')).toBe(draft);
  });

  it('Customize claims nothing until the wording really changes', () => {
    const draft = selectStrategy(minimum(), BREAKOUT);
    let session = openExitPlanEditor(draft);
    session = setExitPlanEditorView(session, 'customize');
    session = updateExitPlanEditor(session, (working) =>
      commitCustomExitPlanText(working, 'Half at 1R, trail the rest.', SCALE_OUT, options),
    );
    expect(closeExitPlanEditor(session, 'keep')).toBe(draft);

    session = updateExitPlanEditor(session, (working) =>
      commitCustomExitPlanText(working, 'Half at 1R, close the rest at 2R.', SCALE_OUT, options),
    );
    const customized = closeExitPlanEditor(session, 'keep');
    expect(resolveExitPlan(customized, options)).toMatchObject({
      resolved: { status: 'customized', base: { exitPlanId: SCALE_OUT } },
      inheritanceDeclined: true,
    });
    expect(closeExitPlanEditor(session, 'discard')).toBe(draft);
  });

  it('keeps custom wording through another choice and restores it', () => {
    let draft = selectStrategy(minimum(), BREAKOUT);
    draft = commitCustomExitPlanText(draft, 'Close before the news.', null, options);
    draft = chooseSavedExitPlan(draft, TRAIL, options);
    draft = chooseNoExitRule(draft);
    draft = restoreStrategyDefault(draft);
    expect(draft.exitPlan.customText).toBe('Close before the news.');
    draft = chooseCustomExitPlan(draft);
    expect(buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })).toMatchObject(
      {
        exitPlan: {
          state: 'customized',
          baseExitPlanId: null,
          instructions: 'Close before the news.',
        },
        exitPlanInheritanceDeclined: true,
      },
    );
  });

  it('records No Defined Exit Rule, restores the default, and removes the answer explicitly', () => {
    const withStrategy = selectStrategy(minimum(), BREAKOUT);
    const noRule = chooseNoExitRule(withStrategy);
    expect(
      buildAtEntryPayload(noRule, { ...context, mutationKey: ACCOUNT, options }),
    ).toMatchObject({
      exitPlan: { state: 'no_rule' },
      exitPlanInheritanceDeclined: true,
    });
    expect(resolveExitPlan(restoreStrategyDefault(noRule), options).resolved.status).toBe(
      'inherited',
    );
    const removed = buildAtEntryPayload(removeExitPlanAnswer(withStrategy), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(removed).not.toHaveProperty('exitPlan');
    expect(removed).toMatchObject({ exitPlanInheritanceDeclined: true });
    // With no Strategy default, removal is simply Not recorded.
    const plain = buildAtEntryPayload(removeExitPlanAnswer(minimum()), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(plain).not.toHaveProperty('exitPlan');
    expect(plain).not.toHaveProperty('exitPlanInheritanceDeclined');
  });
});

describe('At Entry draft — Confidence and Emotions', () => {
  it('has no Confidence default and removes it explicitly', () => {
    expect(minimum().confidence).toBeNull();
    const payload = buildAtEntryPayload(setConfidence(setConfidence(minimum(), 75), null), {
      ...context,
      mutationKey: ACCOUNT,
      options,
    });
    expect(payload).not.toHaveProperty('confidence');
  });

  it('keeps Not answered, None of these and selected emotions distinct', () => {
    const build = (draft: AtEntryDraft) =>
      buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options });
    expect(build(minimum())).not.toHaveProperty('emotionKeys');
    expect(build(answerNoEmotions(minimum()))).toMatchObject({ emotionKeys: [] });
    expect(build(toggleEmotion(minimum(), 'calm'))).toMatchObject({ emotionKeys: ['calm'] });
    expect(build(removeEmotionsAnswer(toggleEmotion(minimum(), 'calm')))).not.toHaveProperty(
      'emotionKeys',
    );
  });

  it('refuses to remove the last selected emotion silently', () => {
    const one = toggleEmotion(minimum(), 'calm');
    expect(toggleEmotion(one, 'calm')).toBe(one);
    const two = toggleEmotion(one, 'fomo');
    expect(toggleEmotion(two, 'calm').emotions).toEqual({ answer: 'selected', keys: ['fomo'] });
  });
});

describe('At Entry draft — summaries and notices', () => {
  it('summarizes answered analytical coverage honestly', () => {
    let draft = selectSetup(selectStrategy(minimum(), BREAKOUT), RETEST);
    draft = answerCondition(draft, 'candle', 'met');
    draft = setConfidence(answerNoEmotions(draft), 50);
    expect(analysisSummary(draft, options)).toEqual({
      strategy: { answer: 'selected', name: 'Breakout' },
      setup: { answer: 'selected', name: 'Retest' },
      conditions: { total: 2, answered: 1, met: 1 },
      confidence: 50,
      emotions: { answer: 'none', count: 0 },
      answeredCount: 3,
      questionCount: 3,
    });
  });

  it('flags a plausible price inconsistency as a notice, not an error', () => {
    const draft = {
      ...minimum(),
      context: { ...minimum().context, entryPrice: '2400', stopPrice: '2410' },
    };
    const validation = validateAtEntryDraft(draft, context);
    expect(validation.errors).toEqual({});
    expect(validation.notices).toEqual(['stop_wrong_side']);
  });

  it('does not treat defaults as work a mode switch would lose', () => {
    const pristine = createAtEntryDraft(ACCOUNT);
    expect(hasUserWork(followClock(pristine, '2026-09-16T10:00'), pristine)).toBe(false);
    expect(hasUserWork({ ...pristine, symbol: 'EURUSD' }, pristine)).toBe(true);
    expect(hasUserWork(confirmEntryTime(followClock(pristine, '2026-09-16T10:00')), pristine)).toBe(
      true,
    );
  });
});
