'use client';

import { HeartPulse, Lightbulb } from 'lucide-react';
import { useState } from 'react';

import { money, targetR } from '../exit-model';
import { PROTOTYPE_TIMEZONE } from '../fixtures';
import { PrototypeShell } from '../prototype-shell';
import { EMPTY_EXIT_PLAN, ExitPlanRow, type ExitPlanDraft } from './exit-plan';
import {
  Band,
  ChoiceGroup,
  ContextLine,
  Field,
  FieldPair,
  FormFooter,
  FormShell,
  PrimaryAmountField,
  QuietAction,
  ResultLine,
  TaskSurface,
  TextField,
} from './form-primitives';
import { JournalAtEntry, useJournalDraft } from './journal-at-entry';
import {
  EMPTY_FEELINGS,
  EMPTY_PLAN,
  FeelingsEditor,
  feelingsSummary,
  tradeIdeaSummary,
  type FeelingsDraft,
  type PlanDraft,
} from './journal-editors';
import { TimestampField, type Timestamp } from './timestamp-picker';
import { TradeIdeaOverlay } from './trade-idea-overlay';

const RECENT_SYMBOLS = ['XAUUSD', 'NAS100', 'EURUSD'];

/** The prototype's fixed "now", captured once so a screenshot is reproducible. */
const CAPTURED_NOW = { date: '2026-09-07', time: '14:32' } as const;

/**
 * STILL OPEN — the whole position, or part of it, is still running.
 *
 * WHAT THE LABEL CHANGE FIXED. This path was called "At entry", which describes
 * WHEN the journal was opened rather than what state the trade is in. A trader
 * who opened a position last week and is writing it up today belongs here and
 * would never have guessed it; a partially closed position belongs here too and
 * fitted neither of the old labels. `Still open` is a fact about the trade, and
 * the trader always knows it.
 *
 * THE SHORT PATH IS FOUR ANSWERS. Symbol, direction, risk at entry, save. The
 * account is already chosen and the entry time is already captured, so a trader
 * who agrees with both is three fields from a saved record. Everything else on
 * this screen is an invitation.
 *
 * "RISK AT ENTRY", NOT "INITIAL RISK". The old label reads as jargon to someone
 * who has not met the concept; the new one says when the number was true. It is
 * the one large editable figure on the page, because it is the only number the
 * product cannot derive and the only one this screen genuinely needs.
 *
 * THE TARGET IS AN ENTRANCE, NOT AN EMPTY FIELD. A blank "Target reward" box
 * standing open says a target is expected; a link says it is available. And R
 * appears only once a target exists to derive it from — never as the page's
 * headline, because a beginner does not yet know what R is and a screen that
 * leads with it has led with a unit rather than with their trade.
 *
 * NOTHING ASSERTS THAT THE OPENING MATCHED A PLAN. The previous version printed
 * "Opening matches plan" with a tick, which is a claim the form had no evidence
 * for — nobody had said what the plan was. If a planned risk has been recorded
 * in the journal, it is stated beside the actual one as a fact; if it has not,
 * the page says nothing at all.
 */
