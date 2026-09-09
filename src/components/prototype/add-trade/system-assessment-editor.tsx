'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import {
  comparability,
  confirmedGrossR,
  confirmedNetR,
  currentGrossR,
  systemCostR,
  systemGrossR,
  systemNetR,
  systemOutcome,
  type Adherence,
  type AssessmentContext,
  type AssessmentStatus,
  type PlanProvenance,
  type SystemAssessmentDraft,
  type SystemBasis,
  type SystemExitReason,
} from '../system-assessment';
import { Field, InlineNote, TextField } from './form-primitives';

/**
 * SYSTEM ASSESSMENT — "what would following your rules have produced?"
 *
 * THE FIRST QUESTION IS THE ONLY ONE MOST TRADES NEED. "Would your rules have
 * taken this trade?" has three answers, and two of them END the assessment: `No`
 * is a finding (`no_trade`), `Can't determine` is a finding, and only `Yes`
 * opens anything further. A beginner who opens this out of curiosity can answer
 * one question and leave with a complete, truthful record.
 *
 * NOTHING IS INFERRED, AND THE SHAPE OF THE FORM IS THE GUARANTEE. There is no
 * field here that reads the actual result, no chart, no price path. The trader
 * names which rule would have closed the trade; the app does arithmetic on the
 * figures they have already recorded. A target the price happened to reach is
 * not an answer to "which rule fired first", and this form has no way to express
 * it as one.
 *
 * ADHERENCE IS ASKED HERE AND MEANS SOMETHING ELSE. "Did you follow your plan?"
 * is a fact about the trader; the system result is a fact about the rules. They
 * share an editor because they are answered in the same sitting, and they share
 * nothing else — a system loss the trader followed faithfully and a system win
 * they ignored are both ordinary records, and neither is derivable from the
 * other.
 *
 * THE COST FIELD STARTS EMPTY AND STAYS EMPTY. Prefilling `0` would be the app
 * asserting that following the rules would have cost nothing — a claim, made on
 * the trader's behalf, in the direction that flatters the strategy. Blank means
 * unknown, the figure stays gross, and the comparison with Actual R is withheld
 * rather than quietly biased.
 */

const STATUS_OPTIONS: readonly { value: AssessmentStatus; label: string }[] = [
  { value: 'assessed', label: 'Yes' },
  { value: 'no_trade', label: "No — the setup wasn't valid" },
  { value: 'cannot_determine', label: "Can't determine" },
];

/**
 * "INITIAL STOP HIT", NOT "STOP HIT" — the narrowing matters more than it reads.
 *
 * The generic wording invited a trader whose stop had been trailed up, or moved
 * to break-even, to select it — and the plan-derived basis behind it answers
 * −1R, which is true only of the stop that Risk at entry measures. A stop that
 * travelled resolves somewhere else entirely. The label says which stop it means
 * and the model refuses the pairing anyway (`basisMatchesReason`), so the two
 * defences are independent.
 *
 * The enum VALUE stays `stop_hit` for production compatibility; only the
 * semantics the trader is offered have narrowed.
 */
const REASON_OPTIONS: readonly { value: SystemExitReason; label: string }[] = [
  { value: 'target_hit', label: 'Target hit' },
  { value: 'stop_hit', label: 'Initial stop hit' },
  { value: 'break_even_rule', label: 'Break-even rule' },
  { value: 'trailing_exit', label: 'Trailing exit' },
  { value: 'time_exit', label: 'Time or session exit' },
  { value: 'rule_exit', label: 'Another rule' },
  { value: 'manual_system_valid_exit', label: 'A judgement the rules allow' },
];

const PROVENANCE_OPTIONS: readonly { value: PlanProvenance; label: string }[] = [
  { value: 'at_entry', label: 'Yes, before I entered' },
  { value: 'reconstructed_later', label: "No, I've worked them out since" },
];

