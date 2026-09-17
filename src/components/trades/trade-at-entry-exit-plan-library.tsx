'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import {
  EXIT_PLAN_INSTRUCTIONS_MAX_LENGTH,
  EXIT_PLAN_NAME_MAX_LENGTH,
  type ExitPlanPublicErrorCode,
} from '@/lib/exit-plans/schemas';
import { generateId } from '@/lib/identifiers';
import { cn } from '@/lib/utils';
import {
  archiveExitPlanAction,
  createExitPlanAction,
  removeExitPlanStrategyDefaultAction,
  setExitPlanStrategyDefaultAction,
  updateExitPlanAction,
  type ExitPlanActionResult,
} from '@/server/actions/exit-plans';
import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import { FieldError, InlineAction, Notice, Tag, TextField } from './trade-at-entry-controls';

/**
 * The in-progress plan form. It lives with the Exit Plan section, not inside
 * the overlay, so X, Escape or an outside click never throws away a plan the
 * trader was part-way through writing (UX Rules §5.2).
 */
export type ExitPlanLibraryForm =
  | {
      readonly mode: 'create';
      readonly mutationKey: string;
      readonly name: string;
      readonly instructions: string;
    }
  | {
      readonly mode: 'edit';
      readonly exitPlanId: string;
      readonly name: string;
      readonly instructions: string;
    };

export function newExitPlanLibraryForm(): ExitPlanLibraryForm {
  return { mode: 'create', mutationKey: generateId(), name: '', instructions: '' };
}

/**
 * MANAGE SAVED PLANS — the library itself, reached from the Exit Plan editor.
 *
 * Every action here is an explicit library decision that persists at once:
 * Save plan, Make default, Remove as default, Archive. None of them is a
 * decision about THIS trade. A plan created here is not selected for the
 * trade; the trader goes back and chooses it. Editing or archiving a plan
 * never rewrites a Trade that already used it — each Trade keeps its copy.
 */
