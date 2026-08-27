'use client';

import { useTranslations } from 'next-intl';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { DayReviewData, DayReviewHeadline } from '@/lib/dashboard/day-review';
import type { DashboardRecentExecutionGap } from '@/lib/dashboard/page-data';
import { cn } from '@/lib/utils';
import {
  DashboardStateLink,
  useDashboardStateNavigation,
} from '@/components/dashboard/dashboard-state-link';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { TradeStatusBadge } from '@/components/trades/trade-status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface DayReviewDialogProps {
  readonly review: DayReviewData;
  /** The selected date, already localised on the server. */
  readonly dateLabel: string;
  /** Where closing the Day Review goes — the same Calendar, same month, same mode, same filters. */
  readonly closeHref: string;
  /** Trade id -> the href that opens its Quick Preview. Built by `serializeCalendarState`. */
  readonly tradeHrefs: Readonly<Record<string, string>>;
  readonly timezone: string;
  readonly dateLocale: string;
}

/**
 * D6B — the Day Review, over the Dashboard rather than instead of it.
 *
 * THE CALENDAR REMAINS THE PARENT CONTEXT. The Phase 14D calendar navigated
 * to `view=log` when a date was clicked, which destroyed the calendar the
 * reader had just been reading and left them somewhere else entirely. This is
 * a dialog: the Calendar, the month, the mode and every Dashboard filter are
 * still behind it, and closing returns to exactly that state.
 *
 * The open state is URL-BACKED, not React memory. The component mounts only
 * when `day` is in the address bar, so refreshing reconstructs the panel,
 * a deep link opens it, and Back closes it — none of which needs history
 * code. Closing is an ordinary navigation to `closeHref`, which the server
 * built from the filters module, so it cannot drop the Dashboard's scope.
 *
 * On mobile it is a near-full-height bottom sheet rather than a narrow
 * centred modal; on desktop it is a centred dialog wide enough for the
 * headline and the Trade rows without becoming a page. It is one component
 * with responsive geometry, not two implementations.
 */