const ADHERENCE_OPTIONS: readonly { value: Adherence; label: string }[] = [
  { value: 'followed', label: 'Followed' },
  { value: 'partly', label: 'Partly' },
  { value: 'not_followed', label: 'Not followed' },
];

/** A chip row — the same control the exit-history question already uses. */
function Chips<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-foreground mb-2 text-sm font-medium">{legend}</legend>
      {hint === undefined ? null : <p className="text-subtle-foreground mb-2 text-xs">{hint}</p>}
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'focus-visible:ring-ring relative min-h-11 rounded-full border px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2',
              value === option.value
                ? 'border-primary bg-primary/10 text-foreground font-medium'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * WHICH MAGNITUDES THE RECORDED PLAN CAN ANSWER FOR, given the named rule.
 *
 * A plan-derived option is offered only where the plan genuinely contains the
 * answer — `Target hit` needs a recorded target and risk, `Stop hit` needs
 * nothing because a stop is −1R by the definition of R. Everything else, and
 * every reason a rule cannot compute, falls to the trader's own figure.
 *
 * OFFERED, NEVER APPLIED. Each is a choice the trader makes; none is preselected.
 */
function basisOptions(
  reason: SystemExitReason | null,
  context: AssessmentContext,
): readonly { value: SystemBasis; label: string }[] {
  const hasTarget = context.targetProfit !== '' && context.riskAtEntry !== '';
  if (reason === 'target_hit' && hasTarget) {
    return [
      { value: 'plan_target', label: 'Your recorded target' },
      { value: 'money', label: 'A different amount' },
      { value: 'custom_r', label: 'Enter R directly' },
    ];
  }
  if (reason === 'stop_hit') {
    return [
      { value: 'plan_stop', label: 'Your initial stop (−1R)' },
      { value: 'money', label: 'A different amount' },
      { value: 'custom_r', label: 'Enter R directly' },
    ];
  }
  if (reason === 'break_even_rule') {
    return [
      { value: 'break_even', label: 'Flat (0R)' },
      { value: 'money', label: 'A different amount' },
      { value: 'custom_r', label: 'Enter R directly' },
    ];
  }
  return [
    { value: 'money', label: 'An amount' },
    { value: 'custom_r', label: 'Enter R directly' },
  ];
}

