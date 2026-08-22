import { useTranslations } from 'next-intl';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { SectionTitle, SubSection } from '@/components/trades/trade-detail-primitives';
import {
  TradeMistakesEditor,
  TradeRulesEditor,
} from '@/components/trades/trade-discipline-editors';
import { TradeReviewNotesEditor } from '@/components/trades/trade-reflection-editor';

/**
 * REVIEW — Phase 15E. Answers "what happened in my execution, and what did
 * I learn afterward?" Two customer-facing groupings, never merged (brief
 * §29): TRADE MANAGEMENT (Rules followed + Common mistakes — replaces the
 * old separate "Execution Rules"/"Mistakes" top-level headings, unchanged
 * since Phase 15B) then Post-Trade Review, kept visually distinct. Setup
 * Checklist never appears here — it stays exclusively in Entry Snapshot.
 * No combined Discipline Score exists or is introduced.
 */
export function ReviewSection({ trade, canWrite }: { trade: TradeDetailModel; canWrite: boolean }) {
  const t = useTranslations('trades');

  return (
    <section aria-labelledby="trade-review-heading" className="grid gap-6">
      <SectionTitle id="trade-review-heading">{t('detail.sections.discipline')}</SectionTitle>

      <SubSection title={t('tradeManagement.title')}>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <h5 className="text-muted-foreground text-sm font-semibold">
              {t('tradeManagement.rulesFollowed')}
            </h5>
            <TradeRulesEditor
              tradeId={trade.tradeId}
              rules={trade.ruleChecks}
              canWrite={canWrite}
            />
          </div>
          <div className="grid gap-2">
            <h5 className="text-muted-foreground text-sm font-semibold">
              {t('tradeManagement.commonMistakes')}
            </h5>
            <TradeMistakesEditor
              tradeId={trade.tradeId}
              mistakes={trade.mistakes}
              catalog={trade.mistakeCatalog}
              canWrite={canWrite}
            />
          </div>
        </div>
      </SubSection>

      <SubSection title={t('lifecycle.reflection.reviewNotes')}>
        <TradeReviewNotesEditor
          tradeId={trade.tradeId}
          reviewNotes={trade.reviewNotes}
          canWrite={canWrite}
        />
      </SubSection>
    </section>
  );
}
