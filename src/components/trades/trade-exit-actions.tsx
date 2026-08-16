'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import {
  addTradeExitAction,
  closeRemainingTradeAction,
  correctTradeExitAction,
} from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
  FormInput,
  TradeField,
} from '@/components/trades/trade-action-form';
import { TradeDateTimeInput } from '@/components/trades/trade-datetime-input';
import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
  tradeMoneyInputValue,
} from '@/components/trades/trade-form-values';
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

function percentToBps(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (match === null) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const bps = whole * 100 + fraction;
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

function bpsToPercent(value: number): string {
  return (value / 100).toFixed(value % 100 === 0 ? 0 : value % 10 === 0 ? 1 : 2);
}

function ExitFields({
  trade,
  correction,
}: {
  trade: TradeDetail;
  correction?: TradeDetail['exits'][number];
}) {
  const t = useTranslations('trades');
  const mode = trade.actualResultMode;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TradeField
        id={correction ? `exit-percent-${correction.exitId}` : 'exit-percent'}
        label={t('field.closedPercent')}
      >
        <FormInput
          id={correction ? `exit-percent-${correction.exitId}` : 'exit-percent'}
          name="closedPercent"
          inputMode="decimal"
          defaultValue={correction ? bpsToPercent(correction.closedBps) : '25'}
          required
        />
      </TradeField>
      <TradeField
        id={correction ? `exit-price-${correction.exitId}` : 'exit-price'}
        label={t('field.exit')}
        {...(mode === 'money' ? { hint: t('common.optional') } : {})}
      >
        <FormInput
          id={correction ? `exit-price-${correction.exitId}` : 'exit-price'}
          name="exitPrice"
          defaultValue={correction?.exitPrice ?? ''}
          required={mode === 'price'}
        />
      </TradeField>
      {mode === 'money' ? (
        <TradeField
          id={correction ? `exit-pnl-${correction.exitId}` : 'exit-pnl'}
          label={t('field.realizedPnl')}
        >
          <FormInput
            id={correction ? `exit-pnl-${correction.exitId}` : 'exit-pnl'}
            name="realizedPnl"
            inputMode="decimal"
            defaultValue={tradeMoneyInputValue(
              correction?.realizedPnlMinor ?? null,
              trade.tradingAccountBaseCurrency,
            )}
            required
          />
        </TradeField>
      ) : null}
      <TradeField
        id={correction ? `exit-reason-${correction.exitId}` : 'exit-reason'}
        label={t('field.exitReason')}
        hint={t('common.optional')}
      >
        <FormInput
          id={correction ? `exit-reason-${correction.exitId}` : 'exit-reason'}
          name="exitReason"
          defaultValue={correction?.exitReason ?? ''}
          maxLength={500}
        />
      </TradeField>
    </div>
  );
}

