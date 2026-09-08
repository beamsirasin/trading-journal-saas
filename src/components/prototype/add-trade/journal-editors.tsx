'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import { PROTOTYPE_STRATEGIES } from '../fixtures';
import { CONFIDENCE_LABEL } from '../presentation';
import { ConfidenceControl } from './confidence-control';
import { emotionLabel, EmotionsControl } from './emotions-control';
import { Field, FieldPair, TextField } from './form-primitives';
import { ContextualAction, NestedEditor } from './journal-prompts';

/**
 * THE THREE JOURNALING EDITORS, BEHIND THE THREE HUMAN QUESTIONS.
 *
 * These hold everything the product used to present as a category list —
 * strategy, setup, entry checklist, planned levels, confidence, emotions, the
 * review note, the rule-following observations and the rule-based comparison.
 * None of that was removed. What changed is that a trader reaches it by
 * answering "What was your plan?" rather than by opening a drawer labelled
 * "Context" and inferring what belongs in it.
 *
 * NO EDITOR OPENS ON TAXONOMY. Each begins with the sentence a person would
 * write anyway — why they took the trade, how they felt, what they would do
 * differently — and the structured fields follow as optional refinements of it.
 * A trade can carry a real, useful journal entry without a strategy ever being
 * selected.
 */

export interface PlanDraft {
  readonly reason: string;
  readonly strategy: string | null;
  readonly setup: string | null;
  readonly checklist: Readonly<Record<string, ChecklistState>>;
  readonly plannedRisk: string;
  readonly plannedTarget: string;
  readonly note: string;
  readonly chartUrl: string;
}

export type ChecklistState = 'met' | 'not_met' | 'not_answered';

export const EMPTY_PLAN: PlanDraft = {
  reason: '',
  strategy: null,
  setup: null,
  checklist: {},
  plannedRisk: '',
  plannedTarget: '',
  note: '',
  chartUrl: '',
};

export interface FeelingsDraft {
  readonly confidence: number | null;
  readonly emotions: readonly string[] | null;
}

export const EMPTY_FEELINGS: FeelingsDraft = { confidence: null, emotions: null };

export interface ReviewDraft {
  readonly note: string;
  readonly followedRules: ChecklistState;
  /** What following the rules would have produced, in money. Never inferred. */
  readonly rulesMoney: string;
  readonly rulesOutcome: string;
}

export const EMPTY_REVIEW: ReviewDraft = {
  note: '',
  followedRules: 'not_answered',
  rulesMoney: '',
  rulesOutcome: 'unrecorded',
};

/**
 * A prompt row's summary — ONLY what has actually been answered.
 *
 * Never "Strategy: not assigned", never an empty classification, never a count
 * of what is missing. A row with nothing under it is a question nobody has
 * answered yet, which is a perfectly good state for a saved trade to be in.
 */
export function planSummary(draft: PlanDraft, currency: string): readonly string[] {
  const lines: string[] = [];

  const classification = [draft.strategy, draft.setup].filter(
    (part): part is string => part !== null,
  );
  if (classification.length > 0) lines.push(classification.join(' · '));

  const levels = [
    draft.plannedRisk === '' ? null : `Planned risk ${draft.plannedRisk} ${currency}`,
    draft.plannedTarget === '' ? null : `Target ${draft.plannedTarget} ${currency}`,
  ].filter((part): part is string => part !== null);
  if (levels.length > 0) lines.push(levels.join(' · '));

  // The reason stands in only when there is no structure to show, so a row never
  // repeats the same thought in two forms.
  if (lines.length === 0 && draft.reason.trim() !== '') lines.push(excerpt(draft.reason));

  return lines;
}

export function feelingsSummary(draft: FeelingsDraft): readonly string[] {
  const parts = [
    draft.confidence === null
      ? null
      : `${CONFIDENCE_LABEL[draft.confidence] ?? ''} confidence`.trim(),
    draft.emotions === null
      ? null
      : draft.emotions.length === 0
        ? 'None of these'
        : draft.emotions.map(emotionLabel).join(', '),
  ].filter((part): part is string => part !== null && part !== '');

  return parts.length === 0 ? [] : [parts.join(' · ')];
}

