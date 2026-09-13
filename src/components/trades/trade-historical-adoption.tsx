'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { adoptHistoricalExitSubtotalAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

import { formatTradeMoney } from './trade-format';

/** Explicit persisted adoption; the server remains the only transition engine. */
export function TradeHistoricalAdoption({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades.lifecycle.historicalExecution');
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');

  if (!trade.canAdoptExitSubtotal || trade.exitSubtotalMinor === null) return null;
  const amount = formatTradeMoney(trade.exitSubtotalMinor, trade.tradingAccountBaseCurrency);
  if (amount === null) return null;

  return (
    <div className="border-primary/30 bg-primary/5 grid gap-2 rounded-lg border p-3">
      <p className="text-sm font-medium">{t('available')}</p>
      <p className="text-muted-foreground text-xs">{t('description')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={state === 'saving'}
          onClick={async () => {
            setState('saving');
            const result = await adoptHistoricalExitSubtotalAction({ tradeId: trade.tradeId });
            if (!result.ok) {
              setState('error');
              return;
            }
            setState('idle');
            router.refresh();
          }}
        >
          {state === 'saving' ? t('saving') : t('action', { amount })}
        </Button>
        {state === 'error' ? (
          <p role="alert" className="text-destructive text-sm">
            {t('error')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