export function AtEntryForm({
  /** A part-finished draft, for the review state that shows populated summaries. */
  filled = false,
  /** Seeds the baseline, so a review state can show a legible worked example. */
  seedRisk,
  seedTarget,
  /** Opens on the explicit No fixed target state, so it can be reviewed directly. */
  seedNoTarget = false,
}: {
  filled?: boolean;
  seedRisk?: string;
  seedTarget?: string;
  seedNoTarget?: boolean;
}) {
  const [symbol, setSymbol] = useState(filled ? 'XAUUSD' : '');
  const [direction, setDirection] = useState<'long' | 'short' | null>(filled ? 'long' : null);
  const [risk, setRisk] = useState(seedRisk ?? (filled ? '200.00' : ''));
  const [enteredAt, setEnteredAt] = useState<Timestamp | null>(CAPTURED_NOW);

  const [target, setTarget] = useState(seedTarget ?? (filled ? '1000.00' : ''));
  /*
    THREE STATES, NOT TWO. A blank target means "not answered yet"; this flag
    means "this strategy has no fixed target", which is a complete answer. They
    are different facts about a plan and the form must not collapse them.

    The typed value is KEPT so the choice is reversible, and is excluded from
    every calculation while the flag is set — see `targetR`. Nothing derived
    reads `target` without checking this first.
  */
  const [noFixedTarget, setNoFixedTarget] = useState(seedNoTarget);
  const [exitPlan, setExitPlan] = useState<ExitPlanDraft>(EMPTY_EXIT_PLAN);

  const [plan, setPlan] = useState<PlanDraft>(
    filled
      ? {
          ...EMPTY_PLAN,
          reason: 'Third push out of the London range, with the 4H trend.',
          strategy: 'Elliott Wave',
          setup: 'Wave 3 Continuation',
        }
      : EMPTY_PLAN,
  );
  const [feelings, setFeelings] = useState<FeelingsDraft>(
    filled ? { confidence: 75, emotions: ['calm', 'focused'] } : EMPTY_FEELINGS,
  );

  /*
    THE JOURNAL EDITORS WRITE TO A WORKING COPY, NOT TO THE TRADE.

    `Done` merges it in; `Cancel` and Escape put it back. The launchers and every
    derived line below keep reading the COMMITTED value — `plan`, not
    `idea.draft` — so an abandoned edit never appears in a preview, and the exit
    plan never inherits from a strategy the trader typed and then discarded.
  */
  const idea = useJournalDraft(plan, setPlan);
  const emotion = useJournalDraft(feelings, setFeelings);

  /*
    TARGET R IS DERIVED, AND ONLY WHEN BOTH HALVES EXIST.

    `Target profit / Risk at entry`. It is not a result and never becomes one —
    it is what this trade is set up to pay if it reaches the target, expressed in
    the unit the rest of the journal uses. A trade with no target has no Target
    R, which is an ordinary state for any strategy that exits on a signal rather
    than at a price.

    A zero or unrecorded risk yields `null`, never a zero and never an infinity.
  */
  const riskNumber = Number(risk);
  const reward = noFixedTarget ? null : money(target);
  const targetRValue = reward === null ? null : targetR(reward, riskNumber);

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <FormShell
        situation="Still open"
        onChangeSituation={() => {
          window.location.href = '../log-trade';
        }}
        footer={
          <FormFooter
            action="Save open trade"
            helper="You can add exits and review later."
            sticky
          />
        }
      >
        <TaskSurface>
          <Band className="gap-3 py-3.5">
            <ContextLine account="Live · FTMO 100K" currency="USD" onChange={() => {}} />
          </Band>

          <Band>
            <FieldPair>
              <div className="flex min-w-0 flex-col gap-1.5">
                <TextField
                  label="Symbol"
                  value={symbol}
                  onChange={setSymbol}
                  placeholder="e.g. XAUUSD"
                />
                {/* Recent symbols as one-tap chips. On a phone this is the
                    difference between typing six characters and pressing once. */}
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {RECENT_SYMBOLS.map((recent) => (
                    <button
                      key={recent}
                      type="button"
                      onClick={() => setSymbol(recent)}
                      className="border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring relative rounded-full border px-2.5 py-1 text-xs outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] focus-visible:ring-2"
                    >
                      {recent}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Direction">
                {() => (
                  <ChoiceGroup
                    legend="Direction"
                    value={direction}
                    onChange={setDirection}
                    options={[
                      { value: 'long', label: 'Long' },
                      { value: 'short', label: 'Short' },
                    ]}
                  />
                )}
              </Field>
            </FieldPair>

            {/*
              THE CAPTURED TIME HAS TO LOOK LIKE A VALUE THAT CAN BE CHANGED.

              Still open covers two situations: a position opened moments ago,
              and one opened last week that is still running. The convenience of
              pre-filling "now" serves the first and quietly mis-records the
              second — a trader writing up Tuesday's position accepts today's
              timestamp because it was already there and looked settled.

              So the field states that the value came from the clock, and offers
              the change in the same breath. One short line, not a paragraph, and
              it disappears the moment the trader picks a different time.
            */}
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-subtle-foreground mb-1 text-xs">Times in {PROTOTYPE_TIMEZONE}</p>
              <TimestampField
                label="Entry time"
                title="Entry date and time"
                value={enteredAt}
                onChange={setEnteredAt}
                placeholder="Not set"
              />
              {enteredAt !== null &&
              enteredAt.date === CAPTURED_NOW.date &&
              enteredAt.time === CAPTURED_NOW.time ? (
                <p className="text-subtle-foreground text-xs">
                  Set to now. Opened earlier? Change it.
                </p>
              ) : null}
            </div>
          </Band>

          {/*
            THE FOCAL BAND. No heading above it: "Your plan" competed with the
            figure for the reader's first fixation and told them nothing the
            field label does not. The figure IS the section.
          */}
          {/*
            THE BASELINE. Two amounts, and the ratio between them.

            THE AMOUNTS / PRICES SWITCH IS GONE FROM THIS PATH. It asked a trader
            to choose a representation before they had entered a single figure —
            and the two branches were not equivalent: one recorded money and the
            other recorded levels and quietly could not produce a monetary
            result. A baseline is two amounts. Price levels still exist, as
            optional structured detail behind "What is your plan?", where they
            describe the trade rather than gate the form.
          */}
          {/*
            TWO EQUAL AMOUNTS, NOT ONE FIGURE AND ONE FOOTNOTE.

            Risk was a full-size focal field and Target was a narrow
            "Target profit · Optional" box beneath it — so the screen said risk
            matters and the target is an extra. Both are the plan-at-entry
            baseline: same label weight, same control, same height, same currency
            treatment, equal columns on a desktop and equal full-width rows on a
            phone. What "Optional" used to carry is carried precisely now, by the
            No fixed target choice underneath.
          */}
          <Band divided={false} className="gap-3 py-5">
            {/*
              THE PAIR HAS A NAME NOW.

              Rendered, the two amounts read as two form inputs that happened to
              be side by side — nothing said they were one thing. "Plan at entry"
              is the name the Close trade flow and Trade details already give this
              same baseline, so naming it here makes one concept read the same
              way in all three places instead of being a heading in two of them
              and an unlabelled row in the third.
            */}
            <h2 className="text-label text-muted-foreground uppercase">Plan at entry</h2>

            <FieldPair>
              <PrimaryAmountField
                label="Risk at entry"
                currency="USD"
                value={risk}
                onChange={setRisk}
                hint="What the whole position stood to lose if your protective exit was hit."
              />
              {/*
                THE FACT IS STATED ONCE, IN ONE CONTROL.

                It used to be stated twice: the field showed a "No fixed target"
                readout AND kept a checked "No fixed target" option row
                underneath it, sixty pixels apart, so the answered state
                announced itself, then announced itself again. Reading it, the
                honest question was whether the two were the same thing.

                Unanswered, "No fixed target" is a quiet action beside the
                label — available, not asked. Answered, it is one readout of the
                input's own height carrying its own way back. Nothing sits
                beneath either.
              */}
              <PrimaryAmountField
                label="Target profit"
                currency="USD"
                value={target}
                onChange={setTarget}
                {...(noFixedTarget
                  ? {
                      readOut: 'No fixed target',
                      readOutAction: (
                        <QuietAction onClick={() => setNoFixedTarget(false)}>
                          Change
                          {/* The page already has two buttons reading "Change" —
                              the situation and the account — and a third would
                              be a list of three identical names to anyone
                              navigating by button. The word beside it stays one
                              word; the accessible name says what it changes. */}
                          <span className="sr-only"> target</span>
                        </QuietAction>
                      ),
                    }
                  : {
                      trailing: (
                        <QuietAction onClick={() => setNoFixedTarget(true)}>
                          No fixed target
                        </QuietAction>
                      ),
                    })}
              />
            </FieldPair>

            {/*
              ONE DERIVED LINE, AND ONLY WHEN IT MEANS SOMETHING.

              Absent while the target is unanswered, and absent when there is no
              fixed target — in that case the declaration above already explains
              why, and printing "0R" or "Not recorded" would answer a question
              the trader has already answered. No reward:risk ratio beside it:
              one derived figure, secondary to the two amounts it comes from.
            */}
            {targetRValue === null ? null : (
              /* A hairline above it, so the figure visibly belongs to the two
                 amounts rather than floating after them. */
              <div className="border-border/70 min-w-0 border-t pt-3">
                <ResultLine
                  label="Target R"
                  value={`+${targetRValue.toFixed(2)}R`}
                  detail={`1R = ${riskNumber.toFixed(2)} USD`}
                />
              </div>
            )}

            {/*
              THE EXIT PLAN IS PART OF THE BASELINE, AND ALWAYS VISIBLE.

              Not conditional on the target: a trade with a fixed target can
              still have a rule that closes it earlier, and a trade with no
              target may have no rule either. Sitting it here rather than inside
              "Trade idea" is deliberate — the idea is the trader's reasoning,
              this is a structured fact about how the position is to be managed,
              and only the second one can later support any assessment.
            */}
            <ExitPlanRow draft={exitPlan} onChange={setExitPlan} strategyName={plan.strategy} />
          </Band>
        </TaskSurface>

        {/*
          "TRADE IDEA", NOT "WHAT IS YOUR PLAN?".

          The baseline directly above already holds the plan's numbers — risk,
          target, Target R — so a journaling row called "your plan" asked for the
          same thing twice under one name. What the editor actually collects is
          the thought behind the trade, so that is what the entrance is called.
          Its focused editor holds the reasoning, Strategy / Setup and chart
          evidence. Structured plan facts stay in the baseline above.
        */}
        <JournalAtEntry
          areas={[
            {
              id: 'idea',
              label: 'Trade idea',
              Icon: Lightbulb,
              invitation: 'Why did you take this trade?',
              title: 'Trade idea',
              description: 'Why you took this trade, and anything you want to remember about it.',
              preview: tradeIdeaSummary(plan),
              onDone: idea.done,
              onCancel: idea.cancel,
              children: null,
              renderOverlay: ({ open, onOpenChange }) => (
                <TradeIdeaOverlay
                  open={open}
                  onOpenChange={onOpenChange}
                  draft={idea.draft}
                  onChange={idea.setDraft}
                  onDone={idea.done}
                  onCancel={idea.cancel}
                />
              ),
            },
            {
              id: 'feelings',
              label: 'Feelings at entry',
              Icon: HeartPulse,
              invitation: 'How did you feel?',
              title: 'How did you feel at entry?',
              description: 'Your state at the moment you took it. Nothing here is scored.',
              preview: feelingsSummary(feelings),
              onDone: emotion.done,
              onCancel: emotion.cancel,
              children: <FeelingsEditor draft={emotion.draft} onChange={emotion.setDraft} />,
            },
          ]}
        />
      </FormShell>
    </PrototypeShell>
  );
}
