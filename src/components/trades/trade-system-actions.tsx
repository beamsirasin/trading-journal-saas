'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { parseCalcDecimal, toCanonicalR } from '@/lib/calc/decimal';
import {
  RESOLVABLE_SYSTEM_EXIT_REASONS,
  type MoneySystemResolutionKind,
  type SystemStatus,
} from '@/lib/trades/constants';
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
  const hasPricePlan = trade.plannedEntry !== null && trade.plannedStop !== null;
  const initialMoneyKind: MoneySystemResolutionKind =
    terminal && trade.systemResolutionKind?.startsWith('money_')
      ? (trade.systemResolutionKind as MoneySystemResolutionKind)
      : trade.plannedR === null
        ? 'money_stop'
        : 'money_target';
  const [moneyKind, setMoneyKind] = useState<MoneySystemResolutionKind>(initialMoneyKind);
  const [grossInput, setGrossInput] = useState(
    terminal && trade.systemResolutionKind === 'money_custom'
      ? (trade.systemGrossRInput ?? '')
      : '',
  );
  const [costInput, setCostInput] = useState(terminal ? trade.systemCostR : '0');

  const grossPreview = hasPricePlan
    ? null
    : moneyKind === 'money_target'
      ? trade.plannedR
      : moneyKind === 'money_stop'
        ? '-1.0000'
        : moneyKind === 'money_break_even'
          ? '0.0000'
          : grossInput;
  const grossDecimal = parseCalcDecimal(grossPreview);
  const costDecimal = parseCalcDecimal(costInput);
  const finalPreview =
    grossDecimal !== null && costDecimal !== null && !costDecimal.isNegative()
      ? toCanonicalR(grossDecimal.minus(costDecimal))
      : null;

  return (
    <>
      {hasPricePlan ? (
        <>
          <input type="hidden" name="resolutionKind" value="price_exit" />
          <TradeField id={`${prefix}-exit`} label={t('lifecycle.system.exitPrice')}>
            <FormInput
              id={`${prefix}-exit`}
              name="systemExitPrice"
              defaultValue={terminal ? (trade.systemExitPrice ?? '') : ''}
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
        </>
      ) : (
        <>
          <TradeField id={`${prefix}-kind`} label={t('lifecycle.system.moneyResult')}>
            <NativeSelect
              id={`${prefix}-kind`}
              name="resolutionKind"
              value={moneyKind}
              onChange={(event) => setMoneyKind(event.target.value as MoneySystemResolutionKind)}
            >
              <option value="money_target" disabled={trade.plannedR === null}>
                {t('lifecycle.system.moneyTarget')}
              </option>
              <option value="money_stop">{t('lifecycle.system.moneyStop')}</option>
              <option value="money_break_even">{t('lifecycle.system.moneyBreakEven')}</option>
              <option value="money_custom">{t('lifecycle.system.moneyCustom')}</option>
            </NativeSelect>
          </TradeField>
          {trade.plannedR === null ? (
            <p className="text-muted-foreground text-xs">
              {t('lifecycle.system.targetUnavailable')}
            </p>
          ) : null}
          {moneyKind === 'money_custom' ? (
            <TradeField
              id={`${prefix}-gross`}
              label={t('lifecycle.system.grossSystemR')}
              hint={t('lifecycle.system.grossSystemRHint')}
            >
              <FormInput
                id={`${prefix}-gross`}
                name="systemGrossRInput"
                value={grossInput}
                onChange={(event) => setGrossInput(event.target.value)}
                required
              />
            </TradeField>
          ) : null}
        </>
      )}
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
      <TradeField
        id={`${prefix}-cost`}
        label={t('field.systemCostR')}
        hint={t('lifecycle.system.costHint')}
      >
        <FormInput
          id={`${prefix}-cost`}
          name="systemCostR"
          value={costInput}
          onChange={(event) => setCostInput(event.target.value)}
          required
        />
      </TradeField>
      {!hasPricePlan ? (
        <div className="bg-muted/40 grid gap-1 rounded-md border p-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('lifecycle.system.previewGross')}</span>
            <span>{grossDecimal === null ? '—' : `${toCanonicalR(grossDecimal)}R`}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('lifecycle.system.previewCost')}</span>
            <span>{costDecimal === null ? '—' : `-${toCanonicalR(costDecimal)}R`}</span>
          </div>
          <div className="flex justify-between gap-4 font-medium">
            <span>{t('lifecycle.system.previewSystem')}</span>
            <span>{finalPreview === null ? '—' : `${finalPreview}R`}</span>
          </div>
        </div>
      ) : null}
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
    const resolutionKind = String(data.get('resolutionKind') ?? '');
    startTransition(async () => {
      const payload: Record<string, unknown> = {
        tradeId: trade.tradeId,
        resolutionKind,
        systemExitedAt: time.value,
        systemCostR: String(data.get('systemCostR') ?? ''),
      };
      if (resolutionKind === 'price_exit') {
        payload.systemExitPrice = String(data.get('systemExitPrice') ?? '');
        payload.systemExitReason = String(data.get('systemExitReason') ?? '');
      } else if (resolutionKind === 'money_custom') {
        payload.systemGrossRInput = String(data.get('systemGrossRInput') ?? '');
      }
      const result = await resolveSystemTradeAction(payload);
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
        resolutionKind: String(data.get('resolutionKind') ?? ''),
        systemExitedAt: time.value,
        systemCostR: String(data.get('systemCostR') ?? ''),
      };
      if (payload.resolutionKind === 'price_exit') {
        payload.systemExitPrice = String(data.get('systemExitPrice') ?? '');
        payload.systemExitReason = String(data.get('systemExitReason') ?? '');
      } else if (payload.resolutionKind === 'money_custom') {
        payload.systemGrossRInput = String(data.get('systemGrossRInput') ?? '');
      }
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
