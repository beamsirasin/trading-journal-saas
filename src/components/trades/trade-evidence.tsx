import { useTranslations } from 'next-intl';

import type { OutcomeValue } from '@/lib/trades/constants';
import { tradeOutcomeEvidence } from '@/lib/trades/record-evidence';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import { Badge } from '@/components/ui/badge';

/**
 * ONE TRADE'S EVIDENCE, PRESENTED FOR WHAT IT IS (contract §16, §25, §28).
 *
 * `src/lib/trades/record-evidence.ts` decides what a row may claim; these are
 * the two shapes every record surface uses to say it, so the Trades table,
 * the Details sheet, the Quick Preview and the Journal detail never disagree.
 */

/** A quiet marker: the figure beside it came from the pre-contract model. */
export function LegacyEvidenceBadge({ className }: { className?: string }) {
  const t = useTranslations('trades.evidence');
  return (
    <Badge variant="neutral" className={className} title={t('legacyHint')}>
      {t('legacy')}
    </Badge>
  );
}

/**
 * The Trader Outcome, or an honest absence.
 *
 * On an Add Trade contract row the outcome is the trader's to choose and
 * nothing has asked yet, so this says so rather than showing the derived
 * Win/Loss the pre-contract close wrote. A legacy row keeps its historical
 * classification, marked as legacy-derived.
 */
export function TraderOutcomeEvidence({
  trade,
}: {
  trade: { readonly recordingContract: string | null; readonly traderOutcome: OutcomeValue | null };
}) {
  const t = useTranslations('trades.evidence');
  const evidence = tradeOutcomeEvidence(trade);
  if (evidence.status === 'unavailable') {
    return (
      <span
        data-trader-outcome={evidence.reason}
        className="text-muted-foreground inline-flex items-center gap-1.5 text-sm"
      >
        {evidence.reason === 'outcome_not_selected' ? t('outcomeUnanswered') : t('outcomeMissing')}
      </span>
    );
  }
  return (
    <span data-trader-outcome={evidence.status} className="inline-flex items-center gap-1.5">
      <TradeOutcomeBadge outcome={evidence.outcome} />
      {evidence.status === 'legacy_derived' ? <LegacyEvidenceBadge /> : null}
    </span>
  );
}
