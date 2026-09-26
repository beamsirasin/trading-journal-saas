import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import * as afterTrade from './after-trade-draft';
import * as atEntry from './at-entry-draft';
import type { RiskStateDraft } from './at-entry-draft';
import {
  TradePlanRiskStep,
  type PlanRiskField,
  type PlanRiskMode,
  type PlanStepId,
} from './trade-plan-risk-step';

vi.mock('@/server/actions/exit-plans', () => ({}));

afterEach(cleanup);

const ACCOUNT_ID = '018f0000-0000-7000-8000-000000000001';
const STRATEGY_ID = '018f0000-0000-7000-8000-000000000010';
const PLAN_ID = '018f0000-0000-7000-8000-000000000030';

const options = {
  exitPlans: [
    {
      exitPlanId: PLAN_ID,
      name: 'Trail structure',
      instructions: 'Trail beneath each higher low.',
      strategyId: STRATEGY_ID,
    },
  ],
  strategies: [
    { strategyId: STRATEGY_ID, name: 'Golden Breakout', currentVersionNumber: 1, setups: [] },
  ],
} as const satisfies Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;

const IDS: Readonly<Record<PlanStepId, string>> = {
  riskState: 'plan-risk-state',
  riskRow: 'plan-risk-row',
  targetRow: 'plan-target-row',
  exitPlanRow: 'plan-exit-plan-row',
  priceRow: 'plan-price-row',
  risk: 'plan-risk',
  targetState: 'plan-target',
  targetProfit: 'plan-target-profit',
  targetPrice: 'plan-target-price',
  entryPrice: 'plan-entry-price',
  stopPrice: 'plan-stop-price',
  positionSize: 'plan-size',
};

type Errors = Partial<Record<PlanRiskField, string>>;

/**
 * THE STEP, HOSTED THE WAY A FORM HOSTS IT. Each mode keeps its OWN draft and
 * applies its OWN module's transitions — the step never sees a merged model.
 */
function Host({
  mode,
  withStrategy = false,
  errors = {},
  notices = { stopWrongSide: false, targetWrongSide: false },
  targetR,
  plannedRR,
}: {
  mode: PlanRiskMode;
  withStrategy?: boolean;
  errors?: Errors;
  notices?: { stopWrongSide: boolean; targetWrongSide: boolean };
  targetR?: string | null;
  plannedRR?: string | null;
}) {
  const [entry, setEntry] = useState(() => {
    const draft = atEntry.createAtEntryDraft(ACCOUNT_ID);
    return withStrategy ? atEntry.selectStrategy(draft, STRATEGY_ID) : draft;
  });
  const [after, setAfter] = useState(() => {
    const draft = afterTrade.createAfterTradeDraft(ACCOUNT_ID);
    // The same Strategy answer an At Entry draft would carry — it must not matter here.
    return withStrategy ? afterTrade.selectStrategy(draft, STRATEGY_ID) : draft;
  });
  const shared = {
    ids: IDS,
    currency: 'USD',
    options,
    errorText: (field: PlanRiskField) => errors[field],
    notices,
    targetR: targetR ?? null,
    plannedRR: plannedRR ?? null,
    onLibraryChanged: () => {},
  };
  return mode === 'at_entry' ? (
    <TradePlanRiskStep
      {...shared}
      mode="at_entry"
      risk={entry.risk}
      riskState={entry.riskState}
      onRiskStateChange={(next: RiskStateDraft) =>
        setEntry((current) => atEntry.setRiskState(current, next))
      }
      target={entry.target}
      exitPlan={entry.exitPlan}
      classification={entry.classification}
      priceContext={entry.context}
      onRiskChange={(risk) => setEntry((current) => ({ ...current, risk }))}
      onTargetStateChange={(state) => setEntry((current) => atEntry.setTargetState(current, state))}
      onTargetValueChange={(field, value) =>
        setEntry((current) => atEntry.setTargetValue(current, field, value))
      }
      onExitPlanChange={(exitPlan) => setEntry((current) => ({ ...current, exitPlan }))}
      onPriceContextChange={(patch) =>
        setEntry((current) => ({ ...current, context: { ...current.context, ...patch } }))
      }
    />
  ) : (
    <TradePlanRiskStep
      {...shared}
      mode="after_trade"
      risk={after.risk}
      riskState={after.riskState}
      onRiskStateChange={(next: RiskStateDraft) =>
        setAfter((current) => afterTrade.setRiskState(current, next))
      }
      target={after.target}
      exitPlan={after.exitPlan}
      // Even handed a Strategy, After Trade must not inherit from it.
      {...(withStrategy
        ? { classification: atEntry.selectStrategy(entry, STRATEGY_ID).classification }
        : {})}
      priceContext={after.context}
      onRiskChange={(risk) => setAfter((current) => ({ ...current, risk }))}
      onTargetStateChange={(state) =>
        setAfter((current) => afterTrade.setTargetState(current, state))
      }
      onTargetValueChange={(field, value) =>
        setAfter((current) => afterTrade.setTargetValue(current, field, value))
      }
      onExitPlanChange={(exitPlan) => setAfter((current) => ({ ...current, exitPlan }))}
      onPriceContextChange={(patch) =>
        setAfter((current) => ({ ...current, context: { ...current.context, ...patch } }))
      }
    />
  );
}

