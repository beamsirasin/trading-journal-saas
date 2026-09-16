import { describe, expect, it } from 'vitest';

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
  setActualRiskAmount,
  setActualRiskMode,
  setConfidence,
  setExitPlanEditorView,
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

function minimum(): AtEntryDraft {
  return {
    ...createAtEntryDraft(ACCOUNT),
    symbol: 'xauusd',
    direction: 'long',
    risk: '100',
  };
}

describe('At Entry draft — minimum Save and readiness', () => {
  it('is ready with Account, Symbol, Direction and a positive Risk at Entry alone', () => {
    const validation = validateAtEntryDraft(minimum(), context);
    expect(atEntryReadiness(validation)).toEqual({ status: 'ready' });
    expect(
      buildAtEntryPayload(minimum(), { ...context, mutationKey: ACCOUNT, options }),
    ).toMatchObject({
      recordingContract: 'add_trade_v1',
      symbol: 'XAUUSD',
      plannedRiskMinor: '10000',
      actualRiskAnswer: 'matched',
    });
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

describe('At Entry draft — Actual Risk', () => {
  it('keeps the Different amount through Matched and back', () => {
    let draft = setActualRiskAmount(minimum(), '150');
    draft = setActualRiskMode(draft, 'matched');
    expect(
      buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options }),
    ).not.toHaveProperty('actualInitialRiskMinor');
    draft = setActualRiskMode(draft, 'different');
    expect(draft.actualRisk).toEqual({ mode: 'different', amount: '150' });
    expect(buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })).toMatchObject(
      {
        actualRiskAnswer: 'different',
        actualInitialRiskMinor: '15000',
      },
    );
  });

  it('records Different with the amount unknown without asking for a second amount', () => {
    const draft = setActualRiskMode(setActualRiskAmount(minimum(), '150'), 'different_unknown');
    const payload = buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options });
    expect(payload).toMatchObject({ actualRiskAnswer: 'different' });
    expect(payload).not.toHaveProperty('actualInitialRiskMinor');
  });

  it('blocks a Different amount equal to Risk at Entry and never rewrites it to Matched', () => {
    // `100.00` and `100` are the same minor-unit amount, so the comparison is by value.
    const draft = setActualRiskMode(setActualRiskAmount(minimum(), '100.00'), 'different');
    const validation = validateAtEntryDraft(draft, context);
    expect(validation.errors).toEqual({ actualRiskAmount: 'actual_risk_equals_risk_at_entry' });
    expect(atEntryReadiness(validation)).toMatchObject({ status: 'blocked', count: 1 });
    expect(buildAtEntryPayload(draft, { ...context, mutationKey: ACCOUNT, options })).toBeNull();
    expect(draft.actualRisk).toEqual({ mode: 'different', amount: '100.00' });

    expect(validateAtEntryDraft(setActualRiskAmount(draft, '100.01'), context).errors).toEqual({});
  });

  it('asks for the amount only when Different with an amount is chosen', () => {
    expect(
      validateAtEntryDraft(setActualRiskMode(minimum(), 'different'), context).errors
        .actualRiskAmount,
    ).toBe('required');
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