export function SystemAssessmentEditor({
  draft,
  onChange,
  context,
  currency = 'USD',
  stale = false,
  onConfirm,
}: {
  draft: SystemAssessmentDraft;
  onChange: (draft: SystemAssessmentDraft) => void;
  context: AssessmentContext;
  currency?: string;
  /** Something the assessment rested on has moved since it was made. */
  stale?: boolean;
  onConfirm?: () => void;
}) {
  const patch = (next: Partial<SystemAssessmentDraft>) => onChange({ ...draft, ...next });

  const gross = systemGrossR(draft, context);
  const net = systemNetR(draft, context);
  const outcome = systemOutcome(draft, context);
  const compare = comparability(draft, context);
  const bases = basisOptions(draft.reason, context);

  /* The frozen result the trader actually confirmed, and what today's figures
     would produce — kept apart deliberately. See the stale block below. */
  const confirmedNet = confirmedNetR(draft);
  const confirmedShown = confirmedNet ?? confirmedGrossR(draft);
  const currentShown = currentGrossR(draft, context);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/*
        A MOVED DEPENDENCY IS STATED, AND NOTHING IS ERASED.

        The assessment below is exactly as the trader left it. What has changed
        is the rules it was made against, so it is held out of any comparison
        until they say it still stands. Deleting it would destroy real work over
        a one-character edit.
      */}
      {/*
        THE CONFIRMED RESULT AND THE CURRENT ONE, SIDE BY SIDE AND LABELLED.

        What the trader confirmed is stated as what it is — previously confirmed
        — and what today's plan figures would produce is offered beneath it as
        context, in plain words that never call it the system result. Only "This
        still applies" promotes it. Presenting the recomputed number alone, as an
        earlier version did, meant editing a historical target silently turned a
        confirmed +5R into +10R that nobody had assessed.
      */}
      {stale ? (
        <div className="border-warning/40 bg-warning/5 flex min-w-0 flex-col gap-2 rounded-lg border p-3">
          <p className="text-warning text-sm leading-relaxed">
            The plan information used by this assessment has changed. It has been kept, but it is
            not counted until you confirm it still applies.
          </p>
          {confirmedShown === null ? null : (
            <p className="text-foreground text-sm">
              Previously confirmed:{' '}
              <span className="numeric font-semibold">
                {confirmedShown > 0 ? '+' : ''}
                {confirmedShown.toFixed(2)}R
              </span>
              {confirmedNet === null ? ' gross' : ''}
            </p>
          )}
          {currentShown === null || currentShown === confirmedShown ? null : (
            <p className="text-muted-foreground text-sm">
              Current inputs would calculate{' '}
              <span className="numeric font-medium">
                {currentShown > 0 ? '+' : ''}
                {currentShown.toFixed(2)}R
              </span>
              .
            </p>
          )}
          {onConfirm === undefined ? null : (
            <Button size="sm" variant="outline" className="min-h-11 self-start" onClick={onConfirm}>
              This still applies
            </Button>
          )}
        </div>
      ) : null}

      <Chips
        legend="Would your rules have taken this trade?"
        options={STATUS_OPTIONS}
        value={draft.status === 'not_assessed' ? null : draft.status}
        onChange={(status) =>
          patch(
            /* Answering No or Can't determine ENDS the assessment — the
               resolution below has nothing left to describe, so it is cleared
               rather than left behind as a stale half-answer. */
            status === 'assessed'
              ? { status }
              : { status, reason: null, basis: null, systemMoney: '', grossRInput: '', costR: '' },
          )
        }
      />

      {draft.status === 'no_trade' ? (
        <InlineNote>
          Recorded as a trade your rules would not have taken. There is no system result to compare
          against, and what the trade actually made is unchanged.
        </InlineNote>
      ) : null}

      {draft.status === 'cannot_determine' ? (
        <InlineNote>
          Recorded as unable to determine. Nothing is assumed about what the rules would have
          produced.
        </InlineNote>
      ) : null}

      {draft.status === 'assessed' ? (
        <>
          <Chips
            legend="What would have closed the trade?"
            hint="The rule that would have fired first — not where price happened to go. “Initial stop” means the stop your Risk at entry was measured against; a stop you moved or trailed is one of the others."
            options={REASON_OPTIONS}
            value={draft.reason}
            onChange={(reason) =>
              /* A different rule means a different magnitude. The old basis is
                 cleared rather than carried onto a rule it was not chosen for. */
              patch({ reason, basis: null, systemMoney: '', grossRInput: '' })
            }
          />

          {draft.reason === null ? null : (
            <Chips
              legend="Where does the result come from?"
              options={bases}
              value={draft.basis}
              onChange={(basis) => patch({ basis, systemMoney: '', grossRInput: '' })}
            />
          )}

          {draft.basis === 'money' ? (
            <TextField
              label={`Result if you followed your rules (${currency})`}
              value={draft.systemMoney}
              onChange={(systemMoney) => patch({ systemMoney })}
              inputMode="decimal"
              numeric
              hint="Use a minus sign for a loss."
            />
          ) : null}

          {draft.basis === 'custom_r' ? (
            <TextField
              label="Gross result in R"
              value={draft.grossRInput}
              onChange={(grossRInput) => patch({ grossRInput })}
              inputMode="decimal"
              numeric
              hint="Before costs. Use a minus sign for a loss."
            />
          ) : null}

          {gross === null ? null : (
            <div className="border-border bg-muted/30 flex min-w-0 flex-col gap-2 rounded-lg border p-3">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-muted-foreground text-xs font-medium">
                  System R{net === null ? ' (gross)' : ''}
                </span>
                <span
                  className={cn(
                    'numeric text-base font-semibold',
                    (net ?? gross) > 0
                      ? 'text-positive'
                      : (net ?? gross) < 0
                        ? 'text-negative'
                        : 'text-foreground',
                  )}
                >
                  {(net ?? gross) > 0 ? '+' : ''}
                  {(net ?? gross).toFixed(2)}R
                </span>
                {outcome === null ? null : (
                  <span className="text-muted-foreground text-xs">
                    ·{' '}
                    {outcome === 'win'
                      ? 'System win'
                      : outcome === 'loss'
                        ? 'System loss'
                        : 'System break-even'}
                  </span>
                )}
              </p>

              {/*
                THE COST IS OPTIONAL, AND ITS ABSENCE IS EXPLAINED RATHER THAN
                FILLED IN. Blank stays blank; the figure above stays labelled
                gross; and the comparison with what the trader actually made is
                withheld until the two sides are measured the same way.
              */}
              <Field
                label={`Costs if you followed your rules (R)`}
                optional
                hint="Leave blank if you don't know. Without it the figure above stays gross and is not compared with your actual result."
              >
                {(id) => (
                  <input
                    id={id}
                    value={draft.costR}
                    inputMode="decimal"
                    placeholder="Unknown"
                    onChange={(event) => patch({ costR: event.target.value })}
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 numeric h-11 w-full max-w-[12rem] min-w-0 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                  />
                )}
              </Field>

              {compare === 'gross_only' ? (
                <InlineNote>
                  Gross only — not compared with your actual result, which is after costs.
                </InlineNote>
              ) : null}
              {systemCostR(draft) !== null && gross !== null ? (
                <InlineNote>
                  {gross > 0 ? '+' : ''}
                  {gross.toFixed(2)}R gross, less {systemCostR(draft)?.toFixed(2)}R of costs.
                </InlineNote>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {/*
        A SEPARATE QUESTION, BELOW A RULE, ASKED OF EVERY TRADE.

        It is not conditional on the assessment above: a trader who cannot
        determine what the rules would have produced may still know perfectly
        well whether they followed them.
      */}
      <div className="border-border min-w-0 border-t pt-5">
        <Chips
          legend="Did you follow your plan?"
          hint="About what you did, not about what the rules would have produced."
          options={ADHERENCE_OPTIONS}
          value={draft.adherence === 'not_answered' ? null : draft.adherence}
          onChange={(adherence) => patch({ adherence })}
        />
      </div>

      {/*
        PROVENANCE IS ASKED, BECAUSE NOTHING HERE CAN ESTABLISH IT.

        IT USED TO BE DERIVED, AND THE DERIVATION WAS WRONG: "this is the
        historical path, so the rules were reconstructed". When a record was
        TYPED says nothing about when its PLAN was made — a trader entering notes
        they wrote before the trade has rules that applied at entry and merely
        late data entry. The prototype holds no evidence either way (the plan
        library has no creation times and there is no strategy versioning here),
        so the one party who knows is asked, once, and `unknown` stands until
        they answer.

        It sits last because it qualifies the assessment rather than forming part
        of it, and it never blocks anything.
      */}
      {draft.status === 'not_assessed' ? null : (
        <div className="border-border min-w-0 border-t pt-5">
          <Chips
            legend="Were these rules in place before you entered?"
            hint="About the rules themselves, not about when you typed them in."
            options={PROVENANCE_OPTIONS}
            value={draft.planProvenance === 'unknown' ? null : draft.planProvenance}
            onChange={(planProvenance) => patch({ planProvenance })}
          />
          {draft.planProvenance === 'unknown' ? (
            <InlineNote>
              Unanswered — this assessment is recorded without a claim either way.
            </InlineNote>
          ) : null}
        </div>
      )}
    </div>
  );
}
