import { describe, expect, it } from 'vitest';

import { actualRDenominatorMinor, laterCaptureOrigin } from './add-trade-contract';
import { CreateTradeSchema } from './schemas';

const uuid1 = '019112a0-0000-7000-8000-000000000001';
const uuid2 = '019112a0-0000-7000-8000-000000000002';
const uuid3 = '019112a0-0000-7000-8000-000000000003';

/** The Add Trade contract minimum: Account, Symbol, Direction and Risk at Entry. */
function contractInput(overrides: Record<string, unknown> = {}) {
  return {
    mutationKey: uuid1,
    tradingAccountId: uuid2,
    symbol: 'XAUUSD',
    direction: 'long' as const,
    recordingTiming: 'at_entry' as const,
    recordingContract: 'add_trade_v1' as const,
    systemPlanBasis: 'money' as const,
    plannedRiskState: 'defined' as const,
    plannedRiskMinor: '10000',
    actualRiskAnswer: 'matched' as const,
    ...overrides,
  };
}

function issueMessages(input: unknown): string[] {
  const result = CreateTradeSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('CreateTradeSchema — Add Trade contract v1', () => {
  it('accepts the minimum At Entry Trade with no entry time, Target or Exit Plan', () => {
    expect(issueMessages(contractInput())).toEqual([]);
  });

  /*
    NO DEFINED RISK IS A COMPLETE SAVE (contract decision 54). It carries no
    planned money at all, so it declares no plan basis either — a basis
    without a plan is what `system_plan_basis_without_plan` exists to refuse.
    This is the boundary the service tests cannot see, and where a No Defined
    Risk Save was refused in the browser before this check existed.
  */
  it('accepts No Defined Risk with no amount and no plan basis', () => {
    const { plannedRiskMinor: _risk, systemPlanBasis: _basis, ...rest } = contractInput();
    expect(issueMessages({ ...rest, plannedRiskState: 'no_defined' })).toEqual([]);
    // A basis declared over no plan figures is still refused.
    expect(
      issueMessages({ ...rest, plannedRiskState: 'no_defined', systemPlanBasis: 'money' }),
    ).toContain('system_plan_basis_without_plan');
    // And an amount beside it contradicts the answer it was saved with.
    expect(
      issueMessages({ ...rest, plannedRiskState: 'no_defined', plannedRiskMinor: '5000' }),
    ).toContain('no_defined_risk_has_no_amount');
  });

  it('requires a positive Risk at Entry, and leaves Actual Risk to the trader', () => {
    const { plannedRiskMinor: _risk, ...withoutRisk } = contractInput();
    expect(issueMessages(withoutRisk)).toContain('contract_requires_risk_at_entry');
    /*
      ACTUAL RISK MAY BE UNANSWERED. Matched and Different are answers the
      trader gives; an omitted answer is Unanswered and is accepted as such,
      rather than being demanded and therefore defaulted to a match nobody
      stated (contract §2, §8).
    */
    const { actualRiskAnswer: _answer, ...withoutAnswer } = contractInput();
    expect(issueMessages(withoutAnswer)).toEqual([]);
  });

  it('keeps a Matched Actual Risk free of a second amount but lets Different carry one or none', () => {
    expect(issueMessages(contractInput({ actualInitialRiskMinor: '12000' }))).toContain(
      'matched_actual_risk_has_no_amount',
    );
    expect(
      issueMessages(
        contractInput({ actualRiskAnswer: 'different', actualInitialRiskMinor: '12000' }),
      ),
    ).toEqual([]);
    expect(issueMessages(contractInput({ actualRiskAnswer: 'different' }))).toEqual([]);
    expect(
      issueMessages(
        contractInput({ actualRiskAnswer: 'different', actualInitialRiskMinor: '10000' }),
      ),
    ).toContain('different_actual_risk_equals_risk_at_entry');
  });

  it('attaches an incomplete Fixed Target to the Target question', () => {
    const result = CreateTradeSchema.safeParse(contractInput({ targetState: 'fixed' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (candidate) => candidate.message === 'fixed_target_requires_representation',
    );
    expect(issue?.path).toEqual(['targetState']);
  });

  it('accepts a Fixed Target from Target Profit or a TP price, and refuses values without one', () => {
    expect(
      issueMessages(contractInput({ targetState: 'fixed', plannedRewardMinor: '20000' })),
    ).toEqual([]);
    expect(issueMessages(contractInput({ targetState: 'fixed', targetPrice: '2450.5' }))).toEqual(
      [],
    );
    expect(
      issueMessages(contractInput({ targetState: 'no_fixed', plannedRewardMinor: '20000' })),
    ).toContain('target_values_require_fixed_target');
    expect(issueMessages(contractInput({ targetPrice: '2450.5' }))).toContain(
      'target_values_require_fixed_target',
    );
  });

  it('keeps price as context: no Price plan, no Price result, no switch to Price', () => {
    expect(
      issueMessages(contractInput({ plannedEntry: '2400', plannedStop: '2390' })).length,
    ).toBeGreaterThan(0);
    expect(issueMessages(contractInput({ actualResultMode: 'price' })).length).toBeGreaterThan(0);
    expect(issueMessages(contractInput({ systemPlanBasis: 'price' })).length).toBeGreaterThan(0);
    expect(
      issueMessages(
        contractInput({
          contextEntryPrice: '2400',
          contextStopPrice: '2410',
          contextPositionSize: '0.5',
        }),
      ),
    ).toEqual([]);
    expect(issueMessages(contractInput({ contextStopPrice: '-1' }))).not.toEqual([]);
    expect(issueMessages(contractInput({ contextStopPrice: '0' }))).not.toEqual([]);
  });

  it('pairs an entry time with where it came from', () => {
    expect(
      issueMessages(
        contractInput({ enteredAt: '2026-09-16T08:00:00Z', enteredAtSource: 'default_now' }),
      ),
    ).toEqual([]);
    expect(issueMessages(contractInput({ enteredAt: '2026-09-16T08:00:00Z' }))).toContain(
      'entered_at_source_mismatch',
    );
    expect(issueMessages(contractInput({ enteredAtSource: 'trader' }))).toContain(
      'entered_at_source_mismatch',
    );
  });

  it('accepts each Exit Plan answer and refuses an inherited plan without a Strategy', () => {
    expect(issueMessages(contractInput({ exitPlan: { state: 'no_rule' } }))).toEqual([]);
    expect(
      issueMessages(
        contractInput({
          exitPlan: { state: 'customized', baseExitPlanId: null, instructions: 'Close at 2R.' },
        }),
      ),
    ).toEqual([]);
    expect(
      issueMessages(
        contractInput({
          strategyId: uuid3,
          exitPlan: { state: 'saved', exitPlanId: uuid1, provenance: 'strategy_default' },
        }),
      ),
    ).toEqual([]);
    expect(
      issueMessages(
        contractInput({
          exitPlan: { state: 'saved', exitPlanId: uuid1, provenance: 'strategy_default' },
        }),
      ),
    ).toContain('inherited_exit_plan_requires_strategy');
    expect(
      issueMessages(
        contractInput({
          strategyId: uuid3,
          exitPlan: { state: 'saved', exitPlanId: uuid1, provenance: 'strategy_default' },
          exitPlanInheritanceDeclined: true,
        }),
      ),
    ).toContain('inherited_exit_plan_conflicts_with_declined');
    expect(
      issueMessages(
        contractInput({
          exitPlan: { state: 'customized', baseExitPlanId: null, instructions: ' ' },
        }),
      ),
    ).not.toEqual([]);
  });

  it('holds explicit "No Strategy" and "No Setup" apart from a selection', () => {
    expect(issueMessages(contractInput({ noStrategy: true }))).toEqual([]);
    expect(issueMessages(contractInput({ noStrategy: true, strategyId: uuid3 }))).toContain(
      'no_strategy_conflicts_with_strategy',
    );
    expect(issueMessages(contractInput({ noSetup: true, strategyId: uuid3 }))).toEqual([]);
    expect(issueMessages(contractInput({ noSetup: true }))).toContain(
      'no_setup_requires_strategy_without_setup',
    );
  });

  it('refuses contract answers on a legacy write', () => {
    const { recordingContract: _contract, ...legacy } = contractInput({
      enteredAt: '2026-09-16T08:00:00Z',
      targetState: 'no_fixed',
    });
    expect(issueMessages(legacy)).toContain('contract_fields_require_contract');
  });
});

describe('add-trade-contract helpers', () => {
  it('measures a contract row against Risk at Entry and a legacy row against its Actual Risk', () => {
    expect(
      actualRDenominatorMinor({
        recordingContract: 'add_trade_v1',
        plannedRiskMinor: 10_000n,
        actualInitialRiskMinor: 30_000n,
      }),
    ).toBe(10_000n);
    expect(
      actualRDenominatorMinor({
        recordingContract: null,
        plannedRiskMinor: 10_000n,
        actualInitialRiskMinor: 30_000n,
      }),
    ).toBe(30_000n);
  });

  it('names a later answer by whether the Trade was still open', () => {
    expect(laterCaptureOrigin('open')).toBe('recorded_during_trade');
    expect(laterCaptureOrigin('closed')).toBe('recalled_after_trade');
  });
});
