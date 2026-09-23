import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import * as afterTrade from './after-trade-draft';
import * as atEntry from './at-entry-draft';
import { staleSelections } from './stale-selection';
import { TradeSetupChecklistStep, type SetupChecklistMode } from './trade-setup-checklist-step';

afterEach(cleanup);

const ACCOUNT_ID = '018f0000-0000-7000-8000-000000000001';
const GOLDEN = '018f0000-0000-7000-8000-000000000010';
const RANGE = '018f0000-0000-7000-8000-000000000011';
const RETEST_SETUP = '018f0000-0000-7000-8000-000000000020';
const BARE_SETUP = '018f0000-0000-7000-8000-000000000021';
const RETEST = '018f0000-0000-7000-8000-000000000041';
const TREND = '018f0000-0000-7000-8000-000000000042';

const options = {
  exitPlans: [
    {
      exitPlanId: '018f0000-0000-7000-8000-000000000030',
      name: 'Trail structure',
      instructions: 'Trail beneath each higher low.',
      strategyId: GOLDEN,
    },
    {
      exitPlanId: '018f0000-0000-7000-8000-000000000031',
      name: 'Fade to the mean',
      instructions: 'Close at the range midpoint.',
      strategyId: RANGE,
    },
  ],
  strategies: [
    {
      strategyId: GOLDEN,
      name: 'Golden Breakout',
      currentVersionNumber: 1,
      setups: [
        {
          setupId: RETEST_SETUP,
          name: 'Clean Retest',
          sortOrder: 0,
          conditionSetToken: 'a'.repeat(64),
          conditions: [
            { conditionKey: RETEST, label: 'Retest held', sortOrder: 0 },
            { conditionKey: TREND, label: 'Trend aligned', sortOrder: 1 },
          ],
        },
        {
          setupId: BARE_SETUP,
          name: 'Bare Setup',
          sortOrder: 1,
          conditionSetToken: 'b'.repeat(64),
          conditions: [],
        },
      ],
    },
    { strategyId: RANGE, name: 'Range Fade', currentVersionNumber: 1, setups: [] },
  ],
} as const satisfies Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;

type Hosted = { entry: atEntry.AtEntryDraft; after: afterTrade.AfterTradeDraft };
let latest: Hosted;

/**
 * THE STEP, HOSTED THE WAY EACH FORM HOSTS IT: its own draft, its own
 * module's transitions and resolver. The drafts are never merged.
 */
function Host({
  mode,
  offered = options,
  seed,
}: {
  mode: SetupChecklistMode;
  offered?: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  seed?: (drafts: Hosted) => Hosted;
}) {
  const [drafts, setDrafts] = useState<Hosted>(() => {
    const start = {
      entry: atEntry.createAtEntryDraft(ACCOUNT_ID),
      after: afterTrade.createAfterTradeDraft(ACCOUNT_ID),
    };
    return seed === undefined ? start : seed(start);
  });
  useEffect(() => {
    latest = drafts;
  }, [drafts]);
  const entry = (change: (draft: atEntry.AtEntryDraft) => atEntry.AtEntryDraft) =>
    setDrafts((current) => ({ ...current, entry: change(current.entry) }));
  const after = (change: (draft: afterTrade.AfterTradeDraft) => afterTrade.AfterTradeDraft) =>
    setDrafts((current) => ({ ...current, after: change(current.after) }));

  if (mode === 'at_entry') {
    const active = atEntry.activeClassification(drafts.entry, offered);
    const exitPlan = atEntry.resolveExitPlan(drafts.entry, offered);
    return (
      <TradeSetupChecklistStep
        mode="at_entry"
        idPrefix="entry"
        strategies={offered.strategies}
        classification={{
          strategyAnswer: drafts.entry.classification.strategy,
          strategy: active.strategy,
          setupAnswer: active.setupAnswer,
          setup: active.setup,
          stale: staleSelections(drafts.entry, offered),
        }}
        conditionAnswers={active.conditionAnswers}
        inheritedExitPlanName={
          exitPlan.resolved.status === 'inherited' ? exitPlan.resolved.plan.name : null
        }
        onSelectStrategy={(id) => entry((draft) => atEntry.selectStrategy(draft, id))}
        onNoStrategy={() => entry(atEntry.answerNoStrategy)}
        onRemoveStrategy={() => entry(atEntry.removeStrategyAnswer)}
        onSelectSetup={(id) => entry((draft) => atEntry.selectSetup(draft, id))}
        onNoSetup={() => entry(atEntry.answerNoSetup)}
        onRemoveSetup={() => entry(atEntry.removeSetupAnswer)}
        onCondition={(key, status) => entry((draft) => atEntry.answerCondition(draft, key, status))}
      />
    );
  }
  const active = afterTrade.activeAfterTradeClassification(drafts.after, offered);
  return (
    <TradeSetupChecklistStep
      mode="after_trade"
      idPrefix="after"
      strategies={offered.strategies}
      classification={{
        strategyAnswer: active.strategyAnswer,
        strategy: active.strategy,
        setupAnswer: active.setupAnswer,
        setup: active.setup,
        stale: staleSelections(drafts.after, offered),
      }}
      conditionAnswers={active.conditionAnswers}
      onSelectStrategy={(id) => after((draft) => afterTrade.selectStrategy(draft, id))}
      onNoStrategy={() => after(afterTrade.answerNoStrategy)}
      onRemoveStrategy={() => after(afterTrade.removeStrategyAnswer)}
      onSelectSetup={(id) => after((draft) => afterTrade.selectSetup(draft, id))}
      onNoSetup={() => after(afterTrade.answerNoSetup)}
      onRemoveSetup={() => after(afterTrade.removeSetupAnswer)}
      onCondition={(key, status) =>
        after((draft) => afterTrade.answerCondition(draft, key, status))
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

function row(field: 'strategy' | 'setup'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-classification="${field}"]`)!;
}

/** Open a row's editor and choose, the way a trader does: the tap is the answer. */
function choose(field: 'Strategy' | 'Setup', choice: string) {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: choice }));
}

function removeAnswer(field: 'Strategy' | 'Setup') {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${field}` }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: `Remove ${field.toLowerCase()} answer`,
    }),
  );
}

