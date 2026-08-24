'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import type { StatusKind } from '@/lib/status/status-kind';
import type { TradeDetailSection } from '@/lib/trades/section';
import { cn } from '@/lib/utils';
import type { TradeListItem } from '@/server/dal/trades';
import { StatusBadge } from '@/components/status/status-badge';
import { formatR } from '@/components/trades/trade-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link, usePathname } from '@/i18n/navigation';

export type TradeListView = TradeListItem & { readonly occurredAtDisplay: string };
type Translation = ReturnType<typeof useTranslations<'trades'>>;

function ArchivedNote({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <Badge variant="neutral" className="ml-1.5 px-1.5 py-0 text-[10px]">
      {label}
    </Badge>
  );
}

function performanceTone(value: string | null): string {
  if (value === null || Number(value) === 0) return 'text-muted-foreground';
  return value.startsWith('-') ? 'text-negative' : 'text-positive';
}

function RValue({ value, label }: { value: string | null; label?: string }) {
  const formatted = formatR(value);
  if (formatted === null) return null;
  return (
    <span className={cn('font-mono text-sm font-semibold tabular-nums', performanceTone(value))}>
      {label === undefined ? null : <span className="sr-only">{label}: </span>}
      {formatted}
    </span>
  );
}

function LabeledStatus({ kind, label }: { kind: StatusKind; label: string }) {
  return <StatusBadge kind={kind} label={label} className="max-w-full" />;
}

function ActualSummary({ trade, t }: { trade: TradeListView; t: Translation }) {
  if (trade.status === 'planned') {
    return <LabeledStatus kind="needs_attention" label={t('list.needsExecutionDetails')} />;
  }
  if (trade.status === 'open') {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <LabeledStatus kind="active" label={t('status.execution.open')} />
        {trade.closedBps > 0 ? (
          <span className="text-muted-foreground text-xs">
            {t('list.remainingPercent', { percent: trade.remainingBps / 100 })}
          </span>
        ) : null}
        {trade.closedBps > 0 ? (
          <RValue value={trade.realizedRToDate} label={t('list.realized')} />
        ) : null}
      </div>
    );
  }
  if (trade.status === 'closed') {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <LabeledStatus kind="complete" label={t('status.execution.closed')} />
        <RValue value={trade.actualR} label={t('list.actualR')} />
      </div>
    );
  }
  return <LabeledStatus kind="not_recorded" label={t('status.execution.canceled')} />;
}

function SystemSummary({ trade, t }: { trade: TradeListView; t: Translation }) {
  const kind: StatusKind =
    trade.systemStatus === 'resolved'
      ? 'complete'
      : trade.systemStatus === 'pending'
        ? 'needs_attention'
        : 'not_recorded';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <LabeledStatus kind={kind} label={t(`status.system.${trade.systemStatus}`)} />
      {trade.systemStatus === 'resolved' ? (
        <RValue value={trade.systemR} label={t('list.systemR')} />
      ) : null}
    </div>
  );
}

function StrategySummary({ trade, t }: { trade: TradeListView; t: Translation }) {
  if (trade.strategyName === null) {
    return <span className="text-muted-foreground break-words">{t('common.notAssigned')}</span>;
  }
  return (
    <span className="font-medium break-words">
      {trade.strategyName}
      <ArchivedNote show={trade.strategyIsArchived} label={t('common.archived')} />
    </span>
  );
}

type RowAttention = {
  readonly section: TradeDetailSection;
  readonly message: string;
  readonly action: string;
};

/** One deterministic row action: legacy Actual, then pending System, then optional classification. */
function getAttention(
  trade: TradeListView,
  canWrite: boolean,
  t: Translation,
): RowAttention | null {
  if (trade.status === 'planned') {
    return {
      section: 'actual',
      message: t('list.attention.execution'),
      action: canWrite ? t('list.action.addExecution') : t('list.action.viewActual'),
    };
  }
  if (trade.systemStatus === 'pending') {
    return {
      section: 'system',
      message: t('list.attention.system'),
      action: canWrite ? t('list.action.updateSystem') : t('list.action.viewSystem'),
    };
  }
  if (canWrite && trade.strategyName === null) {
    return {
      section: 'strategy',
      message: t('list.attention.strategy'),
      action: t('list.action.addStrategy'),
    };
  }
  return null;
}

