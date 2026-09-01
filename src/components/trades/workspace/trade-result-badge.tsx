import { useTranslations } from 'next-intl';

import type { TradeResultKind } from '@/lib/trades/result';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

/**
 * The Result cell's badge.
 *
 * REUSES THE PRODUCT'S EXISTING OUTCOME SEMANTICS RATHER THAN INVENTING A
 * PALETTE. `win`/`loss`/`break_even` take exactly the variants
 * `TradeOutcomeBadge` already gives them, and the three lifecycle states take
 * exactly the variants `TradeStatusBadge` already gives them, so one Trade
 * reads the same colour in the table, in the sheet header, and on the
 * Dashboard. No new token is introduced here.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL (docs/design-system.md §2). Every state
 * carries a word — WIN, LOSS, BE, OPEN — and red/green colour blindness is
 * common enough among traders that a green-vs-red-only cell would be
 * unreadable for a real slice of the intended users.
 */
const VARIANT: Record<TradeResultKind, BadgeVariant> = {
  win: 'positive',
  loss: 'negative',
  break_even: 'breakEven',
  open: 'warning',
  planned: 'brand',
  canceled: 'neutral',
  unresolved: 'neutral',
};

export function TradeResultBadge({ result }: { result: TradeResultKind }) {
  const t = useTranslations('trades.workspace.result');
  return (
    <Badge variant={VARIANT[result]} className="px-2 py-0.5 whitespace-nowrap">
      {t(result)}
    </Badge>
  );
}
