import { useTranslations } from 'next-intl';

import type { InsightPillarsView } from '@/lib/dashboard/insight-presentation';
import { cn } from '@/lib/utils';

import { InsightPillarCard } from './insight-pillar-card';

/**
 * D8 — the three compact insight pillars.
 *
 * DASHBOARD DETECTS; ANALYTICS DIAGNOSES. Three peer cards, each carrying one
 * primary insight, at most one supporting insight, and a line of sample or
 * coverage context. There is no chart, sparkline, donut, gauge, radar,
 * matrix, ranking table or breakdown list anywhere in this section — those
 * are the analytical report the Dashboard deliberately is not, and every one
 * of them already has a home in Analytics.
 *
 * ONE PAYLOAD, THREE CARDS. All three read the same server-composed
 * `DashboardInsightData`; none of them fetches anything, and none re-ranks,
 * re-thresholds or recomputes a figure D8A selected.
 *
 * Responsive shape (§3/§4): one column below `md`, two at `md` where the
 * third wraps to a full-width row of its own, and three equal columns at
 * `xl`. Deliberately NOT three columns from `md` upward — a 768px viewport
 * divided three ways leaves ~230px per card, which is where "Trade Rule
 * Adherence" and a scoped-baseline comparison stop being readable. The
 * layout metadata records three columns because that is the section's
 * desktop grid; the intermediate steps are how it degrades, not a different
 * contract.
 */
export function InsightPillarsSection({
  view,
  className,
}: {
  view: InsightPillarsView;
  className?: string;
}) {
  const t = useTranslations('dashboard.insights');

  return (
    <section aria-labelledby="insight-pillars-heading" className={cn('min-w-0', className)}>
      <h2 id="insight-pillars-heading" className="sr-only">
        {t('regionLabel')}
      </h2>
      {/*
        `items-stretch` so the three cards share a bottom edge whatever each
        pillar's state contains — an available card beside two empty ones
        would otherwise leave the row visibly ragged.
      */}
      <div className="grid min-w-0 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        {view.cards.map((card, index) => (
          <div
            key={card.pillar}
            // The third card fills the two-column row at `md` rather than
            // dangling beside an empty cell — the same rule D3 applies to its
            // fifth KPI on a two-column mobile grid.
            className={cn('h-full min-w-0', index === 2 ? 'md:col-span-2 xl:col-span-1' : '')}
          >
            <InsightPillarCard card={card} />
          </div>
        ))}
      </div>
    </section>
  );
}
