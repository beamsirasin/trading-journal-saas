'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import {
  closeTradeAction,
  correctTradeExecutionAction,
  openTradeAction,
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

type Translation = ReturnType<typeof useTranslations>;

function moneyValue(
  data: FormData,
  name: string,
  currency: string,
  options: { allowNegative?: boolean; allowZero?: boolean } = {},
) {
  return parseTradeMoneyInput(String(data.get(name) ?? ''), currency, options);
}

function feedbackForAction(t: Translation, result: unknown) {
  const code = actionErrorCode(result);
  return code === null ? null : t(`errors.${code}`);
}

export function OpenTradeDialog({ trade, timezone }: { trade: TradeDetail; timezone: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const risk = moneyValue(data, 'actualInitialRisk', trade.tradingAccountBaseCurrency);
    const enteredAt = datetimeLocalToIso(String(data.get('enteredAt') ?? ''), timezone);
    if (!risk.ok) return setFeedback(t('lifecycle.validation.money'));
    if (!enteredAt.ok) return setFeedback(t('lifecycle.validation.time'));
    const positionSize = String(data.get('actualPositionSize') ?? '').trim();
    startTransition(async () => {
      const result = await openTradeAction({
        tradeId: trade.tradeId,
        actualEntry: String(data.get('actualEntry') ?? ''),
        actualInitialStop: String(data.get('actualInitialStop') ?? ''),
        actualInitialRiskMinor: risk.value,
        actualPositionSize: positionSize || null,
        enteredAt: enteredAt.value,
      });
      const message = feedbackForAction(t, result);
      if (message !== null) return setFeedback(message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t('lifecycle.execution.open')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.execution.openTitle')}</DialogTitle>
          <DialogDescription>{t('lifecycle.execution.openDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TradeField id="open-entry" label={t('field.actualEntry')}>
              <FormInput
                id="open-entry"
                name="actualEntry"
                defaultValue={trade.plannedEntry}
                required
              />
            </TradeField>
            <TradeField id="open-stop" label={t('field.initialStop')}>
              <FormInput
                id="open-stop"
                name="actualInitialStop"
                defaultValue={trade.plannedStop}
                required
              />
            </TradeField>
            <TradeField
              id="open-risk"
              label={t('field.initialRisk')}
              hint={t('lifecycle.execution.moneyHint', {
                currency: trade.tradingAccountBaseCurrency,
              })}
            >
              <FormInput id="open-risk" name="actualInitialRisk" inputMode="decimal" required />
            </TradeField>
            <TradeField id="open-size" label={t('field.actualPositionSize')}>
              <FormInput
                id="open-size"
                name="actualPositionSize"
                defaultValue={trade.plannedPositionSize ?? ''}
              />
            </TradeField>
          </div>
          <TradeField
            id="open-entered"
            label={t('field.enteredAt')}
            hint={t('lifecycle.execution.timezoneHint', { timezone })}
          >
            <TradeDateTimeInput
              id="open-entered"
              name="enteredAt"
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
              {pending ? t('lifecycle.common.saving') : t('lifecycle.execution.open')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CloseTradeDialog({ trade, timezone }: { trade: TradeDetail; timezone: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const currency = trade.tradingAccountBaseCurrency;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const signed = { allowNegative: true, allowZero: true };
    const unsigned = { allowZero: true };
    const net = moneyValue(data, 'netPnl', currency, signed);
    const grossInput = String(data.get('grossPnl') ?? '').trim();
    const gross =
      grossInput === ''
        ? { ok: true as const, value: null }
        : moneyValue(data, 'grossPnl', currency, signed);
    const commission = moneyValue(data, 'commission', currency, unsigned);
    const fees = moneyValue(data, 'fees', currency, unsigned);
    const swap = moneyValue(data, 'swap', currency, unsigned);
    const exitedAt = datetimeLocalToIso(String(data.get('exitedAt') ?? ''), timezone);
    if (!net.ok || !gross.ok || !commission.ok || !fees.ok || !swap.ok)
      return setFeedback(t('lifecycle.validation.money'));
    if (!exitedAt.ok) return setFeedback(t('lifecycle.validation.time'));
    startTransition(async () => {
      const result = await closeTradeAction({
        tradeId: trade.tradeId,
        actualExit: String(data.get('actualExit') ?? ''),
        netPnlMinor: net.value,
        exitedAt: exitedAt.value,
        grossPnlMinor: gross.value,
        commissionMinor: commission.value,
        feesMinor: fees.value,
        swapMinor: swap.value,
      });
      const message = feedbackForAction(t, result);
      if (message !== null) return setFeedback(message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t('lifecycle.execution.closeTrade')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.execution.closeTitle')}</DialogTitle>
          <DialogDescription>{t('lifecycle.execution.closeDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TradeField id="close-exit" label={t('field.exit')}>
              <FormInput id="close-exit" name="actualExit" required />
            </TradeField>
            <TradeField
              id="close-net"
              label={t('field.netPnl')}
              hint={t('lifecycle.execution.netHint', { currency })}
            >
              <FormInput id="close-net" name="netPnl" inputMode="decimal" required />
            </TradeField>
            <TradeField id="close-gross" label={t('field.grossPnl')} hint={t('common.optional')}>
              <FormInput id="close-gross" name="grossPnl" inputMode="decimal" />
            </TradeField>
            <TradeField id="close-commission" label={t('field.commission')}>
              <FormInput
                id="close-commission"
                name="commission"
                inputMode="decimal"
                defaultValue="0"
                required
              />
            </TradeField>
            <TradeField id="close-fees" label={t('field.fees')}>
              <FormInput
                id="close-fees"
                name="fees"
                inputMode="decimal"
                defaultValue="0"
                required
              />
            </TradeField>
            <TradeField id="close-swap" label={t('field.swap')}>
              <FormInput
                id="close-swap"
                name="swap"
                inputMode="decimal"
                defaultValue="0"
                required
              />
            </TradeField>
          </div>
          <TradeField
            id="close-time"
            label={t('field.exitedAt')}
            hint={t('lifecycle.execution.timezoneHint', { timezone })}
          >
            <TradeDateTimeInput
              id="close-time"
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
              {pending ? t('lifecycle.common.saving') : t('lifecycle.execution.closeTrade')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExecutionCorrectionDialog({
  trade,
  timezone,
}: {
  trade: TradeDetail;
  timezone: string;
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const currency = trade.tradingAccountBaseCurrency;
  const isClosed = trade.status === 'closed';

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const risk = moneyValue(data, 'actualInitialRisk', currency);
    const enteredAt = datetimeLocalToIso(String(data.get('enteredAt') ?? ''), timezone);
    if (!risk.ok) return setFeedback(t('lifecycle.validation.money'));
    if (!enteredAt.ok) return setFeedback(t('lifecycle.validation.time'));
    const base = {
      tradeId: trade.tradeId,
      actualEntry: String(data.get('actualEntry') ?? ''),
      actualInitialStop: String(data.get('actualInitialStop') ?? ''),
      actualInitialRiskMinor: risk.value,
      actualPositionSize: String(data.get('actualPositionSize') ?? '').trim() || null,
      enteredAt: enteredAt.value,
    };
    let payload: Record<string, unknown> = base;
    if (isClosed) {
      const signed = { allowNegative: true, allowZero: true };
      const unsigned = { allowZero: true };
      const net = moneyValue(data, 'netPnl', currency, signed);
      const grossInput = String(data.get('grossPnl') ?? '').trim();
      const gross =
        grossInput === ''
          ? { ok: true as const, value: null }
          : moneyValue(data, 'grossPnl', currency, signed);
      const commission = moneyValue(data, 'commission', currency, unsigned);
      const fees = moneyValue(data, 'fees', currency, unsigned);
      const swap = moneyValue(data, 'swap', currency, unsigned);
      const exitedAt = datetimeLocalToIso(String(data.get('exitedAt') ?? ''), timezone);
      if (!net.ok || !gross.ok || !commission.ok || !fees.ok || !swap.ok)
        return setFeedback(t('lifecycle.validation.money'));
      if (!exitedAt.ok) return setFeedback(t('lifecycle.validation.time'));
      payload = {
        ...base,
        actualExit: String(data.get('actualExit') ?? ''),
        netPnlMinor: net.value,
        grossPnlMinor: gross.value,
        commissionMinor: commission.value,
        feesMinor: fees.value,
        swapMinor: swap.value,
        exitedAt: exitedAt.value,
      };
    }
    startTransition(async () => {
      const result = await correctTradeExecutionAction(payload);
      const message = feedbackForAction(t, result);
      if (message !== null) return setFeedback(message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('lifecycle.execution.correct')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.execution.correctTitle')}</DialogTitle>
          <DialogDescription>{t('lifecycle.execution.correctDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TradeField id="correct-entry" label={t('field.actualEntry')}>
              <FormInput
                id="correct-entry"
                name="actualEntry"
                defaultValue={trade.actualEntry ?? ''}
                required
              />
            </TradeField>
            <TradeField id="correct-stop" label={t('field.initialStop')}>
              <FormInput
                id="correct-stop"
                name="actualInitialStop"
                defaultValue={trade.actualInitialStop ?? ''}
                required
              />
            </TradeField>
            <TradeField
              id="correct-risk"
              label={t('field.initialRisk')}
              hint={t('lifecycle.execution.moneyHint', { currency })}
            >
              <FormInput
                id="correct-risk"
                name="actualInitialRisk"
                defaultValue={tradeMoneyInputValue(trade.actualInitialRiskMinor, currency)}
                required
              />
            </TradeField>
            <TradeField id="correct-size" label={t('field.actualPositionSize')}>
              <FormInput
                id="correct-size"
                name="actualPositionSize"
                defaultValue={trade.actualPositionSize ?? ''}
              />
            </TradeField>
          </div>
          <TradeField
            id="correct-entered"
            label={t('field.enteredAt')}
            hint={t('lifecycle.execution.timezoneHint', { timezone })}
          >
            <FormInput
              id="correct-entered"
              name="enteredAt"
              type="datetime-local"
              defaultValue={instantToDatetimeLocal(trade.enteredAt, timezone)}
              required
            />
          </TradeField>
          {isClosed ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TradeField id="correct-exit" label={t('field.exit')}>
                  <FormInput
                    id="correct-exit"
                    name="actualExit"
                    defaultValue={trade.actualExit ?? ''}
                    required
                  />
                </TradeField>
                <TradeField id="correct-net" label={t('field.netPnl')}>
                  <FormInput
                    id="correct-net"
                    name="netPnl"
                    defaultValue={tradeMoneyInputValue(trade.netPnlMinor, currency)}
                    required
                  />
                </TradeField>
                <TradeField id="correct-gross" label={t('field.grossPnl')}>
                  <FormInput
                    id="correct-gross"
                    name="grossPnl"
                    defaultValue={tradeMoneyInputValue(trade.grossPnlMinor, currency)}
                  />
                </TradeField>
                <TradeField id="correct-commission" label={t('field.commission')}>
                  <FormInput
                    id="correct-commission"
                    name="commission"
                    defaultValue={tradeMoneyInputValue(trade.commissionMinor, currency)}
                    required
                  />
                </TradeField>
                <TradeField id="correct-fees" label={t('field.fees')}>
                  <FormInput
                    id="correct-fees"
                    name="fees"
                    defaultValue={tradeMoneyInputValue(trade.feesMinor, currency)}
                    required
                  />
                </TradeField>
                <TradeField id="correct-swap" label={t('field.swap')}>
                  <FormInput
                    id="correct-swap"
                    name="swap"
                    defaultValue={tradeMoneyInputValue(trade.swapMinor, currency)}
                    required
                  />
                </TradeField>
              </div>
              <TradeField id="correct-exited" label={t('field.exitedAt')}>
                <FormInput
                  id="correct-exited"
                  name="exitedAt"
                  type="datetime-local"
                  defaultValue={instantToDatetimeLocal(trade.exitedAt, timezone)}
                  required
                />
              </TradeField>
            </>
          ) : null}
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
