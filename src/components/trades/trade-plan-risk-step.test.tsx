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
  risk: 'plan-risk',
  targetState: 'plan-target',
  targetProfit: 'plan-target-profit',
  targetPrice: 'plan-target-price',
  entryPrice: 'plan-entry-price',
  stopPrice: 'plan-stop-price',
  positionSize: 'plan-size',
  priceContextToggle: 'plan-price-toggle',
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
  targetR,
}: {
  mode: PlanRiskMode;
  withStrategy?: boolean;
  errors?: Errors;
  notices?: { stopWrongSide: boolean; targetWrongSide: boolean };
  riskFollowUp?: ReactNode;
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
  return document.querySelector('[data-exit-plan-state]')!.getAttribute('data-exit-plan-state');
}

function card(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title, level: 3 }).closest('section')!;
}

describe('Plan & Risk — what the step holds', () => {
  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'asks Risk at Entry, Target, Exit Plan and folded price levels in %s — and nothing else',
    (mode) => {
      renderStep({ mode });
      expect(document.querySelector('[data-plan-risk-step]')).toHaveAttribute(
        'data-plan-risk-step',
        mode,
      );
      expect(screen.getByLabelText(/^Risk at entry/)).toHaveValue('');
      expect(screen.getByRole('radio', { name: /^Fixed target/ })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: /^No fixed target/ })).not.toBeChecked();
      expect(document.querySelector('[data-exit-plan-state]')).not.toBeNull();
      expect(screen.getByRole('button', { name: /^Price levels/ })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      // Actual Risk, Strategy, Setup and conditions are other steps' questions.
      expect(screen.queryByText(/actual risk/i)).toBeNull();
      expect(screen.queryByLabelText('Strategy')).toBeNull();
      expect(screen.queryByLabelText('Setup')).toBeNull();
    },
  );

  it('shows a host follow-up inside the Risk card, where the host puts it', () => {
    renderStep({ mode: 'after_trade', riskFollowUp: <p>host follow-up</p> });
    expect(within(card('Risk')).getByText('host follow-up')).toBeInTheDocument();
  });

  it('says Risk at Entry is required to save an open trade, and optional after the trade', () => {
    renderStep({ mode: 'at_entry' });
    expect(within(card('Risk')).getByText('Required')).toBeInTheDocument();
    cleanup();
    renderStep({ mode: 'after_trade' });
    expect(within(card('Risk')).getByText('Optional')).toBeInTheDocument();
    expect(within(card('Risk')).queryByText('Required')).toBeNull();
  });

  it('keeps a blank Risk at Entry blank, never zero, and shows the host error beside it', () => {
    renderStep({ mode: 'at_entry', errors: { risk: 'Enter a risk greater than zero.' } });
    const risk = screen.getByLabelText(/^Risk at entry/);
    expect(risk).toHaveValue('');
    expect(risk).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a risk greater than zero.')).toBeInTheDocument();
  });
});

