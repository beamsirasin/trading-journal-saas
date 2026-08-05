'use client';

import { CalendarClock, CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import type {
  DowngradeOption,
  SubscriptionManagementPresentation,
} from '@/lib/billing/subscription-management-types';
import {
  cancelPlanDowngradeAction,
  cancelSubscriptionCancellationAction,
  schedulePlanDowngradeAction,
  scheduleSubscriptionCancellationAction,
  type SubscriptionManagementActionResult,
} from '@/server/actions/subscription-management';
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
import { useRouter } from '@/i18n/navigation';

type Operation =
  'scheduleDowngrade' | 'cancelDowngrade' | 'scheduleCancellation' | 'undoCancellation';

export function SubscriptionManagementControls({
  model,
}: {
  model: SubscriptionManagementPresentation;
}) {
  const t = useTranslations('subscriptionManagement');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SubscriptionManagementActionResult | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);

  function run(
    nextOperation: Operation,
    action: () => Promise<SubscriptionManagementActionResult>,
  ) {
    if (isPending) return;
    setOperation(nextOperation);
    startTransition(async () => {
      const next = await action();
      setResult(next);
      if (next.ok) router.refresh();
    });
  }

  return (
    <section aria-labelledby="subscription-management-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="subscription-management-heading" className="text-card-title">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>

      {model.blockReason !== null ? (
        <div role="status" className="border-border bg-muted/40 rounded-lg border p-4 text-sm">
          {t(`blocked.${model.blockReason}`)}
        </div>
      ) : null}

      {model.overLimit ? (
        <div className="border-warning/40 bg-warning/10 rounded-lg border p-4 text-sm">
          <p className="font-semibold">{t('overLimitTitle')}</p>
          <p className="text-muted-foreground mt-1 leading-relaxed">{t('overLimitBody')}</p>
        </div>
      ) : null}

      {model.pendingDowngrade !== null ? (
        <div className="border-border bg-card rounded-xl border p-5">
          <div className="flex items-start gap-3">
            <CalendarClock className="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{t('pendingTitle')}</h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('pendingBody', {
                  plan: model.pendingDowngrade.plan.name,
                  date: model.pendingDowngrade.effectiveAt,
                })}
              </p>
              {model.pendingDowngrade.willBeOverLimit ? (
                <p className="text-warning mt-2 text-sm">{t('pendingOverLimit')}</p>
              ) : null}
            </div>
          </div>
          {model.canCancelPendingDowngrade ? (
            <ConfirmAction
              title={t('undoDowngradeTitle')}
              description={t('undoDowngradeBody')}
              trigger={t('undoDowngrade')}
              confirm={t('confirmUndoDowngrade')}
              pending={isPending && operation === 'cancelDowngrade'}
              onConfirm={() => run('cancelDowngrade', () => cancelPlanDowngradeAction({}))}
            />
          ) : null}
        </div>
      ) : null}

      {model.downgradeOptions.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {model.downgradeOptions.map((option) => (
            <DowngradeCard
              key={option.id}
              option={option}
              currentPlan={model.currentPlan?.name ?? 'â€”'}
              usage={model.activeAccountCount}
              pending={isPending && operation === 'scheduleDowngrade'}
              onConfirm={() =>
                run('scheduleDowngrade', () =>
                  schedulePlanDowngradeAction({ targetPlanKey: option.id }),
                )
              }
            />
          ))}
        </div>
      ) : null}

      {model.cancellationScheduled ? (
        <div className="border-negative/30 bg-negative/10 rounded-xl border p-5">
          <h3 className="text-sm font-semibold">{t('cancellationScheduledTitle')}</h3>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            {t('cancellationScheduledBody', { date: model.currentPeriodEndsAt ?? 'â€”' })}
          </p>
          {model.canReverseCancellation ? (
            <ConfirmAction
              title={t('undoCancellationTitle')}
              description={t('undoCancellationBody')}
              trigger={t('undoCancellation')}
              confirm={t('confirmUndoCancellation')}
              icon={<RotateCcw className="size-4" aria-hidden="true" />}
              pending={isPending && operation === 'undoCancellation'}
              onConfirm={() =>
                run('undoCancellation', () => cancelSubscriptionCancellationAction({}))
              }
            />
          ) : null}
        </div>
      ) : model.canScheduleCancellation ? (
        <ConfirmAction
          destructive
          title={t('cancelTitle')}
          description={t('cancelBody', { date: model.currentPeriodEndsAt ?? 'â€”' })}
          details={[
            t('cancelKeepsAccess', { date: model.currentPeriodEndsAt ?? 'â€”' }),
            t('cancelReadOnly'),
            t('cancelDataRetained'),
            ...(model.pendingDowngrade !== null ? [t('cancelClearsDowngrade')] : []),
          ]}
          trigger={t('scheduleCancellation')}
          confirm={t('confirmCancellation')}
          pending={isPending && operation === 'scheduleCancellation'}
          onConfirm={() =>
            run('scheduleCancellation', () => scheduleSubscriptionCancellationAction({}))
          }
        />
      ) : null}

      <div aria-live="polite" role="status" className="min-h-6 text-sm">
        {isPending ? (
          <span className="text-muted-foreground inline-flex items-center gap-2">
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t('saving')}
          </span>
        ) : result?.ok ? (
          <span className="text-positive">{t('success')}</span>
        ) : result !== null ? (
          <span className="text-destructive inline-flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t(`errors.${result.code}`)}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function DowngradeCard({
  option,
  currentPlan,
  usage,
  pending,
  onConfirm,
}: {
  option: DowngradeOption;
  currentPlan: string;
  usage: number;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useTranslations('subscriptionManagement');
  return (
    <div className="border-border bg-card flex flex-col gap-4 rounded-xl border p-5">
      <div>
        <h3 className="font-semibold">{t('downgradeTo', { plan: option.name })}</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('effectiveAt', { date: option.effectiveAt })}
        </p>
      </div>
      <dl className="grid gap-2 text-sm">
        <PreviewFact label={t('currentPlan')} value={currentPlan} />
        <PreviewFact label={t('currentUsage')} value={String(usage)} />
        <PreviewFact label={t('futureLimit')} value={String(option.activeTradingAccountLimit)} />
      </dl>
      {option.willBeOverLimit ? (
        <p className="text-warning text-sm">{t('willBeOverLimit')}</p>
      ) : null}
      <ConfirmAction
        title={t('confirmDowngradeTitle', { plan: option.name })}
        description={t('confirmDowngradeBody', { plan: option.name, date: option.effectiveAt })}
        details={[
          t('noImmediatePriceChange'),
          t('noAutomaticArchive'),
          t('dataRetained'),
          t('selectionRemainsAvailable'),
          ...(option.willBeOverLimit ? [t('overLimitAfterDowngrade')] : []),
        ]}
        trigger={t('scheduleDowngrade')}
        confirm={t('confirmDowngrade')}
        pending={pending}
        onConfirm={onConfirm}
      />
    </div>
  );
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="numeric text-right font-medium">{value}</dd>
    </div>
  );
}

function ConfirmAction({
  title,
  description,
  details = [],
  trigger,
  confirm,
  pending,
  onConfirm,
  destructive = false,
  icon,
}: {
  title: string;
  description: string;
  details?: readonly string[];
  trigger: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
  destructive?: boolean;
  icon?: React.ReactNode;
}) {
  const t = useTranslations('subscriptionManagement');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={destructive ? 'destructive' : 'outline'}
          className="mt-4 min-h-11"
          disabled={pending}
        >
          {icon}
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {details.length > 0 ? (
          <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm">
            {details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('close')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={onConfirm}
            className={destructive ? 'bg-destructive text-destructive-foreground' : undefined}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
