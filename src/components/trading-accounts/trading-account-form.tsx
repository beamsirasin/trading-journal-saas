'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

import { detectBrowserTimeZone, listSupportedTimeZones } from '@/lib/time/timezone';
import {
  ACCOUNT_MODES,
  SUGGESTED_BASE_CURRENCIES,
  type AccountMode,
} from '@/lib/trading-accounts/constants';
import {
  validateAccountFields,
  type AccountFormValues,
} from '@/lib/trading-accounts/form-validation';
import {
  createTradingAccountAction,
  updateTradingAccountAction,
} from '@/server/actions/trading-accounts';
import { AccountField } from '@/components/trading-accounts/account-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Link, useRouter } from '@/i18n/navigation';

export interface TradingAccountFormValues extends AccountFormValues {
  accountMode: AccountMode;
}

type TradingAccountFormProps =
  | { readonly mode: 'create'; readonly initialValues: TradingAccountFormValues }
  | {
      readonly mode: 'edit';
      readonly accountId: string;
      readonly initialValues: TradingAccountFormValues;
      /** True once any Trade (including soft-deleted) has ever referenced this account — presentation only; the server remains authoritative. */
      readonly baseCurrencyLocked: boolean;
    };

/**
 * The single shared form behind both "create an additional trading account"
 * and "edit a trading account" (Phase 3B brief: "Reuse one shared schema and
 * form implementation where practical"). Same fields, same client-side
 * validation (`validateAccountFields`), same server-authoritative schema
 * (`CreateAccountSchema`/`UpdateAccountSchema`, both built on
 * `AccountFieldsSchema` — `src/lib/trading-accounts/schema.ts`) as
 * onboarding's first account, reused rather than reimplemented.
 *
 * Unlike the onboarding wizard, this is a single page — Phase 3B never asked
 * for a second step here, and there is no "first account" ceremony to walk
 * through.
 */
