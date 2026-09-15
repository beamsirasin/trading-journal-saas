'use client';

import { GitBranch, Route } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { AdaptiveOverlay, OverlayActions } from '../add-trade/adaptive-overlay';
import { useExitPlanLibrary } from '../add-trade/exit-plan-library';
import {
  exitPlanActions,
  exitPlanStatus,
  NO_RULE_PLAN,
  type PilotDraft,
} from './at-entry-pilot-model';
import { InlineAction, PilotTextarea, RADIUS, StateText, Tag } from './pilot-surface';

/**
 * THE EXIT PLAN, FIVE VISUAL STATES THAT MUST NOT COLLAPSE.
 *
 *   not recorded   neutral words, and the ways to record one
 *   inherited      dashed "From Strategy" tag — supplied, not confirmed
 *   saved          the plan's name, the trader's own choice
 *   customized     "Customized for this trade", with where it came from
 *   no rule        the explicit answer "No defined exit rule"
 *
 * Choosing inside the editor writes to the same draft (nested editors are views
 * of one Draft). Done, X, Escape and outside click keep changes; only Discard
 * changes restores the checkpoint taken when the editor opened.
 */
export function ExitPlanBlock({
  draft,
  onChange,
}: {
  draft: PilotDraft;
  onChange: (next: PilotDraft) => void;
}) {
  const status = exitPlanStatus(draft);
  const [editorOpen, setEditorOpen] = useState(false);
  const checkpoint = useRef<PilotDraft | null>(null);
  const headingId = useId();

  function openEditor(seed?: PilotDraft) {
    checkpoint.current = draft;
    if (seed !== undefined) onChange(seed);
    setEditorOpen(true);
  }

  function customize() {
    const current = status.kind === 'not_recorded' ? null : status.plan;
    openEditor(
      exitPlanActions.choose(draft, {
        source: 'custom',
        planId: current?.planId ?? null,
        planName: current?.planName ?? null,
        instructions: current?.instructions ?? '',
      }),
    );
  }

  const canRestore = status.strategyDefault !== null && status.kind !== 'inherited';

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-foreground text-sm font-medium">
          Exit plan
        </h3>
        {status.kind === 'not_recorded' ? <StateText>Not recorded</StateText> : null}
      </div>

      <div
        data-exit-plan-state={status.kind}
        className={cn(
          'flex min-w-0 flex-col gap-3 border px-4 py-3',
          RADIUS.control,
          status.kind === 'inherited'
            ? 'border-dashed border-[var(--pilot-selected-border)]'
            : 'border-border',
        )}
      >
        {status.kind === 'not_recorded' ? (
          <p className="text-muted-foreground text-sm">
            How you plan to manage and close this trade. A fixed target is not the same thing as an
            exit rule.
          </p>
        ) : status.kind === 'no_rule' ? (
          <p className="text-foreground text-sm font-semibold">No defined exit rule</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Route className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <p className="text-foreground min-w-0 text-sm font-semibold">
                {status.kind === 'custom'
                  ? 'Customized for this trade'
                  : (status.plan.planName ?? 'Saved plan')}
              </p>
              {status.kind === 'inherited' ? (
                <Tag tone="inherited" icon={<GitBranch className="size-3" aria-hidden="true" />}>
                  From Strategy: {status.strategyName}
                </Tag>
              ) : null}
            </div>
            {status.kind === 'custom' && status.plan.planName !== null ? (
              <p className="text-muted-foreground text-sm">Based on {status.plan.planName}</p>
            ) : null}
            {status.plan.instructions.trim() === '' ? null : (
              <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed">
                {status.plan.instructions}
              </p>
            )}
            {status.kind === 'inherited' ? (
              <p className="text-subtle-foreground text-sm">
                Filled in from your strategy. Keep it, change it, or say there is no rule.
              </p>
            ) : null}
          </div>
        )}

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {status.kind === 'inherited' ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(exitPlanActions.confirmInherited(draft))}
              >
                Use this plan
              </Button>
              <InlineAction onClick={customize}>Customize</InlineAction>
              <InlineAction onClick={() => openEditor(exitPlanActions.decline(draft))}>
                Choose another
              </InlineAction>
            </>
          ) : status.kind === 'not_recorded' ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => openEditor()}>
                Choose exit plan
              </Button>
              <InlineAction onClick={() => onChange(exitPlanActions.choose(draft, NO_RULE_PLAN))}>
                No defined exit rule
              </InlineAction>
            </>
          ) : (
            <>
              <InlineAction onClick={() => openEditor()}>Change</InlineAction>
              {status.kind === 'no_rule' ? null : (
                <InlineAction onClick={customize}>Customize</InlineAction>
              )}
            </>
          )}
          {canRestore ? (
            <InlineAction onClick={() => onChange(exitPlanActions.restoreStrategyDefault(draft))}>
              Use strategy default
            </InlineAction>
          ) : null}
        </div>
      </div>

      <ExitPlanEditor
        open={editorOpen}
        draft={draft}
        onChange={onChange}
        onClose={() => setEditorOpen(false)}
        onDiscard={() => {
          if (checkpoint.current !== null) onChange(checkpoint.current);
          setEditorOpen(false);
        }}
      />
    </section>
  );
}