describe('Plan & Risk — Target keeps its three states', () => {
  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'Unanswered, Fixed and No Fixed stay distinct, and hidden values survive (%s)',
    (mode) => {
      renderStep({ mode });
      const target = card('Target');
      expect(within(target).getByText('Not answered')).toBeInTheDocument();
      expect(screen.queryByLabelText('Target profit')).toBeNull();

      fireEvent.click(screen.getByRole('radio', { name: /^Fixed target/ }));
      fireEvent.change(screen.getByLabelText('Target profit'), { target: { value: '300' } });

      // No Fixed Target hides the value; it does not delete it.
      fireEvent.click(screen.getByRole('radio', { name: /^No fixed target/ }));
      expect(screen.queryByLabelText('Target profit')).toBeNull();
      fireEvent.click(screen.getByRole('radio', { name: /^Fixed target/ }));
      expect(screen.getByLabelText('Target profit')).toHaveValue('300');

      // Back to Unanswered only through the named action.
      fireEvent.click(within(target).getByRole('button', { name: 'Remove target answer' }));
      expect(screen.getByRole('radio', { name: /^Fixed target/ })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: /^No fixed target/ })).not.toBeChecked();
      expect(within(target).getByText('Not answered')).toBeInTheDocument();
    },
  );

  it('labels the TP price as context and derives no R from prices', () => {
    renderStep({ mode: 'after_trade' });
    fireEvent.click(screen.getByRole('radio', { name: /^Fixed target/ }));
    expect(screen.getByText('Price context')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('TP price'), { target: { value: '2410' } });
    fireEvent.click(screen.getByRole('button', { name: /^Price levels/ }));
    fireEvent.change(screen.getByLabelText('Entry price'), { target: { value: '2400' } });
    fireEvent.change(screen.getByLabelText('SL price'), { target: { value: '2395' } });
    // No computed R figure appears (the Risk hint's "your 1R" is copy, not a
    // figure): price is never a calculation input.
    expect(screen.queryByText(/\d+\.\d+R\b/)).toBeNull();
  });

  it("shows At Entry's money-based target R only when the host supplies it", () => {
    renderStep({ mode: 'at_entry', targetR: '+3.00R' });
    expect(screen.getByText('Reaching your target would be +3.00R.')).toBeInTheDocument();
  });
});

describe('Plan & Risk — the Exit Plan', () => {
  it('At Entry shows an inherited Strategy default as inherited, never as chosen', () => {
    renderStep({ mode: 'at_entry', withStrategy: true });
    expect(exitPlanState()).toBe('inherited');
    expect(screen.getAllByText('From Strategy: Golden Breakout').length).toBeGreaterThan(0);
  });

  it('After Trade never inherits, even when a Strategy is answered and passed in', () => {
    renderStep({ mode: 'after_trade', withStrategy: true });
    expect(exitPlanState()).toBe('not_recorded');
    expect(screen.queryByText(/From Strategy/)).toBeNull();
    // Nor is today's default offered as a one-press answer for a historical
    // Trade: that would apply a current default retrospectively (contract §5).
    expect(screen.queryByRole('button', { name: 'Use strategy default', hidden: true })).toBeNull();
  });

  it('At Entry keeps a declined default declined, restored only by the named action', () => {
    renderStep({ mode: 'at_entry', withStrategy: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove exit plan answer' }));
    expect(exitPlanState()).toBe('not_recorded');
    fireEvent.click(screen.getByRole('button', { name: 'Use strategy default' }));
    expect(exitPlanState()).toBe('inherited');
  });

  it.each<PlanRiskMode>(['at_entry', 'after_trade'])(
    'records No Defined Exit Rule as its own answer, removable only by name (%s)',
    (mode) => {
      renderStep({ mode });
      if (mode === 'after_trade') {
        fireEvent.click(screen.getByRole('button', { name: /^Exit plan/ }));
      }
      expect(exitPlanState()).toBe('not_recorded');
      fireEvent.click(screen.getByRole('button', { name: 'No defined exit rule' }));
      expect(exitPlanState()).toBe('no_rule');
      fireEvent.click(screen.getByRole('button', { name: 'Remove exit plan answer' }));
      expect(exitPlanState()).toBe('not_recorded');
    },
  );
});

describe('Plan & Risk — price levels are folded context', () => {
  it('says the prices are context, and reads its values back when folded', () => {
    renderStep({ mode: 'at_entry' });
    const toggle = screen.getByRole('button', { name: /^Price levels/ });
    expect(toggle).toHaveTextContent('Nothing added');
    fireEvent.click(toggle);
    expect(screen.getByText('Context only, never used to calculate results')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Entry price'), { target: { value: '2398.5' } });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '2' } });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Entry price 2398.5 · Size 2');
  });

  it('never folds over an error, and shows price notices without blocking anything', () => {
    renderStep({
      mode: 'after_trade',
      errors: { stopPrice: 'Enter a price.' },
      notices: { stopWrongSide: true, targetWrongSide: false },
    });
    const toggle = screen.getByRole('button', { name: /^Price levels/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('1 thing to fix');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('SL price')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Your SL price is on the profit side of entry/)).toBeInTheDocument();
  });
});
