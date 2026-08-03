'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { detectBrowserTimeZone, listSupportedTimeZones } from '@/lib/time/timezone';
import {
  ACCOUNT_MODES,
  DEFAULT_BASE_CURRENCY,
  DEFAULT_MAXIMUM_DAILY_LOSS_PERCENT,
  DEFAULT_RISK_PER_TRADE_PERCENT,
  SUGGESTED_BASE_CURRENCIES,
  type AccountMode,
} from '@/lib/trading-accounts/constants';
import {
  pickFormErrors,
  validateAccountFields,
  type AccountFormValues,
} from '@/lib/trading-accounts/form-validation';
import { completeOnboardingAction } from '@/server/actions/onboarding';
import { AccountField } from '@/components/trading-accounts/account-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useRouter } from '@/i18n/navigation';

interface FormValues extends AccountFormValues {
  accountMode: AccountMode;
}

const STEP_ONE_FIELDS = [
  'name',
  'brokerName',
  'platformName',
  'baseCurrency',
  'startingBalance',
] as const;
const STEP_TWO_FIELDS = ['timezone', 'riskPerTradePercent', 'maximumDailyLossPercent'] as const;

type FieldErrors = Partial<
  Record<(typeof STEP_ONE_FIELDS)[number] | (typeof STEP_TWO_FIELDS)[number], string>
>;

/** The shared validator (`src/lib/trading-accounts/form-validation.ts`) checks every field at once; each step only surfaces the errors for the fields it actually shows. */
function validateStepOne(values: FormValues): FieldErrors {
  return pickFormErrors(validateAccountFields(values), STEP_ONE_FIELDS);
}

function validateStepTwo(values: FormValues): FieldErrors {
  return pickFormErrors(validateAccountFields(values), STEP_TWO_FIELDS);
}

/**
 * The two-step onboarding wizard. Client-side validation
 * (`validateStepOne`/`validateStepTwo`) is immediate feedback only — the
 * same pure checks the server action re-runs authoritatively via
 * `OnboardingSubmitSchema` (`src/lib/trading-accounts/schema.ts`), so
 * neither side can silently drift from the other.
 *
 * Values entered in either step persist in this component's own state for
 * its whole lifetime — going back and forth between steps never clears
 * anything, and a validation failure on submit leaves every field exactly
 * as typed.
 */
