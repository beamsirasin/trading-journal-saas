'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { correctTradeIdentityAction, updateTradePlanAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
  FormInput,
  NativeSelect,
  TradeField,
} from '@/components/trades/trade-action-form';
import { parseTradeMoneyInput, tradeMoneyInputValue } from '@/components/trades/trade-form-values';
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

function errorMessage(t: ReturnType<typeof useTranslations>, code: string) {
  return t(`errors.${code}`);
}

export function PlanCorrectionDialog({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const initialBasis =
    trade.plannedEntry !== null && trade.plannedStop !== null ? 'price' : 'money';
  const [basis, setBasis] = useState<'price' | 'money'>(initialBasis);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    const currency = trade.tradingAccountBaseCurrency;

    const riskRaw = basis === 'money' ? String(data.get('plannedRiskMinor') ?? '').trim() : '';
    let plannedRiskMinor: string | null = null;
    if (riskRaw !== '') {
      const risk = parseTradeMoneyInput(riskRaw, currency, { allowZero: false });
      if (!risk.ok) return setFeedback(t('lifecycle.validation.money'));
      plannedRiskMinor = risk.value;
    }
    const rewardRaw = basis === 'money' ? String(data.get('plannedRewardMinor') ?? '').trim() : '';
    let plannedRewardMinor: string | null = null;
    if (rewardRaw !== '') {
      const reward = parseTradeMoneyInput(rewardRaw, currency, { allowZero: true });
      if (!reward.ok) return setFeedback(t('lifecycle.validation.money'));
      plannedRewardMinor = reward.value;
    }

    startTransition(async () => {
      const result = await updateTradePlanAction({
        tradeId: trade.tradeId,
        systemPlanBasis: basis,
        plannedEntry:
          basis === 'price' ? String(data.get('plannedEntry') ?? '').trim() || null : null,
        plannedStop:
          basis === 'price' ? String(data.get('plannedStop') ?? '').trim() || null : null,
        plannedTarget:
          basis === 'price' ? String(data.get('plannedTarget') ?? '').trim() || null : null,
        plannedPositionSize:
          basis === 'price' ? String(data.get('plannedPositionSize') ?? '').trim() || null : null,
        plannedRiskMinor,
        plannedRewardMinor,
        timeframe: trade.timeframe,
        session: trade.session,
        confirmationNotes: trade.confirmationNotes,
        confidence: trade.confidence,
        tradingviewUrl: trade.tradingviewUrl,
        notes: trade.notes,
      });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(errorMessage(t, code));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('lifecycle.plan.edit')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.plan.title')}</DialogTitle>
          <DialogDescription>{t('lifecycle.plan.description')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <TradeField id="plan-basis" label={t('lifecycle.plan.basis')}>
            <NativeSelect
              id="plan-basis"
              value={basis}
              onChange={(event) => setBasis(event.target.value as 'price' | 'money')}
            >
              <option value="price">{t('lifecycle.plan.price')}</option>
              <option value="money">{t('lifecycle.plan.money')}</option>
            </NativeSelect>
          </TradeField>
          {basis === 'price' ? (
            <div key="price-plan" className="grid gap-4 sm:grid-cols-2">
              <TradeField id="plan-entry" label={t('field.entry')}>
                <FormInput
                  id="plan-entry"
                  name="plannedEntry"
                  defaultValue={trade.plannedEntry ?? ''}
                  required
                />
              </TradeField>
              <TradeField id="plan-stop" label={t('field.stopLoss')}>
                <FormInput
                  id="plan-stop"
                  name="plannedStop"
                  defaultValue={trade.plannedStop ?? ''}
                  required
                />
              </TradeField>
              <TradeField
                id="plan-target"
                label={t('field.takeProfit')}
                hint={t('lifecycle.plan.targetHint')}
              >
                <FormInput
                  id="plan-target"
                  name="plannedTarget"
                  defaultValue={trade.plannedTarget ?? ''}
                />
              </TradeField>
              <TradeField id="plan-size" label={t('field.positionSize')}>
                <FormInput
                  id="plan-size"
                  name="plannedPositionSize"
                  defaultValue={trade.plannedPositionSize ?? ''}
                />
              </TradeField>
            </div>
          ) : (
            <div key="money-plan" className="grid gap-4 sm:grid-cols-2">
              <TradeField
                id="plan-risk"
                label={t('detail.systemPlan.risk')}
                hint={t('lifecycle.execution.moneyHint', {
                  currency: trade.tradingAccountBaseCurrency,
                })}
              >
                <FormInput
                  id="plan-risk"
                  name="plannedRiskMinor"
                  defaultValue={tradeMoneyInputValue(
                    trade.plannedRiskMinor,
                    trade.tradingAccountBaseCurrency,
                  )}
                  required
                />
              </TradeField>
              <TradeField
                id="plan-reward"
                label={t('detail.systemPlan.targetReward')}
                hint={t('common.optional')}
              >
                <FormInput
                  id="plan-reward"
                  name="plannedRewardMinor"
                  defaultValue={tradeMoneyInputValue(
                    trade.plannedRewardMinor,
                    trade.tradingAccountBaseCurrency,
                  )}
                />
              </TradeField>
            </div>
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

export function IdentityCorrectionDialog({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    // plannedEntry/plannedStop stay OMITTED (never an empty string) when
    // blank — this correction never clears a Price plan, only sets it
    // alongside a Direction change; a Money-only Trade may correct its
    // Symbol/Direction with these left blank entirely.
    const entryRaw = String(data.get('plannedEntry') ?? '').trim();
    const stopRaw = String(data.get('plannedStop') ?? '').trim();
    startTransition(async () => {
      const result = await correctTradeIdentityAction({
        tradeId: trade.tradeId,
        symbol: String(data.get('symbol') ?? ''),
        direction: String(data.get('direction') ?? ''),
        ...(entryRaw === '' ? {} : { plannedEntry: entryRaw }),
        ...(stopRaw === '' ? {} : { plannedStop: stopRaw }),
      });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(errorMessage(t, code));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('lifecycle.identity.edit')}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('lifecycle.identity.title')}</DialogTitle>
          <DialogDescription>{t('lifecycle.identity.description')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <TradeField id="identity-symbol" label={t('field.symbol')}>
            <FormInput id="identity-symbol" name="symbol" defaultValue={trade.symbol} required />
          </TradeField>
          <TradeField
            id="identity-direction"
            label={t('field.direction')}
            hint={t('lifecycle.identity.directionHint')}
          >
            <NativeSelect id="identity-direction" name="direction" defaultValue={trade.direction}>
              <option value="long">{t('direction.long')}</option>
              <option value="short">{t('direction.short')}</option>
            </NativeSelect>
          </TradeField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TradeField id="identity-entry" label={t('field.entry')} hint={t('common.optional')}>
              <FormInput
                id="identity-entry"
                name="plannedEntry"
                defaultValue={trade.plannedEntry ?? ''}
              />
            </TradeField>
            <TradeField id="identity-stop" label={t('field.stop')} hint={t('common.optional')}>
              <FormInput
                id="identity-stop"
                name="plannedStop"
                defaultValue={trade.plannedStop ?? ''}
              />
            </TradeField>
          </div>
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