export function AddExitDialog({
  trade,
  timezone,
  closeRemaining = false,
}: {
  trade: TradeDetail;
  timezone: string;
  closeRemaining?: boolean;
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const label = closeRemaining
    ? trade.exits.length === 0
      ? t('lifecycle.execution.fullClose')
      : t('lifecycle.execution.closeRemaining')
    : t('lifecycle.execution.partialClose');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const closedBps = closeRemaining ? null : percentToBps(String(data.get('closedPercent') ?? ''));
    if (!closeRemaining && closedBps === null)
      return setFeedback(t('lifecycle.validation.percentage'));
    const exitedAt = datetimeLocalToIso(String(data.get('exitedAt') ?? ''), timezone);
    if (!exitedAt.ok) return setFeedback(t('lifecycle.validation.time'));
    const realized =
      trade.actualResultMode === 'money'
        ? parseTradeMoneyInput(
            String(data.get('realizedPnl') ?? ''),
            trade.tradingAccountBaseCurrency,
            { allowNegative: true, allowZero: true },
          )
        : { ok: true as const, value: null };
    if (!realized.ok) return setFeedback(t('lifecycle.validation.money'));
    const common = {
      tradeId: trade.tradeId,
      mutationKey: crypto.randomUUID(),
      actualResultMode: trade.actualResultMode,
      exitPrice: String(data.get('exitPrice') ?? '').trim() || null,
      realizedPnlMinor: realized.value,
      exitReason: String(data.get('exitReason') ?? '').trim() || undefined,
      exitedAt: exitedAt.value,
    };
    startTransition(async () => {
      const result = closeRemaining
        ? await closeRemainingTradeAction(common)
        : await addTradeExitAction({ ...common, closedBps });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(t(`errors.${code}`));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={closeRemaining ? 'default' : 'outline'}>{label}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t('lifecycle.execution.exitDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {closeRemaining ? (
            <p className="text-muted-foreground text-sm">
              {t('lifecycle.execution.closingRemaining', {
                percent: bpsToPercent(trade.remainingBps),
              })}
            </p>
          ) : (
            <ExitFields trade={trade} />
          )}
          {closeRemaining ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TradeField
                id="remaining-exit-price"
                label={t('field.exit')}
                {...(trade.actualResultMode === 'money' ? { hint: t('common.optional') } : {})}
              >
                <FormInput
                  id="remaining-exit-price"
                  name="exitPrice"
                  required={trade.actualResultMode === 'price'}
                />
              </TradeField>
              {trade.actualResultMode === 'money' ? (
                <TradeField id="remaining-pnl" label={t('field.realizedPnl')}>
                  <FormInput id="remaining-pnl" name="realizedPnl" inputMode="decimal" required />
                </TradeField>
              ) : null}
              <TradeField
                id="remaining-reason"
                label={t('field.exitReason')}
                hint={t('common.optional')}
              >
                <FormInput id="remaining-reason" name="exitReason" maxLength={500} />
              </TradeField>
            </div>
          ) : null}
          <TradeField id="exit-time" label={t('field.exitedAt')}>
            <TradeDateTimeInput
              id="exit-time"
              name="exitedAt"
              timezone={timezone}
              instant={null}
              required
            />
          </TradeField>
          <ActionFeedback message={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('lifecycle.common.saving') : label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CorrectExitDialog({
  trade,
  exit,
  timezone,
}: {
  trade: TradeDetail;
  exit: TradeDetail['exits'][number];
  timezone: string;
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const closedBps = percentToBps(String(data.get('closedPercent') ?? ''));
    if (closedBps === null) return setFeedback(t('lifecycle.validation.percentage'));
    const exitedAt = datetimeLocalToIso(String(data.get('exitedAt') ?? ''), timezone);
    if (!exitedAt.ok) return setFeedback(t('lifecycle.validation.time'));
    const realized =
      trade.actualResultMode === 'money'
        ? parseTradeMoneyInput(
            String(data.get('realizedPnl') ?? ''),
            trade.tradingAccountBaseCurrency,
            { allowNegative: true, allowZero: true },
          )
        : { ok: true as const, value: null };
    if (!realized.ok) return setFeedback(t('lifecycle.validation.money'));
    startTransition(async () => {
      const result = await correctTradeExitAction({
        tradeId: trade.tradeId,
        exitId: exit.exitId,
        actualResultMode: trade.actualResultMode,
        closedBps,
        exitPrice: String(data.get('exitPrice') ?? '').trim() || null,
        realizedPnlMinor: realized.value,
        exitReason: String(data.get('exitReason') ?? '').trim() || undefined,
        exitedAt: exitedAt.value,
      });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(t(`errors.${code}`));
      setOpen(false);
      router.refresh();
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t('lifecycle.execution.correctExit')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.execution.correctExit')}</DialogTitle>
          <DialogDescription>{t('lifecycle.execution.correctExitDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <ExitFields trade={trade} correction={exit} />
          <TradeField id={`correct-exit-time-${exit.exitId}`} label={t('field.exitedAt')}>
            <FormInput
              id={`correct-exit-time-${exit.exitId}`}
              name="exitedAt"
              type="datetime-local"
              defaultValue={instantToDatetimeLocal(exit.exitedAt, timezone)}
              required
            />
          </TradeField>
          <ActionFeedback message={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('lifecycle.common.saving') : t('lifecycle.execution.correctExit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
