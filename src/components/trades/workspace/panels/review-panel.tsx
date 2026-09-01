'use client';

import { useTranslations } from 'next-intl';

import { deriveTradeAttributionQuadrant } from '@/lib/trades/attribution-quadrant';
import type { TradeDetail } from '@/server/dal/trades';
import { TradeEmotionsEditor } from '@/components/trades/trade-reflection-editor';
import { ReviewSection } from '@/components/trades/trade-review-section';
import { PanelSection } from '@/components/trades/workspace/panel-primitives';

/**
 * REVIEW — the tab this product is actually for.
 *
 * It opens with the one sentence the whole attribution model exists to
 * produce: was the IDEA good, and did the EXECUTION capture it? That reading
 * comes from two independently stored outcomes and never from profit
 * (`deriveTradeAttributionQuadrant`), so "the setup worked, the execution gave
 * it back" can be said about a Trade that made money and "you were paid for
 * breaking your rules" about one that did too.
 *
 * Beneath it, the working surfaces, reused verbatim rather than rebuilt:
 *
 *   ReviewSection        Rules followed, Common mistakes, Post-Trade Review
 *   TradeEmotionsEditor  psychology at entry
 *
 * NOTHING HERE IS AI-GENERATED AND NOTHING IS SCORED. The summary is a lookup
 * against a nine-cell matrix of states the domain already stores. There is no
 * Discipline Score, no severity-weighted penalty and no advice engine — none
 * of those has an approved formula in this product (CLAUDE.md section 6 / A2),
 * and none is introduced by a UI pass.
 *
 * WHY EMOTIONS MOVED IN BESIDE THE MISTAKES. In the five-section IA emotions
 * sat under Entry Snapshot, beside the Setup Checklist. In this six-tab IA the
 * question "what affected my decision?" belongs with "what did I do wrong?" —
 * they are the same reflection. The underlying editor, its action and its
 * entry-time truth (`emotions_recorded_at` distinguishing "none selected" from
 * "never recorded") are untouched.
 */
export function TradeReviewPanel({ trade, canWrite }: { trade: TradeDetail; canWrite: boolean }) {
  const t = useTranslations('trades.workspace.details');
  const tTrades = useTranslations('trades');
  const quadrant = deriveTradeAttributionQuadrant(trade);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection title={t('groups.attribution')}>
        {quadrant === null ? (
          <p
            data-trade-quadrant="unavailable"
            className="text-muted-foreground border-border rounded-lg border border-dashed p-3 text-xs leading-relaxed"
          >
            {t('quadrantUnavailable')}
          </p>
        ) : (
          <div
            data-trade-quadrant={quadrant}
            className="border-border bg-muted/30 flex min-w-0 flex-col gap-1 rounded-lg border p-3"
          >
            <p className="text-foreground text-sm font-semibold">{t(`quadrant.${quadrant}`)}</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t('quadrantExplanation')}
            </p>
          </div>
        )}
      </PanelSection>

      <ReviewSection trade={trade} canWrite={canWrite} />

      <PanelSection
        title={tTrades('lifecycle.reflection.emotions')}
        description={t('emotionsMeaning')}
      >
        <TradeEmotionsEditor
          tradeId={trade.tradeId}
          emotions={trade.emotions}
          emotionCatalog={trade.emotionCatalog}
          emotionsRecorded={trade.emotionsRecordedAt !== null}
          canWrite={canWrite}
        />
      </PanelSection>
    </div>
  );
}
