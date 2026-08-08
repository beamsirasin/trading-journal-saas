'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { generateId } from '@/lib/identifiers';
import { isValidTradingViewUrl } from '@/lib/trades/validation';
import { createTradeAction } from '@/server/actions/trades';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';

type Stage = 0 | 1 | 2 | 3;
type Direction = '' | 'long' | 'short';
type ErrorMap = Record<string, string>;

interface Values {
  tradingAccountId: string;
  strategyId: string;
  setupId: string;
  symbol: string;
  direction: Direction;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget: string;
  plannedPositionSize: string;
  timeframe: string;
  session: string;
  confidence: string;
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
}

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

function confidenceValue(value: string): 1 | 2 | 3 | 4 | 5 | undefined {
  if (value === '1') return 1;
  if (value === '2') return 2;
  if (value === '3') return 3;
  if (value === '4') return 4;
  if (value === '5') return 5;
  return undefined;
}

function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] ${className}`}
      {...props}
    />
  );
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  const t = useTranslations('trades');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="text-muted-foreground font-normal"> {t('common.optional')}</span>
        ) : null}
      </Label>
      {children}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export function TradeCreateForm({ options }: { options: TradeCreateOptions }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [mutationKey] = useState(generateId);
  const [stage, setStage] = useState<Stage>(0);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const initialAccount =
    options.tradingAccounts.length === 1
      ? (options.tradingAccounts[0]?.tradingAccountId ?? '')
      : '';
  const [values, setValues] = useState<Values>({
    tradingAccountId: initialAccount,
    strategyId: '',
    setupId: '',
    symbol: '',
    direction: '',
    plannedEntry: '',
    plannedStop: '',
    plannedTarget: '',
    plannedPositionSize: '',
    timeframe: '',
    session: '',
    confidence: '',
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
  });
  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const selectedStrategy = options.strategies.find((item) => item.strategyId === values.strategyId);
  const selectedSetup = selectedStrategy?.setups.find((item) => item.setupId === values.setupId);

  function setField<K extends keyof Values>(field: K, value: Values[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  }

  function handleStrategyChange(strategyId: string) {
    const strategy = options.strategies.find((item) => item.strategyId === strategyId);
    setValues((current) => ({
      ...current,
      strategyId,
      setupId: strategy?.setups.length === 1 ? (strategy.setups[0]?.setupId ?? '') : '',
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.strategyId;
      delete next.setupId;
      return next;
    });
    setFormError(null);
  }

  function validateStage(target: Stage): boolean {
    const next: ErrorMap = {};
    if (target >= 0 && values.tradingAccountId === '')
      next.tradingAccountId = t('validation.requiredAccount');
    if (target >= 1) {
      if (values.strategyId === '') next.strategyId = t('validation.requiredStrategy');
      if (values.setupId === '') next.setupId = t('validation.requiredSetup');
    }
    if (target >= 2) {
      if (values.symbol.trim() === '') next.symbol = t('validation.requiredSymbol');
      if (values.direction === '') next.direction = t('validation.requiredDirection');
      for (const field of ['plannedEntry', 'plannedStop'] as const) {
        if (values[field].trim() === '')
          next[field] = t(
            `validation.${field === 'plannedEntry' ? 'requiredEntry' : 'requiredStop'}`,
          );
        else if (!DECIMAL_PATTERN.test(values[field].trim()))
          next[field] = t('validation.invalidDecimal');
      }
      for (const field of ['plannedTarget', 'plannedPositionSize'] as const) {
        if (values[field].trim() !== '' && !DECIMAL_PATTERN.test(values[field].trim()))
          next[field] = t('validation.invalidDecimal');
      }
      if (
        values.tradingviewUrl.trim() !== '' &&
        !isValidTradingViewUrl(values.tradingviewUrl.trim())
      ) {
        next.tradingviewUrl = t('validation.invalidTradingViewUrl');
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStage(stage)) return;
    setStage((stage + 1) as Stage);
  }

  function fieldError(field: keyof Values): string | undefined {
    return errors[field];
  }

  async function submit() {
    if (!validateStage(2) || values.direction === '') {
      setStage(2);
      return;
    }
    setIsPending(true);
    setFormError(null);
    const confidence = confidenceValue(values.confidence);
    const result = await createTradeAction({
      mutationKey,
      tradingAccountId: values.tradingAccountId,
      strategyId: values.strategyId,
      setupId: values.setupId,
      symbol: values.symbol,
      direction: values.direction,
      plannedEntry: values.plannedEntry,
      plannedStop: values.plannedStop,
      plannedTarget: values.plannedTarget.trim() === '' ? null : values.plannedTarget,
      plannedPositionSize:
        values.plannedPositionSize.trim() === '' ? null : values.plannedPositionSize,
      timeframe: values.timeframe,
      session: values.session,
      ...(confidence === undefined ? {} : { confidence }),
      confirmationNotes: values.confirmationNotes,
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
    });
    setIsPending(false);
    if (result.ok) {
      router.push(`/app/trades?trade=${result.data.tradeId}`);
      return;
    }
    const mapped: ErrorMap = {};
    for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      const message = messages[0];
      mapped[field] =
        message === undefined
          ? t('validation.invalidField')
          : translateServerFieldError(message, t);
    }
    setErrors(mapped);
    setFormError(t(`errors.${result.error.code}`));
    if (Object.keys(mapped).some((field) => ['tradingAccountId'].includes(field))) setStage(0);
    else if (Object.keys(mapped).some((field) => ['strategyId', 'setupId'].includes(field)))
      setStage(1);
    else if (Object.keys(mapped).length > 0) setStage(2);
  }

  const stepLabels = [
    t('create.steps.account'),
    t('create.steps.strategy'),
    t('create.steps.plan'),
    t('create.steps.review'),
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('create.progress')}>
        {stepLabels.map((label, index) => (
          <li
            key={label}
            aria-current={stage === index ? 'step' : undefined}
            className={`min-h-11 rounded-md border px-3 py-2 text-sm ${stage === index ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'}`}
          >
            <span className="mr-1 font-semibold">{index + 1}.</span>
            {label}
          </li>
        ))}
      </ol>

      <div
        role="status"
        aria-live="polite"
        className={
          formError === null
            ? 'sr-only'
            : 'border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm'
        }
      >
        {formError ?? t('create.ready')}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (stage === 3) void submit();
          else goNext();
        }}
        className="border-border bg-card rounded-lg border p-4 sm:p-6"
      >
        {stage === 0 ? (
          <fieldset className="grid gap-5">
            <legend className="text-card-title mb-2">{t('create.accountTitle')}</legend>
            <p className="text-muted-foreground text-sm">{t('create.accountDescription')}</p>
            <Field
              id="trade-account"
              label={t('field.account')}
              error={fieldError('tradingAccountId')}
            >
              <Select
                id="trade-account"
                value={values.tradingAccountId}
                onChange={(event) => setField('tradingAccountId', event.target.value)}
                aria-invalid={fieldError('tradingAccountId') !== undefined}
                aria-describedby={
                  fieldError('tradingAccountId') === undefined ? undefined : 'trade-account-error'
                }
              >
                <option value="">{t('create.chooseAccount')}</option>
                {options.tradingAccounts.map((account) => (
                  <option key={account.tradingAccountId} value={account.tradingAccountId}>
                    {account.name} · {account.baseCurrency}
                  </option>
                ))}
              </Select>
            </Field>
          </fieldset>
        ) : null}

        {stage === 1 ? (
          <fieldset className="grid gap-5">
            <legend className="text-card-title mb-2">{t('create.strategyTitle')}</legend>
            <p className="text-muted-foreground text-sm">{t('create.strategyDescription')}</p>
            <Field id="trade-strategy" label={t('field.strategy')} error={fieldError('strategyId')}>
              <Select
                id="trade-strategy"
                value={values.strategyId}
                onChange={(event) => handleStrategyChange(event.target.value)}
                aria-invalid={fieldError('strategyId') !== undefined}
                aria-describedby={
                  fieldError('strategyId') === undefined ? undefined : 'trade-strategy-error'
                }
              >
                <option value="">{t('create.chooseStrategy')}</option>
                {options.strategies.map((strategy) => (
                  <option key={strategy.strategyId} value={strategy.strategyId}>
                    {strategy.name} ·{' '}
                    {t('common.version', { number: strategy.currentVersionNumber })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="trade-setup" label={t('field.setup')} error={fieldError('setupId')}>
              <Select
                id="trade-setup"
                value={values.setupId}
                disabled={selectedStrategy === undefined}
                onChange={(event) => setField('setupId', event.target.value)}
                aria-invalid={fieldError('setupId') !== undefined}
                aria-describedby={
                  fieldError('setupId') === undefined ? undefined : 'trade-setup-error'
                }
              >
                <option value="">{t('create.chooseSetup')}</option>
                {(selectedStrategy?.setups ?? []).map((setup) => (
                  <option key={setup.setupId} value={setup.setupId}>
                    {setup.name}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedStrategy !== undefined && selectedStrategy.setups.length === 0 ? (
              <p className="border-warning/30 bg-warning/10 rounded-md border p-3 text-sm">
                {t('prerequisite.noSetupDescription')}{' '}
                <Link
                  href={`/app/strategies?strategy=${selectedStrategy.strategyId}`}
                  className="text-primary inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
                >
                  {t('prerequisite.manageStrategies')}
                </Link>
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {stage === 2 ? (
          <fieldset className="grid gap-5">
            <legend className="text-card-title mb-2">{t('create.planTitle')}</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="trade-symbol" label={t('field.symbol')} error={fieldError('symbol')}>
                <Input
                  id="trade-symbol"
                  value={values.symbol}
                  onChange={(event) => setField('symbol', event.target.value.toUpperCase())}
                  autoComplete="off"
                  aria-invalid={fieldError('symbol') !== undefined}
                  aria-describedby={
                    fieldError('symbol') === undefined ? undefined : 'trade-symbol-error'
                  }
                />
              </Field>
              <fieldset
                className="flex flex-col gap-2"
                aria-invalid={fieldError('direction') !== undefined}
                aria-describedby={
                  fieldError('direction') === undefined ? undefined : 'trade-direction-error'
                }
              >
                <legend className="text-sm font-medium">{t('field.direction')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['long', 'short'] as const).map((direction) => (
                    <Button
                      key={direction}
                      type="button"
                      variant={values.direction === direction ? 'default' : 'outline'}
                      aria-pressed={values.direction === direction}
                      onClick={() => setField('direction', direction)}
                    >
                      {t(`direction.${direction}`)}
                    </Button>
                  ))}
                </div>
                {fieldError('direction') === undefined ? null : (
                  <p id="trade-direction-error" role="alert" className="text-destructive text-xs">
                    {fieldError('direction')}
                  </p>
                )}
              </fieldset>
              <DecimalField
                id="trade-entry"
                field="plannedEntry"
                label={t('field.entry')}
                values={values}
                setField={setField}
                error={fieldError('plannedEntry')}
              />
              <DecimalField
                id="trade-stop"
                field="plannedStop"
                label={t('field.stop')}
                values={values}
                setField={setField}
                error={fieldError('plannedStop')}
              />
              <DecimalField
                id="trade-target"
                field="plannedTarget"
                label={t('field.target')}
                values={values}
                setField={setField}
                error={fieldError('plannedTarget')}
                optional
              />
              <DecimalField
                id="trade-position-size"
                field="plannedPositionSize"
                label={t('field.positionSize')}
                values={values}
                setField={setField}
                error={fieldError('plannedPositionSize')}
                optional
              />
              <TextField
                id="trade-timeframe"
                field="timeframe"
                label={t('field.timeframe')}
                values={values}
                setField={setField}
                optional
              />
              <TextField
                id="trade-session"
                field="session"
                label={t('field.session')}
                values={values}
                setField={setField}
                optional
              />
              <Field id="trade-confidence" label={t('field.confidence')} optional>
                <Select
                  id="trade-confidence"
                  value={values.confidence}
                  onChange={(event) => setField('confidence', event.target.value)}
                >
                  <option value="">{t('common.notSet')}</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={String(value)}>
                      {value}/5
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="trade-tv"
                label={t('field.tradingViewUrl')}
                optional
                error={fieldError('tradingviewUrl')}
              >
                <Input
                  id="trade-tv"
                  type="url"
                  value={values.tradingviewUrl}
                  onChange={(event) => setField('tradingviewUrl', event.target.value)}
                  aria-invalid={fieldError('tradingviewUrl') !== undefined}
                  aria-describedby={
                    fieldError('tradingviewUrl') === undefined ? undefined : 'trade-tv-error'
                  }
                />
              </Field>
            </div>
            <Field id="trade-confirmation" label={t('field.confirmationNotes')} optional>
              <Textarea
                id="trade-confirmation"
                value={values.confirmationNotes}
                onChange={(event) => setField('confirmationNotes', event.target.value)}
              />
            </Field>
            <Field id="trade-notes" label={t('field.notes')} optional>
              <Textarea
                id="trade-notes"
                value={values.notes}
                onChange={(event) => setField('notes', event.target.value)}
              />
            </Field>
          </fieldset>
        ) : null}

        {stage === 3 ? (
          <section aria-labelledby="trade-review-title" className="grid gap-5">
            <div>
              <h2 id="trade-review-title" className="text-card-title">
                {t('create.reviewTitle')}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">{t('create.versionPinNote')}</p>
            </div>
            <dl className="divide-border divide-y rounded-lg border px-4">
              <ReviewRow label={t('field.account')} value={selectedAccount?.name ?? '—'} />
              <ReviewRow label={t('field.strategy')} value={selectedStrategy?.name ?? '—'} />
              <ReviewRow
                label={t('field.version')}
                value={
                  selectedStrategy === undefined
                    ? '—'
                    : String(selectedStrategy.currentVersionNumber)
                }
              />
              <ReviewRow label={t('field.setup')} value={selectedSetup?.name ?? '—'} />
              <ReviewRow
                label={t('field.symbol')}
                value={`${values.symbol} · ${values.direction === '' ? '—' : t(`direction.${values.direction}`)}`}
              />
              <ReviewRow label={t('field.entry')} value={values.plannedEntry} />
              <ReviewRow label={t('field.stop')} value={values.plannedStop} />
              {values.plannedTarget.trim() === '' ? null : (
                <ReviewRow label={t('field.target')} value={values.plannedTarget} />
              )}
              {values.plannedPositionSize.trim() === '' ? null : (
                <ReviewRow label={t('field.positionSize')} value={values.plannedPositionSize} />
              )}
              {values.timeframe.trim() === '' ? null : (
                <ReviewRow label={t('field.timeframe')} value={values.timeframe} />
              )}
              {values.session.trim() === '' ? null : (
                <ReviewRow label={t('field.session')} value={values.session} />
              )}
              {values.confidence === '' ? null : (
                <ReviewRow label={t('field.confidence')} value={`${values.confidence}/5`} />
              )}
              {values.confirmationNotes.trim() === '' ? null : (
                <ReviewRow label={t('field.confirmationNotes')} value={values.confirmationNotes} />
              )}
              {values.tradingviewUrl.trim() === '' ? null : (
                <ReviewRow label={t('field.tradingViewUrl')} value={values.tradingviewUrl} />
              )}
              {values.notes.trim() === '' ? null : (
                <ReviewRow label={t('field.notes')} value={values.notes} />
              )}
            </dl>
          </section>
        ) : null}

        <div className="mt-7 flex flex-wrap justify-between gap-3 border-t pt-5">
          <Button
            type="button"
            variant="outline"
            disabled={stage === 0 || isPending}
            onClick={() => setStage((stage - 1) as Stage)}
          >
            <ArrowLeft aria-hidden="true" />
            {t('create.back')}
          </Button>
          {stage === 3 ? (
            <Button type="submit" disabled={isPending}>
              <Check aria-hidden="true" />
              {isPending ? t('create.creating') : t('create.create')}
            </Button>
          ) : (
            <Button type="submit">
              {t('create.continue')}
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function translateServerFieldError(
  message: string,
  t: ReturnType<typeof useTranslations<'trades'>>,
): string {
  const known: Record<string, string> = {
    invalid_risk_direction: t('validation.invalidRiskDirection'),
    zero_risk: t('validation.zeroRisk'),
    invalid_target_direction: t('validation.invalidTargetDirection'),
    invalid_tradingview_url: t('validation.invalidTradingViewUrl'),
  };
  return known[message] ?? t('validation.invalidField');
}

function DecimalField({
  id,
  field,
  label,
  values,
  setField,
  error,
  optional,
}: {
  id: string;
  field: 'plannedEntry' | 'plannedStop' | 'plannedTarget' | 'plannedPositionSize';
  label: string;
  values: Values;
  setField: <K extends keyof Values>(field: K, value: Values[K]) => void;
  error?: string | undefined;
  optional?: boolean | undefined;
}) {
  return (
    <Field id={id} label={label} optional={optional} error={error}>
      <Input
        id={id}
        inputMode="decimal"
        value={values[field]}
        onChange={(event) => setField(field, event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
    </Field>
  );
}

function TextField({
  id,
  field,
  label,
  values,
  setField,
  optional,
}: {
  id: string;
  field: 'timeframe' | 'session';
  label: string;
  values: Values;
  setField: <K extends keyof Values>(field: K, value: Values[K]) => void;
  optional?: boolean | undefined;
}) {
  return (
    <Field id={id} label={label} optional={optional}>
      <Input
        id={id}
        value={values[field]}
        onChange={(event) => setField(field, event.target.value)}
      />
    </Field>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[150px_1fr]">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}
