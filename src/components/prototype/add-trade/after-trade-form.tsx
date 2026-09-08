'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import { PROTOTYPE_TIMEZONE } from '../fixtures';
import { PrototypeShell } from '../prototype-shell';
import { DEFAULT_EXIT_ROWS, ExitsEditor, latestExitTimestamp, type ExitRow } from './exits-editor';
import {
  Band,
  BasisToggle,
  ChoiceGroup,
  ContextLine,
  Field,
  FieldPair,
  FormFooter,
  FormShell,
  OutcomeChoice,
  PrimaryAmountField,
  QuietAction,
  TaskSurface,
  TextField,
  type MoneyOutcome,
} from './form-primitives';
import {
  EMPTY_FEELINGS,
  EMPTY_PLAN,
  EMPTY_REVIEW,
  FeelingsEditor,
  feelingsSummary,
  PlanEditor,
  planSummary,
  ReviewEditor,
  reviewSummary,
  type FeelingsDraft,
  type PlanDraft,
  type ReviewDraft,
} from './journal-editors';
import { JournalPrompts } from './journal-prompts';
import { formatTimestamp, TimestampField, type Timestamp } from './timestamp-picker';

/**
 * FULLY CLOSED — the whole finished trade, written up in one sitting.
 *
 * THE MENTAL MODEL THIS PASS CORRECTED. The previous composition read "the
 * result, and everything else is hidden somewhere". That is a defensible
 * reading of "After trade" and the wrong one: a trader journaling a completed
 * trade is reconstructing the WHOLE trade — what was traded, which way, when it
 * opened and closed, what was risked, what it made, and what they thought about
 * it. So the screen shows two compact factual groups, THE TRADE and RESULT,
 * and the result is prominent because it is known, not because the rest was
 * demoted.
 *
 * MONEY LEADS; R FOLLOWS. `+2.00R` was the largest figure on the screen, which
 * is right for a trader fluent in R and useless to everyone else. `Net profit
 * +400.00 USD` is the headline now, with `Result (R)` beneath it — a beginner
 * can verify the first against their broker statement and learn the second by
 * watching it move.
 *
 * NO PLUS/MINUS TOGGLE. The sign is asked in words — Profit, Loss, Break-even —
 * because a beginner should never have to discover an icon-only control in order
 * to record a losing trade, and because a form that silently defaults to
 * "profit" will happily save someone's worst trade as a win.
 *
 * NOTHING IS RECONSTRUCTED FROM THE RESULT. The plan starts blank and stays
 * blank unless the trader actually had one; the rule-based comparison is never
 * seeded from the exit. An exit price says where the position closed, not which
 * rule would have fired first, and a form that guesses turns a counterfactual
 * into a copy of the actual.
 */
