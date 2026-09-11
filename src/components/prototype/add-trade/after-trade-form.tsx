'use client';

import { HeartPulse, Lightbulb, NotebookPen, Scale } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import {
  adoptExitSubtotal,
  applyExitHistory,
  applyExits,
  beginManualEdit,
  blockingIssues,
  canAdoptExitSubtotal,
  canSave,
  derivedActualR,
  derivedOutcome,
  derivedTargetR,
  EMPTY_CLOSED_TRADE,
  finalExitTimeFromExits,
  finalNetPnl,
  issueFor,
  reconciliation,
  validateClosedTrade,
  type ClosedTradeDraft,
} from '../closed-trade';
import { money, type ExitRecord } from '../exit-model';
import { PROTOTYPE_TIMEZONE } from '../fixtures';
import { PrototypeShell } from '../prototype-shell';
import {
  confirmAssessment,
  EMPTY_SYSTEM_ASSESSMENT,
  needsReview,
  systemAssessmentSummary,
  type AssessmentContext,
  type SystemAssessmentDraft,
} from '../system-assessment';
import { EMPTY_EXIT_PLAN, ExitPlanRow, type ExitPlanDraft } from './exit-plan';
import { DEFAULT_EXIT_ROWS, ExitsEditor } from './exits-editor';
import {
  Band,
  ChoiceGroup,
  ContextLine,
  Field,
  FieldPair,
  FormFooter,
  FormShell,
  InlineNote,
  OutcomeChoice,
  PrimaryAmountField,
  QuietAction,
  ResultLine,
  TaskSurface,
  TextField,
} from './form-primitives';
import { JournalAtEntry, LauncherSurface, useJournalDraft } from './journal-at-entry';
import {
  EMPTY_FEELINGS,
  EMPTY_PLAN,
  EMPTY_REVIEW,
  FeelingsEditor,
  feelingsSummary,
  ReflectionEditor,
  reflectionSummary,
  tradeIdeaSummary,
  type FeelingsDraft,
  type PlanDraft,
  type ReviewDraft,
} from './journal-editors';
import { SystemAssessmentEditor } from './system-assessment-editor';
import { formatTimestamp, TimestampField } from './timestamp-picker';
import { TradeIdeaOverlay } from './trade-idea-overlay';

const CURRENCY = 'USD';

/**
 * FULLY CLOSED — a finished trade, written up from memory.
 *
 * WHAT THIS PASS CORRECTED, AND IT IS NOT A LAYOUT PROBLEM.
 *
 * The previous version opened with a symbol, a direction, a 200.00 risk and a
 * 400.00 profit already in the fields. Every one of those was a fact about a
 * trade nobody had described yet. A historical form's hardest requirement is
 * that it hold "I do not remember" without turning it into a number, and a form
 * that starts pre-filled has already failed it before the trader types anything.
 * Everything starts unrecorded now, and unrecorded stays unrecorded through
 * derivation, validation and Save.
 *
 * THE SECOND AND WORSE ONE: "It closed in more than one exit" REMOVED the
 * whole-trade result and made the reconstructed legs the trade's money. So a
 * trader who knew their trade made 15 and could recall one 10 leg ended up with
 * a 10 trade. The authoritative figure is the FINAL WHOLE-TRADE NET P&L — the
 * number on the broker statement, the one a person actually knows — and exit
 * detail is now a disclosure UNDER it that never replaces it, never adds to it,
 * and never claims to be complete on its own. See `closed-trade.ts`.
 *
 * READING ORDER, NOT EQUAL WEIGHT. The trade, the plan at entry, the actual
 * result, the journal, the review, save. One column. The result carries the
 * emphasis because it is the one figure this screen exists to capture; the plan
 * baseline is the same two controls the Still open path uses, at a smaller size,
 * so the page has a subject rather than three competing headlines.
 *
 * NOTHING IS RECONSTRUCTED FROM ANYTHING ELSE. The plan is not inferred from the
 * result, the strategy's current exit plan is not stamped onto a trade that
 * closed under an older one, the final exit time is not taken from whichever leg
 * happens to be latest, and the exit history is never called complete because
 * the arithmetic happens to work out.
 */
