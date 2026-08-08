import { useTranslations } from 'next-intl';

import type { OutcomeValue } from '@/lib/trades/constants';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

const VARIANT: Record<OutcomeValue, BadgeVariant> = {
  win: 'positive',
  loss: 'negative',
  break_even: 'neutral',
};

export function TradeOutcomeBadge({ outcome }: { outcome: OutcomeValue | null }) {
  const t = useTranslations('trades');
  return outcome === null ? (
    <span className="text-muted-foreground">{t('common.notAvailable')}</span>
  ) : (
    <Badge variant={VARIANT[outcome]}>{t(`status.outcome.${outcome}`)}</Badge>
  );
}