function checklistMessage(): string | null {
  return document.querySelector('[data-checklist-message]')?.textContent ?? null;
}

const MODES: readonly SetupChecklistMode[] = ['at_entry', 'after_trade'];

describe('Setup & Checklist — what the step holds', () => {
  it.each(MODES)('asks Strategy, Setup and the checklist, and nothing else (%s)', (mode) => {
    renderStep({ mode });
    expect(row('strategy')).toHaveTextContent('Not answered');
    expect(row('strategy')).toHaveAttribute('data-answer', 'unanswered');
    // A Setup belongs to a Strategy, so it waits for one — and says so.
    expect(row('setup')).toBeDisabled();
    expect(row('setup')).toHaveTextContent('Choose a strategy first');
    expect(checklistMessage()).toBe('Choose a strategy, then a setup, to answer its checklist.');
    // Other stages' questions are not here.
    for (const absent of [
      /confidence/i,
      /emotion/i,
      /why this trade/i,
      /timeframe/i,
      /session/i,
      /chart/i,
      /actual risk/i,
      /followed|violated/i,
    ]) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });
});

describe('Setup & Checklist — Strategy and Setup keep their three answers', () => {
  it.each(MODES)('Unanswered, No strategy and a selected Strategy stay distinct (%s)', (mode) => {
    renderStep({ mode });
    choose('Strategy', 'No strategy');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row('strategy')).toHaveTextContent('No strategy');
    expect(row('strategy')).toHaveAttribute('data-answer', 'none');
    expect(row('setup')).toHaveTextContent('Not needed without a strategy');
    expect(checklistMessage()).toBe(
      'No strategy for this trade, so there is no checklist to answer.',
    );

    choose('Strategy', 'Golden Breakout');
    expect(row('strategy')).toHaveTextContent('Golden Breakout');
    expect(row('strategy')).toHaveAttribute('data-answer', 'selected');
    expect(row('setup')).toBeEnabled();
    expect(checklistMessage()).toBe('Choose a setup to answer its conditions.');

    removeAnswer('Strategy');
    expect(row('strategy')).toHaveAttribute('data-answer', 'unanswered');
    expect(row('strategy')).toHaveTextContent('Not answered');
  });

  it.each(MODES)(
    'offers only the chosen Strategy’s Setups, plus an explicit No setup (%s)',
    (mode) => {
      renderStep({ mode });
      choose('Strategy', 'Golden Breakout');
      fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
      const editor = within(screen.getByRole('dialog'));
      expect(editor.getByRole('button', { name: 'Clean Retest' })).toBeInTheDocument();
      expect(editor.getByRole('button', { name: 'Bare Setup' })).toBeInTheDocument();
      expect(editor.getByRole('button', { name: 'No setup' })).toBeInTheDocument();
      expect(editor.queryByRole('button', { name: 'Range Fade' })).toBeNull();
    },
  );

  it.each(MODES)(
    'No setup is a complete answer with its own sentence, not an empty step (%s)',
    (mode) => {
      renderStep({ mode });
      choose('Strategy', 'Golden Breakout');
      choose('Setup', 'No setup');
      expect(row('setup')).toHaveTextContent('No setup');
      expect(row('setup')).toHaveAttribute('data-answer', 'none');
      expect(checklistMessage()).toBe(
        'No setup for this trade, so there is no checklist to answer.',
      );
      removeAnswer('Setup');
      expect(row('setup')).toHaveAttribute('data-answer', 'unanswered');
      expect(checklistMessage()).toBe('Choose a setup to answer its conditions.');
    },
  );

  it('says a Strategy has no Setups yet, and still takes No setup', () => {
    renderStep({ mode: 'at_entry' });
    choose('Strategy', 'Range Fade');
    // Said on the row and in place of the checklist, as a state — not an error.
    expect(row('setup')).toHaveTextContent('Range Fade has no setups yet.');
    expect(row('setup')).toHaveAttribute('data-answer', 'unanswered');
    expect(checklistMessage()).toBe(
      'Range Fade has no setups, so there is no checklist to answer.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Setup' }));
    expect(
      within(screen.getByRole('dialog')).getByText('Range Fade has no setups yet.'),
    ).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'No setup' }));
    expect(row('setup')).toHaveAttribute('data-answer', 'none');
    // Once answered, the row says the answer and nothing more.
    expect(row('setup')).not.toHaveTextContent('has no setups yet');
    expect(checklistMessage()).toBe('No setup for this trade, so there is no checklist to answer.');
  });

  it('says there are no strategies yet, and still takes No strategy', () => {
    renderStep({ mode: 'after_trade', offered: { strategies: [], exitPlans: [] } });
    expect(row('strategy')).toHaveTextContent('Not answered');
    expect(row('strategy')).toHaveTextContent('No strategies in this workspace yet');
    expect(checklistMessage()).toBe(
      'There are no strategies yet, so there is no checklist to answer.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Strategy' }));
    expect(
      screen.getByText('You have no strategies yet. Add them on the Strategies page.'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'No strategy' }),
    );
    expect(row('strategy')).toHaveAttribute('data-answer', 'none');
    expect(row('strategy')).not.toHaveTextContent('No strategies in this workspace yet');
    expect(checklistMessage()).toBe(
      'No strategy for this trade, so there is no checklist to answer.',
    );
  });

  it('keeps a Setup with no conditions from looking unfinished', () => {
    renderStep({ mode: 'after_trade' });
    choose('Strategy', 'Golden Breakout');
    choose('Setup', 'Bare Setup');
    expect(checklistMessage()).toBe('This setup has no conditions to answer.');
  });

  it('keeps a chosen Strategy that went away as chosen, and says so', () => {
    renderStep({
      mode: 'after_trade',
      seed: (drafts) => ({
        ...drafts,
        after: afterTrade.selectStrategy(drafts.after, '018f0000-0000-7000-8000-0000000000ff'),
      }),
    });
    expect(row('strategy')).toHaveTextContent('No longer available');
    expect(row('strategy')).toHaveAttribute('data-answer', 'unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent(/archived or removed/);
    expect(document.querySelector('[data-checklist-state]')).toBeNull();
  });
});