export function TradingAccountForm(props: TradingAccountFormProps) {
  const t = useTranslations('onboarding');
  const tAccounts = useTranslations('accounts');
  const router = useRouter();
  const formId = useId();
  const [timeZones] = useState<string[] | null>(() => listSupportedTimeZones());
  const [values, setValues] = useState<TradingAccountFormValues>(() => {
    const initial = props.initialValues;
    // Onboarding's own refinement, reused here for CREATE only: a stored
    // 'UTC' preference is this product's "nothing set yet" default, so a
    // real client-side browser guess is worth trying. An edit always
    // carries the account's own already-meaningful timezone, so it is
    // never second-guessed.
    if (props.mode === 'create' && initial.timezone === 'UTC') {
      return { ...initial, timezone: detectBrowserTimeZone() ?? initial.timezone };
    }
    return initial;
  });
  const [errors, setErrors] = useState<Partial<Record<keyof AccountFormValues, string>>>({});
  const [setActiveOnCreate, setSetActiveOnCreate] = useState(false);
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [submitErrorCode, setSubmitErrorCode] = useState<string | null>(null);
  // One UUID per mount, reused across retries of the SAME submission intent
  // — the server's `(workspaceId, mutationKey)` unique index is what makes a
  // duplicate create request return the original account instead of a
  // second row (`createTradingAccount`, `trading-account-management.ts`).
  const [mutationKey] = useState<string>(() => crypto.randomUUID());

  function setField<K extends keyof TradingAccountFormValues>(
    field: K,
    value: TradingAccountFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  const baseCurrencyLocked = props.mode === 'edit' && props.baseCurrencyLocked;

  const accountModeOptions = ACCOUNT_MODES.map((mode) => ({
    value: mode,
    label: t(`accountModeValues.${mode}`),
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'pending') {
      return;
    }

    const validationErrors = validateAccountFields(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setStatus('pending');
    setSubmitErrorCode(null);

    const fields = {
      name: values.name,
      brokerName: values.brokerName,
      platformName: values.platformName,
      accountMode: values.accountMode,
      baseCurrency: values.baseCurrency,
      startingBalance: values.startingBalance,
      timezone: values.timezone,
      riskPerTradePercent: values.riskPerTradePercent,
      maximumDailyLossPercent: values.maximumDailyLossPercent,
    };

    const result =
      props.mode === 'create'
        ? await createTradingAccountAction({
            ...fields,
            mutationKey,
            setActive: setActiveOnCreate,
          })
        : await updateTradingAccountAction(props.accountId, fields);

    if (!result.ok) {
      setStatus('error');
      setSubmitErrorCode(result.code);
      return;
    }

    router.push(`/app/accounts?status=${props.mode === 'create' ? 'created' : 'updated'}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-5">
        <AccountField
          id={`${formId}-name`}
          label={t('nameLabel')}
          error={errors.name === undefined ? undefined : t(`errors.${errors.name}`)}
        >
          <Input
            id={`${formId}-name`}
            value={values.name}
            onChange={(event) => setField('name', event.target.value)}
            aria-invalid={errors.name !== undefined}
            aria-describedby={errors.name === undefined ? undefined : `${formId}-name-error`}
            required
          />
        </AccountField>

        <AccountField
          id={`${formId}-broker`}
          label={t('brokerLabel')}
          optional
          error={errors.brokerName === undefined ? undefined : t(`errors.${errors.brokerName}`)}
        >
          <Input
            id={`${formId}-broker`}
            value={values.brokerName}
            onChange={(event) => setField('brokerName', event.target.value)}
            aria-invalid={errors.brokerName !== undefined}
            aria-describedby={
              errors.brokerName === undefined ? undefined : `${formId}-broker-error`
            }
          />
        </AccountField>

        <AccountField
          id={`${formId}-platform`}
          label={t('platformLabel')}
          optional
          error={errors.platformName === undefined ? undefined : t(`errors.${errors.platformName}`)}
        >
          <Input
            id={`${formId}-platform`}
            value={values.platformName}
            onChange={(event) => setField('platformName', event.target.value)}
            aria-invalid={errors.platformName !== undefined}
            aria-describedby={
              errors.platformName === undefined ? undefined : `${formId}-platform-error`
            }
          />
        </AccountField>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-account-mode`}>{t('accountModeLabel')}</Label>
          <SegmentedControl
            legend={t('accountModeLabel')}
            options={accountModeOptions}
            value={values.accountMode}
            onValueChange={(value) => setField('accountMode', value)}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-currency`}>{t('baseCurrencyLabel')}</Label>
            <select
              id={`${formId}-currency`}
              value={values.baseCurrency}
              disabled={baseCurrencyLocked}
              onChange={(event) => setField('baseCurrency', event.target.value.toUpperCase())}
              aria-invalid={errors.baseCurrency !== undefined}
              aria-describedby={
                baseCurrencyLocked
                  ? `${formId}-currency-locked-hint`
                  : errors.baseCurrency === undefined
                    ? undefined
                    : `${formId}-currency-error`
              }
              className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive flex h-11 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {SUGGESTED_BASE_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            {baseCurrencyLocked ? (
              <p id={`${formId}-currency-locked-hint`} className="text-muted-foreground text-xs">
                {t('baseCurrencyLockedHint')}
              </p>
            ) : errors.baseCurrency === undefined ? null : (
              <p id={`${formId}-currency-error`} role="alert" className="text-destructive text-xs">
                {t(`errors.${errors.baseCurrency}`)}
              </p>
            )}
          </div>

          <AccountField
            id={`${formId}-balance`}
            label={t('startingBalanceLabel')}
            error={
              errors.startingBalance === undefined
                ? undefined
                : t(`errors.${errors.startingBalance}`)
            }
          >
            <Input
              id={`${formId}-balance`}
              inputMode="decimal"
              value={values.startingBalance}
              onChange={(event) => setField('startingBalance', event.target.value)}
              aria-invalid={errors.startingBalance !== undefined}
              aria-describedby={
                errors.startingBalance === undefined ? undefined : `${formId}-balance-error`
              }
              required
            />
          </AccountField>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-timezone`}>{t('timezoneLabel')}</Label>
          {timeZones !== null ? (
            <select
              id={`${formId}-timezone`}
              value={values.timezone}
              onChange={(event) => setField('timezone', event.target.value)}
              aria-invalid={errors.timezone !== undefined}
              aria-describedby={
                errors.timezone === undefined ? undefined : `${formId}-timezone-error`
              }
              className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive flex h-11 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
            >
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${formId}-timezone`}
              value={values.timezone}
              onChange={(event) => setField('timezone', event.target.value)}
              aria-invalid={errors.timezone !== undefined}
              aria-describedby={
                errors.timezone === undefined ? undefined : `${formId}-timezone-error`
              }
            />
          )}
          {errors.timezone === undefined ? null : (
            <p id={`${formId}-timezone-error`} role="alert" className="text-destructive text-xs">
              {t(`errors.${errors.timezone}`)}
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <AccountField
            id={`${formId}-risk`}
            label={t('riskPerTradeLabel')}
            optional
            error={
              errors.riskPerTradePercent === undefined
                ? undefined
                : t(`errors.${errors.riskPerTradePercent}`)
            }
          >
            <div className="relative">
              <Input
                id={`${formId}-risk`}
                inputMode="decimal"
                className="pr-8"
                value={values.riskPerTradePercent}
                onChange={(event) => setField('riskPerTradePercent', event.target.value)}
                aria-invalid={errors.riskPerTradePercent !== undefined}
                aria-describedby={
                  errors.riskPerTradePercent === undefined ? undefined : `${formId}-risk-error`
                }
              />
              <span
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
              >
                %
              </span>
            </div>
          </AccountField>

          <AccountField
            id={`${formId}-max-loss`}
            label={t('maximumDailyLossLabel')}
            optional
            error={
              errors.maximumDailyLossPercent === undefined
                ? undefined
                : t(`errors.${errors.maximumDailyLossPercent}`)
            }
          >
            <div className="relative">
              <Input
                id={`${formId}-max-loss`}
                inputMode="decimal"
                className="pr-8"
                value={values.maximumDailyLossPercent}
                onChange={(event) => setField('maximumDailyLossPercent', event.target.value)}
                aria-invalid={errors.maximumDailyLossPercent !== undefined}
                aria-describedby={
                  errors.maximumDailyLossPercent === undefined
                    ? undefined
                    : `${formId}-max-loss-error`
                }
              />
              <span
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
              >
                %
              </span>
            </div>
          </AccountField>
        </div>

        {props.mode === 'create' ? (
          <label
            htmlFor={`${formId}-set-active`}
            className="border-border bg-muted/30 flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 text-sm"
          >
            <input
              id={`${formId}-set-active`}
              type="checkbox"
              checked={setActiveOnCreate}
              onChange={(event) => setSetActiveOnCreate(event.target.checked)}
              className="border-input size-4 rounded"
            />
            <span className="text-foreground font-medium">{tAccounts('setActiveOnCreate')}</span>
          </label>
        ) : null}
      </div>

      <div aria-live="polite" role="status">
        {status === 'error' && submitErrorCode !== null ? (
          <div className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-4">
            <CircleAlert className="text-destructive size-5 shrink-0" aria-hidden="true" />
            <p className="text-foreground text-sm leading-relaxed">
              {tAccounts(`errors.${submitErrorCode}`)}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex justify-end gap-3">
        <Button asChild variant="outline" className="min-h-11">
          <Link href="/app/accounts">{tAccounts('cancel')}</Link>
        </Button>
        <Button type="submit" disabled={status === 'pending'} className="min-h-11">
          {props.mode === 'create' ? tAccounts('create') : tAccounts('save')}
        </Button>
      </div>
    </form>
  );
}
