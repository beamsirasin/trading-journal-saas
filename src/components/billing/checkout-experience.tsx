'use client';

import { Check, CircleAlert, Clock, CreditCard, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition, type FormEvent } from 'react';

import type { BillingCheckoutCapability } from '@/config/billing-capability';
import type { SharedBillingFeatureKey } from '@/config/plan-catalog';
import type { CheckoutQuotePresentation } from '@/lib/billing/presentation-types';
import {
  checkoutAction,
  reconcileCheckoutAction,
  type CheckoutActionResult,
} from '@/server/actions/checkout';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

interface CheckoutContextPresentation {
  readonly status: string;
  readonly currentPlanName: string | null;
}

function newAttemptKey(): string {
  return crypto.randomUUID();
}

export function CheckoutExperience({
  quote,
  sharedFeatureKeys,
  context,
  capability,
}: {
  quote: CheckoutQuotePresentation;
  sharedFeatureKeys: readonly SharedBillingFeatureKey[];
  context: CheckoutContextPresentation;
  capability: BillingCheckoutCapability;
}) {
  const t = useTranslations('checkout');
  const tPricing = useTranslations('pricing');
  const router = useRouter();
  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  const [result, setResult] = useState<CheckoutActionResult | null>(null);
  const [processingTransactionId, setProcessingTransactionId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const storageKey = `billing-checkout-attempt:${quote.plan.id}:${quote.currency}`;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored !== null) {
          const parsed = JSON.parse(stored) as { key?: unknown; transactionId?: unknown };
          if (typeof parsed.key === 'string') setAttemptKey(parsed.key);
          if (typeof parsed.transactionId === 'string')
            setProcessingTransactionId(parsed.transactionId);
          return;
        }
      } catch {
        // Corrupt or unavailable browser session state is safely replaced.
      }
      const key = newAttemptKey();
      setAttemptKey(key);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ key }));
      } catch {
        // The in-memory key still protects this page session when storage is unavailable.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  function persistProcessing(key: string, transactionId: string) {
    setProcessingTransactionId(transactionId);
    sessionStorage.setItem(storageKey, JSON.stringify({ key, transactionId }));
  }

  function clearAttempt() {
    sessionStorage.removeItem(storageKey);
    setProcessingTransactionId(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attemptKey === null || isPending) return;
    startTransition(async () => {
      const next = await checkoutAction({
        plan: quote.plan.id,
        currency: quote.currency,
        interval: quote.billingInterval,
        idempotencyKey: attemptKey,
      });
      setResult(next);
      if (next.ok && next.status === 'processing') {
        persistProcessing(attemptKey, next.billingTransactionId);
      } else if (next.ok) {
        clearAttempt();
        if (next.status === 'succeeded') router.refresh();
      }
    });
  }

  function handleReconcile() {
    const transactionId =
      result?.ok === true && result.status === 'processing'
        ? result.billingTransactionId
        : processingTransactionId;
    if (transactionId === null || isPending) return;
    startTransition(async () => {
      const next = await reconcileCheckoutAction({ billingTransactionId: transactionId });
      setResult(next);
      if (next.ok && next.status !== 'processing') clearAttempt();
      if (next.ok && next.status === 'succeeded') router.refresh();
    });
  }

  function beginNewAttempt() {
    const key = newAttemptKey();
    setAttemptKey(key);
    setResult(null);
    setProcessingTransactionId(null);
    sessionStorage.setItem(storageKey, JSON.stringify({ key }));
  }

  const resumedProcessing = result === null && processingTransactionId !== null;
  const displayResult = result?.ok === true ? result : null;
  const displayedSubtotal = displayResult?.subtotal ?? quote.subtotal;
  const displayedVatAmount = displayResult?.vatAmount ?? quote.vat.amount;
  const displayedTotal = displayResult?.total ?? quote.total;
  const vatEnabled = displayResult?.vatEnabled ?? quote.vat.enabled;
  const vatRate = displayResult?.vatRatePercent ?? quote.vat.ratePercent;

  const summaryPanel = (
    <section
      aria-labelledby="checkout-summary-heading"
      className="border-border bg-card min-w-0 rounded-xl border p-5 sm:p-6"
    >
      <h2 id="checkout-summary-heading" className="text-card-title">
        {t('summaryTitle')}
      </h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <SummaryTerm label={t('planLabel')} value={quote.plan.name} />
        <SummaryTerm
          label={t('allowanceLabel')}
          value={t('allowanceValue', { count: quote.plan.activeTradingAccountLimit })}
        />
        <SummaryTerm label={t('intervalLabel')} value={t('monthly')} />
        <SummaryTerm label={t('currencyLabel')} value={quote.currency} />
        <SummaryTerm
          label={t('currentContextLabel')}
          value={
            context.currentPlanName === null
              ? t(`context.${context.status}`)
              : t('currentPlanContext', {
                  plan: context.currentPlanName,
                  status: t(`context.${context.status}`),
                })
          }
        />
      </dl>

      <div className="border-border mt-6 border-t pt-5">
        <h3 className="text-foreground text-sm font-semibold">
          {tPricing('sharedFeaturesHeading')}
        </h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {sharedFeatureKeys.map((feature) => (
            <li key={feature} className="text-muted-foreground flex items-start gap-2 text-sm">
              <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{tPricing(`sharedFeatures.${feature}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );

  if (capability === 'unavailable') {
    return (
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        {summaryPanel}
        <section
          aria-labelledby="payment-heading"
          className="border-border bg-card min-w-0 rounded-xl border p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <Clock className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
            <div>
              <h2 id="payment-heading" className="text-card-title">
                {t('unavailable.title')}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {t('unavailable.body')}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            <Button asChild variant="outline" className="w-full">
              <Link href="/app/billing">{t('unavailable.viewBilling')}</Link>
            </Button>
            <Button asChild variant="link" className="w-full">
              <Link href="/app/plan">{t('backToPlans')}</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      {summaryPanel}

      <section
        aria-labelledby="payment-heading"
        className="border-border bg-card min-w-0 rounded-xl border p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <CreditCard className="text-primary size-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="payment-heading" className="text-card-title">
              {t('mockPaymentTitle')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {t('mockPaymentBody')}
            </p>
          </div>
        </div>

        <dl className="border-border mt-6 flex flex-col gap-3 border-y py-4 text-sm">
          <PriceRow
            label={vatEnabled ? t('subtotal') : t('price')}
            value={displayedSubtotal.formatted}
          />
          {vatEnabled ? (
            <PriceRow label={t('vat', { rate: vatRate })} value={displayedVatAmount.formatted} />
          ) : null}
          <PriceRow label={t('total')} value={displayedTotal.formatted} strong />
        </dl>
        {vatEnabled ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {tPricing('vatExclusiveNotice', { rate: vatRate })}
          </p>
        ) : null}

        <div className="mt-5 min-h-12" aria-live="polite" role="status">
          {isPending ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('submitting')}
            </p>
          ) : null}
          {result?.ok === false ? (
            <p id="checkout-error" className="text-destructive flex items-start gap-2 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t(`errors.${result.code}`)}
            </p>
          ) : null}
          {displayResult !== null ? <CheckoutStatus result={displayResult} /> : null}
          {resumedProcessing ? (
            <p className="text-muted-foreground text-sm">{t('status.processing')}</p>
          ) : null}
        </div>

        {displayResult?.status === 'processing' || resumedProcessing ? (
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={isPending}
            onClick={handleReconcile}
          >
            {t('checkStatus')}
          </Button>
        ) : displayResult !== null && ['failed', 'canceled'].includes(displayResult.status) ? (
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={isPending}
            onClick={beginNewAttempt}
          >
            {t('newAttempt')}
          </Button>
        ) : displayResult?.status === 'succeeded' ? (
          <Button asChild className="mt-4 w-full">
            <Link href="/app/plan" prefetch={false}>
              {t('continueToPlan')}
            </Link>
          </Button>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4">
            <Button
              type="submit"
              className="w-full"
              disabled={attemptKey === null || isPending}
              aria-describedby={result?.ok === false ? 'checkout-error' : undefined}
            >
              {t('confirm')}
            </Button>
          </form>
        )}

        <Button asChild variant="link" className="mt-2 w-full">
          <Link href="/app/plan">{t('backToPlans')}</Link>
        </Button>
      </section>
    </div>
  );
}

function SummaryTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="text-foreground mt-1 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

function PriceRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong ? 'flex justify-between gap-4 text-base font-semibold' : 'flex justify-between gap-4'
      }
    >
      <dt>{label}</dt>
      <dd className="numeric text-right">{value}</dd>
    </div>
  );
}

function CheckoutStatus({ result }: { result: Extract<CheckoutActionResult, { ok: true }> }) {
  const t = useTranslations('checkout');
  if (result.status === 'succeeded')
    return (
      <p className="text-positive text-sm">
        {t('status.succeeded', { plan: result.plan, amount: result.total.formatted })}
      </p>
    );
  return (
    <p
      className={
        result.status === 'failed' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'
      }
    >
      {t(`status.${result.status}`)}
    </p>
  );
}
