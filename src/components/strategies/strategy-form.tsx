'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import {
  validateChangeNote,
  validateStrategyContentFields,
  type StrategyContentFormErrors,
} from '@/lib/strategies/form-validation';
import {
  createStrategyAction,
  updateStrategyAction,
  type CreateStrategyData,
  type UpdateStrategyData,
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

interface StrategyContentValues {
  readonly name: string;
  readonly description: string;
  readonly notes: string;
}

const BLANK_VALUES: StrategyContentValues = { name: '', description: '', notes: '' };

type StrategyFormDialogProps =
  | {
      readonly mode: 'create';
      readonly trigger: ReactNode;
      readonly onSuccess: (data: CreateStrategyData) => void;
    }
  | {
      readonly mode: 'edit';
      readonly trigger: ReactNode;
      readonly strategyId: string;
      readonly initialValues: StrategyContentValues;
      readonly isCurrentVersionLocked: boolean;
      readonly onSuccess: (data: UpdateStrategyData) => void;
    };

/**
 * Create/edit Strategy content — one Dialog, two modes, matching
 * `TradingAccountForm`'s "one shared form" precedent. The Dialog's content
 * subtree unmounts on close (Radix does not render it while `open` is
 * false), which is what resets `mutationKey`/field state on the next open —
 * the same "new key only after an explicit new attempt" rule
 * `TradingAccountForm`'s per-mount `useState(() => crypto.randomUUID())`
 * relies on.
 */
export function StrategyFormDialog(props: StrategyFormDialogProps) {
  const t = useTranslations('strategies');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'create' ? t('createStrategyTitle') : t('editStrategyTitle')}
          </DialogTitle>
          <DialogDescription>
            {props.mode === 'create'
              ? t('createStrategyDescription')
              : t('editStrategyDescription')}
          </DialogDescription>
        </DialogHeader>
        <StrategyFormBody
          {...props}
          onDone={(data) => {
            setOpen(false);
            // TypeScript can't narrow `props.onSuccess`'s parameter type across
            // the union from inside this callback; the mode check just above
            // (via `props.mode`) is what actually keeps `data` correct at the
            // call site below.
            if (props.mode === 'create') {
              props.onSuccess(data as CreateStrategyData);
            } else {
              props.onSuccess(data as UpdateStrategyData);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function StrategyFormBody(
  props: StrategyFormDialogProps & {
    onDone: (data: CreateStrategyData | UpdateStrategyData) => void;
  },
) {
  const t = useTranslations('strategies');
  const [values, setValues] = useState<StrategyContentValues>(
    props.mode === 'edit' ? props.initialValues : BLANK_VALUES,
  );
  const [changeNote, setChangeNote] = useState('');
  const [errors, setErrors] = useState<StrategyContentFormErrors>({});
  const [changeNoteError, setChangeNoteError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'pending'>('idle');
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  const [mutationKey] = useState<string>(() => crypto.randomUUID());
  const isLocked = props.mode === 'edit' && props.isCurrentVersionLocked;

  function setField<K extends keyof StrategyContentValues>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'pending') return;

    const fieldErrors = validateStrategyContentFields(values);
    const changeNoteFieldError = isLocked ? validateChangeNote(changeNote) : undefined;
    setErrors(fieldErrors);
    setChangeNoteError(
      changeNoteFieldError === undefined ? undefined : t(`fieldErrors.${changeNoteFieldError}`),
    );
    if (Object.keys(fieldErrors).length > 0 || changeNoteFieldError !== undefined) {
      return;
    }

    setStatus('pending');
    setSubmitErrorCode(null);

    const result =
      props.mode === 'create'
        ? await createStrategyAction({
            mutationKey,
            name: values.name.trim(),
            description: values.description.trim() === '' ? undefined : values.description.trim(),
            notes: values.notes.trim() === '' ? undefined : values.notes.trim(),
          })
        : await updateStrategyAction({
            strategyId: props.strategyId,
            name: values.name.trim(),
            description: values.description.trim() === '' ? undefined : values.description.trim(),
            notes: values.notes.trim() === '' ? undefined : values.notes.trim(),
            changeNote: isLocked ? changeNote.trim() : undefined,
          });

    if (!result.ok) {
      setStatus('idle');
      if (result.error.code === 'validation_error' && result.error.fieldErrors !== undefined) {
        // Server-side Zod field errors are a defensive fallback only (the
        // client check above already covers the same rules) — mapped to a
        // generic message rather than echoing Zod's raw text.
        const nextErrors: StrategyContentFormErrors = {};
        for (const key of Object.keys(result.error.fieldErrors)) {
          if (key === 'name' || key === 'description' || key === 'notes') {
            nextErrors[key] = 'invalidCharacters';
          }
        }
        setErrors(nextErrors);
      }
      setSubmitErrorCode(result.error.code);
      return;
    }

    setStatus('idle');
    props.onDone(result.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <StrategyField
        id="strategy-name"
        label={t('nameLabel')}
        error={errors.name === undefined ? undefined : t(`fieldErrors.${errors.name}`)}
      >
        <Input
          id="strategy-name"
          value={values.name}
          onChange={(event) => setField('name', event.target.value)}
          aria-invalid={errors.name !== undefined}
          aria-describedby={errors.name === undefined ? undefined : 'strategy-name-error'}
          required
        />
      </StrategyField>

      <StrategyField
        id="strategy-description"
        label={t('descriptionLabel')}
        optional
        error={
          errors.description === undefined ? undefined : t(`fieldErrors.${errors.description}`)
        }
      >
        <Textarea
          id="strategy-description"
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
          aria-invalid={errors.description !== undefined}
          aria-describedby={
            errors.description === undefined ? undefined : 'strategy-description-error'
          }
        />
      </StrategyField>

      <StrategyField
        id="strategy-notes"
        label={t('notesLabel')}
        optional
        error={errors.notes === undefined ? undefined : t(`fieldErrors.${errors.notes}`)}
      >
        <Textarea
          id="strategy-notes"
          value={values.notes}
          onChange={(event) => setField('notes', event.target.value)}
          aria-invalid={errors.notes !== undefined}
          aria-describedby={errors.notes === undefined ? undefined : 'strategy-notes-error'}
        />
      </StrategyField>

      {props.mode === 'edit' ? (
        <>
          <VersionEditNotice isLocked={isLocked} />
          {isLocked ? (
            <ChangeNoteField
              id="strategy-change-note"
              value={changeNote}
              onChange={setChangeNote}
              error={changeNoteError}
            />
          ) : null}
        </>
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