describe('Setup & Checklist — conditions are multi-state, never checkboxes', () => {
  function openChecklist(mode: SetupChecklistMode) {
    renderStep({ mode });
    choose('Strategy', 'Golden Breakout');
    choose('Setup', 'Clean Retest');
  }

  it('shows every condition at once, unanswered, with no checkbox anywhere', () => {
    openChecklist('at_entry');
    const retest = screen.getByRole('group', { name: 'Retest held' });
    expect(screen.getByRole('group', { name: 'Trend aligned' })).toBeInTheDocument();
    expect(within(retest).getByRole('radio', { name: 'Met' })).not.toBeChecked();
    expect(within(retest).getByRole('radio', { name: 'Not met' })).not.toBeChecked();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('0 of 2 conditions answered')).toBeInTheDocument();
  });

  it('At Entry offers Met / Not met only, and removing an answer is never a Not met', () => {
    openChecklist('at_entry');
    const retest = screen.getByRole('group', { name: 'Retest held' });
    expect(within(retest).queryByRole('radio', { name: "Don't remember" })).toBeNull();
    fireEvent.click(within(retest).getByRole('radio', { name: 'Not met' }));
    expect(screen.getByText('1 of 2 conditions answered')).toBeInTheDocument();
    expect(latest.entry.classification.conditions[GOLDEN]?.[RETEST_SETUP]?.[RETEST]).toBe(
      'not_met',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove answer for Retest held' }));
    expect(
      latest.entry.classification.conditions[GOLDEN]?.[RETEST_SETUP]?.[RETEST],
    ).toBeUndefined();
    expect(within(retest).getByRole('radio', { name: 'Not met' })).not.toBeChecked();
  });

  it('each row reads its own state — Unanswered in words, an answer by marker and weight', () => {
    openChecklist('at_entry');
    const retest = screen.getByRole('group', { name: 'Retest held' });
    // Unanswered: said in words, nothing selected, and nothing to remove.
    expect(retest).toHaveAttribute('data-condition-answer', 'unanswered');
    expect(within(retest).getByText('Not answered')).toBeInTheDocument();
    expect(retest.querySelector('[data-option-selected]')).toBeNull();
    expect(within(retest).queryByRole('button', { name: /Remove answer/ })).toBeNull();

    fireEvent.click(within(retest).getByRole('radio', { name: 'Met' }));
    expect(retest).toHaveAttribute('data-condition-answer', 'met');
    const selected = retest.querySelectorAll('[data-option-selected]');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Met');
    expect(within(retest).queryByText('Not answered')).toBeNull();
    // The other row is untouched: answering one never answers its neighbour.
    expect(screen.getByRole('group', { name: 'Trend aligned' })).toHaveAttribute(
      'data-condition-answer',
      'unanswered',
    );

    fireEvent.click(within(retest).getByRole('button', { name: 'Remove answer for Retest held' }));
    expect(retest).toHaveAttribute('data-condition-answer', 'unanswered');
    expect(within(retest).getByText('Not answered')).toBeInTheDocument();
  });

  it('Record Closed adds Don’t remember as its own answer, distinct from Not met and Unanswered', () => {
    openChecklist('after_trade');
    const retest = screen.getByRole('group', { name: 'Retest held' });
    fireEvent.click(within(retest).getByRole('radio', { name: "Don't remember" }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Trend aligned' })).getByRole('radio', {
        name: 'Not met',
      }),
    );
    const answers = latest.after.classification.conditions[GOLDEN]?.[RETEST_SETUP];
    expect(answers).toEqual({ [RETEST]: 'unknown', [TREND]: 'not_met' });
    expect(screen.getByText('2 of 2 conditions answered')).toBeInTheDocument();
  });
});