export function TradeList({
  trades,
  selectedTradeId,
  nextCursor,
  currentCursor,
  cursorTrail,
  canWrite,
}: {
  trades: readonly TradeListView[];
  selectedTradeId: string | null;
  nextCursor: string | null;
  currentCursor: string | null;
  cursorTrail: string;
  canWrite: boolean;
}) {
  const t = useTranslations('trades');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousCursors = cursorTrail.split(',').filter(Boolean).slice(-99);
  const pageNumber = currentCursor === null ? 1 : previousCursors.length + 2;

  function tradeHref(tradeId: string, section?: TradeDetailSection): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('trade', tradeId);
    if (section === undefined) params.delete('section');
    else params.set('section', section);
    return `${pathname}?${params.toString()}`;
  }

  function nextHref(cursor: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('trade');
    params.delete('section');
    params.set('cursor', cursor);
    const nextTrail =
      currentCursor === null ? previousCursors : [...previousCursors, currentCursor];
    if (nextTrail.length === 0) params.delete('trail');
    else params.set('trail', nextTrail.join(','));
    return `${pathname}?${params.toString()}`;
  }

  function previousHref(): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('trade');
    params.delete('section');
    const previousCursor = previousCursors.at(-1);
    if (previousCursor === undefined) params.delete('cursor');
    else params.set('cursor', previousCursor);
    const remainingTrail = previousCursors.slice(0, -1);
    if (remainingTrail.length === 0) params.delete('trail');
    else params.set('trail', remainingTrail.join(','));
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        role="list"
        aria-label={t('list.caption')}
        className="border-border divide-border grid min-w-0 divide-y border-y md:gap-0 md:overflow-hidden md:rounded-lg md:border"
      >
        <div className="bg-surface text-muted-foreground hidden grid-cols-[minmax(9rem,1.05fr)_minmax(8rem,0.9fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_auto] gap-3 px-3 py-2 text-[11px] font-semibold tracking-[0.08em] uppercase md:grid">
          <span>{t('list.date')}</span>
          <span>{t('list.trade')}</span>
          <span>{t('list.actual')}</span>
          <span>{t('list.system')}</span>
          <span>{t('list.strategy')}</span>
          <span>{t('list.action.label')}</span>
        </div>
        {trades.map((trade) => {
          const attention = getAttention(trade, canWrite, t);
          const isOpen = trade.status === 'open';
          const isSelected = selectedTradeId === trade.tradeId;
          return (
            <article
              key={trade.tradeId}
              role="listitem"
              aria-labelledby={`trade-${trade.tradeId}`}
              className={cn(
                'bg-card hover:bg-primary/[0.05] min-w-0 px-1 py-3 transition-colors md:grid md:grid-cols-[minmax(9rem,1.05fr)_minmax(8rem,0.9fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_auto] md:items-center md:gap-3 md:border-0 md:p-3',
                isOpen && 'border-info/25',
                isSelected && 'bg-primary/[0.08] md:shadow-[inset_2px_0_0_var(--primary)]',
              )}
            >
              <div className="text-muted-foreground hidden min-w-0 text-xs md:block">
                <span className="break-words">{trade.occurredAtDisplay}</span>
                <span className="block break-words">
                  {trade.tradingAccountName}
                  <ArchivedNote
                    show={trade.tradingAccountIsArchived}
                    label={t('common.archived')}
                  />
                </span>
              </div>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 md:text-right">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Link
                      id={`trade-${trade.tradeId}`}
                      href={tradeHref(trade.tradeId)}
                      aria-current={isSelected ? 'page' : undefined}
                      className="focus-visible:ring-ring rounded-sm text-base font-bold break-all outline-none hover:underline focus-visible:ring-2"
                    >
                      {trade.symbol}
                    </Link>
                    <span className="text-sm font-semibold tracking-wide uppercase">
                      {t(`direction.${trade.direction}`)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs break-words md:hidden">
                    {trade.occurredAtDisplay}
                    <span aria-hidden="true"> · </span>
                    <span className="break-words">{trade.tradingAccountName}</span>
                    <ArchivedNote
                      show={trade.tradingAccountIsArchived}
                      label={t('common.archived')}
                    />
                  </p>
                </div>
              </div>

              <dl className="mt-3 grid min-w-0 gap-3 border-t pt-3 sm:grid-cols-3 md:contents">
                <div className="min-w-0 md:text-right">
                  <dt className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase md:sr-only">
                    {t('list.actual')}
                  </dt>
                  <dd>
                    <ActualSummary trade={trade} t={t} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase md:sr-only">
                    {t('list.system')}
                  </dt>
                  <dd>
                    <SystemSummary trade={trade} t={t} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground mb-1 text-[11px] font-medium tracking-wide uppercase md:sr-only">
                    {t('list.strategy')}
                  </dt>
                  <dd className="text-sm">
                    <StrategySummary trade={trade} t={t} />
                  </dd>
                </div>
              </dl>

              <div
                className={cn(
                  'mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t pt-3 md:mt-0 md:justify-end md:border-0 md:pt-0',
                  attention === null ? 'justify-end' : 'justify-between',
                )}
              >
                {attention === null ? null : (
                  <p className="text-sm font-medium break-words md:sr-only">{attention.message}</p>
                )}
                <Button asChild variant={attention === null ? 'ghost' : 'outline'} size="sm">
                  <Link href={tradeHref(trade.tradeId, attention?.section)}>
                    {attention?.action ?? t('list.action.openTrade')}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <nav aria-label={t('pagination.label')} className="flex items-center justify-between gap-3">
        {currentCursor === null ? (
          <Button variant="outline" disabled>
            <ArrowLeft aria-hidden="true" /> {t('pagination.previous')}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={previousHref()}>
              <ArrowLeft aria-hidden="true" /> {t('pagination.previous')}
            </Link>
          </Button>
        )}
        <span className="text-muted-foreground text-sm font-medium" aria-current="page">
          {t('pagination.page', { page: pageNumber })}
        </span>
        {nextCursor === null ? (
          <Button variant="outline" disabled>
            {t('pagination.next')} <ArrowRight aria-hidden="true" />
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href={nextHref(nextCursor)}>
              {t('pagination.next')} <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </nav>
    </div>
  );
}
