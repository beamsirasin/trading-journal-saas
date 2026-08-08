'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { correctTradeIdentityAction, updateTradePlanAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
  FormInput,
  FormTextarea,
  NativeSelect,
  TradeField,
} from '@/components/trades/trade-action-form';
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

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const confidence = String(data.get('confidence') ?? '').trim();
      const result = await updateTradePlanAction({
        tradeId: trade.tradeId,
        plannedEntry: String(data.get('plannedEntry') ?? ''),
        plannedStop: String(data.get('plannedStop') ?? ''),
        plannedTarget: String(data.get('plannedTarget') ?? '').trim() || null,
        plannedPositionSize: String(data.get('plannedPositionSize') ?? '').trim() || null,
        timeframe: String(data.get('timeframe') ?? '').trim() || null,
        session: String(data.get('session') ?? '').trim() || null,
        confirmationNotes: String(data.get('confirmationNotes') ?? '').trim() || null,
        confidence: confidence === '' ? null : Number.parseInt(confidence, 10),
        tradingviewUrl: String(data.get('tradingviewUrl') ?? '').trim() || null,
        notes: String(data.get('notes') ?? '').trim() || null,
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
          <div className="grid gap-4 sm:grid-cols-2">
            <TradeField id="plan-entry" label={t('field.entry')}>
              <FormInput
                id="plan-entry"
                name="plannedEntry"
                defaultValue={trade.plannedEntry}
                required
              />
            </TradeField>
            <TradeField id="plan-stop" label={t('field.stop')}>
              <FormInput
                id="plan-stop"
                name="plannedStop"
                defaultValue={trade.plannedStop}
                required
              />
            </TradeField>
            <TradeField
              id="plan-target"
              label={t('field.target')}
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
            <TradeField id="plan-timeframe" label={t('field.timeframe')}>
              <FormInput
                id="plan-timeframe"
                name="timeframe"
                defaultValue={trade.timeframe ?? ''}
              />
            </TradeField>
            <TradeField id="plan-session" label={t('field.session')}>
              <FormInput id="plan-session" name="session" defaultValue={trade.session ?? ''} />
            </TradeField>
            <TradeField id="plan-confidence" label={t('field.confidence')}>
              <NativeSelect
                id="plan-confidence"
                name="confidence"
                defaultValue={trade.confidence?.toString() ?? ''}
              >
                <option value="">{t('common.notSet')}</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}/5
                  </option>
                ))}
              </NativeSelect>
            </TradeField>
            <TradeField id="plan-chart" label={t('field.tradingViewUrl')}>
              <FormInput
                id="plan-chart"
                name="tradingviewUrl"
                type="url"
                defaultValue={trade.tradingviewUrl ?? ''}
              />
            </TradeField>
          </div>
          <TradeField id="plan-confirmation" label={t('field.confirmationNotes')}>
            <FormTextarea
              id="plan-confirmation"
              name="confirmationNotes"
              defaultValue={trade.confirmationNotes ?? ''}
            />
          </TradeField>
          <TradeField id="plan-notes" label={t('field.notes')}>
            <FormTextarea id="plan-notes" name="notes" defaultValue={trade.notes ?? ''} />
          </TradeField>
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
    startTransition(async () => {
      const result = await correctTradeIdentityAction({
        tradeId: trade.tradeId,
        symbol: String(data.get('symbol') ?? ''),
        direction: String(data.get('direction') ?? ''),
        plannedEntry: String(data.get('plannedEntry') ?? ''),
        plannedStop: String(data.get('plannedStop') ?? ''),
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
            <TradeField id="identity-entry" label={t('field.entry')}>
              <FormInput
                id="identity-entry"
                name="plannedEntry"
                defaultValue={trade.plannedEntry}
                required
              />
            </TradeField>
            <TradeField id="identity-stop" label={t('field.stop')}>
              <FormInput
                id="identity-stop"
                name="plannedStop"
                defaultValue={trade.plannedStop}
                required
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