describe('Setup & Checklist — the Exit Plan', () => {
  function notice(): string | null {
    return document.querySelector('[data-inherited-exit-plan]')?.textContent ?? null;
  }

  it('At Entry announces the inherited plan here, and follows a Strategy change', () => {
    renderStep({ mode: 'at_entry' });
    expect(notice()).toBeNull();
    choose('Strategy', 'Golden Breakout');
    expect(notice()).toContain(
      'Golden Breakout currently supplies the exit plan “Trail structure”',
    );
    // SEEN where it is caused: under the Strategy on its own row, whole, not truncated.
    expect(row('strategy')).toHaveTextContent('Exit plan from Strategy: Trail structure');
    // The announcement sits in a polite live region, so the change is heard as well as seen.
    expect(document.querySelector('[data-inherited-exit-plan]')!.parentElement).toHaveAttribute(
      'aria-live',
      'polite',
    );
    choose('Strategy', 'Range Fade');
    expect(notice()).toContain('Range Fade currently supplies the exit plan “Fade to the mean”');
    // A Strategy change is never silent: the row follows it.
    expect(row('strategy')).toHaveTextContent('Exit plan from Strategy: Fade to the mean');
    expect(row('strategy')).not.toHaveTextContent('Trail structure');
    // The step itself never writes the Exit Plan: inheritance is still the host's answer.
    expect(latest.entry.exitPlan.choice).toEqual({ kind: 'inherit' });
  });

  it('At Entry stops following the Strategy once the Exit Plan is explicitly overridden', () => {
    renderStep({
      mode: 'at_entry',
      seed: (drafts) => ({ ...drafts, entry: atEntry.chooseNoExitRule(drafts.entry) }),
    });
    choose('Strategy', 'Golden Breakout');
    expect(notice()).toBeNull();
    choose('Strategy', 'Range Fade');
    expect(notice()).toBeNull();
    // An override is not implied to be inherited, on the row either.
    expect(row('strategy')).not.toHaveTextContent(/Exit plan from Strategy/);
    expect(latest.entry.exitPlan.choice).toEqual({ kind: 'no_rule' });
  });

  it('Record Closed never announces or applies a Strategy default', () => {
    renderStep({ mode: 'after_trade' });
    choose('Strategy', 'Golden Breakout');
    expect(notice()).toBeNull();
    expect(screen.queryByText(/supplies the exit plan/)).toBeNull();
    expect(row('strategy')).not.toHaveTextContent(/Exit plan from Strategy/);
    expect(latest.after.exitPlan.choice).toEqual({ kind: 'unanswered' });
  });
});

describe('Setup & Checklist — editors dismiss without changing anything', () => {
  it.each(MODES)('Escape leaves the answer as it was (%s)', (mode) => {
    renderStep({ mode });
    choose('Strategy', 'Golden Breakout');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Strategy' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(row('strategy')).toHaveTextContent('Golden Breakout');
    expect(row('strategy')).toHaveAttribute('data-answer', 'selected');
  });
});

vi.setConfig({ testTimeout: 15_000 });
