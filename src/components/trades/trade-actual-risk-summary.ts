'use client';

import { useTranslations } from 'next-intl';

/**
 * WHAT THE TRADE RECORDS ABOUT THE RISK ACTUALLY CARRIED — as the host's own
 * draft holds it, never as a step infers it (Add Trade contract §4,
 * decision 52).
 *
 * `not_recorded` is the answer nobody has given yet. Both recording moments
 * start there and only a named action moves them, so a row that reads
 * `matched` is reading something the trader said.
 */
export type ActualRiskSummary =
  | { readonly kind: 'not_recorded' }
  | { readonly kind: 'matched' }
  | { readonly kind: 'different'; readonly amount: string }
  | { readonly kind: 'different_unknown' }
  | { readonly kind: 'unknown' };

/**
 * The one line a launcher row reads back, in the wording each state earns.
 * It states only what was recorded: an unanswered Actual Risk says "not
 * recorded", never a match and never a reproach (§2, §8).
 */
export function useActualRiskSummaryLine(): (
  summary: ActualRiskSummary,
  currency: string,
) => string {
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const rows = useTranslations('trades.create.recording.planRows');

  return (summary, currency) => {
    switch (summary.kind) {
      case 'matched':
        return a('actualRisk.matched');
      case 'different_unknown':
        return c('actualRisk.unknownState');
      case 'unknown':
        return rows('actualRisk.notKnown');
      case 'different':
        return summary.amount.trim() === ''
          ? rows('actualRisk.differentBlank')
          : rows('actualRisk.different', { amount: `${summary.amount.trim()} ${currency}` });
      default:
        return rows('actualRisk.notRecorded');
    }
  };
}
