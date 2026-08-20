'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { assignTradeClassificationAction } from '@/server/actions/trades';
import type { TradeCreateStrategyOption, TradeDetail } from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
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

/**
 * Late Strategy/Setup classification (Phase 14C UI over Phase 14B's
 * `assignTradeClassification`). Supports exactly the three sanctioned
 * transitions the service enforces — this dialog never lets the user
 * construct a request outside that matrix:
 *
 *   - `trade.strategyId === null` -> pick a Strategy, optionally a Setup
 *     belonging to it, in the SAME submission ("Add Strategy" /
 *     "Add Strategy & Setup" collapse into one control here).
 *   - `trade.strategyId !== null && trade.setupId === null` -> pick a Setup
 *     belonging to the ALREADY-pinned Strategy only (no Strategy picker).
 *
 * Never rendered at all once both are assigned — arbitrary reclassification
 * is out of scope (Phase 14B contract, unchanged by 14C).
 */
export function AssignClassificationDialog({
  trade,
  strategies,
}: {
  trade: TradeDetail;
  strategies: readonly TradeCreateStrategyOption[];
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const assigningStrategy = trade.strategyId === null;
  const [strategyId, setStrategyId] = useState('');
  const [setupId, setSetupId] = useState('');

  // When adding a Setup only (Strategy already pinned), offer just that
  // Strategy's own Setups — never a foreign Strategy's.
  const setupOptions = assigningStrategy
    ? (strategies.find((item) => item.strategyId === strategyId)?.setups ?? [])
    : (strategies.find((item) => item.strategyId === trade.strategyId)?.setups ?? []);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const result = await assignTradeClassificationAction({
        tradeId: trade.tradeId,
        ...(assigningStrategy ? { strategyId } : {}),
        ...(setupId === '' ? {} : { setupId }),
      });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(errorMessage(t, code));
      setOpen(false);
      setStrategyId('');
      setSetupId('');
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFeedback(null);
          setStrategyId('');
          setSetupId('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          {assigningStrategy
            ? t('lifecycle.classification.addStrategy')
            : t('lifecycle.classification.addSetup')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('lifecycle.common.close')}>
        <DialogHeader>
          <DialogTitle>
            {assigningStrategy
              ? t('lifecycle.classification.addStrategyTitle')
              : t('lifecycle.classification.addSetupTitle')}
          </DialogTitle>
          <DialogDescription>{t('lifecycle.classification.description')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {assigningStrategy ? (
            <TradeField id="classify-strategy" label={t('field.strategy')}>
              <NativeSelect
                id="classify-strategy"
                value={strategyId}
                required
                onChange={(event) => {
                  setStrategyId(event.target.value);
                  setSetupId('');
                }}
              >
                <option value="">{t('create.chooseStrategy')}</option>
                {strategies.map((strategy) => (
                  <option key={strategy.strategyId} value={strategy.strategyId}>
                    {strategy.name} ·{' '}
                    {t('common.version', { number: strategy.currentVersionNumber })}
                  </option>
                ))}
              </NativeSelect>
            </TradeField>
          ) : null}
          <TradeField id="classify-setup" label={t('field.setup')} hint={t('common.optional')}>
            <NativeSelect
              id="classify-setup"
              value={setupId}
              disabled={assigningStrategy && strategyId === ''}
              onChange={(event) => setSetupId(event.target.value)}
            >
              <option value="">{t('create.chooseSetup')}</option>
              {setupOptions.map((setup) => (
                <option key={setup.setupId} value={setup.setupId}>
                  {setup.name}
                </option>
              ))}
            </NativeSelect>
          </TradeField>
          <ActionFeedback message={feedback} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || (assigningStrategy && strategyId === '')}>
              {pending ? t('lifecycle.common.saving') : t('lifecycle.common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
