'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { RESOLVABLE_SYSTEM_EXIT_REASONS, type SystemStatus } from '@/lib/trades/constants';
import {
  correctSystemResolutionAction,
  markSystemNoTradeAction,
  resolveSystemTradeAction,
} from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
  FormInput,
  NativeSelect,
  TradeField,
} from '@/components/trades/trade-action-form';
import { TradeDateTimeInput } from '@/components/trades/trade-datetime-input';
import { datetimeLocalToIso } from '@/components/trades/trade-form-values';
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
import { useRouter } from '@/i18n/navigation';

type Translation = ReturnType<typeof useTranslations>;

function actionFeedback(t: Translation, result: unknown) {
  const code = actionErrorCode(result);
  return code === null ? null : t(`errors.${code}`);
}

function ResolvedFields({
  trade,
  timezone,
  prefix,
}: {
  trade: TradeDetail;
  timezone: string;
  prefix: string;
}) {
  const t = useTranslations('trades');
  const terminal = trade.systemStatus === 'resolved';
  return (
    <>
      <TradeField id={`${prefix}-exit`} label={t('lifecycle.system.exitPrice')}>
        <FormInput
          id={`${prefix}-exit`}
          name="systemExitPrice"
          defaultValue={terminal ? (trade.systemExitPrice ?? '') : ''}
          required
        />
      </TradeField>
      <TradeField
        id={`${prefix}-time`}
        label={t('field.systemExitedAt')}
        hint={t('lifecycle.execution.timezoneHint', { timezone })}
      >
        <TradeDateTimeInput
          id={`${prefix}-time`}
          name="systemExitedAt"
          timezone={timezone}
          instant={terminal ? trade.systemExitedAt : null}
          required
        />
      </TradeField>
      <TradeField id={`${prefix}-reason`} label={t('field.systemExitReason')}>
        <NativeSelect
          id={`${prefix}-reason`}
          name="systemExitReason"
          defaultValue={terminal ? (trade.systemExitReason ?? 'target_hit') : 'target_hit'}
        >
          {RESOLVABLE_SYSTEM_EXIT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(`systemReason.${reason}`)}
            </option>
          ))}
        </NativeSelect>
      </TradeField>
      <TradeField
        id={`${prefix}-cost`}
        label={t('field.systemCostR')}
        hint={t('lifecycle.system.costHint')}
      >
        <FormInput
          id={`${prefix}-cost`}
          name="systemCostR"
          defaultValue={terminal ? trade.systemCostR : '0'}
          required
        />
      </TradeField>
    </>
  );
}

export function ResolveSystemDialog({ trade, timezone }: { trade: TradeDetail; timezone: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const time = datetimeLocalToIso(String(data.get('systemExitedAt') ?? ''), timezone);
    if (!time.ok) return setFeedback(t('lifecycle.validation.time'));
    startTransition(async () => {
      const result = await resolveSystemTradeAction({
        tradeId: trade.tradeId,
        systemExitPrice: String(data.get('systemExitPrice') ?? ''),
        systemExitedAt: time.value,
        systemExitReason: String(data.get('systemExitReason') ?? ''),
        systemCostR: String(data.get('systemCostR') ?? ''),
      });
      const message = actionFeedback(t, result);
      if (message !== null) return setFeedback(message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t('lifecycle.system.resolve')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.system.resolveTitle')}</DialogTitle>
          <DialogDescription>{t('lifecycle.system.resolveDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <ResolvedFields trade={trade} timezone={timezone} prefix="resolve-system" />
          <ActionFeedback message={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('lifecycle.common.saving') : t('lifecycle.system.confirmResolve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MarkSystemNoTradeDialog({ tradeId }: { tradeId: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function confirm() {
    setFeedback(null);
    startTransition(async () => {
      const result = await markSystemNoTradeAction({ tradeId });
      const message = actionFeedback(t, result);
      if (message !== null) return setFeedback(message);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline">{t('lifecycle.system.noTrade')}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('lifecycle.system.noTradeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('lifecycle.system.noTradeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lifecycle.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={confirm}>
              {pending ? t('lifecycle.common.saving') : t('lifecycle.system.confirmNoTrade')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionFeedback message={feedback} />
    </div>
  );
}

export function CorrectSystemDialog({ trade, timezone }: { trade: TradeDetail; timezone: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Extract<SystemStatus, 'resolved' | 'no_trade'>>(
    trade.systemStatus === 'no_trade' ? 'no_trade' : 'resolved',
  );
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    let payload: Record<string, unknown> = { tradeId: trade.tradeId, target };
    if (target === 'resolved') {
      const time = datetimeLocalToIso(String(data.get('systemExitedAt') ?? ''), timezone);
      if (!time.ok) return setFeedback(t('lifecycle.validation.time'));
      payload = {
        ...payload,
        systemExitPrice: String(data.get('systemExitPrice') ?? ''),
        systemExitedAt: time.value,
        systemExitReason: String(data.get('systemExitReason') ?? ''),
        systemCostR: String(data.get('systemCostR') ?? ''),
      };
    }
    startTransition(async () => {
      const result = await correctSystemResolutionAction(payload);
      const message = actionFeedback(t, result);
      if (message !== null) return setFeedback(message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('lifecycle.system.correct')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.system.correctTitle')}</DialogTitle>
          <DialogDescription>{t('lifecycle.system.correctDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <TradeField id="system-target" label={t('lifecycle.system.result')}>
            <NativeSelect
              id="system-target"
              value={target}
              onChange={(event) => setTarget(event.target.value as typeof target)}
            >
              <option value="resolved">{t('status.system.resolved')}</option>
              <option value="no_trade">{t('status.system.no_trade')}</option>
            </NativeSelect>
          </TradeField>
          {target === 'resolved' ? (
            <ResolvedFields trade={trade} timezone={timezone} prefix="correct-system" />
          ) : (
            <p className="border-warning/30 bg-warning/10 rounded-md border p-3 text-sm">
              {t('lifecycle.system.correctionNoTradeWarning')}
            </p>
          )}
          <ActionFeedback message={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('lifecycle.common.saving') : t('lifecycle.common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
