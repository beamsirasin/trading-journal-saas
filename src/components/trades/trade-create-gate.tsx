import { CircleAlert, Landmark } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { EmptyState } from '@/components/product/empty-state';
import { TradeRecordingForm } from '@/components/trades/trade-recording-form';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export function TradeCreateGate({
  options,
  canWrite,
  writeBlockReason,
  timing,
  activeTradingAccountId,
  timezone,
}: {
  options: TradeCreateOptions;
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
  /** The recording situation chosen on the previous step, resolved from the URL. */
  timing: RecordingTiming;
  /** The workspace's persisted active Account, used only to seed the form's own field. */
  activeTradingAccountId?: string | null;
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
  return (
    <TradeRecordingForm
      options={options}
      timing={timing}
      activeTradingAccountId={activeTradingAccountId ?? null}
      timezone={timezone}
    />
  );
}