export function DayReviewDialog({
  review,
  dateLabel,
  closeHref,
  tradeHrefs,
  timezone,
  dateLocale,
}: DayReviewDialogProps) {
  const t = useTranslations('dashboard.dayReview');
  const tCommon = useTranslations('common');
  const navigateDashboardState = useDashboardStateNavigation();

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) navigateDashboardState(closeHref);
      }}
    >
      <DialogContent
        closeLabel={tCommon('close')}
        data-day-review={review.status}
        data-day-review-mode={review.mode}
        data-day-review-date={review.date}
        aria-describedby="day-review-description"
        className={cn(
          'flex flex-col gap-0 overflow-y-hidden p-0',
          // Mobile: a bottom sheet pinned to the viewport edges.
          'inset-x-0 top-auto bottom-0 h-auto max-h-[88vh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none',
          // Desktop: a centred dialog, large enough for metrics plus rows and
          // deliberately not large enough to be mistaken for the Journal.
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100vh-4rem)] sm:w-[calc(100%-3rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg',
        )}
      >
        <DialogHeader className="border-border shrink-0 border-b p-4 text-left sm:p-5">
          <DialogTitle data-day-review-title="">{dateLabel}</DialogTitle>
          <DialogDescription id="day-review-description">
            {t(`modeDescription.${review.mode}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {review.status === 'error' ? (
            <div role="alert" className="border-destructive/40 rounded-lg border border-dashed p-4">
              <p className="text-sm font-medium">{t('states.errorTitle')}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {t('states.errorDescription')}
              </p>
            </div>
          ) : review.status === 'empty' ? (
            <div className="border-border rounded-lg border border-dashed p-4">
              <p className="text-sm font-medium">{t('states.emptyTitle')}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {t(`states.emptyDescription.${review.mode}`)}
              </p>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              <DayReviewHeadlineBlock headline={review.headline} />
              <ul className="flex min-w-0 flex-col gap-2" aria-label={t('rowsLabel')}>
                {review.trades.map((row) => (
                  <DayReviewRow
                    key={row.tradeId}
                    symbol={row.symbol}
                    direction={row.direction}
                    status={row.status}
                    strategyName={row.strategyName}
                    setupName={row.setupName}
                    axisAt={row.axisAt}
                    actualR={row.actualR}
                    systemR={row.systemR}
                    gap={row.executionGapR}
                    href={tradeHrefs[row.tradeId] ?? null}
                    timezone={timezone}
                    dateLocale={dateLocale}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-border shrink-0 border-t p-3 sm:px-5">
          <DashboardStateLink
            href={closeHref}
            data-day-review-close=""
            className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2"
          >
            {t('backToCalendar')}
          </DashboardStateLink>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The headline is the CLICKED SQUARE's own numbers, passed straight through
 * from D6A. Nothing here re-sums the rows: the failure this prevents is a
 * cell reading `+2.40R` and the panel it opens reading `+2.41R` because two
 * aggregations rounded differently.
 *
 * Gap mode gets its own vocabulary, never "winning"/"losing" — a day the
 * account lost money on can still be a day the Trader outperformed the System.
 */
function DayReviewHeadlineBlock({ headline }: { headline: DayReviewHeadline }) {
  const t = useTranslations('dashboard.dayReview');

  if (headline.mode === 'gap') {
    return (
      <div
        data-day-review-headline="gap"
        className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:p-4"
      >
        <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3">
          <HeadlineFigure label={t('headline.totalGap')} value={headline.gapR} tone />
          <HeadlineCount label={t('headline.pairedTrades')} value={headline.pairedTradeCount} />
          <HeadlineFigure label={t('headline.systemR')} value={headline.systemR} />
          <HeadlineFigure label={t('headline.actualR')} value={headline.actualR} />
        </dl>
        <dl
          data-day-review-distribution=""
          className="text-muted-foreground flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-xs"
        >
          <Distribution
            label={t('distribution.underperformed')}
            value={headline.underperformedCount}
          />
          <Distribution label={t('distribution.matched')} value={headline.matchedCount} />
          <Distribution label={t('distribution.outperformed')} value={headline.outperformedCount} />
        </dl>
      </div>
    );
  }

  return (
    <div
      data-day-review-headline={headline.mode}
      className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:p-4"
    >
      <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3">
        <HeadlineFigure label={t(`headline.total.${headline.mode}`)} value={headline.totalR} tone />
        <HeadlineCount
          label={t(`headline.count.${headline.mode}`)}
          value={headline.eligibleTradeCount}
        />
      </dl>
      <dl className="text-muted-foreground flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-xs">
        <Distribution label={t('outcome.wins')} value={headline.wins} />
        <Distribution label={t('outcome.breakEvens')} value={headline.breakEvens} />
        <Distribution label={t('outcome.losses')} value={headline.losses} />
      </dl>
    </div>
  );
}

function HeadlineFigure({
  label,
  value,
  tone = false,
}: {
  label: string;
  value: string;
  tone?: boolean;
}) {
  const t = useTranslations('dashboard.dayReview');
  const formatted = formatAnalyticsMetric({ status: 'available', value }, 'r');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-[11px] font-medium uppercase">{label}</dt>
      <dd
        className={cn(
          'numeric text-xl leading-7 font-semibold',
          tone &&
            formatted.status === 'available' &&
            formatted.tone === 'positive' &&
            'text-positive',
          tone &&
            formatted.status === 'available' &&
            formatted.tone === 'negative' &&
            'text-negative',
        )}
      >
        {formatted.status === 'available' ? formatted.text : t('notAvailableShort')}
      </dd>
    </div>
  );
}

function HeadlineCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-[11px] font-medium uppercase">{label}</dt>
      <dd className="numeric text-xl leading-7 font-semibold">{value}</dd>
    </div>
  );
}

function Distribution({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="numeric text-foreground font-semibold">{value}</dd>
    </div>
  );
}

function DayReviewRow({
  symbol,
  direction,
  status,
  strategyName,
  setupName,
  axisAt,
  actualR,
  systemR,
  gap,
  href,
  timezone,
  dateLocale,
}: {
  symbol: string;
  direction: 'long' | 'short';
  status: React.ComponentProps<typeof TradeStatusBadge>['status'];
  strategyName: string | null;
  setupName: string | null;
  axisAt: string;
  actualR: string | null;
  systemR: string | null;
  gap: DashboardRecentExecutionGap;
  href: string | null;
  timezone: string;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.dayReview');
  const tTrades = useTranslations('trades');
  const time = formatTradeInstant(axisAt, timezone, dateLocale) ?? '—';
  const classification =
    strategyName === null
      ? tTrades('common.notAssigned')
      : setupName === null
        ? strategyName
        : `${strategyName} · ${setupName}`;

  const body = (
    <div className="grid min-w-0 grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{symbol}</span>
          <span className="text-muted-foreground text-xs">{tTrades(`direction.${direction}`)}</span>
          <TradeStatusBadge status={status} />
        </div>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {classification}
          {' · '}
          {time}
        </p>
      </div>
      <div className="flex min-w-0 shrink-0 items-start gap-4 sm:justify-end">
        <RowFigure label={t('row.actualR')} value={actualR} />
        <RowFigure label={t('row.systemR')} value={systemR} />
        <RowGap gap={gap} />
      </div>
    </div>
  );

  return (
    <li
      data-day-review-row=""
      className="border-border bg-card min-w-0 overflow-hidden rounded-lg border"
    >
      {href === null ? (
        body
      ) : (
        <DashboardStateLink
          href={href}
          data-day-review-trade=""
          className="hover:bg-muted/50 focus-visible:ring-ring block min-w-0 rounded-lg transition-colors outline-none focus-visible:ring-2"
        >
          {body}
        </DashboardStateLink>
      )}
    </li>
  );
}

function RowFigure({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('dashboard.dayReview');
  const formatted =
    value === null ? null : formatAnalyticsMetric({ status: 'available', value }, 'r');
  return (
    <span className="flex min-w-14 flex-col gap-0.5">
      <span className="text-muted-foreground text-[10px] font-medium uppercase">{label}</span>
      <span className="numeric text-sm font-semibold">
        {formatted?.status === 'available' ? formatted.text : t('notAvailableShort')}
      </span>
    </span>
  );
}

/** The row's Gap is D5A's typed state, never `actualR - systemR` recomputed here. */
function RowGap({ gap }: { gap: DashboardRecentExecutionGap }) {
  const t = useTranslations('dashboard.dayReview');
  const formatted =
    gap.status === 'available'
      ? formatAnalyticsMetric({ status: 'available', value: gap.value }, 'r')
      : null;
  return (
    <span className="flex min-w-14 flex-col gap-0.5" data-day-review-gap-status={gap.status}>
      <span className="text-muted-foreground text-[10px] font-medium uppercase">
        {t('row.gapR')}
      </span>
      {formatted !== null && formatted.status === 'available' ? (
        <span
          className={cn(
            'numeric text-sm font-semibold',
            formatted.tone === 'positive' && 'text-positive',
            formatted.tone === 'negative' && 'text-negative',
          )}
        >
          {formatted.text}
        </span>
      ) : (
        <span
          className={cn(
            'text-xs leading-5 font-medium',
            gap.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {gap.status === 'unavailable' ? t('row.gapPending') : t('row.gapError')}
        </span>
      )}
    </span>
  );
}