export function reviewSummary(draft: ReviewDraft): readonly string[] {
  const lines: string[] = [];
  if (draft.note.trim() !== '') lines.push(`“${excerpt(draft.note)}”`);
  if (draft.followedRules !== 'not_answered') {
    lines.push(draft.followedRules === 'met' ? 'Followed your rules' : 'Did not follow your rules');
  }
  if (draft.rulesOutcome !== 'unrecorded') lines.push('Rule-based comparison added');
  return lines;
}

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 64 ? trimmed : `${trimmed.slice(0, 63)}…`;
}

/** The entry checklist a chosen setup brings with it. Fixture data, not a schema. */
const ENTRY_CHECKLIST: Readonly<Record<string, readonly string[]>> = {
  'Wave 3 Continuation': [
    'Wave 2 held above the 0.618 retracement',
    'Momentum expanded on the break of wave 1',
    'Higher timeframe trend agreed',
  ],
  'Failed breakout of the Asian range': [
    'Range high swept before the London open',
    'Price reclaimed the range within two candles',
  ],
};

const CHECKLIST_OPTIONS: readonly { value: ChecklistState; label: string }[] = [
  { value: 'met', label: 'Yes' },
  { value: 'not_met', label: 'No' },
  { value: 'not_answered', label: 'Not answered' },
];

/**
 * WHAT IS / WAS YOUR PLAN.
 *
 * IT OPENS ON A SENTENCE, NOT A DROPDOWN. "Why did you take this trade?" is
 * answerable by anyone; "Strategy" is answerable only by someone who has already
 * created one. Opening on the taxonomy is what made the previous version feel
 * like a database form, and it is also what made the plan feel mandatory — a
 * dropdown at the top of an editor reads as the thing you are there to set.
 *
 * STRATEGY AND SETUP ARE OPTIONAL AND EXPLAINED IN SIX WORDS EACH. "The trading
 * method you used" and "The pattern or signal you traded" are what let a
 * beginner tell them apart, which no amount of label tuning does on its own.
 *
 * THE ENTRY CHECKLIST NEVER OPENS BY ITSELF, and viewing it answers nothing.
 * Every condition starts at `Not answered` and stays there until the trader says
 * otherwise — "I did not check this" and "this was false" are different claims
 * about a process, and only one of them is a criticism.
 */