export function AfterTradeForm({
  /** Opens the exit-details disclosure with recorded legs, for the review states. */
  exits = false,
  /** Which leg opens as the active editor, for the active-editor review state. */
  activeExit = null,
  /** A part-finished draft, for the review state that shows populated summaries. */
  filled = false,
  /** A complete, fully priced reconstruction with no stated result — the Pass 2 flow. */
  reconstruct = false,
  /**
   * THE SEAM A REAL SAVE WOULD USE.
   *
   * The prototype persists nothing, but "was this record accepted?" is a
   * question about the FORM rather than about storage, and it needs an
   * observable answer or nothing can check that a minimal historical trade
   * actually gets through. It is called with the record exactly as the model
   * holds it — unknowns still unknown — and only when nothing blocks.
   */
  onSave = () => {},
}: {
  exits?: boolean;
  activeExit?: string | null;
  filled?: boolean;
  reconstruct?: boolean;
  onSave?: (trade: ClosedTradeDraft) => void;
}) {
  /*
    ONE DRAFT, AND THE MODEL OWNS ITS MEANING.

    The screen used to keep eight independent `useState` values and re-derive the
    result inline from whichever of them happened to be in scope. Holding the
    record in the shape `closed-trade.ts` defines means every figure on the page
    — the result, both R values, the reconciliation, what may be saved — is a
    function of the same record the save would carry, so the screen cannot show
    one thing and store another.
  */
  const [trade, setTrade] = useState<ClosedTradeDraft>(() =>
    seedTrade({ exits, filled, reconstruct }),
  );
  const patch = (next: Partial<ClosedTradeDraft>) =>
    setTrade((current) => ({ ...current, ...next }));

  /*
    NOTHING IS WRONG WITH A FORM NOBODY HAS TOUCHED — AND THE ATTEMPT IS WHAT
    ASKS.

    Two versions of this were wrong before this one. The first printed "Enter the
    symbol you traded" and "Choose Long or Short" on arrival, which is a form
    telling somebody off for opening it — and on a phone that was two red lines
    in the docked bar of a screen where nothing had been typed. The second
    revealed them on the first keystroke anywhere, so typing a symbol produced a
    complaint about direction before the reader had reached it.

    Pressing Save is the only unambiguous statement that the trader considers the
    record finished, so it is the only thing that asks the required questions. A
    missing symbol is not a mistake until somebody tries to save without one.
  */
  const [attempted, setAttempted] = useState(false);

  const [exitsOpen, setExitsOpen] = useState(exits || reconstruct);
  const [exitEditorActive, setExitEditorActive] = useState(activeExit !== null);
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
  const [review, setReview] = useState<ReviewDraft>(
    filled
      ? {
          ...EMPTY_REVIEW,
          note: 'Wait for the candle close next time rather than anticipating it.',
        }
      : EMPTY_REVIEW,
  );

  /*
    THE SYSTEM ASSESSMENT AND ITS DEPENDENCIES.

    The context is the PLAN ONLY — strategy, setup, the adopted exit plan and the
    two planned figures. The actual result is deliberately not in it and cannot
    reach the assessment, which is what makes "never inferred from the actual
    result" a property of the wiring rather than a rule somebody has to remember.

    `planProvenance` is DERIVED rather than asked. This whole path records a
    finished trade, so any plan on it was written down afterwards — that is
    `reconstructed_later` by construction, and `unknown` when no plan exists at
    all. A questionnaire asking the trader to confirm what the form already knows
    would be three seconds spent to learn nothing.
  */
  const [system, setSystem] = useState<SystemAssessmentDraft>(EMPTY_SYSTEM_ASSESSMENT);
  const assessmentContext: AssessmentContext = {
    strategy: plan.strategy,
    setup: plan.setup,
    exitPlan,
    riskAtEntry: trade.riskAtEntry,
    targetProfit: trade.noFixedTarget ? '' : trade.targetProfit,
  };
  const assessmentNeedsReview = needsReview(system, assessmentContext);

  /* Overlay-local working copies, so Cancel and Escape have something to
     discard — the same contract the Still open path established. */
  const idea = useJournalDraft(plan, setPlan);
  const emotion = useJournalDraft(feelings, setFeelings);
  const reflection = useJournalDraft(review, setReview);
  const assessment = useJournalDraft(system, (next) =>
    /*
      DONE CAPTURES WHAT THE ASSESSMENT RESTED ON, at the moment it is committed
      — so a later edit to the strategy or the exit plan can be detected as a
      change rather than silently redefining what was already concluded.
    */
    /*
      DONE IS A CONFIRMATION. It freezes the result and the facts it rested on,
      so a later plan edit is detectable as a change rather than silently
      recomputing what the trader concluded.

      PROVENANCE IS NOT SET HERE, and that is the correction. This form used to
      write `reconstructed_later` whenever a plan existed, reasoning from the
      recording route — but when the record was TYPED says nothing about when the
      PLAN was made, and notes written before entry and entered afterwards are
      `at_entry`. The prototype holds no evidence either way: the plan library
      has no creation times and there is no strategy versioning here. So it stays
      whatever the trader stated, and `unknown` when they have not.
    */
    setSystem(confirmAssessment(next, assessmentContext)),
  );

  /*
    EVERY FIGURE BELOW IS DERIVED FROM `trade`. None is stored, none is editable
    on its own, and none can disagree with the money and risk it comes from.
  */
  const finalPnl = finalNetPnl(trade);
  const actualRValue = derivedActualR(trade);
  const targetRValue = derivedTargetR(trade);
  const riskValue = money(trade.riskAtEntry);
  const issues = validateClosedTrade(trade);
  const blocking = blockingIssues(trade);
  const suggestedExitTime = finalExitTimeFromExits(trade.exits);

  /*
    TWO KINDS OF MESSAGE, ON TWO DIFFERENT CLOCKS.

    A WRONG VALUE speaks at once: a risk of `0` or a signed amount is something
    the trader has just typed, and waiting until Save to mention it would let
    them keep building on it. A MISSING REQUIRED FIELD waits for the attempt,
    because until then it is not missing — it is simply not filled in yet, which
    on this form is the ordinary state of nearly everything.
  */
  /*
    THE RESULT'S OWN PROVENANCE DECIDES WHAT THE SECTION SHOWS. An adopted figure
    is a readout with a way back to typing; a stated one is the ordinary
    outcome-plus-amount pair.
  */
  const adoptedResult = trade.finalSource === 'exit_history';
  const adoptedOutcome = derivedOutcome(trade);
  const adoptedLabel =
    adoptedOutcome === 'profit'
      ? 'Final net profit'
      : adoptedOutcome === 'loss'
        ? 'Final net loss'
        : adoptedOutcome === 'break_even'
          ? 'Final net P&L'
          : null;

  const timeError = issueFor(issues, 'exitedAt');
  const exitTimeNote = issueFor(issues, 'exitTime');
  const riskError = issueFor(issues, 'riskAtEntry');
  const targetError = issueFor(issues, 'targetProfit');
  const amountError = issueFor(issues, 'finalAmount') ?? issueFor(issues, 'outcome');
  const symbolError = attempted ? issueFor(issues, 'symbol') : null;
  const directionError = attempted ? issueFor(issues, 'direction') : null;

  const tone =
    finalPnl === null
      ? 'neutral'
      : finalPnl > 0
        ? 'positive'
        : finalPnl < 0
          ? 'negative'
          : 'neutral';

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
            helper="Save what you remember. Anything left blank stays blank — you can fill it in later."
            sticky
            suppressWhileMobileSubtaskActive={exitEditorActive}
            onAction={() => {
              setAttempted(true);
              if (!canSave(trade)) return;
              onSave(trade);
            }}
            blockedBy={attempted ? blocking.map((issue) => issue.message) : []}
          />
        }
      >
        <TaskSurface>
          <Band className="gap-3 py-3.5">
            <ContextLine account="Live · FTMO 100K" currency={CURRENCY} onChange={() => {}} />
          </Band>

          {/*
            ONE — THE TRADE. What was traded, which way, and when it ran. It
            comes first because a completed trade is a thing that happened, and a
            screen that opens on its P&L is a receipt rather than a journal entry.
          */}
          <Band>
            <h2 className="text-label text-muted-foreground uppercase">The trade</h2>
            {/*
              THE REQUIRED PAIR STATES ITS OWN PROBLEM, WHERE THE PROBLEM IS.

              The footer summarises; these two are what the trader has to act on,
              and on a long form the footer can be a screen away from the field
              it is talking about. Both appear only after an attempted save.
            */}
            <FieldPair>
              <div className="flex min-w-0 flex-col gap-1.5">
                <TextField
                  label="Symbol"
                  value={trade.symbol}
                  onChange={(symbol) => patch({ symbol })}
                  placeholder="e.g. XAUUSD"
                />
                {symbolError === null ? null : (
                  <InlineNote tone="error">{symbolError.message}</InlineNote>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Field label="Direction">
                  {() => (
                    <ChoiceGroup
                      legend="Direction"
                      value={trade.direction}
                      onChange={(direction) => patch({ direction })}
                      options={[
                        { value: 'long', label: 'Long' },
                        { value: 'short', label: 'Short' },
                      ]}
                    />
                  )}
                </Field>
                {directionError === null ? null : (
                  <InlineNote tone="error">{directionError.message}</InlineNote>
                )}
              </div>
            </FieldPair>

            {/*
              BOTH TIMESTAMPS BEGIN UNRECORDED, AND THAT IS THE WHOLE POINT.

              A historical trade silently dated today is a wrong record that
              looks like a right one: nothing downstream can tell a genuine
              timestamp from a default the trader accepted because it was already
              there. "Not set" is a state the analytics can exclude; today's date
              is a state they cannot.

              Side by side where there is room, stacked where there is not — one
              zone note above the pair rather than a timezone on each.
            */}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-subtle-foreground text-xs">Times in {PROTOTYPE_TIMEZONE}</p>
              <div className="grid min-w-0 gap-2 min-[560px]:grid-cols-2">
                <TimestampField
                  label="Entry time"
                  title="Entry date and time"
                  value={trade.enteredAt}
                  onChange={(enteredAt) => patch({ enteredAt })}
                  placeholder="Not set"
                />
                <TimestampField
                  label="Final exit time"
                  title="Final exit date and time"
                  value={trade.exitedAt}
                  onChange={(exitedAt) => patch({ exitedAt })}
                  placeholder="Not set"
                />
              </div>

              {/*
                A LEG'S TIME MAY STAND FOR THE TRADE'S ONLY IF THAT LEG CLOSED IT.

                The previous version REPLACED this field with a read-only line
                derived from the latest recorded exit — whatever that exit was.
                On a partly reconstructed history the latest recorded leg is
                routinely a partial one, so the trade acquired a final exit time
                that was really a mid-trade timestamp, and the trader had no
                field left to correct it in.

                An `All remaining` leg is the one exit that says nothing was left
                afterwards. Its time is offered, once, as something to accept.
              */}
              {suggestedExitTime === null ||
              (trade.exitedAt !== null &&
                trade.exitedAt.date === suggestedExitTime.date &&
                trade.exitedAt.time === suggestedExitTime.time) ? null : (
                <QuietAction onClick={() => patch({ exitedAt: suggestedExitTime })}>
                  Use {formatTimestamp(suggestedExitTime)} — your exit that closed the position
                </QuietAction>
              )}

              {timeError === null ? null : (
                <InlineNote tone="error">{timeError.message}</InlineNote>
              )}

              {/*
                TWO CLOSING TIMES, AND NEITHER IS OVERWRITTEN. Stated beside the
                fields it concerns, with no suggestion of which is right — the
                record has no grounds to prefer either, and it costs no money, so
                it does not refuse the save.
              */}
              {exitTimeNote === null ? null : (
                <InlineNote tone="warning">{exitTimeNote.message}</InlineNote>
              )}
            </div>
          </Band>

          {/*
            TWO — PLAN AT ENTRY. The same baseline the Still open path collects,
            in the same three terms and through the same controls, at a smaller
            size so it does not compete with the result below it.

            A HISTORICAL PLAN IS RECONSTRUCTED, NOT ASSUMED. Nothing here is
            seeded, nothing is inferred from the result, and the trade's exit plan
            does not inherit the strategy's CURRENT default — a trade managed
            last month under an older rule must not be stamped with this month's
            and then judged against it.
          */}
          <Band>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-label text-muted-foreground uppercase">Plan at entry</h2>
              <InlineNote>
                Record what applied when you entered; leave anything you don’t remember blank.
              </InlineNote>
            </div>

            <FieldPair>
              <PrimaryAmountField
                size="compact"
                label="Risk at entry"
                currency={CURRENCY}
                value={trade.riskAtEntry}
                onChange={(riskAtEntry) => patch({ riskAtEntry })}
                hint="What the whole position stood to lose if your protective exit was hit."
              />
              {/*
                THREE STATES, NOT TWO — the same control, and the same rule, as
                Still open. A blank target means "not answered"; No fixed target
                is a complete answer about the plan. The typed value is kept so
                the choice is reversible, and is excluded from Target R while the
                declaration stands.
              */}
              <PrimaryAmountField
                size="compact"
                label="Target profit"
                currency={CURRENCY}
                value={trade.targetProfit}
                onChange={(targetProfit) => patch({ targetProfit })}
                {...(trade.noFixedTarget
                  ? {
                      readOut: 'No fixed target',
                      readOutAction: (
                        <QuietAction onClick={() => patch({ noFixedTarget: false })}>
                          Change
                          <span className="sr-only"> target</span>
                        </QuietAction>
                      ),
                    }
                  : {
                      trailing: (
                        <QuietAction onClick={() => patch({ noFixedTarget: true })}>
                          No fixed target
                        </QuietAction>
                      ),
                    })}
              />
            </FieldPair>

            {riskError === null ? null : <InlineNote tone="error">{riskError.message}</InlineNote>}
            {targetError === null ? null : (
              <InlineNote tone="error">{targetError.message}</InlineNote>
            )}

            {/*
              ONE DERIVED LINE, AND ONLY WHEN BOTH HALVES EXIST. Target profit
              over risk at entry. Absent while either is unrecorded and absent
              when there is no fixed target — never `0.00R`, which would state a
              plan that pays nothing.
            */}
            {targetRValue === null ? null : (
              <div className="border-border/70 min-w-0 border-t pt-3">
                <ResultLine
                  label="Target R"
                  value={`+${targetRValue.toFixed(2)}R`}
                  {...(riskValue === null
                    ? {}
                    : { detail: `1R = ${riskValue.toFixed(2)} ${CURRENCY}` })}
                />
              </div>
            )}

            <ExitPlanRow
              draft={exitPlan}
              onChange={setExitPlan}
              strategyName={plan.strategy}
              inheritStrategyDefault={false}
            />
          </Band>

          {/*
            THREE — ACTUAL RESULT. The strongest figure on the page, and the one
            authority on what this trade made.
          */}
          <Band divided={false} className="py-4">
            <h2 className="text-label text-muted-foreground uppercase">Actual result</h2>

            {/*
              WHEN THE RECONSTRUCTION IS THE SOURCE, THERE IS NOTHING TO CHOOSE.

              An outcome selector beside an adopted figure would let a trader mark
              `Profit` over an adopted −80.00, and the record would carry both.
              The word FOLLOWS the money here, the amount is a readout of the
              subtotal it comes from, and the way back to typing is one action
              that changes the source at the same instant — see `beginManualEdit`.
            */}
            {adoptedResult ? (
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-muted-foreground text-xs font-medium">
                    {adoptedLabel ?? 'Final net P&L'}
                  </p>
                  <QuietAction onClick={() => setTrade(beginManualEdit(trade))}>
                    Edit final result
                  </QuietAction>
                </div>
                <p
                  className={cn(
                    'numeric text-metric font-semibold',
                    tone === 'positive'
                      ? 'text-positive'
                      : tone === 'negative'
                        ? 'text-negative'
                        : 'text-foreground',
                  )}
                >
                  {finalPnl === null
                    ? '—'
                    : `${finalPnl > 0 ? '+' : ''}${finalPnl.toFixed(2)} ${CURRENCY}`}
                </p>
                {/* Provenance, stated plainly. A figure that came from a
                    reconstruction must never look like one read off a statement. */}
                <InlineNote>From your recorded exits, which you marked complete.</InlineNote>
              </div>
            ) : (
              <>
                <OutcomeChoice
                  value={trade.outcome}
                  onChange={(outcome) => patch({ outcome })}
                  legend="How did the trade finish?"
                />

                {trade.outcome === null ? (
                  <InlineNote>
                    Leave this unanswered if you don’t know the final figure. It stays unrecorded
                    rather than becoming zero.
                  </InlineNote>
                ) : trade.outcome === 'break_even' ? (
                  /* Break-even is a KNOWN zero, stated as one. It is the only route
                     to a zero on this screen; a blank amount is not one. */
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs font-medium">Final net P&amp;L</p>
                    <p className="numeric text-foreground text-metric mt-0.5 font-semibold">
                      0.00 {CURRENCY}
                    </p>
                  </div>
                ) : (
                  <div data-final-amount className="min-w-0">
                    <PrimaryAmountField
                      label={trade.outcome === 'loss' ? 'Final net loss' : 'Final net profit'}
                      currency={CURRENCY}
                      value={trade.finalAmount}
                      onChange={(finalAmount) => patch({ finalAmount })}
                      hint="For the whole trade, after fees and other costs."
                    />
                  </div>
                )}
              </>
            )}

            {amountError === null ? null : (
              <InlineNote tone="error">{amountError.message}</InlineNote>
            )}

            {/*
              ACTUAL R IS DERIVED FROM THAT FIGURE AND THE RISK ABOVE IT, on every
              render. Editing the risk moves it; an unrecorded risk removes it.
              UNAVAILABLE IS SILENCE OR A SENTENCE, NEVER `0.00R`.
            */}
            {actualRValue === null ? (
              finalPnl === null || riskValue !== null ? null : (
                <InlineNote>Actual R needs your risk at entry.</InlineNote>
              )
            ) : (
              <ResultLine
                label="Actual R"
                value={`${actualRValue > 0 ? '+' : ''}${actualRValue.toFixed(2)}R`}
                tone={tone}
              />
            )}

            {/*
              FOUR — EXIT DETAIL, AS A DISCLOSURE UNDER THE RESULT.

              Not a second recording mode and not a replacement for the figure
              above. A trader who closed in parts can describe how; the total they
              already stated remains the trade's result whatever those parts add
              up to, and no empty leg stands open until they ask for one.
            */}
            <div className="flex min-w-0 flex-col gap-1">
              <QuietAction
                expanded={exitsOpen}
                onClick={() => {
                  setExitsOpen((open) => !open);
                  if (exitsOpen) setExitEditorActive(false);
                }}
              >
                {exitsOpen ? 'Hide exit details' : 'Add exit details'}
              </QuietAction>
              {exitsOpen ? null : <InlineNote>If you closed in parts.</InlineNote>}
            </div>

            {exitsOpen ? (
              <ExitsEditor
                rows={trade.exits}
                /*
                  EVERY EXIT EDIT GOES THROUGH THE MODEL'S TRANSITION, not
                  straight into state. While the reconstruction is the source, an
                  edit that destroys its basis — a blanked leg, the last leg
                  removed — has to keep the money the trader accepted and correct
                  its provenance, and that decision belongs in one tested place
                  rather than in an `onChange`.
                */
                onRowsChange={(nextExits) => setTrade(applyExits(trade, nextExits))}
                riskAtEntry={trade.riskAtEntry}
                currency={CURRENCY}
                declaredClosed
                history={trade.exitHistory}
                onHistoryChange={(exitHistory) => setTrade(applyExitHistory(trade, exitHistory))}
                supporting={{
                  total: finalPnl,
                  reconciliation: reconciliation(trade),
                  sourced: trade.finalSource === 'exit_history',
                  ...(canAdoptExitSubtotal(trade)
                    ? { onAdopt: () => setTrade(adoptExitSubtotal(trade)) }
                    : {}),
                  onEditFinalResult: () => {
                    /*
                      THE ACTION GOES TO THE EXISTING EDITOR RATHER THAN OPENING A
                      NEW ONE. On a long form the field under discussion is
                      usually off-screen, and a dialog to fix a number that
                      already has a field is one modal too many.
                    */
                    const input = document.querySelector<HTMLInputElement>(
                      '[data-final-amount] input',
                    );
                    input?.scrollIntoView({ block: 'center' });
                    input?.focus();
                  },
                }}
                onEditingChange={setExitEditorActive}
                {...(activeExit === null ? {} : { initialActiveId: activeExit })}
              />
            ) : null}
          </Band>
        </TaskSurface>

        {/*
          FIVE — JOURNAL AT ENTRY. The same surface, the same two areas and the
          same editors as Still open. "At entry" names the moment being
          REMEMBERED, not the moment of typing, which is exactly why a historical
          trade belongs in it.
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
                  reasonPrompt="Why did you take this trade?"
                />
              ),
            },
            {
              id: 'feelings',
              label: 'Feelings at entry',
              Icon: HeartPulse,
              invitation: 'How did you feel?',
              title: 'How did you feel at entry?',
              description:
                'Describe how you felt when you entered, rather than how the outcome feels now.',
              preview: feelingsSummary(feelings),
              onDone: emotion.done,
              onCancel: emotion.cancel,
              children: (
                <FeelingsEditor draft={emotion.draft} onChange={emotion.setDraft} recalled />
              ),
            },
          ]}
        />

        {/*
          SIX — REVIEW. Its own surface, because what the trader thought at entry
          and what they concluded afterwards are different kinds of truth, learned
          at different moments.

          IT HOLDS ONE LAUNCHER IN THIS PASS. System assessment — what following
          the rules would have produced — becomes a SECOND launcher beside this
          one, which is why Review is a surface now rather than a single row:
          adding it later moves nothing, and completing either will never be read
          as completing the other.
        */}
        <LauncherSurface
          heading="Review"
          aside="Now or later"
          areas={[
            {
              id: 'reflection',
              label: 'Reflection',
              Icon: NotebookPen,
              invitation: 'What would you repeat or change next time?',
              title: 'Reflection',
              description: 'What this trade taught you, in your own words.',
              preview: reflectionSummary(review),
              onDone: reflection.done,
              onCancel: reflection.cancel,
              children: (
                <ReflectionEditor draft={reflection.draft} onChange={reflection.setDraft} />
              ),
            },
            {
              id: 'system',
              label: 'System assessment',
              Icon: Scale,
              invitation: 'What would following your rules have produced?',
              title: 'System assessment',
              description:
                'What the rules that applied to this trade would have produced — separately from what you did.',
              /*
                THE STALE MARK RIDES ON THE PREVIEW, not on a badge. The launcher
                pattern's rule is that the preview IS the status; a second
                indicator would be the one place in this surface where an area
                announces an obligation.

                IT GOES FIRST, AND THAT IS NOT A STYLE CHOICE. The launcher
                renders at most TWO preview lines. Appended last, the mark was
                the third line of a fully answered assessment — so it rendered
                for a half-answered one and vanished for a complete one, which is
                exactly backwards: the more the trader had entered, the less
                likely they were to be told it no longer applied. Found by
                driving the state in a browser; the DOM test that "covered" it
                had only ever produced a one-line summary.
              */
              preview: assessmentNeedsReview
                ? ['Needs review', ...systemAssessmentSummary(system, assessmentContext)]
                : systemAssessmentSummary(system, assessmentContext),
              onDone: assessment.done,
              onCancel: assessment.cancel,
              children: (
                <SystemAssessmentEditor
                  draft={assessment.draft}
                  onChange={assessment.setDraft}
                  context={assessmentContext}
                  currency={CURRENCY}
                  stale={assessmentNeedsReview}
                  onConfirm={() =>
                    assessment.setDraft(confirmAssessment(assessment.draft, assessmentContext))
                  }
                />
              ),
            },
          ]}
        />
      </FormShell>
    </PrototypeShell>
  );
}

