'use client';

import { ChevronRight, Route } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { strategyExitPlan } from '../fixtures';

/**
 * THE EXIT PLAN — how the position is to be managed, which is not what the
 * target is.
 *
 * A TARGET IS AN OBJECTIVE; AN EXIT PLAN IS A RULE. They are independent, and
 * treating them as one thing is what made the previous version overclaim:
 * choosing "No fixed target" printed "Exit follows my trading rules", which the
 * app had no evidence for. Nobody had said a rule existed. A trade can carry a
 * fixed target AND a rule that closes it earlier; it can have no target and no
 * rule; it can have either alone. So the row is always visible, whatever the
 * target says, and it is never called "Additional rules" — that phrasing would
 * imply the target already describes the exit, which is precisely the confusion
 * being removed.
 *
 * THREE STATES THAT MUST NOT COLLAPSE INTO TWO:
 *
 *   RECORDED      a plan is known — inherited from a strategy or written here
 *   NOT RECORDED  TradeChemist has not been told. A plan may well exist in the
 *                 trader's head or notes; the app simply does not know it
 *   NO DEFINED    the trader has said there is no exit rule for this trade
 *
 * `Not recorded` and `No defined exit rule` are different claims — one is an
 * absence of information, the other is information about an absence — and only
 * the second could ever justify a later "can't determine". Neither is a defect,
 * neither is styled as one, and neither blocks Save.
 */

export type ExitPlanSource = 'none' | 'strategy' | 'custom' | 'no_rule';

export interface ExitPlanDraft {
  readonly source: ExitPlanSource;
  /** The effective text when the trader wrote it for this trade. */
  readonly text: string;
  /**
   * Provenance, and the strategy's wording AS IT WAS when it was adopted.
   *
   * SNAPSHOT, NOT A LIVE REFERENCE. A strategy's exit plan may be rewritten
   * later, and rewriting it must not silently change what an already-recorded
   * trade says its plan was — the trade was managed under the old wording, and
   * any later assessment of it has to be against that. Holding the text rather
   * than a pointer is the prototype-scale version of that guarantee.
   */
  readonly strategyName: string | null;
  readonly strategyText: string | null;
}

export const EMPTY_EXIT_PLAN: ExitPlanDraft = {
  source: 'none',
  text: '',
  strategyName: null,
  strategyText: null,
};

/** What the row shows: the effective plan, or `null` when there is none to show. */
export function exitPlanSummary(draft: ExitPlanDraft): string | null {
  if (draft.source === 'strategy') return draft.strategyText;
  if (draft.source === 'custom') return draft.text.trim() === '' ? null : draft.text.trim();
  return null;
}

/** Where the plan came from, when that is worth saying. */
function provenance(draft: ExitPlanDraft): string | null {
  if (draft.source === 'strategy' && draft.strategyName !== null) {
    return `From ${draft.strategyName}`;
  }
  if (draft.source === 'custom' && draft.strategyName !== null) return 'Customized for this trade';
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
  const [open, setOpen] = useState(false);

  /**
   * CLOSING PUTS FOCUS BACK ON THE ROW.
   *
   * Radix restores focus to the element that TRIGGERED a dialog, and this one
   * has no `DialogTrigger` — it is opened by a plain button setting state, so on
   * Escape focus fell to `<body>` and a keyboard user was returned to the top of
   * a form they were part-way down. Measured before fixing: `focus restored to
   * row: false`. The same explicit restoration the details drawer and the
   * journal areas already do.
   */
  function setOpenAndRestore(next: boolean) {
    setOpen(next);
    if (next) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-exit-plan-row]')?.focus();
    });
  }

  const summary = exitPlanSummary(draft);
  const from = provenance(draft);

  const primary = draft.source === 'no_rule' ? 'No defined exit rule' : (summary ?? 'Not recorded');
  const isRecorded = draft.source === 'strategy' || draft.source === 'custom';

  return (
    <>
      <button
        type="button"
        data-exit-plan-row
        onClick={() => setOpen(true)}
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

      <SetExitPlanDialog
        open={open}
        onOpenChange={setOpenAndRestore}
        draft={draft}
        onChange={onChange}
        strategyName={strategyName}
      />
    </>
  );
}

