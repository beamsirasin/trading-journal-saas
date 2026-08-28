import type { DashboardFilterState } from '@/lib/dashboard/filters';
import {
  composeInsightPillarsView,
  insightPillarsServiceError,
} from '@/lib/dashboard/insight-presentation';
import { getDashboardInsightData } from '@/server/services/dashboard-insights';

import { InsightPillarsSection } from './insight-pillars-row';

/**
 * D8B — the insight pillars' own server boundary.
 *
 * ONE READ FOR THREE CARDS. D8A resolves the authenticated Dashboard scope
 * once and runs five bounded bulk projections in parallel behind a single
 * service call; this component makes that call exactly once and hands all
 * three cards their slice of the one result. There is no read per pillar, no
 * read per Strategy/Emotion/rule/mistake/Trade, no client `useEffect` fetch,
 * and no N+1 — and the Dashboard core's five projections and D7 Risk's one
 * are untouched by it.
 *
 * It is streamed on its own Suspense boundary for the same reason the
 * Calendar and Risk sections are: five more projections must never hold the
 * five core reads off the screen.
 *
 * A thrown read is caught here rather than allowed to take the page down.
 * Everything above and below this section comes from different boundaries and
 * is still true, so the three cards say so about themselves instead.
 */
export async function InsightPillarsDataSection({
  filters,
  className,
}: {
  readonly filters: DashboardFilterState;
  readonly className?: string;
}) {
  const result = await getDashboardInsightData(filters).catch(() => null);
  const view =
    result === null || !result.ok
      ? insightPillarsServiceError(filters)
      : composeInsightPillarsView({ data: result.data, filters });

  return <InsightPillarsSection view={view} {...(className === undefined ? {} : { className })} />;
}
