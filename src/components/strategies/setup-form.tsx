'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import {
  validateChangeNote,
  validateSetupContentFields,
  type SetupContentFormErrors,
} from '@/lib/strategies/form-validation';
import {
  createSetupAction,
  updateSetupAction,
  type CreateSetupData,
  type UpdateSetupData,
} from '@/server/actions/strategies';
import { ChangeNoteField, VersionEditNotice } from '@/components/strategies/change-note-field';
import { StrategyField } from '@/components/strategies/field';
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
import { Textarea } from '@/components/ui/textarea';

interface SetupContentValues {
  readonly name: string;
  readonly description: string;
  readonly sortOrder: string;
}

type SetupFormDialogProps =
  | {
      readonly mode: 'create';
      readonly trigger: ReactNode;
      readonly strategyId: string;
      readonly isCurrentVersionLocked: boolean;
      readonly defaultSortOrder: number;
      readonly onSuccess: (data: CreateSetupData) => void;
    }
  | {
      readonly mode: 'edit';
      readonly trigger: ReactNode;
      readonly strategyId: string;
      readonly setupId: string;
      readonly initialValues: SetupContentValues;
      readonly isCurrentVersionLocked: boolean;
      readonly onSuccess: (data: UpdateSetupData) => void;
    };

/** Create/edit a Setup — same Dialog-remount-resets-state posture as `StrategyFormDialog`. */
export function SetupFormDialog(props: SetupFormDialogProps) {
  const t = useTranslations('strategies');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'create' ? t('createSetupTitle') : t('editSetupTitle')}
          </DialogTitle>
          <DialogDescription>
            {props.mode === 'create' ? t('createSetupDescription') : t('editSetupDescription')}
          </DialogDescription>
        </DialogHeader>
        <SetupFormBody
          {...props}
          onDone={(data) => {
            setOpen(false);
            if (props.mode === 'create') {
              props.onSuccess(data as CreateSetupData);
            } else {
              props.onSuccess(data as UpdateSetupData);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SetupFormBody(
  props: SetupFormDialogProps & { onDone: (data: CreateSetupData | UpdateSetupData) => void },
) {
  const t = useTranslations('strategies');
  const [values, setValues] = useState<SetupContentValues>(
    props.mode === 'edit'
      ? props.initialValues
      : { name: '', description: '', sortOrder: String(props.defaultSortOrder) },
  );
  const [changeNote, setChangeNote] = useState('');
  const [errors, setErrors] = useState<SetupContentFormErrors>({});
  const [sortOrderError, setSortOrderError] = useState<string | undefined>(undefined);
  const [changeNoteError, setChangeNoteError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'pending'>('idle');
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  const [mutationKey] = useState<string>(() => crypto.randomUUID());
  const isLocked = props.isCurrentVersionLocked;

  function setField<K extends keyof SetupContentValues>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function parseSortOrder(): number | undefined {
    const trimmed = values.sortOrder.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    return Number(trimmed);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'pending') return;

    const fieldErrors = validateSetupContentFields(values);
    const sortOrder = parseSortOrder();
    const sortOrderInvalid = sortOrder === undefined ? 'invalidNumber' : undefined;
    const changeNoteFieldError = isLocked ? validateChangeNote(changeNote) : undefined;
    setErrors(fieldErrors);
    setSortOrderError(
      sortOrderInvalid === undefined ? undefined : t(`fieldErrors.${sortOrderInvalid}`),
    );
    setChangeNoteError(
      changeNoteFieldError === undefined ? undefined : t(`fieldErrors.${changeNoteFieldError}`),
    );
    if (
      Object.keys(fieldErrors).length > 0 ||
      sortOrder === undefined ||
      changeNoteFieldError !== undefined
    ) {
      return;
    }

    setStatus('pending');
    setSubmitErrorCode(null);

    const result =
      props.mode === 'create'
        ? await createSetupAction({
            strategyId: props.strategyId,
            mutationKey,
            name: values.name.trim(),
            description: values.description.trim() === '' ? undefined : values.description.trim(),
            sortOrder,
            changeNote: isLocked ? changeNote.trim() : undefined,
          })
        : await updateSetupAction({
            strategyId: props.strategyId,
            setupId: props.setupId,
            name: values.name.trim(),
            description: values.description.trim() === '' ? undefined : values.description.trim(),
            sortOrder,
            changeNote: isLocked ? changeNote.trim() : undefined,
          });

    if (!result.ok) {
      setStatus('idle');
      setSubmitErrorCode(result.error.code);
      return;
    }

    setStatus('idle');
    props.onDone(result.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <StrategyField
        id="setup-name"
        label={t('nameLabel')}
        error={errors.name === undefined ? undefined : t(`fieldErrors.${errors.name}`)}
      >
        <Input
          id="setup-name"
          value={values.name}
          onChange={(event) => setField('name', event.target.value)}
          aria-invalid={errors.name !== undefined}
          required
        />
      </StrategyField>

      <StrategyField
        id="setup-description"
        label={t('descriptionLabel')}
        optional
        error={
          errors.description === undefined ? undefined : t(`fieldErrors.${errors.description}`)
        }
      >
        <Textarea
          id="setup-description"
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
          aria-invalid={errors.description !== undefined}
        />
      </StrategyField>

      <StrategyField id="setup-sort-order" label={t('sortOrderLabel')} error={sortOrderError}>
        <Input
          id="setup-sort-order"
          inputMode="numeric"
          value={values.sortOrder}
          onChange={(event) => setField('sortOrder', event.target.value)}
          aria-invalid={sortOrderError !== undefined}
        />
      </StrategyField>

      <VersionEditNotice isLocked={isLocked} />
      {isLocked ? (
        <ChangeNoteField
          id="setup-change-note"
          value={changeNote}
          onChange={setChangeNote}
          error={changeNoteError}
        />
      ) : null}

      <div aria-live="polite" role="status">
        {submitErrorCode !== null ? (
          <div className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-4">
            <CircleAlert className="text-destructive size-5 shrink-0" aria-hidden="true" />
            <p className="text-foreground text-sm leading-relaxed">
              {t(`errors.${submitErrorCode}` as Parameters<typeof t>[0])}
            </p>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="submit" disabled={status === 'pending'} className="min-h-11">
          {props.mode === 'create' ? t('create') : t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
