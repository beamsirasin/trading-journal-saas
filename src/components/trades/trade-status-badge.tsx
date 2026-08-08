import { useTranslations } from 'next-intl';

import type { SystemStatus, TradeStatus } from '@/lib/trades/constants';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

const EXECUTION_VARIANT: Record<TradeStatus, BadgeVariant> = {
  planned: 'brand',
  open: 'warning',
  closed: 'positive',
  canceled: 'neutral',
};

const SYSTEM_VARIANT: Record<SystemStatus, BadgeVariant> = {
  pending: 'warning',
  resolved: 'positive',
  no_trade: 'neutral',
};

export function TradeStatusBadge({ status }: { status: TradeStatus }) {
  const t = useTranslations('trades');
  return <Badge variant={EXECUTION_VARIANT[status]}>{t(`status.execution.${status}`)}</Badge>;
}

export function SystemStatusBadge({ status }: { status: SystemStatus }) {
  const t = useTranslations('trades');
  return <Badge variant={SYSTEM_VARIANT[status]}>{t(`status.system.${status}`)}</Badge>;
}