function renderStep(props: Parameters<typeof Host>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Host {...props} />
    </NextIntlClientProvider>,
  );
}

function exitPlanState(): string | null {
  return document.querySelector('[data-exit-plan-row]')!.getAttribute('data-exit-plan-row');
}

function row(concept: 'risk' | 'target' | 'price'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-plan-row="${concept}"]`)!;
}

/** Take one choice the way a trader does: the label, not the hidden radio. */
function choose(editor: ReturnType<typeof within>, name: string) {
  const radio = editor.getByRole('radio', { name: new RegExp(`^${name}`) });
  fireEvent.click(document.querySelector<HTMLElement>(`label[for="${radio.id}"]`)!);
}

/** Open one row's editor, the way a trader does, and read inside it. */
function open(concept: 'risk' | 'target' | 'price' | 'exit'): ReturnType<typeof within> {
  const launcher =
    concept === 'exit'
      ? document.querySelector<HTMLElement>('[data-exit-plan-row]')!
      : row(concept);
  fireEvent.click(launcher);
  return within(screen.getByRole('dialog'));
}

describe('Plan & Risk — four rows, each opening its own editor', () => {
  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'reads Risk at Entry, Target, Exit Plan and Price levels as rows in %s — and asks nothing else',
    (mode) => {
      renderStep({ mode });
      expect(document.querySelector('[data-plan-risk-step]')).toHaveAttribute(
        'data-plan-risk-step',
        mode,
      );
      // Every concept is readable without opening anything.
      expect(row('risk')).toHaveTextContent('Risk');
      expect(row('risk')).toHaveTextContent('Not answered');
      expect(row('target')).toHaveTextContent('Not answered');
      expect(exitPlanState()).toBe('not_recorded');
      expect(row('price')).toHaveTextContent('Nothing added');
      // No editor is open until one is asked for.
      expect(screen.queryByRole('dialog')).toBeNull();
      // Strategy and Setup are Step 3's questions, in any state.
      expect(screen.queryByLabelText('Strategy')).toBeNull();
      expect(screen.queryByLabelText('Setup')).toBeNull();
      // Actual Risk is an execution fact, asked in Step 4 (decision 53).
      expect(screen.queryByText(/actual risk/i)).toBeNull();
    },
  );

  it('records a Defined Risk in its editor and reads the amount back on the row', () => {
    renderStep({ mode: 'at_entry' });
    const editor = open('risk');
    // The amount belongs to Defined Risk: it appears once that is chosen.
    expect(editor.queryByLabelText(/^Risk at entry/)).toBeNull();
    choose(editor, 'Defined risk');
    fireEvent.change(editor.getByLabelText(/^Risk at entry/), { target: { value: '100' } });
    expect(row('risk')).toHaveTextContent('100 USD');
    expect(row('risk')).toHaveAttribute('data-risk-state', 'defined');
  });

  /*
    ONE REQUIREMENT MODEL IN BOTH RECORDING MOMENTS (decision 59): Risk and
    Target are Required to complete the Trade, Price levels Optional, and the
    Exit Plan follows the Target — never decided by an Unanswered one.
  */
  it.each(['at_entry', 'after_trade'] as const)(
    'marks Risk and Target Required and Price levels Optional (%s)',
    (mode) => {
      renderStep({ mode });
      for (const concept of ['risk', 'target'] as const) {
        expect(row(concept).querySelector('[data-requirement]')).toHaveAttribute(
          'data-requirement',
          'required',
        );
      }
      expect(row('price').querySelector('[data-requirement]')).toHaveAttribute(
        'data-requirement',
        'optional',
      );
    },
  );

  it('keeps a blank Risk at Entry blank, never zero, and carries the error on the closed row', () => {
    renderStep({ mode: 'at_entry', errors: { risk: 'Enter a risk greater than zero.' } });
    // A blocked Save lands here, so the row itself must say what is wrong.
    expect(row('risk')).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByText('Enter a risk greater than zero.')).toBeInTheDocument();
    const editor = open('risk');
    choose(editor, 'Defined risk');
    expect(editor.getByLabelText(/^Risk at entry/)).toHaveValue('');
  });
});

describe('Plan & Risk — risk is a decision, never a number the form extracts', () => {
  /*
    THREE STATES THAT MUST NOT COLLAPSE (contract decision 54). Unanswered is
    not No Defined Risk, and No Defined Risk is not a zero: each reads as
    itself on the row and each is reached by saying so.
  */
  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'starts Unanswered, offering both answers and taking neither (%s)',
    (mode) => {
      renderStep({ mode });
      expect(row('risk')).toHaveAttribute('data-risk-state', 'unanswered');
      expect(row('risk')).toHaveTextContent('Not answered');
      expect(row('risk')).not.toHaveTextContent(/no defined risk/i);
      const editor = open('risk');
      for (const name of [/^Defined risk/, /^No defined risk/]) {
        expect(editor.getByRole('radio', { name })).not.toBeChecked();
      }
      // The amount is not asked until the decision calls for one.
      expect(editor.queryByLabelText(/^Risk at entry/)).toBeNull();
    },
  );

  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'records No Defined Risk as its own answer, and asks for no amount (%s)',
    (mode) => {
      const editor = renderStep({ mode }) && open('risk');
      choose(editor, 'No defined risk');
      expect(row('risk')).toHaveAttribute('data-risk-state', 'no_defined');
      expect(row('risk')).toHaveTextContent('No defined risk');
      expect(editor.queryByLabelText(/^Risk at entry/)).toBeNull();
      // And it says plainly what that costs, where the answer was given.
      expect(
        editor.getByText('R and RR comparison will not be available for this trade.'),
      ).toBeVisible();
    },
  );

  it('drops an amount that a later No Defined Risk contradicts', () => {
    renderStep({ mode: 'at_entry' });
    const editor = open('risk');
    choose(editor, 'Defined risk');
    fireEvent.change(editor.getByLabelText(/^Risk at entry/), { target: { value: '100' } });
    choose(editor, 'No defined risk');
    expect(row('risk')).toHaveTextContent('No defined risk');
    expect(row('risk')).not.toHaveTextContent('100');
    // Returning to Defined starts from empty, never from the contradicted figure.
    choose(editor, 'Defined risk');
    expect(editor.getByLabelText(/^Risk at entry/)).toHaveValue('');
  });

  it('returns to Unanswered only through its own named action', () => {
    renderStep({ mode: 'after_trade' });
    const editor = open('risk');
    choose(editor, 'No defined risk');
    fireEvent.click(editor.getByRole('button', { name: 'Remove risk answer' }));
    expect(row('risk')).toHaveAttribute('data-risk-state', 'unanswered');
    expect(row('risk')).toHaveTextContent('Not answered');
  });

  /*
    PRICE DECIDES NOTHING (contract §3). An SL price says where a stop would
    sit; it neither defines a risk nor proves there was none.
  */
  it('is never inferred from a recorded SL price', () => {
    renderStep({ mode: 'at_entry' });
    const price = open('price');
    fireEvent.change(price.getByLabelText('SL price'), { target: { value: '2395' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(row('price')).toHaveTextContent('SL price 2395');
    expect(row('risk')).toHaveAttribute('data-risk-state', 'unanswered');
    expect(row('risk')).toHaveTextContent('Not answered');
  });

  /* Stop Method is retired from capture: the step no longer asks it. */
  it('no longer asks for a Stop Method at all', () => {
    renderStep({ mode: 'at_entry' });
    const editor = open('risk');
    for (const gone of [/broker stop/i, /mental stop/i, /no defined stop/i]) {
      expect(editor.queryByText(gone)).toBeNull();
    }
  });
});

describe('Plan & Risk — Target keeps its three states', () => {
  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'Unanswered, Fixed and No Fixed stay distinct, and hidden values survive (%s)',
    (mode) => {
      renderStep({ mode });
      const editor = open('target');
      expect(editor.getByText('Not answered')).toBeInTheDocument();
      expect(screen.queryByLabelText('Target profit')).toBeNull();

      fireEvent.click(editor.getByRole('radio', { name: /^Fixed target/ }));
      fireEvent.change(editor.getByLabelText('Target profit'), { target: { value: '300' } });

      // No Fixed Target hides the value; it does not delete it.
      fireEvent.click(editor.getByRole('radio', { name: /^No fixed target/ }));
      expect(screen.queryByLabelText('Target profit')).toBeNull();
      expect(row('target')).toHaveTextContent('No fixed target');
      fireEvent.click(editor.getByRole('radio', { name: /^Fixed target/ }));
      expect(editor.getByLabelText('Target profit')).toHaveValue('300');
      expect(row('target')).toHaveTextContent('Fixed · 300 USD');

      // Back to Unanswered only through the named action.
      fireEvent.click(editor.getByRole('button', { name: 'Remove target answer' }));
      expect(editor.getByRole('radio', { name: /^Fixed target/ })).not.toBeChecked();
      expect(editor.getByRole('radio', { name: /^No fixed target/ })).not.toBeChecked();
      expect(row('target')).toHaveTextContent('Not answered');
    },
  );

  it('reads a Fixed Target with no amount as Fixed, never as a figure it does not have', () => {
    renderStep({ mode: 'at_entry' });
    fireEvent.click(open('target').getByRole('radio', { name: /^Fixed target/ }));
    expect(row('target')).toHaveTextContent('Fixed target');
    expect(row('target')).not.toHaveTextContent('·');
  });

  it('reads a recorded TP price on the row when there is no R to show, and never a nag', () => {
    renderStep({ mode: 'after_trade' });
    const editor = open('target');
    fireEvent.click(editor.getByRole('radio', { name: /^Fixed target/ }));
    // Nothing recorded yet: the row says nothing about the TP price.
    expect(row('target').querySelector('[data-launcher-support]')).toBeNull();
    fireEvent.change(editor.getByLabelText('TP price'), { target: { value: '2410' } });
    expect(row('target')).toHaveTextContent('TP price 2410');
  });

  it('prefers the money-based R over the TP price when the host derived one', () => {
    renderStep({ mode: 'at_entry', targetR: '+3.00R' });
    const editor = open('target');
    fireEvent.click(editor.getByRole('radio', { name: /^Fixed target/ }));
    fireEvent.change(editor.getByLabelText('TP price'), { target: { value: '2410' } });
    expect(row('target')).toHaveTextContent('Reaching your target would be +3.00R.');
    expect(row('target')).not.toHaveTextContent('TP price');
  });

  it('labels the TP price as context and derives no R from prices', () => {
    renderStep({ mode: 'after_trade' });
    const target = open('target');
    fireEvent.click(target.getByRole('radio', { name: /^Fixed target/ }));
    expect(target.getByText('Price context')).toBeInTheDocument();
    fireEvent.change(target.getByLabelText('TP price'), { target: { value: '2410' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    const price = open('price');
    fireEvent.change(price.getByLabelText('Entry price'), { target: { value: '2400' } });
    fireEvent.change(price.getByLabelText('SL price'), { target: { value: '2395' } });
    // No computed R figure appears: price is never a calculation input.
    expect(screen.queryByText(/\d+\.\d+R\b/)).toBeNull();
  });

  it("shows At Entry's money-based target R on the row and in the editor, from the host", () => {
    renderStep({ mode: 'at_entry', targetR: '+3.00R' });
    expect(row('target')).toHaveTextContent('Reaching your target would be +3.00R.');
    expect(open('target').getByText('Reaching your target would be +3.00R.')).toBeInTheDocument();
  });
});

describe('Plan & Risk — the Exit Plan', () => {
  it('At Entry shows an inherited Strategy default as inherited, never as chosen', () => {
    renderStep({ mode: 'at_entry', withStrategy: true });
    expect(exitPlanState()).toBe('inherited');
    // Readable as inherited on the row itself, before anything is opened.
    expect(screen.getByText('From Strategy: Golden Breakout')).toBeInTheDocument();
    expect(open('exit').getAllByText(/From Strategy: Golden Breakout/).length).toBeGreaterThan(0);
  });

  it('After Trade never inherits, even when a Strategy is answered and passed in', () => {
    renderStep({ mode: 'after_trade', withStrategy: true });
    expect(exitPlanState()).toBe('not_recorded');
    expect(screen.queryByText(/From Strategy/)).toBeNull();
    // Nor is today's default offered as a one-press answer for a historical
    // Trade: that would apply a current default retrospectively (contract §5).
    expect(open('exit').queryByRole('button', { name: 'Use strategy default' })).toBeNull();
  });

  it('At Entry keeps a declined default declined, restored only by the named action', () => {
    renderStep({ mode: 'at_entry', withStrategy: true });
    const editor = open('exit');
    fireEvent.click(editor.getByRole('button', { name: 'Remove exit plan answer' }));
    expect(exitPlanState()).toBe('not_recorded');
    fireEvent.click(editor.getByRole('button', { name: 'Use strategy default' }));
    expect(exitPlanState()).toBe('inherited');
  });

  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'records No Defined Exit Rule as its own answer, removable only by name (%s)',
    (mode) => {
      renderStep({ mode });
      const editor = open('exit');
      expect(exitPlanState()).toBe('not_recorded');
      fireEvent.click(editor.getByRole('button', { name: 'No defined exit rule' }));
      expect(exitPlanState()).toBe('no_rule');
      expect(document.querySelector('[data-exit-plan-row]')).toHaveTextContent(
        'No defined exit rule',
      );
      fireEvent.click(editor.getByRole('button', { name: 'Remove exit plan answer' }));
      expect(exitPlanState()).toBe('not_recorded');
    },
  );
});

describe('Plan & Risk — price levels are context', () => {
  it('says the prices are context, and reads its values back on the row', () => {
    renderStep({ mode: 'at_entry' });
    expect(row('price')).toHaveTextContent('Nothing added');
    const editor = open('price');
    expect(editor.getByText('Context only, never used to calculate results')).toBeInTheDocument();
    fireEvent.change(editor.getByLabelText('Entry price'), { target: { value: '2398.5' } });
    fireEvent.change(editor.getByLabelText('Size'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row('price')).toHaveTextContent('Entry price 2398.5 · Size 2');
  });

  it('shows an error on the closed row, and price notices without blocking anything', () => {
    renderStep({
      mode: 'after_trade',
      errors: { stopPrice: 'Enter a price.' },
      notices: { stopWrongSide: true, targetWrongSide: false },
    });
    // Nothing that stops a Save is hidden behind a tap.
    expect(row('price')).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByText('Enter a price.')).toBeInTheDocument();
    const editor = open('price');
    expect(editor.getByLabelText('SL price')).toHaveAttribute('aria-invalid', 'true');
    expect(editor.getByText(/Your SL price is on the profit side of entry/)).toBeInTheDocument();
  });
});

/*
  THE PLAN AT A GLANCE (contract decision 54). The card restates answers given
  in the rows above and states only what is known: a ratio exists when a
  Defined Risk and a Fixed Target's profit both do, and every other shape says
  which one it is rather than printing a figure it cannot have.
*/
describe('Plan & Risk — the planned summary', () => {
  function summary(): HTMLElement {
    return document.querySelector<HTMLElement>('[data-planned-summary]')!;
  }

  function line(name: string): HTMLElement {
    return summary().querySelector<HTMLElement>(`[data-planned-line="${name}"]`)!;
  }

  function defineRisk(amount: string) {
    const editor = open('risk');
    choose(editor, 'Defined risk');
    fireEvent.change(editor.getByLabelText(/^Risk at entry/), { target: { value: amount } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  }

  function fixedTarget(profit: string) {
    const editor = open('target');
    fireEvent.click(editor.getByRole('radio', { name: /^Fixed target/ }));
    fireEvent.change(editor.getByLabelText('Target profit'), { target: { value: profit } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  }

  it('shows the ratio when a Defined Risk and a Fixed Target both exist', () => {
    renderStep({ mode: 'at_entry', plannedRR: '1:2' });
    defineRisk('50');
    fixedTarget('100');
    expect(line('risk')).toHaveTextContent('50 USD');
    expect(line('target')).toHaveTextContent('100 USD');
    expect(line('rr')).toHaveTextContent('1:2');
  });

  it('shows no ratio at all when the trader defined no risk', () => {
    renderStep({ mode: 'at_entry' });
    fixedTarget('100');
    choose(open('risk'), 'No defined risk');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(summary()).toHaveAttribute('data-planned-summary', 'no_defined');
    expect(line('risk')).toHaveTextContent('Not defined');
    // Not "0", not "1:0" — no ratio can ever exist for this Trade.
    expect(line('rr')).toHaveTextContent('Not available');
    expect(line('rr')).not.toHaveTextContent('1:');
  });

  it('keeps a rule-based plan valid, with a ratio that is not knowable yet', () => {
    renderStep({ mode: 'at_entry' });
    defineRisk('50');
    const target = open('target');
    fireEvent.click(target.getByRole('radio', { name: /^No fixed target/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(line('risk')).toHaveTextContent('50 USD');
    expect(line('target')).toHaveTextContent('Rule-based');
    // An open question, not a closed door: the exit rule decides the result.
    expect(line('rr')).toHaveTextContent('Not known yet');
  });

  it('names the exit plan the rule-based plan relies on', () => {
    renderStep({ mode: 'at_entry', withStrategy: true });
    defineRisk('50');
    expect(line('exitPlan')).toHaveTextContent('Trail structure');
  });

  it('never shows a trader result: at entry there is none', () => {
    renderStep({ mode: 'at_entry', plannedRR: '1:2' });
    defineRisk('50');
    fixedTarget('100');
    for (const absent of [/actual/i, /result/i, /p&l/i, /^win$/i]) {
      expect(within(summary()).queryByText(absent)).toBeNull();
    }
  });
});
