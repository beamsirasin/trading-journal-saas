import { useTranslations } from 'next-intl';

import type { TradeResultKind } from '@/lib/trades/result';
import { LegacyEvidenceBadge } from '@/components/trades/trade-evidence';
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
  // Unanswered is not a bad result — it is a question the trader has not been asked.
  outcome_unanswered: 'neutral',
};

/**
 * `legacy`: the Win / Loss / BE shown was derived under the pre-contract rules,
 * not chosen by the trader (contract §12, §28). It keeps its colour and word,
 * and carries the Legacy marker so it never reads as a trader-selected answer.
 */
export function TradeResultBadge({
  result,
  legacy = false,
}: {
  result: TradeResultKind;
  legacy?: boolean;
}) {
  const t = useTranslations('trades.workspace.result');
  const badge = (
    <Badge variant={VARIANT[result]} className="px-2 py-0.5 whitespace-nowrap">
      {t(result)}
    </Badge>
  );
  if (!legacy) return badge;
  return (
    <span data-result-legacy="" className="inline-flex items-center gap-1">
      {badge}
      <LegacyEvidenceBadge className="px-1.5 py-0 text-[10px]" />
    </span>
  );
}