/**
 * THE REVIEW STATES, AND THE ONE THAT IS NOT A REVIEW STATE.
 *
 * `EMPTY_CLOSED_TRADE` is what a trader actually opens: nothing filled, no
 * timestamp, no outcome selected. The seeds exist so a reviewer can see a
 * populated screen without typing one, and every one of them is reachable only
 * by an explicit URL — no default path renders a pre-filled trade.
 */
function seedTrade({
  exits,
  filled,
  reconstruct,
}: {
  exits: boolean;
  filled: boolean;
  reconstruct: boolean;
}): ClosedTradeDraft {
  /*
    THE STATE PASS 2 EXISTS FOR: a trader who never knew the whole-trade figure,
    reconstructed the legs instead, and has said that is all of them. The result
    is still UNKNOWN here — the offer to adopt it is one activation away, and
    arriving in this state must never look like arriving with an answer.
  */
  if (reconstruct) {
    return {
      ...EMPTY_CLOSED_TRADE,
      symbol: 'XAUUSD',
      direction: 'long',
      enteredAt: { date: '2026-09-01', time: '09:41' },
      riskAtEntry: '200.00',
      exitHistory: 'complete',
      exits: [
        {
          id: 'e1',
          scope: 'part',
          percent: '40',
          outcome: 'profit',
          amount: '100.00',
          at: { date: '2026-09-01', time: '12:02' },
        },
        {
          id: 'e2',
          scope: 'all_remaining',
          percent: '',
          outcome: 'profit',
          amount: '300.00',
          at: { date: '2026-09-01', time: '14:15' },
        },
      ],
    };
  }

  const seededExits: readonly ExitRecord[] = exits ? DEFAULT_EXIT_ROWS : [];
  if (!filled) return { ...EMPTY_CLOSED_TRADE, exits: seededExits };

  return {
    ...EMPTY_CLOSED_TRADE,
    symbol: 'XAUUSD',
    direction: 'long',
    enteredAt: { date: '2026-09-01', time: '09:41' },
    exitedAt: { date: '2026-09-01', time: '14:32' },
    riskAtEntry: '200.00',
    targetProfit: '1000.00',
    outcome: 'profit',
    finalAmount: '400.00',
    exits: seededExits,
  };
}
