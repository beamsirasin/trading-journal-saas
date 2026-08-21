import { CircleAlert, Landmark, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { EmptyState } from '@/components/product/empty-state';
import { TradeCreateForm } from '@/components/trades/trade-create-form';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export function TradeCreateGate({
  options,
  canWrite,
  writeBlockReason,
  timezone,
}: {
  options: TradeCreateOptions;
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
  timezone: string;
}) {
  const t = useTranslations('trades');

  if (!canWrite && writeBlockReason !== null) {
    return (
      <EmptyState
        icon={CircleAlert}
        title={t('create.blockedTitle')}
        description={t(`errors.${writeBlockReason}`)}
        action={
          <Button asChild variant="outline">
            <Link href="/app/trades">{t('detail.back')}</Link>
          </Button>
        }
      />
    );
  }
  if (options.tradingAccounts.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title={t('prerequisite.noAccountTitle')}
        description={t('prerequisite.noAccountDescription')}
        action={
          <Button asChild>
            <Link href="/app/accounts">{t('prerequisite.manageAccounts')}</Link>
          </Button>
        }
      />
    );
  }
  if (options.strategies.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={t('prerequisite.noStrategyTitle')}
        description={t('prerequisite.noStrategyDescription')}
        action={
          <Button asChild>
            <Link href="/app/strategies">{t('prerequisite.createStrategy')}</Link>
          </Button>
        }
      />
    );
  }
  if (options.strategies.every((strategy) => strategy.setups.length === 0)) {
    return (
      <EmptyState
        icon={Layers}
        title={t('prerequisite.noSetupTitle')}
        description={t('prerequisite.noSetupDescription')}
        action={
          <Button asChild>
            <Link href="/app/strategies">{t('prerequisite.manageStrategies')}</Link>
          </Button>
        }
      />
    );
  }
  return <TradeCreateForm options={options} timezone={timezone} />;
}
