import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import * as afterTrade from './after-trade-draft';
import * as atEntry from './at-entry-draft';
import {
  TradePlanRiskStep,
  type ActualRiskSummary,
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
  riskFollowUp,
  actualRisk = { kind: 'not_recorded' },
  actualRiskError,
  targetR,
}: {
  mode: PlanRiskMode;
  withStrategy?: boolean;
  errors?: Errors;
  notices?: { stopWrongSide: boolean; targetWrongSide: boolean };
  riskFollowUp?: ReactNode;
  actualRisk?: ActualRiskSummary;
  actualRiskError?: string;
  targetR?: string | null;
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
    riskFollowUp: riskFollowUp ?? null,
    actualRisk,
    ...(actualRiskError === undefined ? {} : { actualRiskError }),
    targetR: targetR ?? null,
    onLibraryChanged: () => {},
  };
  return mode === 'at_entry' ? (
    <TradePlanRiskStep
      {...shared}
      mode="at_entry"
      risk={entry.risk}
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
      expect(row('risk')).toHaveTextContent('Risk at entry');
      expect(row('risk')).toHaveTextContent('Not answered');
      expect(row('target')).toHaveTextContent('Not answered');
      expect(exitPlanState()).toBe('not_recorded');
      expect(row('price')).toHaveTextContent('Nothing added');
      // No editor is open until one is asked for.
      expect(screen.queryByRole('dialog')).toBeNull();
      // Strategy and Setup are Step 3's questions, in any state.
      expect(screen.queryByLabelText('Strategy')).toBeNull();
      expect(screen.queryByLabelText('Setup')).toBeNull();
    },
  );

  it('records Risk at Entry in its editor and reads it back on the row', () => {
    renderStep({ mode: 'at_entry' });
    const editor = open('risk');
    fireEvent.change(editor.getByLabelText(/^Risk at entry/), { target: { value: '100' } });
    expect(row('risk')).toHaveTextContent('100 USD');
  });

  it('shows a host follow-up inside the Risk editor, never on the row', () => {
    renderStep({ mode: 'after_trade', riskFollowUp: <p>host follow-up</p> });
    expect(screen.queryByText('host follow-up')).toBeNull();
    expect(open('risk').getByText('host follow-up')).toBeInTheDocument();
  });

  it('says Risk at Entry is required to save an open trade, and optional after the trade', () => {
    renderStep({ mode: 'at_entry' });
    expect(within(row('risk')).getByText('Required')).toBeInTheDocument();
    cleanup();
    renderStep({ mode: 'after_trade' });
    expect(within(row('risk')).getByText('Optional')).toBeInTheDocument();
    expect(within(row('risk')).queryByText('Required')).toBeNull();
  });

  it('keeps a blank Risk at Entry blank, never zero, and carries the error on the closed row', () => {
    renderStep({ mode: 'at_entry', errors: { risk: 'Enter a risk greater than zero.' } });
    // A blocked Save lands here, so the row itself must say what is wrong.
    expect(row('risk')).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByText('Enter a risk greater than zero.')).toBeInTheDocument();
    expect(open('risk').getByLabelText(/^Risk at entry/)).toHaveValue('');
  });

  it("carries the host's Actual Risk error on the row too, since the row is what Save focuses", () => {
    renderStep({
      mode: 'after_trade',
      actualRisk: { kind: 'matched' },
      actualRiskError: 'Add your risk at entry first.',
    });
    expect(row('risk')).toHaveAttribute('data-invalid', 'true');
    expect(screen.getByText('Add your risk at entry first.')).toBeInTheDocument();
  });
});

describe('Plan & Risk — the Risk row never invents an Actual Risk answer', () => {
  /** Risk at Entry recorded, so the row has something to qualify. */
  function withRisk(props: Parameters<typeof Host>[0]) {
    renderStep(props);
    fireEvent.change(open('risk').getByLabelText(/^Risk at entry/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  }

  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'says actual risk is not recorded until it is, and never that it matched (%s)',
    (mode) => {
      withRisk({ mode, actualRisk: { kind: 'not_recorded' } });
      expect(row('risk')).toHaveTextContent('Actual risk not recorded');
      // The claim this row must never make on its own.
      expect(row('risk')).not.toHaveTextContent(/matched/i);
    },
  );

  it('says nothing at all about actual risk while Risk at Entry is unanswered', () => {
    renderStep({ mode: 'at_entry', actualRisk: { kind: 'not_recorded' } });
    expect(row('risk')).not.toHaveTextContent(/actual risk/i);
    expect(row('risk').querySelector('[data-launcher-support]')).toBeNull();
  });

  it('states a match only when the trader established it', () => {
    withRisk({ mode: 'after_trade', actualRisk: { kind: 'matched' } });
    expect(row('risk')).toHaveTextContent('Matched risk at entry');
  });

  it('reads back an explicitly different amount, and the shapes of not knowing it', () => {
    withRisk({ mode: 'after_trade', actualRisk: { kind: 'different', amount: '120' } });
    expect(row('risk')).toHaveTextContent('Actual risk 120 USD');
    cleanup();

    withRisk({ mode: 'after_trade', actualRisk: { kind: 'different', amount: '  ' } });
    expect(row('risk')).toHaveTextContent('Actual risk was different');
    cleanup();

    withRisk({ mode: 'at_entry', actualRisk: { kind: 'different_unknown' } });
    expect(row('risk')).toHaveTextContent('Different, amount not known');
    cleanup();

    withRisk({ mode: 'after_trade', actualRisk: { kind: 'unknown' } });
    expect(row('risk')).toHaveTextContent('Actual risk not known');
  });

  it('reports the state it was given, so a host can be read at a glance', () => {
    renderStep({ mode: 'at_entry', actualRisk: { kind: 'different_unknown' } });
    expect(row('risk')).toHaveAttribute('data-actual-risk-summary', 'different_unknown');
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