export function AfterTradeForm({
  /** Opens the multiple-exits editor on arrival, for the partial-exit review states. */
  exits = false,
  /** Which leg opens as the active editor, for the active-editor review state. */
  activeExit = null,
  /** A part-finished draft, for the review state that shows populated summaries. */
  filled = false,
}: {
  exits?: boolean;
  activeExit?: string | null;
  filled?: boolean;
}) {
  const [basis, setBasis] = useState<'money' | 'price'>('money');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [direction, setDirection] = useState<'long' | 'short' | null>('long');
  const [risk, setRisk] = useState('200.00');
  const [pnl, setPnl] = useState('400.00');
  const [outcome, setOutcome] = useState<MoneyOutcome>('profit');
  const [multipleExits, setMultipleExits] = useState(exits);

  const [enteredAt, setEnteredAt] = useState<Timestamp | null>(null);
  const [exitedAt, setExitedAt] = useState<Timestamp | null>(null);
  const [exitRows, setExitRows] = useState<readonly ExitRow[]>(DEFAULT_EXIT_ROWS);

  /*
    WITH MULTIPLE EXITS, THE FINAL EXIT TIME IS THE LAST LEG — NOT A FIELD.

    Keeping a per-leg timestamp on every exit AND a separate "final exit time"
    asks the trader to hold two records in agreement by hand, and gives the form
    no way to decide which to believe when they drift. The last leg to close is
    the final exit, by definition, so it is derived and shown rather than asked
    for again.
  */
  const derivedExitAt = latestExitTimestamp(exitRows);

  const [plan, setPlan] = useState<PlanDraft>(
    filled
      ? {
          ...EMPTY_PLAN,
          strategy: 'Elliott Wave',
          setup: 'Wave 3 Continuation',
          targetProfit: '1000.00',
        }
      : EMPTY_PLAN,
  );
  const [feelings, setFeelings] = useState<FeelingsDraft>(
    filled ? { confidence: 75, emotions: ['calm', 'focused'] } : EMPTY_FEELINGS,
  );
  const [review, setReview] = useState<ReviewDraft>(
    filled
      ? {
          ...EMPTY_REVIEW,
          note: 'Wait for the candle close next time rather than anticipating it.',
          followedRules: 'met',
        }
      : EMPTY_REVIEW,
  );

  /*
    THE SIGN COMES FROM THE WORD THE TRADER CHOSE, and break-even is a real zero
    rather than a typed one. This is INPUT MEANING only: the engine still
    classifies the outcome from the resulting R against its own tolerance band,
    and a "profit" of a few cents can still classify as break-even.
  */
  const signedPnl = outcome === 'break_even' ? 0 : Number(pnl) * (outcome === 'loss' ? -1 : 1);
  const riskNumber = Number(risk);
  const hasResult =
    Number.isFinite(riskNumber) &&
    riskNumber > 0 &&
    Number.isFinite(signedPnl) &&
    (outcome === 'break_even' || pnl !== '');
  const actualR = hasResult ? signedPnl / riskNumber : null;

  const moneyText = hasResult ? `${signedPnl > 0 ? '+' : ''}${signedPnl.toFixed(2)} USD` : null;
  const tone = signedPnl > 0 ? 'positive' : signedPnl < 0 ? 'negative' : 'neutral';

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <FormShell
        situation="Fully closed"
        onChangeSituation={() => {
          window.location.href = '../log-trade';
        }}
        footer={
          <FormFooter
            action="Save closed trade"
            helper="You can add your plan, your review and the rule comparison later."
            sticky
          />
        }
      >
        <TaskSurface>
          <Band className="gap-3 py-3.5">
            <ContextLine account="Live · FTMO 100K" currency="USD" onChange={() => {}} />
          </Band>

          {/*
            GROUP ONE — THE TRADE. What was traded, which way, and when it ran.
            It comes first because a completed trade is a thing that happened,
            and a screen that opens on its P&L is a receipt rather than a journal
            entry.
          */}
          <Band>
            <h2 className="text-label text-muted-foreground uppercase">The trade</h2>
            <FieldPair>
              <TextField label="Symbol" value={symbol} onChange={setSymbol} placeholder="XAUUSD" />
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
              ONE TIMESTAMP GROUP, TWO COMPACT ROWS.

              They were a `FieldPair`, which on a phone is two full-height fields
              stacked, each with its own label and each carrying a placeholder
              that repeated its own label back — "Select entry date and time"
              under a label reading "Entry time". Roughly 150px of vertical space
              on the screen that most needs to give it back. One zone note above
              the pair, short placeholders, and both timestamps still explicit.

              BOTH START UNANSWERED. A historical trade silently dated today is a
              wrong record that looks like a right one, so neither picker selects
              anything until the trader does.
            */}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-subtle-foreground text-xs">Times in {PROTOTYPE_TIMEZONE}</p>
              <div className="grid min-w-0 gap-2 min-[560px]:grid-cols-2">
                <TimestampField
                  label="Entry time"
                  title="Entry date and time"
                  value={enteredAt}
                  onChange={setEnteredAt}
                  placeholder="Not set"
                />
                {multipleExits ? (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs font-medium">
                      Final exit time
                    </span>
                    <p className="text-foreground numeric flex h-11 min-w-0 items-center text-sm">
                      {formatTimestamp(derivedExitAt) ?? (
                        <span className="text-subtle-foreground">From your last exit</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <TimestampField
                    label="Final exit time"
                    title="Final exit date and time"
                    value={exitedAt}
                    onChange={setExitedAt}
                    placeholder="Not set"
                  />
                )}
              </div>
            </div>
          </Band>

          {/* GROUP TWO — RESULT. */}
          <Band divided={false} className="py-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h2 className="text-label text-muted-foreground uppercase">Result</h2>
              <BasisToggle value={basis} onChange={setBasis} />
            </div>

            {basis === 'money' ? (
              <>
                <div className="max-w-[16rem]">
                  <TextField
                    label="Risk at entry (USD)"
                    value={risk}
                    onChange={setRisk}
                    inputMode="decimal"
                    numeric
                  />
                </div>

                {/*
                  ONE MONETARY AUTHORITY.

                  The screen used to carry TWO large money figures: the editable
                  "Net P&L 400.00" and, directly beneath it, a `text-metric`
                  "Net profit +400.00 USD" restating the same number. Two focal
                  points for one fact, one of them a control and one of them a
                  readout, forty pixels apart. The editable amount is the only
                  large figure now; the outcome word above it supplies the sign
                  and the label ("Net profit" / "Net loss"), and R is one quiet
                  line underneath.

                  WHEN THE EXITS OWN THE RESULT the single-figure inputs go
                  entirely — a screenshot caught "Net P&L 400.00" sitting above an
                  exits editor totalling +80.00, two different results for one
                  trade with nothing to say which would be saved.
                */}
                {multipleExits ? null : <OutcomeChoice value={outcome} onChange={setOutcome} />}

                {multipleExits ? null : outcome === 'break_even' ? (
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs font-medium">Net P&L</p>
                    <p className="numeric text-foreground text-metric mt-0.5 font-semibold">
                      0.00 USD
                    </p>
                  </div>
                ) : (
                  <PrimaryAmountField
                    label={outcome === 'loss' ? 'Net loss' : 'Net profit'}
                    currency="USD"
                    value={pnl}
                    onChange={setPnl}
                    hint="After fees and other costs"
                  />
                )}

                {/* R IS SECONDARY AND ON ONE LINE. Money is the figure a beginner
                    can check; R is the one they are learning. */}
                {multipleExits || actualR === null ? null : (
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="text-muted-foreground text-xs font-medium">Result (R)</span>
                    <span
                      className={cn(
                        'numeric text-base font-semibold',
                        tone === 'positive'
                          ? 'text-positive'
                          : tone === 'negative'
                            ? 'text-negative'
                            : 'text-foreground',
                      )}
                    >
                      {actualR > 0 ? '+' : ''}
                      {actualR.toFixed(2)}R
                    </span>
                  </p>
                )}
              </>
            ) : (
              <>
                <FieldPair>
                  <TextField label="Entry price" value="" onChange={() => {}} numeric />
                  <TextField label="Stop loss at entry" value="" onChange={() => {}} numeric />
                  <TextField label="Exit price" value="" onChange={() => {}} numeric />
                  <TextField label="Position size" optional value="" onChange={() => {}} numeric />
                </FieldPair>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Prices calculate R. Money is not recorded in this mode.
                </p>
              </>
            )}

            <div className="flex min-w-0">
              <QuietAction
                expanded={multipleExits}
                onClick={() => setMultipleExits((current) => !current)}
              >
                {multipleExits ? 'This was one single exit' : 'It closed in more than one exit'}
              </QuietAction>
            </div>

            {multipleExits ? (
              <ExitsEditor
                variant="after-trade"
                rows={exitRows}
                onRowsChange={setExitRows}
                initialRisk={risk}
                currency="USD"
                initialActiveId={activeExit}
              />
            ) : null}
          </Band>
        </TaskSurface>

        <JournalPrompts
          prompts={[
            {
              id: 'plan',
              question: 'What was your plan?',
              summary: planSummary(plan, 'USD'),
              children: <PlanEditor tense="past" draft={plan} onChange={setPlan} currency="USD" />,
            },
            {
              id: 'feelings',
              question: 'How did you feel at entry?',
              summary: feelingsSummary(feelings),
              children: <FeelingsEditor draft={feelings} onChange={setFeelings} recalled />,
            },
            {
              id: 'review',
              question: 'What would you repeat or change next time?',
              summary: reviewSummary(review),
              children: (
                <ReviewEditor
                  draft={review}
                  onChange={setReview}
                  currency="USD"
                  actualMoney={moneyText ?? 'Not recorded'}
                  riskAtEntry={risk}
                />
              ),
            },
          ]}
        />
      </FormShell>
    </PrototypeShell>
  );
}