export function OnboardingWizard({ defaultTimezone }: { defaultTimezone: string }) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const formId = useId();
  const [timeZones] = useState<string[] | null>(() => listSupportedTimeZones());

  const [step, setStep] = useState<1 | 2>(1);
  const [values, setValues] = useState<FormValues>(() => ({
    name: '',
    brokerName: '',
    platformName: '',
    accountMode: 'live',
    baseCurrency: DEFAULT_BASE_CURRENCY,
    startingBalance: '',
    timezone:
      defaultTimezone === 'UTC' ? (detectBrowserTimeZone() ?? defaultTimezone) : defaultTimezone,
    riskPerTradePercent: DEFAULT_RISK_PER_TRADE_PERCENT,
    maximumDailyLossPercent: DEFAULT_MAXIMUM_DAILY_LOSS_PERCENT,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [submitErrorCode, setSubmitErrorCode] = useState<'validation' | 'unexpected' | null>(null);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  function setField<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleContinue() {
    const stepOneErrors = validateStepOne(values);
    setErrors(stepOneErrors);
    if (Object.keys(stepOneErrors).length > 0) {
      return;
    }
    setStep(2);
  }

  function handleBack() {
    setErrors({});
    setStep(1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'pending') {
      return;
    }

    const stepOneErrors = validateStepOne(values);
    const stepTwoErrors = validateStepTwo(values);
    const combinedErrors = { ...stepOneErrors, ...stepTwoErrors };
    setErrors(combinedErrors);
    if (Object.keys(combinedErrors).length > 0) {
      if (Object.keys(stepOneErrors).length > 0) {
        setStep(1);
      }
      return;
    }

    setStatus('pending');
    setSubmitErrorCode(null);

    const result = await completeOnboardingAction({
      name: values.name,
      brokerName: values.brokerName,
      platformName: values.platformName,
      accountMode: values.accountMode,
      baseCurrency: values.baseCurrency,
      startingBalance: values.startingBalance,
      timezone: values.timezone,
      riskPerTradePercent: values.riskPerTradePercent,
      maximumDailyLossPercent: values.maximumDailyLossPercent,
    });

    if (!result.ok) {
      setStatus('error');
      setSubmitErrorCode(result.code);
      return;
    }

    router.push('/app');
    router.refresh();
  }

  const accountModeOptions = ACCOUNT_MODES.map((mode) => ({
    value: mode,
    label: t(`accountModeValues.${mode}`),
  }));

  return (
    <div className="flex flex-col gap-8">
      <ol
        aria-label={t('stepsLabel')}
        className="text-muted-foreground flex items-center gap-3 text-sm font-medium"
      >
        {[1, 2].map((stepNumber) => (
          <li
            key={stepNumber}
            aria-current={step === stepNumber ? 'step' : undefined}
            // `listitem` does not support "name from contents" per the
            // accessible-name spec (unlike, say, a button or heading), so
            // without this the step's own visible text is never exposed as
            // its accessible name at all.
            aria-label={t(stepNumber === 1 ? 'stepOneLabel' : 'stepTwoLabel')}
            className={
              step === stepNumber
                ? 'text-foreground flex items-center gap-2'
                : 'flex items-center gap-2'
            }
          >
            <span
              aria-hidden="true"
              className={
                step === stepNumber
                  ? 'bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full text-xs'
                  : 'bg-muted flex size-6 items-center justify-center rounded-full text-xs'
              }
            >
              {stepNumber}
            </span>
            {t(stepNumber === 1 ? 'stepOneLabel' : 'stepTwoLabel')}
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        {step === 1 ? (
          <div className="flex flex-col gap-5">
            <h2 ref={stepHeadingRef} tabIndex={-1} className="text-card-title outline-none">
              {t('stepOneTitle')}
            </h2>

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
              error={
                errors.platformName === undefined ? undefined : t(`errors.${errors.platformName}`)
              }
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
                  onChange={(event) => setField('baseCurrency', event.target.value.toUpperCase())}
                  aria-invalid={errors.baseCurrency !== undefined}
                  aria-describedby={
                    errors.baseCurrency === undefined ? undefined : `${formId}-currency-error`
                  }
                  className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive flex h-11 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
                >
                  {SUGGESTED_BASE_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                {errors.baseCurrency === undefined ? null : (
                  <p
                    id={`${formId}-currency-error`}
                    role="alert"
                    className="text-destructive text-xs"
                  >
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

            <div className="flex justify-end">
              <Button type="button" onClick={handleContinue} className="min-h-11">
                {t('continue')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <h2 ref={stepHeadingRef} tabIndex={-1} className="text-card-title outline-none">
              {t('stepTwoTitle')}
            </h2>

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
                <p
                  id={`${formId}-timezone-error`}
                  role="alert"
                  className="text-destructive text-xs"
                >
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

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={handleBack} className="min-h-11">
                {t('back')}
              </Button>
              <Button type="submit" disabled={status === 'pending'} className="min-h-11">
                {t('finish')}
              </Button>
            </div>
          </div>
        )}

        <div aria-live="polite" role="status">
          {status === 'error' && submitErrorCode !== null ? (
            <div className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-4">
              <CircleAlert className="text-destructive size-5 shrink-0" aria-hidden="true" />
              <p className="text-foreground text-sm leading-relaxed">
                {t(
                  submitErrorCode === 'validation'
                    ? 'submitValidationError'
                    : 'submitUnexpectedError',
                )}
              </p>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}
