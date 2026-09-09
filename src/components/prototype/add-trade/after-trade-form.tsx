'use client';

import { HeartPulse, Lightbulb, NotebookPen } from 'lucide-react';
import { useState } from 'react';

import {
  blockingIssues,
  canSave,
  derivedActualR,
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
}: {
  exits?: boolean;
  activeExit?: string | null;
  filled?: boolean;
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
  const [trade, setTrade] = useState<ClosedTradeDraft>(() => seedTrade({ exits, filled }));
  /*
    NOTHING IS WRONG WITH A FORM NOBODY HAS TOUCHED.

    Save is refused from the first render, because a trade with no symbol and no
    direction is not a record. But rendering "Enter the symbol you traded" beside
    an empty field the reader has not reached yet is the form telling somebody
    off for arriving, and on a phone it put two red lines in the docked bar of a
    screen where nothing had been typed. The refusal is visible in the disabled
    control; the reasons appear once there is something to have got wrong.
  */
  const [touched, setTouched] = useState(false);
  const patch = (next: Partial<ClosedTradeDraft>) => {
    setTouched(true);
    setTrade((current) => ({ ...current, ...next }));
  };

  const [exitsOpen, setExitsOpen] = useState(exits);
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

  /* Overlay-local working copies, so Cancel and Escape have something to
     discard — the same contract the Still open path established. */
  const idea = useJournalDraft(plan, setPlan);
  const emotion = useJournalDraft(feelings, setFeelings);
  const reflection = useJournalDraft(review, setReview);

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

  const timeError = issueFor(issues, 'exitedAt');
  const riskError = issueFor(issues, 'riskAtEntry');
  const targetError = issueFor(issues, 'targetProfit');
  const amountError = issueFor(issues, 'finalAmount') ?? issueFor(issues, 'outcome');

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
            disabled={!canSave(trade)}
            blockedBy={touched ? blocking.map((issue) => issue.message) : []}
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
            <FieldPair>
              <TextField
                label="Symbol"
                value={trade.symbol}
                onChange={(symbol) => patch({ symbol })}
                placeholder="e.g. XAUUSD"
              />
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

            <OutcomeChoice
              value={trade.outcome}
              onChange={(outcome) => patch({ outcome })}
              legend="How did the trade finish?"
            />

            {trade.outcome === null ? (
              <InlineNote>
                Leave this unanswered if you don’t know the final figure. It stays unrecorded rather
                than becoming zero.
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
              <PrimaryAmountField
                label={trade.outcome === 'loss' ? 'Final net loss' : 'Final net profit'}
                currency={CURRENCY}
                value={trade.finalAmount}
                onChange={(finalAmount) => patch({ finalAmount })}
                hint="For the whole trade, after fees and other costs."
              />
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
              <QuietAction expanded={exitsOpen} onClick={() => setExitsOpen((open) => !open)}>
                {exitsOpen ? 'Hide exit details' : 'Add exit details'}
              </QuietAction>
              {exitsOpen ? null : <InlineNote>If you closed in parts.</InlineNote>}
            </div>

            {exitsOpen ? (
              <ExitsEditor
                rows={trade.exits}
                onRowsChange={(nextExits) => patch({ exits: nextExits })}
                riskAtEntry={trade.riskAtEntry}
                currency={CURRENCY}
                declaredClosed
                history={trade.exitHistory}
                onHistoryChange={(exitHistory) => patch({ exitHistory })}
                supporting={{ total: finalPnl, reconciliation: reconciliation(trade) }}
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
function seedTrade({ exits, filled }: { exits: boolean; filled: boolean }): ClosedTradeDraft {
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