/**
 * THE FOCUSED DISCLOSURE — three honest options, and no rule builder.
 *
 * NOT AN IF/THEN EDITOR. A conditions engine would be a different product, and
 * building one here would make recording a plan harder than having one. A trader
 * can already say the true thing in a sentence: "trail beneath structure, but
 * close any remainder at the New York session end". So the options are: adopt
 * the strategy's wording, write this trade's own, or say there is no rule.
 *
 * THE STRATEGY OPTION ONLY EXISTS WHEN THERE IS A STRATEGY PLAN TO ADOPT. A
 * strategy with a name and no recorded exit plan offers nothing to inherit, and
 * the option is absent rather than present-and-empty — see `strategyExitPlan`.
 *
 * OPENING AND CLOSING WITHOUT CHOOSING CHANGES NOTHING. The dialog edits a local
 * draft and only commits on Save, so a reader who opens it to look at the
 * strategy's wording and then leaves still has `Not recorded`.
 */
function SetExitPlanDialog({
  open,
  onOpenChange,
  draft,
  onChange,
  strategyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ExitPlanDraft;
  onChange: (draft: ExitPlanDraft) => void;
  strategyName: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="Close" className="max-h-[85dvh] max-w-[32rem] overflow-y-auto">
        {/* Remounted per open, so the local draft is re-seeded from the committed
            one every time and a cancelled edit never leaks into the next. */}
        {open ? (
          <SetExitPlanBody
            draft={draft}
            strategyName={strategyName}
            onCancel={() => onOpenChange(false)}
            onSave={(next) => {
              onChange(next);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SetExitPlanBody({
  draft,
  strategyName,
  onCancel,
  onSave,
}: {
  draft: ExitPlanDraft;
  strategyName: string | null;
  onCancel: () => void;
  onSave: (draft: ExitPlanDraft) => void;
}) {
  const inherited = strategyExitPlan(strategyName);
  const groupName = useId();
  const textId = useId();

  /* `none` is a real starting position, not a fourth option: the dialog opens on
     whatever the trade already says, and offers no default choice when it says
     nothing. */
  const [choice, setChoice] = useState<ExitPlanSource>(draft.source);
  const [text, setText] = useState(
    draft.source === 'custom' ? draft.text : (draft.strategyText ?? ''),
  );

  const options: readonly { value: ExitPlanSource; label: string; hint?: string }[] = [
    ...(inherited === null
      ? []
      : [
          {
            value: 'strategy' as const,
            label: `Use the ${strategyName} exit plan`,
            hint: inherited,
          },
        ]),
    {
      value: 'custom' as const,
      label: inherited === null ? 'Write an exit plan for this trade' : 'Customize for this trade',
      ...(inherited === null
        ? {}
        : { hint: 'Starts from the strategy plan. The strategy itself is not changed.' }),
    },
    { value: 'no_rule' as const, label: 'No defined exit rule for this trade' },
  ];

  function commit() {
    if (choice === 'strategy' && inherited !== null) {
      onSave({
        source: 'strategy',
        text: '',
        strategyName,
        // The wording AS ADOPTED. A later edit to the strategy must not rewrite
        // what this trade says its plan was.
        strategyText: inherited,
      });
      return;
    }
    if (choice === 'custom') {
      onSave({
        source: 'custom',
        text,
        strategyName: inherited === null ? null : strategyName,
        strategyText: inherited,
      });
      return;
    }
    if (choice === 'no_rule') {
      onSave({ source: 'no_rule', text: '', strategyName: null, strategyText: null });
      return;
    }
    onCancel();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Exit plan</DialogTitle>
        <DialogDescription>
          How this position should be managed. Separate from your target — a rule can close a trade
          before the target is reached.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="min-w-0">
        <legend className="sr-only">Exit plan for this trade</legend>
        <div className="flex min-w-0 flex-col gap-2">
          {options.map((option) => {
            const id = `${groupName}-${option.value}`;
            const selected = choice === option.value;
            return (
              <div key={option.value} className="min-w-0">
                <input
                  type="radio"
                  id={id}
                  name={groupName}
                  checked={selected}
                  onChange={() => setChoice(option.value)}
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  className={cn(
                    'flex min-h-11 w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5',
                    'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                    selected
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-input hover:bg-accent/50',
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
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-sm',
                        selected ? 'text-foreground font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {option.label}
                    </span>
                    {/* The strategy's ACTUAL wording, shown before it is chosen —
                        nobody should adopt a rule they cannot read. */}
                    {option.hint === undefined ? null : (
                      <span className="text-subtle-foreground block text-xs leading-relaxed">
                        {option.hint}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {choice === 'custom' ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={textId} className="text-muted-foreground text-xs font-medium">
            Exit plan for this trade
          </label>
          <textarea
            id={textId}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g. Trail beneath structure, but close any remainder at the New York session end."
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
          />
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
        {/* Nothing is required. Leaving without choosing keeps "Not recorded",
            and the trade saves either way. */}
        <Button className="min-h-11" onClick={commit}>
          Save exit plan
        </Button>
      </DialogFooter>
    </>
  );
}