export function ExitPlanLibrary({
  options,
  strategyId,
  strategyName,
  inUseIds,
  form,
  onForm,
  onBack,
  onLibraryChanged,
}: {
  options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  /** The Strategy selected on this trade, when one is — the only Strategy a default can be set for here. */
  strategyId: string | null;
  strategyName: string;
  /** Plans this trade's current Exit Plan answer uses or inherits. */
  inUseIds: readonly string[];
  form: ExitPlanLibraryForm | null;
  onForm: (form: ExitPlanLibraryForm | null) => void;
  onBack: () => void;
  /** The active library after a successful change — see `ExitPlanActionResult.exitPlans`. */
  onLibraryChanged: (plans: readonly TradeCreateExitPlanOption[]) => void;
}) {
  const t = useTranslations('trades.create.recording.contractEntry.exitPlan.library');
  const [pending, startTransition] = useTransition();
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const strategyNameById = new Map(options.strategies.map((s) => [s.strategyId, s.name]));
  const currentDefault =
    strategyId === null
      ? null
      : (options.exitPlans.find((plan) => plan.strategyId === strategyId) ?? null);

  function errorMessage(code: ExitPlanPublicErrorCode): string {
    switch (code) {
      case 'read_only_workspace':
      case 'over_limit_workspace':
        return t('errors.readOnly');
      case 'exit_plan_not_found':
      case 'exit_plan_archived':
        return t('errors.planGone');
      case 'strategy_not_found':
      case 'strategy_archived':
        return t('errors.strategyGone');
      case 'validation_error':
        return t('errors.validation');
      default:
        return t('errors.unexpected');
    }
  }

  function perform<T>(
    work: () => Promise<ExitPlanActionResult<T>>,
    onSuccess: (data: T) => string,
  ) {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(errorMessage(result.error.code));
        return;
      }
      onLibraryChanged(result.exitPlans);
      setStatus(onSuccess(result.data));
    });
  }

  if (form !== null) {
    return (
      <PlanForm
        form={form}
        pending={pending}
        serverError={error}
        onChange={onForm}
        onDiscard={() => {
          setError(null);
          onForm(null);
        }}
        onSave={(name, instructions) =>
          perform(
            () =>
              form.mode === 'create'
                ? createExitPlanAction({ mutationKey: form.mutationKey, name, instructions })
                : updateExitPlanAction({ exitPlanId: form.exitPlanId, name, instructions }),
            () => {
              onForm(null);
              return form.mode === 'create'
                ? t('status.created', { name })
                : t('status.updated', { name });
            },
          )
        }
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-exit-plan-library="" aria-busy={pending}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-foreground text-sm font-semibold">{t('title')}</h3>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div role="status" aria-live="polite" className="min-w-0">
        {status === null ? null : <p className="text-foreground text-sm">{status}</p>}
      </div>
      {error === null ? null : <FieldError id="exit-plan-library-error">{error}</FieldError>}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setStatus(null);
            setError(null);
            onForm(newExitPlanLibraryForm());
          }}
        >
          {t('create')}
        </Button>
      </div>

      {options.exitPlans.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {options.exitPlans.map((plan) => {
            const defaultFor =
              plan.strategyId === null ? null : (strategyNameById.get(plan.strategyId) ?? null);
            const isDefaultHere = strategyId !== null && plan.strategyId === strategyId;
            return (
              <li
                key={plan.exitPlanId}
                data-exit-plan-library-item={plan.name}
                className="border-border flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="text-foreground min-w-0 text-sm font-semibold break-words">
                    {plan.name}
                  </p>
                  {defaultFor === null ? null : (
                    <Tag tone="context">{t('defaultFor', { strategy: defaultFor })}</Tag>
                  )}
                </div>
                <p className="text-muted-foreground line-clamp-3 text-sm break-words whitespace-pre-line">
                  {plan.instructions}
                </p>

                {confirmArchiveId === plan.exitPlanId ? (
                  <ArchiveConfirmation
                    plan={plan}
                    inUse={inUseIds.includes(plan.exitPlanId)}
                    pending={pending}
                    onKeep={() => setConfirmArchiveId(null)}
                    onArchive={() =>
                      perform(
                        () => archiveExitPlanAction({ exitPlanId: plan.exitPlanId }),
                        () => {
                          setConfirmArchiveId(null);
                          return t('status.archived', { name: plan.name });
                        },
                      )
                    }
                  />
                ) : (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                    <InlineAction
                      ariaLabel={t('editAria', { name: plan.name })}
                      onClick={() => {
                        setStatus(null);
                        setError(null);
                        onForm({
                          mode: 'edit',
                          exitPlanId: plan.exitPlanId,
                          name: plan.name,
                          instructions: plan.instructions,
                        });
                      }}
                    >
                      {t('edit')}
                    </InlineAction>
                    {strategyId === null ? null : isDefaultHere ? (
                      <InlineAction
                        onClick={() =>
                          perform(
                            () =>
                              removeExitPlanStrategyDefaultAction({ exitPlanId: plan.exitPlanId }),
                            () => t('status.defaultRemoved', { strategy: strategyName }),
                          )
                        }
                      >
                        {t('removeDefault', { strategy: strategyName })}
                      </InlineAction>
                    ) : (
                      <InlineAction
                        onClick={() =>
                          perform(
                            () =>
                              setExitPlanStrategyDefaultAction({
                                exitPlanId: plan.exitPlanId,
                                strategyId,
                              }),
                            () =>
                              currentDefault === null
                                ? t('status.defaultSet', {
                                    name: plan.name,
                                    strategy: strategyName,
                                  })
                                : t('status.defaultReplaced', {
                                    name: plan.name,
                                    strategy: strategyName,
                                    previous: currentDefault.name,
                                  }),
                          )
                        }
                      >
                        {currentDefault === null
                          ? t('makeDefault', { strategy: strategyName })
                          : t('replaceDefault', { strategy: strategyName })}
                      </InlineAction>
                    )}
                    <InlineAction
                      ariaLabel={t('archiveAria', { name: plan.name })}
                      onClick={() => {
                        setStatus(null);
                        setError(null);
                        setConfirmArchiveId(plan.exitPlanId);
                      }}
                    >
                      {t('archive')}
                    </InlineAction>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {strategyId === null && options.exitPlans.length > 0 ? (
        <p className="text-muted-foreground text-sm">{t('defaultNeedsStrategy')}</p>
      ) : null}

      <div>
        <InlineAction onClick={onBack}>{t('back')}</InlineAction>
      </div>
    </div>
  );
}

function ArchiveConfirmation({
  plan,
  inUse,
  pending,
  onKeep,
  onArchive,
}: {
  plan: TradeCreateExitPlanOption;
  inUse: boolean;
  pending: boolean;
  onKeep: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations('trades.create.recording.contractEntry.exitPlan.library');
  return (
    <div className="border-destructive/40 flex min-w-0 flex-col gap-2 border-l-2 pl-3">
      <p className="text-foreground text-sm">{t('archiveConfirm', { name: plan.name })}</p>
      {plan.strategyId === null ? null : <Notice>{t('archiveEndsDefault')}</Notice>}
      {inUse ? <Notice>{t('archiveInUse')}</Notice> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={onArchive}
        >
          {t('archiveConfirmAction')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onKeep}>
          {t('keep')}
        </Button>
      </div>
    </div>
  );
}

function PlanForm({
  form,
  pending,
  serverError,
  onChange,
  onDiscard,
  onSave,
}: {
  form: ExitPlanLibraryForm;
  pending: boolean;
  serverError: string | null;
  onChange: (form: ExitPlanLibraryForm) => void;
  onDiscard: () => void;
  onSave: (name: string, instructions: string) => void;
}) {
  const t = useTranslations('trades.create.recording.contractEntry.exitPlan.library');
  const id = useId();
  const [attempted, setAttempted] = useState(false);
  const nameError =
    form.name.trim() === ''
      ? t('errors.nameRequired')
      : form.name.length > EXIT_PLAN_NAME_MAX_LENGTH
        ? t('errors.nameTooLong', { max: EXIT_PLAN_NAME_MAX_LENGTH })
        : /[<>]/.test(form.name)
          ? t('errors.invalidCharacters')
          : null;
  const instructionsError =
    form.instructions.trim() === ''
      ? t('errors.instructionsRequired')
      : form.instructions.length > EXIT_PLAN_INSTRUCTIONS_MAX_LENGTH
        ? t('errors.instructionsTooLong', { max: EXIT_PLAN_INSTRUCTIONS_MAX_LENGTH })
        : /[<>]/.test(form.instructions)
          ? t('errors.invalidCharacters')
          : null;
  const instructionsId = `${id}-instructions`;
  const visibleInstructionsError = attempted ? instructionsError : null;

  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-4"
      data-exit-plan-library-form={form.mode}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        /*
          THIS FORM IS RENDERED THROUGH THE OVERLAY'S PORTAL, BUT IT STILL SITS
          INSIDE THE AT ENTRY FORM'S REACT TREE, and React propagates a synthetic
          submit along that tree, not the DOM. Without this, saving a library
          plan also submitted — and saved — the Trade being recorded.
        */
        event.stopPropagation();
        setAttempted(true);
        if (nameError !== null || instructionsError !== null) return;
        onSave(form.name, form.instructions);
      }}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-foreground text-sm font-semibold">
          {form.mode === 'create' ? t('createTitle') : t('editTitle')}
        </h3>
        <p className="text-muted-foreground text-sm">
          {form.mode === 'create' ? t('createHint') : t('editHint')}
        </p>
      </div>
      <TextField
        id={`${id}-name`}
        label={t('name')}
        value={form.name}
        onChange={(name) => onChange({ ...form, name })}
        error={attempted && nameError !== null ? nameError : undefined}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={instructionsId} className="text-foreground text-sm font-medium">
          {t('instructions')}
        </label>
        <textarea
          id={instructionsId}
          value={form.instructions}
          rows={4}
          placeholder={t('instructionsPlaceholder')}
          aria-invalid={visibleInstructionsError !== null}
          aria-describedby={
            visibleInstructionsError === null ? undefined : `${instructionsId}-error`
          }
          onChange={(event) => onChange({ ...form, instructions: event.target.value })}
          className={cn(
            'bg-background text-foreground placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-ring/40 min-h-28 w-full rounded-md border px-3 py-2.5 text-base outline-none focus-visible:ring-[3px]',
            visibleInstructionsError === null ? 'border-control-border' : 'border-destructive',
          )}
        />
        {visibleInstructionsError === null ? null : (
          <FieldError id={`${instructionsId}-error`}>{visibleInstructionsError}</FieldError>
        )}
      </div>
      {serverError === null ? null : <FieldError id={`${id}-server`}>{serverError}</FieldError>}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDiscard}>
          {t('discard')}
        </Button>
      </div>
    </form>
  );
}