function ExitPlanEditor({
  open,
  draft,
  onChange,
  onClose,
  onDiscard,
}: {
  open: boolean;
  draft: PilotDraft;
  onChange: (next: PilotDraft) => void;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const library = useExitPlanLibrary();
  const name = useId();
  const current = draft.exitPlan;
  const selected =
    current.source === 'saved'
      ? `plan:${current.planId ?? ''}`
      : current.source === 'custom'
        ? 'custom'
        : current.source === 'no_rule'
          ? 'no_rule'
          : '';

  const options = [
    ...library.map((plan) => ({
      key: `plan:${plan.id}`,
      title: plan.name,
      detail: plan.instructions,
      tag: plan.strategyName === null ? null : `Default for ${plan.strategyName}`,
      apply: () =>
        onChange(
          exitPlanActions.choose(draft, {
            source: 'saved',
            planId: plan.id,
            planName: plan.name,
            instructions: plan.instructions,
          }),
        ),
    })),
    {
      key: 'custom',
      title: 'Write a plan for this trade',
      detail: 'Only this trade uses it. Your saved plans stay as they are.',
      tag: null,
      apply: () =>
        onChange(
          exitPlanActions.choose(draft, {
            source: 'custom',
            planId: null,
            planName: null,
            instructions: current.source === 'custom' ? current.instructions : '',
          }),
        ),
    },
    {
      key: 'no_rule',
      title: 'No defined exit rule',
      detail: 'You do not have a rule for closing this trade.',
      tag: null,
      apply: () => onChange(exitPlanActions.choose(draft, NO_RULE_PLAN)),
    },
  ];

  return (
    <AdaptiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Exit plan"
      description="Choose how you plan to close this trade. Closing this panel keeps what you chose."
      footer={
        <OverlayActions
          primary={
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          }
          secondary={
            <Button type="button" variant="ghost" className="text-destructive" onClick={onDiscard}>
              Discard changes
            </Button>
          }
        />
      }
    >
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="sr-only">Exit plan</legend>
        {options.map((option) => {
          const checked = selected === option.key;
          const id = `${name}-${option.key}`;
          return (
            <div key={option.key} className="min-w-0">
              <input
                type="radio"
                id={id}
                name={name}
                checked={checked}
                onChange={option.apply}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'peer-focus-visible:ring-ring flex min-h-12 cursor-pointer items-start gap-2.5 border px-3 py-2.5 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  RADIUS.control,
                  checked
                    ? 'border-[var(--pilot-selected-border)] bg-[var(--pilot-selected)]'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                    checked ? 'border-primary bg-primary' : 'border-[var(--pilot-selected-border)]',
                  )}
                >
                  {checked ? (
                    <span className="bg-primary-foreground size-1.5 rounded-full" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-semibold">{option.title}</span>
                    {option.tag === null ? null : <Tag tone="context">{option.tag}</Tag>}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-sm">
                    {option.detail}
                  </span>
                </span>
              </label>
            </div>
          );
        })}
      </fieldset>
      {current.source === 'custom' ? (
        <div className="mt-4">
          <PilotTextarea
            id={`${name}-instructions`}
            label="Your plan for this trade"
            value={current.instructions}
            onChange={(instructions) =>
              onChange(exitPlanActions.choose(draft, { ...current, instructions }))
            }
            placeholder="For example: take half at 2R, trail the rest beneath each higher low."
          />
        </div>
      ) : null}
    </AdaptiveOverlay>
  );
}