export function PlanEditor({
  tense,
  draft,
  onChange,
  currency,
  basis,
  includeLevels = true,
}: {
  tense: 'present' | 'past';
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  currency: string;
  /** Money-basis plans ask for amounts; price-basis plans ask for levels. */
  basis: 'money' | 'price';
  /**
   * Whether the planned target and risk belong to this editor.
   *
   * Still open already carries a target in the trade core, where it is part of
   * the position rather than part of the story; offering a second one here would
   * be two fields for one fact.
   */
  includeLevels?: boolean;
}) {
  const [showChecklist, setShowChecklist] = useState(false);
  const [showLevels, setShowLevels] = useState(
    draft.plannedRisk !== '' || draft.plannedTarget !== '',
  );
  const [showNote, setShowNote] = useState(draft.note !== '' || draft.chartUrl !== '');

  const conditions = draft.setup === null ? [] : (ENTRY_CHECKLIST[draft.setup] ?? []);
  const patch = (next: Partial<PlanDraft>) => onChange({ ...draft, ...next });

  return (
    <NestedEditor
      open={showChecklist}
      title="Entry checklist"
      backLabel="Back to your plan"
      onBack={() => setShowChecklist(false)}
      body={
        <div className="flex min-w-0 flex-col gap-5">
          <Field
            label={
              tense === 'present'
                ? 'Why are you taking this trade?'
                : 'Why did you take this trade?'
            }
          >
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={draft.reason}
                onChange={(event) => patch({ reason: event.target.value })}
                placeholder="What you saw, and why it was worth risking money on."
                className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
              />
            )}
          </Field>

          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-foreground text-sm font-medium">
              {tense === 'present'
                ? 'Are you following a strategy?'
                : 'Were you following a strategy?'}
            </p>

            <Field label="Strategy" optional hint="The trading method you used.">
              {(id) => (
                <select
                  id={id}
                  value={draft.strategy ?? ''}
                  onChange={(event) =>
                    patch({
                      strategy: event.target.value === '' ? null : event.target.value,
                      setup: null,
                    })
                  }
                  className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                >
                  <option value="">Not selected</option>
                  {PROTOTYPE_STRATEGIES.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {draft.strategy === null ? null : (
              <Field label="Trade setup" optional hint="The pattern or signal you traded.">
                {(id) => (
                  <select
                    id={id}
                    value={draft.setup ?? ''}
                    onChange={(event) =>
                      patch({ setup: event.target.value === '' ? null : event.target.value })
                    }
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                  >
                    <option value="">Not selected</option>
                    {(
                      PROTOTYPE_STRATEGIES.find((item) => item.name === draft.strategy)?.setups ??
                      []
                    ).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}

            {conditions.length === 0 ? null : (
              <ContextualAction onClick={() => setShowChecklist(true)}>
                View entry checklist
              </ContextualAction>
            )}
          </div>

          {/*
            PLANNED NUMBERS ARE AN ENTRANCE, NOT A PAIR OF EMPTY BOXES. Two blank
            fields sitting open say "these are expected of you"; a link says they
            are there if the trader had them. For a completed trade this is the
            difference between recording a plan and inventing one.
          */}
          {!includeLevels ? null : showLevels ? (
            <FieldPair>
              <TextField
                label={basis === 'money' ? 'Planned risk' : 'Planned entry'}
                {...(basis === 'money' ? { suffix: currency } : {})}
                value={draft.plannedRisk}
                onChange={(value) => patch({ plannedRisk: value })}
                inputMode="decimal"
                numeric
              />
              <TextField
                label={basis === 'money' ? 'Target profit' : 'Target price'}
                {...(basis === 'money' ? { suffix: currency } : {})}
                value={draft.plannedTarget}
                onChange={(value) => patch({ plannedTarget: value })}
                inputMode="decimal"
                numeric
              />
            </FieldPair>
          ) : (
            <ContextualAction onClick={() => setShowLevels(true)}>
              {basis === 'money' ? 'Add planned amounts' : 'Add planned levels'}
            </ContextualAction>
          )}

          {showNote ? (
            <div className="flex min-w-0 flex-col gap-4">
              <Field label="Note" optional>
                {(id) => (
                  <textarea
                    id={id}
                    rows={2}
                    value={draft.note}
                    onChange={(event) => patch({ note: event.target.value })}
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-20 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
                  />
                )}
              </Field>
              <TextField
                label="Chart link"
                optional
                value={draft.chartUrl}
                onChange={(value) => patch({ chartUrl: value })}
                placeholder="https://www.tradingview.com/x/…"
              />
            </div>
          ) : (
            <ContextualAction onClick={() => setShowNote(true)}>
              Attach a chart or a note
            </ContextualAction>
          )}
        </div>
      }
    >
      <EntryChecklist
        conditions={conditions}
        value={draft.checklist}
        onChange={(checklist) => patch({ checklist })}
      />
    </NestedEditor>
  );
}

/**
 * THE ENTRY CHECKLIST — three states, and the third one is not a failure.
 *
 * `Not answered` is a real, selected, default answer rather than an absence the
 * product later reads as `No`. That distinction is the whole reason this control
 * has three options instead of a checkbox: a checkbox has exactly two states and
 * silently maps "never looked at it" onto "false", which turns a trader's
 * unexamined condition into evidence against their own process.
 *
 * It carries no explanatory sentence. The option labels are the explanation.
 */
function EntryChecklist({
  conditions,
  value,
  onChange,
}: {
  conditions: readonly string[];
  value: Readonly<Record<string, ChecklistState>>;
  onChange: (value: Readonly<Record<string, ChecklistState>>) => void;
}) {
  return (
    <div className="divide-border border-border min-w-0 divide-y border-y">
      {conditions.map((condition) => {
        const current = value[condition] ?? 'not_answered';
        return (
          <fieldset key={condition} className="min-w-0 py-3">
            <legend className="text-foreground mb-2 text-sm">{condition}</legend>
            <div className="grid min-w-0 grid-cols-3 gap-1.5">
              {CHECKLIST_OPTIONS.map((option) => {
                const checked = current === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => onChange({ ...value, [condition]: option.value })}
                    className={cn(
                      'flex min-h-11 items-center justify-center rounded-lg border px-2 text-xs font-medium',
                      'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
                      checked
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input bg-background text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * HOW DID YOU FEEL AT ENTRY.
 *
 * Two controls, no headings above them beyond their own legends, and no caption
 * restating what the selected chips already show. The `recalled` qualifier is
 * the one piece of standing copy: on a completed trade the trader is remembering
 * a feeling rather than reporting it, and a journal that stores the two
 * identically is quietly overstating what it knows.
 */
export function FeelingsEditor({
  draft,
  onChange,
  recalled = false,
}: {
  draft: FeelingsDraft;
  onChange: (draft: FeelingsDraft) => void;
  recalled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/*
        THE QUALIFIER IS STATED ONCE, HERE, AND NOT ON THE COLLAPSED ROW.

        It was printed on the prompt row in the trade's main list AND again
        inside — so a reader met "Recalled after the trade" twice for one fact,
        and on a 320px screen at 200% zoom the row copy was 264px of
        non-shrinking text that pushed the page sideways. It is a property of
        the answers being given, so it belongs where they are given.
      */}
      {recalled ? (
        <p className="text-subtle-foreground text-xs">
          Recalled after the trade, not captured at entry.
        </p>
      ) : null}
      <ConfidenceControl
        value={draft.confidence}
        onChange={(confidence) => onChange({ ...draft, confidence })}
      />
      <EmotionsControl
        value={draft.emotions}
        onChange={(emotions) => onChange({ ...draft, emotions })}
      />
    </div>
  );
}

const RULES_OUTCOME_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'unrecorded', label: 'Not recorded' },
  { value: 'target', label: 'It would have hit my target' },
  { value: 'stop', label: 'It would have hit my stop' },
  { value: 'break_even', label: 'It would have closed at break-even' },
  { value: 'other', label: 'It would have closed for another reason' },
  { value: 'no_trade', label: 'I would not have taken it at all' },
  { value: 'unknown', label: "Can't determine" },
];

/**
 * WHAT WOULD YOU REPEAT OR CHANGE NEXT TIME.
 *
 * THE EASIEST POSSIBLE ENTRY POINT TO REVIEW, and deliberately the first thing
 * in it. A trader who writes one honest sentence here has done the valuable part
 * of reviewing a trade; everything else on this screen is refinement. The
 * previous version opened on "System outcome" with a dropdown of rule
 * resolutions — the most technical idea in the product, charged as the price of
 * entry to reflection.
 *
 * "COMPARE WITH YOUR RULES" IS WHERE THE COUNTERFACTUAL LIVES, and it stays
 * visibly hypothetical: the question is what following your rules WOULD have
 * produced, every answer is phrased as "it would have…", and `Not recorded` is
 * the default. `Can't determine` is a real answer, because a trader who cannot
 * reconstruct it must not be pushed into choosing a resolution that then enters
 * analytics as fact — and neither it nor `Not recorded` is ever read as zero.
 *
 * NOTHING HERE IS INFERRED FROM THE ACTUAL RESULT. An exit price says where the
 * position closed; it does not say which rule would have fired first.
 */
export function ReviewEditor({
  draft,
  onChange,
  currency,
  actualMoney,
}: {
  draft: ReviewDraft;
  onChange: (draft: ReviewDraft) => void;
  currency: string;
  /** The trader's real result, shown beside the hypothetical for comparison. */
  actualMoney: string;
}) {
  const [view, setView] = useState<'none' | 'rules' | 'management'>('none');
  const patch = (next: Partial<ReviewDraft>) => onChange({ ...draft, ...next });

  return (
    <NestedEditor
      open={view !== 'none'}
      title={view === 'rules' ? 'Compare with your rules' : 'How you managed the trade'}
      backLabel="Back to your review"
      onBack={() => setView('none')}
      body={
        <div className="flex min-w-0 flex-col gap-5">
          {/* NOT the editor's own question again — that is the header two
              rows above. A short label, so the textarea still has one. */}
          <Field label="In your own words">
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={draft.note}
                onChange={(event) => patch({ note: event.target.value })}
                placeholder="One honest sentence is enough."
                className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
              />
            )}
          </Field>

          <div className="flex min-w-0 flex-col gap-3">
            <ContextualAction onClick={() => setView('rules')}>
              Compare with your rules
            </ContextualAction>
            <ContextualAction onClick={() => setView('management')}>
              Review how you managed the trade
            </ContextualAction>
          </div>
        </div>
      }
    >
      {view === 'rules' ? (
        <RulesComparison
          draft={draft}
          patch={patch}
          currency={currency}
          actualMoney={actualMoney}
        />
      ) : (
        <RuleFollowing draft={draft} patch={patch} />
      )}
    </NestedEditor>
  );
}

function RulesComparison({
  draft,
  patch,
  currency,
  actualMoney,
}: {
  draft: ReviewDraft;
  patch: (next: Partial<ReviewDraft>) => void;
  currency: string;
  actualMoney: string;
}) {
  const resolvable =
    draft.rulesOutcome !== 'unrecorded' &&
    draft.rulesOutcome !== 'unknown' &&
    draft.rulesOutcome !== 'no_trade';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Field label="What would following your rules have produced?">
        {(id) => (
          <select
            id={id}
            value={draft.rulesOutcome}
            onChange={(event) => patch({ rulesOutcome: event.target.value })}
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
          >
            {RULES_OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      {resolvable ? (
        <TextField
          label="Result if you followed your rules"
          suffix={currency}
          optional
          value={draft.rulesMoney}
          onChange={(value) => patch({ rulesMoney: value })}
          inputMode="decimal"
          numeric
        />
      ) : null}

      {/*
        THE COMPARISON, IN PLAIN MONEY. Two labelled figures — no "actual vs
        system" vocabulary and no derived gap figure. A reader can see the
        difference between two numbers themselves, and naming it would cost a
        term the product has not taught them yet.
      */}
      <dl className="divide-border border-border min-w-0 divide-y border-y">
        <div className="flex min-w-0 items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground text-xs">Your net P&amp;L</dt>
          <dd className="numeric text-foreground text-sm font-medium">{actualMoney}</dd>
        </div>
        <div className="flex min-w-0 items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground text-xs">If you followed your rules</dt>
          <dd
            className={cn(
              'numeric text-sm font-medium',
              draft.rulesMoney === '' ? 'text-subtle-foreground' : 'text-foreground',
            )}
          >
            {draft.rulesMoney === '' ? 'Not recorded' : `${draft.rulesMoney} ${currency}`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function RuleFollowing({
  draft,
  patch,
}: {
  draft: ReviewDraft;
  patch: (next: Partial<ReviewDraft>) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-foreground mb-2 text-sm font-medium">
        Did you follow your rules?
      </legend>
      <div className="grid min-w-0 grid-cols-3 gap-1.5">
        {(
          [
            { value: 'met', label: 'Followed' },
            { value: 'not_met', label: 'Not followed' },
            { value: 'not_answered', label: 'Not answered' },
          ] as const
        ).map((option) => {
          const checked = draft.followedRules === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={checked}
              onClick={() => patch({ followedRules: option.value })}
              className={cn(
                'flex min-h-11 items-center justify-center rounded-lg border px-2 text-xs font-medium',
                'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
                checked
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              <span className="min-w-0 truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
