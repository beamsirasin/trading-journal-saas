'use client';

import { useState } from 'react';

import { PROTOTYPE_TIMEZONE } from '../fixtures';
import { PrototypeShell } from '../prototype-shell';
import {
  Band,
  ChoiceGroup,
  ContextLine,
  Field,
  FieldPair,
  FormFooter,
  FormShell,
  PrimaryAmountField,
  ResultLine,
  TaskSurface,
  TextField,
} from './form-primitives';
import {
  EMPTY_FEELINGS,
  EMPTY_PLAN,
  FeelingsEditor,
  feelingsSummary,
  PlanEditor,
  planSummary,
  type FeelingsDraft,
  type PlanDraft,
} from './journal-editors';
import { JournalPrompts } from './journal-prompts';
import { TimestampField, type Timestamp } from './timestamp-picker';

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
}: {
  filled?: boolean;
  seedRisk?: string;
  seedTarget?: string;
}) {
  const [symbol, setSymbol] = useState(filled ? 'XAUUSD' : '');
  const [direction, setDirection] = useState<'long' | 'short' | null>(filled ? 'long' : null);
  const [risk, setRisk] = useState(seedRisk ?? (filled ? '200.00' : ''));
  const [enteredAt, setEnteredAt] = useState<Timestamp | null>(CAPTURED_NOW);

  const [target, setTarget] = useState(seedTarget ?? (filled ? '1000.00' : ''));

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
    TARGET R IS DERIVED, AND ONLY WHEN BOTH HALVES EXIST.

    `Target profit / Risk at entry`. It is not a result and never becomes one —
    it is what this trade is set up to pay if it reaches the target, expressed in
    the unit the rest of the journal uses. A trade with no target has no Target
    R, which is an ordinary state for any strategy that exits on a signal rather
    than at a price.

    A zero or unrecorded risk yields `null`, never a zero and never an infinity.
  */
  const riskNumber = Number(risk);
  const targetNumber = Number(target);
  const hasRisk = risk !== '' && Number.isFinite(riskNumber) && riskNumber > 0;
  const targetR =
    hasRisk && target !== '' && Number.isFinite(targetNumber) ? targetNumber / riskNumber : null;

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
          <Band divided={false} className="py-5">
            <PrimaryAmountField
              label="Risk at entry"
              currency="USD"
              value={risk}
              onChange={setRisk}
              hint="What the whole position stood to lose if your protective exit was hit."
            />

            {/*
              THE TARGET IS IN THE BASELINE NOW, NOT BEHIND A LINK.

              It was hidden behind "Add target", which made the commonest half of
              a plan feel like an extra. It is a plain optional field: visible,
              answerable, and legitimately left blank by any strategy that exits
              on a signal rather than at a price.
            */}
            <div className="flex max-w-[16rem] min-w-0 flex-col gap-2">
              <TextField
                label="Target profit (USD)"
                optional
                value={target}
                onChange={setTarget}
                inputMode="decimal"
                numeric
              />
            </div>

            {/*
              R IS SECONDARY AND SAYS SO. It appears only once a target exists to
              derive it from, at body size, under a label that names the unit
              rather than assuming it — never as the largest thing on a screen
              belonging to someone who has not learned what R means.
            */}
            {targetR === null ? null : (
              <ResultLine
                label="Target R"
                value={`+${targetR.toFixed(2)}R`}
                detail={`1R = ${riskNumber.toFixed(2)} USD`}
              />
            )}
          </Band>
        </TaskSurface>

        <JournalPrompts
          prompts={[
            {
              id: 'plan',
              question: 'What is your plan?',
              summary: planSummary(plan, 'USD'),
              children: (
                <PlanEditor tense="present" draft={plan} onChange={setPlan} currency="USD" />
              ),
            },
            {
              id: 'feelings',
              question: 'How did you feel at entry?',
              summary: feelingsSummary(feelings),
              children: <FeelingsEditor draft={feelings} onChange={setFeelings} />,
            },
          ]}
        />
      </FormShell>
    </PrototypeShell>
  );
}
