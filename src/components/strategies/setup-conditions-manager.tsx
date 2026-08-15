'use client';

import { CircleAlert, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import { RULE_TITLE_MAX_LENGTH } from '@/lib/strategies/constants';
import { validateChangeNote } from '@/lib/strategies/form-validation';
import {
  createSetupConditionAction,
  removeSetupConditionAction,
  updateSetupConditionAction,
} from '@/server/actions/strategies';
import type { SetupConditionDetail, StrategySetupDetail } from '@/server/dal/strategies';
import { ChangeNoteField, VersionEditNotice } from '@/components/strategies/change-note-field';
import { StrategyField } from '@/components/strategies/field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function SetupConditionsManager({
  strategyId,
  setups,
  conditionsBySetupId,
  isStrategyArchived,
  isCurrentVersionLocked,
  canWrite,
  onMutated,
}: {
  strategyId: string;
  setups: readonly StrategySetupDetail[];
  conditionsBySetupId: Readonly<Record<string, readonly SetupConditionDetail[]>>;
  isStrategyArchived: boolean;
  isCurrentVersionLocked: boolean;
  canWrite: boolean;
  onMutated: (key: string) => void;
}) {
  const t = useTranslations('strategies');
  return (
    <section className="flex flex-col gap-5" aria-labelledby="setup-conditions-heading">
      <div>
        <h2 id="setup-conditions-heading" className="text-section-title">
          {t('setupConditionsHeading')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          {t('setupConditionsDescription')}
        </p>
      </div>

      {setups.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('setupConditionsNeedSetup')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {setups.map((setup) => {
            const conditions = conditionsBySetupId[setup.setupId] ?? [];
            const canManage = canWrite && !isStrategyArchived && !setup.isSetupArchived;
            return (
              <div key={setup.setupId} className="border-border rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{setup.name}</h3>
                    <p className="text-muted-foreground text-xs">
                      {t('conditionCountLabel', { count: conditions.length })}
                    </p>
                  </div>
                  {canManage ? (
                    <ConditionFormDialog
                      mode="create"
                      strategyId={strategyId}
                      setupId={setup.setupId}
                      isCurrentVersionLocked={isCurrentVersionLocked}
                      defaultSortOrder={conditions.length}
                      trigger={
                        <Button size="sm" variant="outline" className="min-h-11 gap-1.5">
                          <Plus className="size-4" aria-hidden="true" />
                          {t('addCondition')}
                        </Button>
                      }
                      onSuccess={() => onMutated('conditionCreated')}
                    />
                  ) : null}
                </div>

                {conditions.length === 0 ? (
                  <p className="text-muted-foreground mt-4 text-sm">{t('noSetupConditions')}</p>
                ) : (
                  <ol className="mt-4 flex flex-col gap-2">
                    {conditions.map((condition, index) => (
                      <li
                        key={condition.conditionKey}
                        className="border-border bg-muted/20 flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2"
                      >
                        <span className="text-muted-foreground w-6 shrink-0 text-sm">
                          {index + 1}.
                        </span>
                        <span className="min-w-0 flex-1 text-sm break-words">
                          {condition.label}
                        </span>
                        {canManage ? (
                          <div className="flex shrink-0 gap-1">
                            <ConditionFormDialog
                              mode="edit"
                              strategyId={strategyId}
                              setupId={setup.setupId}
                              condition={condition}
                              isCurrentVersionLocked={isCurrentVersionLocked}
                              trigger={
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t('editConditionAria', { label: condition.label })}
                                >
                                  <Pencil className="size-4" aria-hidden="true" />
                                </Button>
                              }
                              onSuccess={() => onMutated('conditionUpdated')}
                            />
                            <RemoveConditionButton
                              strategyId={strategyId}
                              setupId={setup.setupId}
                              condition={condition}
                              isCurrentVersionLocked={isCurrentVersionLocked}
                              onSuccess={() => onMutated('conditionRemoved')}
                            />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type ConditionFormProps =
  | {
      readonly mode: 'create';
      readonly strategyId: string;
      readonly setupId: string;
      readonly isCurrentVersionLocked: boolean;
      readonly defaultSortOrder: number;
      readonly trigger: ReactNode;
      readonly onSuccess: () => void;
    }
  | {
      readonly mode: 'edit';
      readonly strategyId: string;
      readonly setupId: string;
      readonly isCurrentVersionLocked: boolean;
      readonly condition: SetupConditionDetail;
      readonly trigger: ReactNode;
      readonly onSuccess: () => void;
    };

function ConditionFormDialog(props: ConditionFormProps) {
  const t = useTranslations('strategies');
  const common = useTranslations('common');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'create' ? t('createConditionTitle') : t('editConditionTitle')}
          </DialogTitle>
          <DialogDescription>{t('conditionFormDescription')}</DialogDescription>
        </DialogHeader>
        <ConditionFormBody
          {...props}
          onDone={() => {
            setOpen(false);
            props.onSuccess();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConditionFormBody(props: ConditionFormProps & { readonly onDone: () => void }) {
  const t = useTranslations('strategies');
  const [label, setLabel] = useState(props.mode === 'edit' ? props.condition.label : '');
  const [sortOrder, setSortOrder] = useState(
    String(props.mode === 'edit' ? props.condition.sortOrder : props.defaultSortOrder),
  );
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = label.trim();
    const parsedOrder = /^\d+$/.test(sortOrder.trim()) ? Number(sortOrder) : -1;
    const changeNoteError = props.isCurrentVersionLocked
      ? validateChangeNote(changeNote)
      : undefined;
    if (
      normalized.length === 0 ||
      normalized.length > RULE_TITLE_MAX_LENGTH ||
      !Number.isSafeInteger(parsedOrder) ||
      parsedOrder < 0 ||
      changeNoteError !== undefined
    ) {
      setError('validation_error');
      return;
    }
    setPending(true);
    const input = {
      strategyId: props.strategyId,
      setupId: props.setupId,
      label: normalized,
      sortOrder: parsedOrder,
      ...(props.isCurrentVersionLocked ? { changeNote: changeNote.trim() } : {}),
    };
    const result =
      props.mode === 'create'
        ? await createSetupConditionAction(input)
        : await updateSetupConditionAction({
            ...input,
            conditionKey: props.condition.conditionKey,
          });
    setPending(false);
    if (!result.ok) {
      setError(result.error.code);
      return;
    }
    props.onDone();
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <StrategyField id="condition-label" label={t('conditionLabel')}>
        <Input
          id="condition-label"
          value={label}
          maxLength={RULE_TITLE_MAX_LENGTH}
          onChange={(event) => setLabel(event.target.value)}
          required
        />
      </StrategyField>
      <StrategyField id="condition-sort-order" label={t('sortOrderLabel')}>
        <Input
          id="condition-sort-order"
          inputMode="numeric"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value)}
          required
        />
      </StrategyField>
      <VersionEditNotice isLocked={props.isCurrentVersionLocked} />
      {props.isCurrentVersionLocked ? (
        <ChangeNoteField id="condition-change-note" value={changeNote} onChange={setChangeNote} />
      ) : null}
      {error === null ? null : (
        <div className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-4">
          <CircleAlert className="text-destructive size-5 shrink-0" aria-hidden="true" />
          <p className="text-sm">{t(`errors.${error}` as Parameters<typeof t>[0])}</p>
        </div>
      )}
      <DialogFooter>
        <Button type="submit" disabled={pending} className="min-h-11">
          {props.mode === 'create' ? t('create') : t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RemoveConditionButton({
  strategyId,
  setupId,
  condition,
  isCurrentVersionLocked,
  onSuccess,
}: {
  strategyId: string;
  setupId: string;
  condition: SetupConditionDetail;
  isCurrentVersionLocked: boolean;
  onSuccess: () => void;
}) {
  const t = useTranslations('strategies');
  const [open, setOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [pending, setPending] = useState(false);
  async function remove() {
    if (isCurrentVersionLocked && validateChangeNote(changeNote) !== undefined) return;
    setPending(true);
    const result = await removeSetupConditionAction({
      strategyId,
      setupId,
      conditionKey: condition.conditionKey,
      ...(isCurrentVersionLocked ? { changeNote: changeNote.trim() } : {}),
    });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      onSuccess();
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('removeConditionAria', { label: condition.label })}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('removeConditionTitle', { label: condition.label })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('removeConditionDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        {isCurrentVersionLocked ? (
          <ChangeNoteField
            id="remove-condition-change-note"
            value={changeNote}
            onChange={setChangeNote}
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => void remove()}>
            {t('removeConditionConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
