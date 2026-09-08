'use client';

import { ChevronLeft, ChevronRight, Plus, Route, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { AdaptiveOverlay, OverlayActions } from './adaptive-overlay';
import {
  findExitPlan,
  saveExitPlan,
  strategyDefaultPlan,
  useExitPlanLibrary,
  type SavedExitPlan,
} from './exit-plan-library';

/**
 * THE EXIT PLAN — how the position is to be managed, which is not what the
 * target is.
 *
 * A TARGET IS AN OBJECTIVE; AN EXIT PLAN IS A RULE. They are independent, and
 * treating them as one thing is what made an earlier version overclaim:
 * choosing "No fixed target" printed "Exit follows my trading rules", which the
 * app had no evidence for. Nobody had said a rule existed. A trade can carry a
 * fixed target AND a rule that closes it earlier; it can have no target and no
 * rule; it can have either alone. So the row is always visible, whatever the
 * target says, in one stable position under the baseline it belongs to.
 *
 * FOUR STATES THAT MUST NOT COLLAPSE INTO TWO:
 *
 *   NOT RECORDED  TradeChemist has not been told. A plan may well exist in the
 *                 trader's head or notes; the app simply does not know it
 *   SAVED PLAN    a plan from the library is in effect, either chosen here or
 *                 inherited from the strategy because nothing else was chosen
 *   CUSTOMIZED    a plan adapted for this trade alone
 *   NO DEFINED    the trader has said there is no exit rule for this trade
 *
 * `Not recorded` and `No defined exit rule` are different claims — one is an
 * absence of information, the other is information about an absence — and only
 * the second could ever justify a later "can't determine". Neither is a defect,
 * neither is styled as one, and neither blocks Save.
 */

export type ExitPlanSource = 'none' | 'saved' | 'custom' | 'no_rule';

export interface ExitPlanDraft {
  readonly source: ExitPlanSource;
  /**
   * The library plan this came from — its id and its name AS ADOPTED.
   *
   * SNAPSHOT, NOT A LIVE REFERENCE. `instructions` holds the wording at the
   * moment it was adopted rather than a pointer into the library, because a
   * plan rewritten next month must not silently change what a trade recorded
   * last month says its plan was: the trade was managed under the old wording
   * and any later assessment of it has to be against that. The id is kept
   * alongside so provenance survives, not so the text can be re-read.
   */
  readonly planId: string | null;
  readonly planName: string | null;
  readonly instructions: string;
}

export const EMPTY_EXIT_PLAN: ExitPlanDraft = {
  source: 'none',
  planId: null,
  planName: null,
  instructions: '',
};

/**
 * What is actually in effect on this trade, and whether it got there by
 * inheritance.
 *
 * INHERITANCE IS RESOLVED, NOT WRITTEN. `source: 'none'` means the trade has
 * made no explicit choice, and only then does the strategy's default apply. So
 * an explicitly chosen plan, a customized plan and an explicit "No defined exit
 * rule" are all untouchable — changing the strategy afterwards cannot overwrite
 * any of them — while a draft that has said nothing yet keeps following the
 * strategy as the trader tries different ones. Deriving this rather than
 * seeding state is what makes that guarantee structural instead of a rule
 * somebody has to remember not to break.
 *
 * Nothing is ever inferred from a strategy's NAME. A strategy with no recorded
 * exit plan contributes nothing, and the trade stays `Not recorded`.
 */
export function effectiveExitPlan(
  chosen: ExitPlanDraft,
  strategyName: string | null,
): { draft: ExitPlanDraft; inherited: boolean } {
  if (chosen.source !== 'none') return { draft: chosen, inherited: false };

  const fallback = strategyDefaultPlan(strategyName);
  if (fallback === null) return { draft: chosen, inherited: false };

  return {
    draft: {
      source: 'saved',
      planId: fallback.id,
      planName: fallback.name,
      instructions: fallback.instructions,
    },
    inherited: true,
  };
}

/** The effective instructions, or `null` when there are none to show. */
export function exitPlanSummary(draft: ExitPlanDraft): string | null {
  if (draft.source !== 'saved' && draft.source !== 'custom') return null;
  const text = draft.instructions.trim();
  return text === '' ? null : text;
}

/** Where the plan came from, when that is worth saying. */
function provenance(draft: ExitPlanDraft, inherited: boolean): string | null {
  if (draft.source === 'saved') {
    if (draft.planName === null) return null;
    return inherited ? `${draft.planName} · Strategy default` : draft.planName;
  }
  if (draft.source === 'custom') {
    return draft.planName === null
      ? 'Written for this trade'
      : `Customized for this trade · from ${draft.planName}`;
  }
  return null;
}

/**
 * The row itself — always visible, quieter than the amounts above it.
 *
 * One compact line with its own icon anchor, matching the Journal at entry rows
 * so the two secondary regions read as the same kind of thing. The whole row is
 * the control; the chevron says so without a second button competing with it.
 */
export function ExitPlanRow({
  draft,
  onChange,
  /** The strategy currently chosen in the trade idea, if any. */
  strategyName,
}: {
  draft: ExitPlanDraft;
  onChange: (draft: ExitPlanDraft) => void;
  strategyName: string | null;
}) {
  const library = useExitPlanLibrary();
  const { draft: effective, inherited } = effectiveExitPlan(draft, strategyName);

  const [open, setOpen] = useState(false);
  /*
    ONE OVERLAY, THREE VIEWS — AND NEVER A DIALOG ON TOP OF A DIALOG.

    Creating a plan and customizing one both happen inside this same surface,
    with a "Back to plans" step out of each. A second modal over the first would
    stack two Escape keys, two focus traps and two sets of actions over a
    decision that is one decision.
  */
  const [view, setView] = useState<'pick' | 'create' | 'customize'>('pick');
  const [choice, setChoice] = useState<Choice>({ kind: 'clear' });
  const [customText, setCustomText] = useState('');
  const [newName, setNewName] = useState('');
  const [newInstructions, setNewInstructions] = useState('');

  /*
    OPENING RESEEDS EVERY FIELD FROM WHAT THE TRADE ACTUALLY SAYS.

    Explicitly, at the moment of opening, rather than by remounting on a key or
    re-seeding in an effect: a cancelled edit must not survive into the next
    open, and a half-typed new plan must not still be sitting there tomorrow.
  */
  function openOverlay() {
    setChoice(choiceFor(effective));
    setCustomText(effective.source === 'custom' ? effective.instructions : '');
    setNewName('');
    setNewInstructions('');
    setView('pick');
    setOpen(true);
  }

  const summary = exitPlanSummary(effective);
  const from = provenance(effective, inherited);
  const primary =
    effective.source === 'no_rule' ? 'No defined exit rule' : (summary ?? 'Not recorded');
  const isRecorded = effective.source === 'saved' || effective.source === 'custom';

  const strategyDefault = strategyDefaultPlan(strategyName);
  const selectedPlan = choice.kind === 'saved' ? findExitPlan(choice.id) : null;

  function commit(next: ExitPlanDraft) {
    onChange(next);
    setOpen(false);
  }

  function useSelection() {
    if (choice.kind === 'clear') {
      commit(EMPTY_EXIT_PLAN);
      return;
    }
    if (choice.kind === 'no_rule') {
      commit({ source: 'no_rule', planId: null, planName: null, instructions: '' });
      return;
    }
    if (choice.kind === 'custom') {
      commit({
        source: 'custom',
        planId: choice.from?.id ?? null,
        planName: choice.from?.name ?? null,
        instructions: choice.text.trim(),
      });
      return;
    }
    const plan = findExitPlan(choice.id);
    if (plan === null) {
      commit(EMPTY_EXIT_PLAN);
      return;
    }
    commit({
      source: 'saved',
      planId: plan.id,
      planName: plan.name,
      // Adopted wording, frozen here — see `ExitPlanDraft`.
      instructions: plan.instructions,
    });
  }

  const others = library.filter((plan) => plan.id !== strategyDefault?.id);

  return (
    <>
      <button
        type="button"
        data-exit-plan-row
        onClick={openOverlay}
        className={cn(
          /*
            A ROW INSIDE THE CARD, NOT A CARD INSIDE THE CARD.

            It first carried the same border AND fill as the Journal at entry
            surface — but that surface sits on the canvas, while this sits inside
            the task card, so copying it put a filled box inside a filled box.
            The border alone is enough to say "this is a control"; the hover fill
            arrives on interaction rather than at rest.
          */
          'group/exit border-border flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left',
          'hover:bg-accent/40 focus-visible:ring-ring transition-colors outline-none',
          'focus-visible:ring-2 focus-visible:-outline-offset-2',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
            isRecorded ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Route className="size-3.5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="text-foreground block text-sm font-medium">Exit plan</span>
          {/* Neutral in every state. "Not recorded" is a fact about what the app
              knows, not a judgement about the trade. */}
          <span
            className={cn(
              'block text-xs',
              isRecorded ? 'text-muted-foreground' : 'text-subtle-foreground',
            )}
          >
            {primary}
          </span>
          {from === null ? null : (
            <span className="text-subtle-foreground block truncate text-xs">{from}</span>
          )}
        </span>

        <span
          aria-hidden="true"
          className="text-subtle-foreground group-hover/exit:text-foreground shrink-0 transition-colors"
        >
          <ChevronRight className="size-4" />
        </span>
      </button>

      <AdaptiveOverlay
        open={open}
        onOpenChange={setOpen}
        returnFocusTo="[data-exit-plan-row]"
        title={
          view === 'create'
            ? 'New exit plan'
            : view === 'customize'
              ? 'Customize for this trade'
              : 'Choose exit plan'
        }
        description={
          view === 'create'
            ? 'Saved to your plans so you can use it on the next trade too.'
            : view === 'customize'
              ? 'Adapts the wording for this trade only. The saved plan is not changed.'
              : 'How this position should be managed. Separate from your target — a rule can close a trade before the target is reached.'
        }
        footer={
          view === 'create' ? (
            <OverlayActions
              secondary={<BackToPlans onClick={() => setView('pick')} />}
              primary={
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  disabled={newName.trim() === '' || newInstructions.trim() === ''}
                  onClick={() => {
                    const plan = saveExitPlan(newName, newInstructions);
                    commit({
                      source: 'saved',
                      planId: plan.id,
                      planName: plan.name,
                      instructions: plan.instructions,
                    });
                  }}
                >
                  Save and use plan
                </Button>
              }
            />
          ) : view === 'customize' ? (
            <OverlayActions
              secondary={<BackToPlans onClick={() => setView('pick')} />}
              primary={
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  disabled={customText.trim() === ''}
                  onClick={() => {
                    commit({
                      source: 'custom',
                      planId: selectedPlan?.id ?? null,
                      planName: selectedPlan?.name ?? null,
                      instructions: customText.trim(),
                    });
                  }}
                >
                  Use customized plan
                </Button>
              }
            />
          ) : (
            <OverlayActions
              /*
                CLEARING IS NOT DECLARING. "Clear selection" returns the trade to
                `Not recorded` — the app has not been told — which is a different
                answer from "No defined exit rule", the trader saying there is
                nothing to tell. Where a strategy nominates a default, clearing
                the trade's own choice hands it back to that default, because
                that is what having made no choice means.
              */
              {...(choice.kind === 'clear'
                ? {}
                : {
                    tertiary: (
                      <Button
                        variant="ghost"
                        className="text-muted-foreground min-h-11 w-full sm:w-auto"
                        onClick={() => setChoice({ kind: 'clear' })}
                      >
                        Clear selection
                      </Button>
                    ),
                  })}
              secondary={
                <Button
                  variant="ghost"
                  className="min-h-11 w-full sm:w-auto"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
              }
              primary={
                <Button className="min-h-11 w-full sm:w-auto" onClick={useSelection}>
                  Use exit plan
                </Button>
              }
            />
          )
        }
      >
        {view === 'create' ? (
          <PlanFields
            name={newName}
            onNameChange={setNewName}
            instructions={newInstructions}
            onInstructionsChange={setNewInstructions}
          />
        ) : view === 'customize' ? (
          <CustomizeField source={selectedPlan} value={customText} onChange={setCustomText} />
        ) : (
          <PickPlan
            choice={choice}
            onChoice={setChoice}
            strategyDefault={strategyDefault}
            others={others}
            onCreate={() => setView('create')}
            onCustomize={() => {
              setCustomText(
                choice.kind === 'custom' ? choice.text : (selectedPlan?.instructions ?? ''),
              );
              setView('customize');
            }}
          />
        )}
      </AdaptiveOverlay>
    </>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * WHAT IS SELECTED IN THE OVERLAY, which is not yet what the trade says.
 *
 * `clear` is a real position and not a fourth option in the list: it is "no
 * selection", the state the overlay opens in when the trade has recorded
 * nothing, and the state "Clear selection" returns to. Cancelling from any of
 * these leaves the trade exactly as it was — the overlay never writes anything
 * until its primary action is pressed, so opening it to read a plan's wording
 * and then leaving cannot turn `Not recorded` into `No defined exit rule`.
 */
type Choice =
  | { kind: 'clear' }
  | { kind: 'saved'; id: string }
  | { kind: 'custom'; from: SavedExitPlan | null; text: string }
  | { kind: 'no_rule' };

function choiceFor(effective: ExitPlanDraft): Choice {
  if (effective.source === 'saved' && effective.planId !== null) {
    return { kind: 'saved', id: effective.planId };
  }
  if (effective.source === 'custom') {
    return { kind: 'custom', from: findExitPlan(effective.planId), text: effective.instructions };
  }
  if (effective.source === 'no_rule') return { kind: 'no_rule' };
  return { kind: 'clear' };
}

function BackToPlans({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" className="min-h-11 w-full sm:w-auto" onClick={onClick}>
      <ChevronLeft className="size-4" aria-hidden="true" />
      Back to plans
    </Button>
  );
}

/**
 * THE LIST — one selection, and a visible separation before the option that is
 * not a plan at all.
 *
 * "No defined exit rule" sits below a divider under its own quiet heading,
 * because it is a different KIND of answer from the plans above it and putting
 * it in the same run would make it read as the last, least appealing plan.
 */
function PickPlan({
  choice,
  onChoice,
  strategyDefault,
  others,
  onCreate,
  onCustomize,
}: {
  choice: Choice;
  onChoice: (choice: Choice) => void;
  strategyDefault: SavedExitPlan | null;
  others: readonly SavedExitPlan[];
  onCreate: () => void;
  onCustomize: () => void;
}) {
  const groupName = useId();
  const customizable = choice.kind === 'saved' || choice.kind === 'custom';

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Exit plan for this trade</legend>

      <div className="flex min-w-0 flex-col gap-4">
        {/* The customized plan is shown as its own selected entry rather than
            hidden behind the plan it came from — otherwise the list would show
            the original's wording while the trade carries different words. */}
        {choice.kind === 'custom' ? (
          <Section label="This trade">
            <PlanOption
              groupName={groupName}
              selected
              onSelect={() => {}}
              name="Customized for this trade"
              instructions={choice.text}
              {...(choice.from === null ? {} : { badge: `from ${choice.from.name}` })}
            />
          </Section>
        ) : null}

        {strategyDefault === null ? null : (
          <Section label="Strategy default">
            <PlanOption
              groupName={groupName}
              selected={choice.kind === 'saved' && choice.id === strategyDefault.id}
              onSelect={() => onChoice({ kind: 'saved', id: strategyDefault.id })}
              name={strategyDefault.name}
              instructions={strategyDefault.instructions}
              badge="Strategy default"
            />
          </Section>
        )}

        {others.length === 0 ? null : (
          <Section label={strategyDefault === null ? 'Saved plans' : 'Other saved plans'}>
            {others.map((plan) => (
              <PlanOption
                key={plan.id}
                groupName={groupName}
                selected={choice.kind === 'saved' && choice.id === plan.id}
                onSelect={() => onChoice({ kind: 'saved', id: plan.id })}
                name={plan.name}
                instructions={plan.instructions}
              />
            ))}
          </Section>
        )}

        <div className="border-border min-w-0 border-t pt-4">
          <PlanOption
            groupName={groupName}
            selected={choice.kind === 'no_rule'}
            onSelect={() => onChoice({ kind: 'no_rule' })}
            name="No defined exit rule for this trade"
            instructions="You manage this one by judgement. TradeChemist will not treat that as a missing answer."
          />
        </div>

        {/*
          SECONDARY ACTIONS, BELOW THE THING THEY ACT ON. Creating a plan and
          adapting one are both ways OUT of this list, so neither may look like
          an entry in it — they are text actions under the list, not a third and
          fourth option row.
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Button variant="ghost" className="text-primary min-h-11 px-2" onClick={onCreate}>
            <Plus className="size-4" aria-hidden="true" />
            Create new exit plan
          </Button>
          {customizable ? (
            <Button variant="ghost" className="text-primary min-h-11 px-2" onClick={onCustomize}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Customize for this trade
            </Button>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-label text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}

/**
 * One selectable plan.
 *
 * The native radio is `peer sr-only` and the ring is drawn — this codebase's
 * established selection control, so keyboard behaviour, the checked state in
 * the accessibility tree and the label association all still come from the
 * platform while the selected state looks like every other selected state in
 * the product.
 */
function PlanOption({
  groupName,
  selected,
  onSelect,
  name,
  instructions,
  badge,
}: {
  groupName: string;
  selected: boolean;
  onSelect: () => void;
  name: string;
  instructions: string;
  badge?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <input
        type="radio"
        id={id}
        name={groupName}
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          'flex min-h-11 w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5',
          'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
          selected ? 'border-primary/40 bg-primary/10' : 'border-input hover:bg-accent/50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
            selected ? 'border-primary' : 'border-input',
          )}
        >
          {selected ? <span className="bg-primary size-2.5 rounded-full" /> : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={cn(
                'min-w-0 text-sm',
                selected ? 'text-foreground font-medium' : 'text-foreground',
              )}
            >
              {name}
            </span>
            {badge === undefined ? null : (
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                {badge}
              </span>
            )}
          </span>
          {/* The plan's ACTUAL wording, shown before it is chosen — nobody
              should adopt a rule they cannot read. */}
          <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
            {instructions}
          </span>
        </span>
      </label>
    </div>
  );
}

/** Name and instructions — the whole of a plan. */
function PlanFields({
  name,
  onNameChange,
  instructions,
  onInstructionsChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
}) {
  const nameId = useId();
  const textId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={nameId} className="text-foreground text-sm font-medium">
          Name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="e.g. Structure trail"
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-11 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
        />
        <p className="text-muted-foreground text-xs">What you will call it in the list.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {/* "Exit instructions", not "Description". A description is about the
            plan; instructions are the plan. */}
        <label htmlFor={textId} className="text-foreground text-sm font-medium">
          Exit instructions
        </label>
        <textarea
          id={textId}
          rows={4}
          value={instructions}
          onChange={(event) => onInstructionsChange(event.target.value)}
          placeholder="e.g. Trail beneath structure, but close any remainder at the New York session end."
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
        />
        <p className="text-muted-foreground text-xs">
          Plain language. There are no conditions to build — a sentence is the plan.
        </p>
      </div>
    </div>
  );
}

/** The customized wording, with the plan it started from stated above it. */
function CustomizeField({
  source,
  value,
  onChange,
}: {
  source: SavedExitPlan | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const textId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {source === null ? null : (
        <div className="border-border bg-muted/30 min-w-0 rounded-lg border p-3">
          <p className="text-label text-muted-foreground uppercase">{source.name}</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {source.instructions}
          </p>
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={textId} className="text-foreground text-sm font-medium">
          Exit instructions for this trade
        </label>
        <textarea
          id={textId}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. Trail beneath structure, but close any remainder at the New York session end."
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
        />
        <p className="text-muted-foreground text-xs">
          This trade only.{' '}
          {source === null ? 'Nothing is saved to your plans.' : `${source.name} is not changed.`}
        </p>
      </div>
    </div>
  );
}
