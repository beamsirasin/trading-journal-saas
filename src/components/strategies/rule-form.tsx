'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import { STRATEGY_RULE_CATEGORIES, type StrategyRuleCategory } from '@/lib/strategies/constants';
import {
  validateChangeNote,
  validateRuleFields,
  type RuleFormErrors,
} from '@/lib/strategies/form-validation';
import {
  createStrategyRuleAction,
  updateStrategyRuleAction,
  type CreateStrategyRuleData,
  type UpdateStrategyRuleData,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface RuleScopeOption {
  readonly setupId: string;
  readonly name: string;
}

interface RuleValues {
  readonly setupId: string; // '' means Strategy-level
  readonly category: StrategyRuleCategory;
  readonly title: string;
  readonly description: string;
  readonly isRequired: boolean;
  readonly sortOrder: string;
}

type RuleFormDialogProps =
  | {
      readonly mode: 'create';
      readonly trigger: ReactNode;
      readonly strategyId: string;
      readonly isCurrentVersionLocked: boolean;
      readonly availableSetups: readonly RuleScopeOption[];
      readonly defaultSetupId: string | null;
      readonly defaultSortOrder: number;
      readonly onSuccess: (data: CreateStrategyRuleData) => void;
    }
  | {
      readonly mode: 'edit';
      readonly trigger: ReactNode;
      readonly strategyId: string;
      readonly ruleKey: string;
      readonly scopeLabel: string;
      readonly initialValues: Omit<RuleValues, 'setupId'>;
      readonly isCurrentVersionLocked: boolean;
      readonly onSuccess: (data: UpdateStrategyRuleData) => void;
    };

/**
 * Create/edit a Rule. Scope (Strategy-level vs. one Setup) is choosable only
 * on create — `updateStrategyRule` resolves scope from the stored Rule row
 * via `ruleKey` and never moves a Rule between scopes, so Edit shows the
 * existing scope as read-only text instead of a control that would silently
 * do nothing.
 */
export function RuleFormDialog(props: RuleFormDialogProps) {
  const t = useTranslations('strategies');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'create' ? t('createRuleTitle') : t('editRuleTitle')}
          </DialogTitle>
          <DialogDescription>
            {props.mode === 'create' ? t('createRuleDescription') : t('editRuleDescription')}
          </DialogDescription>
        </DialogHeader>
        <RuleFormBody
          {...props}
          onDone={(data) => {
            setOpen(false);
            if (props.mode === 'create') {
              props.onSuccess(data as CreateStrategyRuleData);
            } else {
              props.onSuccess(data as UpdateStrategyRuleData);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RuleFormBody(
  props: RuleFormDialogProps & {
    onDone: (data: CreateStrategyRuleData | UpdateStrategyRuleData) => void;
  },
) {
  const t = useTranslations('strategies');
  const [values, setValues] = useState<RuleValues>(
    props.mode === 'edit'
      ? { ...props.initialValues, setupId: '' }
      : {
          setupId: props.defaultSetupId ?? '',
          category: 'entry',
          title: '',
          description: '',
          isRequired: true,
          sortOrder: String(props.defaultSortOrder),
        },
  );
  const [changeNote, setChangeNote] = useState('');
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [sortOrderError, setSortOrderError] = useState<string | undefined>(undefined);
  const [changeNoteError, setChangeNoteError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'pending'>('idle');
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  // Stable across a retry within this open dialog; a new key only appears
  // once the dialog remounts (close, then reopen for a new attempt).
  const [ruleKey] = useState<string>(() =>
    props.mode === 'create' ? crypto.randomUUID() : props.ruleKey,
  );
  const isLocked = props.isCurrentVersionLocked;

  function setField<K extends keyof RuleValues>(field: K, value: RuleValues[K]) {
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

    const fieldErrors = validateRuleFields(values);
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
        ? await createStrategyRuleAction({
            strategyId: props.strategyId,
            ...(values.setupId === '' ? {} : { setupId: values.setupId }),
            ruleKey,
            category: values.category,
            title: values.title.trim(),
            description: values.description.trim() === '' ? undefined : values.description.trim(),
            isRequired: values.isRequired,
            sortOrder,
            changeNote: isLocked ? changeNote.trim() : undefined,
          })
        : await updateStrategyRuleAction({
            strategyId: props.strategyId,
            ruleKey,
            category: values.category,
            title: values.title.trim(),
            description: values.description.trim() === '' ? undefined : values.description.trim(),
            isRequired: values.isRequired,
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
      {props.mode === 'create' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-scope">{t('scopeLabel')}</Label>
          <select
            id="rule-scope"
            value={values.setupId}
            onChange={(event) => setField('setupId', event.target.value)}
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-11 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
          >
            <option value="">{t('scopeStrategyLevel')}</option>
            {props.availableSetups.map((setup) => (
              <option key={setup.setupId} value={setup.setupId}>
                {setup.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label>{t('scopeLabel')}</Label>
          <p className="text-foreground text-sm">{props.scopeLabel}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-category">{t('categoryLabel')}</Label>
        <select
          id="rule-category"
          value={values.category}
          onChange={(event) => setField('category', event.target.value as StrategyRuleCategory)}
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-11 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
        >
          {STRATEGY_RULE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`ruleCategories.${category}`)}
            </option>
          ))}
        </select>
      </div>

      <StrategyField
        id="rule-title"
        label={t('ruleTitleLabel')}
        error={errors.title === undefined ? undefined : t(`fieldErrors.${errors.title}`)}
      >
        <Input
          id="rule-title"
          value={values.title}
          onChange={(event) => setField('title', event.target.value)}
          aria-invalid={errors.title !== undefined}
          required
        />
      </StrategyField>

      <StrategyField
        id="rule-description"
        label={t('descriptionLabel')}
        optional
        error={
          errors.description === undefined ? undefined : t(`fieldErrors.${errors.description}`)
        }
      >
        <Textarea
          id="rule-description"
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
          aria-invalid={errors.description !== undefined}
        />
      </StrategyField>

      <label
        htmlFor="rule-is-required"
        className="border-border bg-muted/30 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 text-sm"
      >
        <input
          id="rule-is-required"
          type="checkbox"
          checked={values.isRequired}
          onChange={(event) => setField('isRequired', event.target.checked)}
          className="border-input size-4 rounded"
        />
        <span className="text-foreground font-medium">{t('isRequiredLabel')}</span>
      </label>

      <StrategyField id="rule-sort-order" label={t('sortOrderLabel')} error={sortOrderError}>
        <Input
          id="rule-sort-order"
          inputMode="numeric"
          value={values.sortOrder}
          onChange={(event) => setField('sortOrder', event.target.value)}
          aria-invalid={sortOrderError !== undefined}
        />
      </StrategyField>

      <VersionEditNotice isLocked={isLocked} />
      {isLocked ? (
        <ChangeNoteField
          id="rule-change-note"
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
