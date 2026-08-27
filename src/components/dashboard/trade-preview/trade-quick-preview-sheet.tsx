'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { TradeQuickPreviewModel, TradeQuickPreviewTab } from '@/lib/dashboard/trade-preview';
import { cn } from '@/lib/utils';
import {
  DashboardStateLink,
  useDashboardStateNavigation,
} from '@/components/dashboard/dashboard-state-link';
import { formatTradeInstant, formatTradeMoney } from '@/components/trades/trade-format';
import { TradeStatusBadge } from '@/components/trades/trade-status-badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Link } from '@/i18n/navigation';

export interface TradeQuickPreviewSheetProps {
  readonly trade: TradeQuickPreviewModel;
  /** Closing returns to the Day Review that opened it — never to a bare Dashboard. */
  readonly closeHref: string;
  readonly timezone: string;
  readonly dateLocale: string;
}

/**
 * D6B — the Quick Trade Preview.
 *
 * A READER, NOT A SECOND JOURNAL EDITOR. Every value comes from the canonical
 * `getWorkspaceTradeDetail` the Journal already uses, projected once by
 * `composeTradeQuickPreview`; nothing is recomputed, and the Execution Gap in
 * particular is the calc engine's own derived figure rather than
 * `actualR - systemR` done again in React. Anything that needs changing is a
 * link into the Journal.
 *
 * URL-backed like the Day Review above it: the sheet exists only while
 * `trade` is in the address bar, so refresh reconstructs it, a deep link opens
 * it, and closing is an ordinary navigation back to the day — which is why
 * closing the Trade leaves the Day Review open rather than dismissing both.
 *
 * One sheet, two geometries: full width on a phone (a 3/4-width side panel at
 * 390px would be neither a panel nor a page), a right-hand panel from `sm` up.
 */
export function TradeQuickPreviewSheet({
  trade,
  closeHref,
  timezone,
  dateLocale,
}: TradeQuickPreviewSheetProps) {
  const t = useTranslations('dashboard.tradePreview');
  const tTrades = useTranslations('trades');
  const tCommon = useTranslations('common');
  const navigateDashboardState = useDashboardStateNavigation();
  const baseId = useId();
  const [active, setActive] = useState<TradeQuickPreviewTab>('overview');

  const tabs = trade.tabs;
  const current = tabs.includes(active) ? active : 'overview';

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) navigateDashboardState(closeHref);
      }}
    >
      <SheetContent
        side="right"
        closeLabel={tCommon('close')}
        data-trade-preview={trade.tradeId}
        className="w-full gap-0 p-0 sm:max-w-md lg:max-w-lg"
      >
        <SheetHeader className="border-border shrink-0 border-b p-4">
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base">{trade.symbol}</span>
            <span className="text-muted-foreground text-xs font-normal">
              {tTrades(`direction.${trade.direction}`)}
            </span>
            <TradeStatusBadge status={trade.status} />
          </SheetTitle>
          <SheetDescription>
            {trade.tradingAccountName}
            {' · '}
            {formatTradeInstant(trade.exitedAt ?? trade.enteredAt, timezone, dateLocale) ?? '—'}
          </SheetDescription>
        </SheetHeader>

        {/*
          A real tablist: arrow keys, Home/End and roving tabindex come from
          the browser's own button semantics plus explicit ARIA wiring, so the
          six condensed sections are keyboard-operable without a router change.
          The tab is view state and nothing else — it is deliberately NOT in
          the URL, because which tab was open is not a fact about the Trade.
        */}
        {tabs.length > 1 ? (
          <div
            role="tablist"
            aria-label={t('tabsLabel')}
            className="border-border flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5"
            onKeyDown={(event) => {
              const index = tabs.indexOf(current);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + tabs.length) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              const target = tabs[next];
              if (target === undefined) return;
              setActive(target);
              document.getElementById(`${baseId}-tab-${target}`)?.focus();
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab}`}
                aria-selected={tab === current}
                aria-controls={`${baseId}-panel-${tab}`}
                tabIndex={tab === current ? 0 : -1}
                data-trade-preview-tab={tab}
                onClick={() => setActive(tab)}
                className={cn(
                  'focus-visible:ring-ring inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2',
                  tab === current
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </div>
        ) : null}

        <div
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          id={`${baseId}-panel-${current}`}
          aria-labelledby={tabs.length > 1 ? `${baseId}-tab-${current}` : undefined}
          tabIndex={tabs.length > 1 ? 0 : undefined}
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {current === 'overview' ? (
            <OverviewPanel trade={trade} timezone={timezone} dateLocale={dateLocale} />
          ) : current === 'strategy' ? (
            <StrategyPanel trade={trade} />
          ) : current === 'review' ? (
            <ReviewPanel trade={trade} />
          ) : current === 'executions' ? (
            <ExecutionsPanel trade={trade} timezone={timezone} dateLocale={dateLocale} />
          ) : current === 'chart' ? (
            <ChartPanel trade={trade} />
          ) : (
            <NotesPanel trade={trade} />
          )}
        </div>

        <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-t p-3">
          <Link
            href={`/app/trades?trade=${trade.tradeId}`}
            data-trade-preview-open-journal=""
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('openInJournal')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <DashboardStateLink
            href={closeHref}
            data-trade-preview-close=""
            className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2"
          >
            {t('backToDay')}
          </DashboardStateLink>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The three attribution figures lead, because they are the reason the product
 * exists. Identity and context follow them rather than the other way round.
 */
function OverviewPanel({
  trade,
  timezone,
  dateLocale,
}: {
  trade: TradeQuickPreviewModel;
  timezone: string;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.tradePreview');
  const tTrades = useTranslations('trades');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl
        data-trade-preview-results=""
        className="border-border bg-muted/30 grid min-w-0 grid-cols-3 gap-3 rounded-lg border p-3"
      >
        <Figure label={t('actualR')} value={trade.actualR} />
        <Figure label={t('systemR')} value={trade.systemR} />
        <Figure label={t('executionGapR')} value={trade.executionGapR} tone />
      </dl>

      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Fact label={t('account')} value={trade.tradingAccountName} />
        <Fact label={t('status')} value={tTrades(`status.execution.${trade.status}`)} />
        <Fact
          label={t('enteredAt')}
          value={formatTradeInstant(trade.enteredAt, timezone, dateLocale)}
        />
        <Fact
          label={t('exitedAt')}
          value={formatTradeInstant(trade.exitedAt, timezone, dateLocale)}
        />
        <Fact
          label={t('systemExitedAt')}
          value={formatTradeInstant(trade.systemExitedAt, timezone, dateLocale)}
        />
        <Fact label={t('timeframe')} value={trade.timeframe} />
        <Fact label={t('session')} value={trade.session} />
      </dl>
    </div>
  );
}

function StrategyPanel({ trade }: { trade: TradeQuickPreviewModel }) {
  const t = useTranslations('dashboard.tradePreview');
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact
        label={t('strategy')}
        value={
          trade.strategyName === null
            ? null
            : trade.strategyVersionNumber === null
              ? trade.strategyName
              : `${trade.strategyName} (v${trade.strategyVersionNumber})`
        }
      />
      <Fact label={t('setup')} value={trade.setupName} />
      <Fact label={t('plannedR')} value={trade.plannedR} />
    </dl>
  );
}

function ReviewPanel({ trade }: { trade: TradeQuickPreviewModel }) {
  const t = useTranslations('dashboard.tradePreview');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {trade.ruleChecks.length === 0 ? null : (
        <section>
          <h3 className="text-label text-muted-foreground uppercase">{t('rules')}</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {trade.ruleChecks.map((rule) => (
              <li key={rule.ruleKey} className="flex min-w-0 items-start justify-between gap-3">
                <span className="min-w-0 text-sm">{rule.title}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t(`ruleStatus.${rule.checkStatus}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {trade.mistakes.length === 0 ? null : (
        <section>
          <h3 className="text-label text-muted-foreground uppercase">{t('mistakes')}</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {trade.mistakes.map((mistake) => (
              <li
                key={mistake.key}
                className="border-border bg-muted/40 rounded-md border px-2 py-1 text-xs"
              >
                {mistake.label}
              </li>
            ))}
          </ul>
        </section>
      )}
      {trade.emotions.length === 0 ? null : (
        <section>
          <h3 className="text-label text-muted-foreground uppercase">{t('emotions')}</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {trade.emotions.map((emotion) => (
              <li
                key={emotion.key}
                className="border-border bg-muted/40 rounded-md border px-2 py-1 text-xs"
              >
                {emotion.label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Execution legs — the one place a partially closed position stops being one
 * row. The Calendar and the Day Review count positions (one Trade, one row,
 * by construction); the legs are here, where scaling out is the actual
 * subject.
 */
function ExecutionsPanel({
  trade,
  timezone,
  dateLocale,
}: {
  trade: TradeQuickPreviewModel;
  timezone: string;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.tradePreview');
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {t('closedPortion', {
          closed: (trade.closedBps / 100).toFixed(2),
          remaining: (trade.remainingBps / 100).toFixed(2),
        })}
      </p>
      <ul data-trade-preview-exits={trade.exits.length} className="flex flex-col gap-2">
        {trade.exits.map((exit) => (
          <li key={exit.exitId} className="border-border rounded-lg border p-3">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">
                {t('legLabel', { sequence: exit.sequence })}
              </span>
              <span className="numeric text-muted-foreground text-xs">
                {(exit.closedBps / 100).toFixed(2)}%
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              <Fact label={t('exitPrice')} value={exit.exitPrice} />
              <Fact
                label={t('realizedPnl')}
                value={formatTradeMoney(exit.realizedPnlMinor, trade.tradingAccountBaseCurrency)}
              />
              <Fact
                label={t('exitedAt')}
                value={formatTradeInstant(exit.exitedAt, timezone, dateLocale)}
              />
              <Fact label={t('exitReason')} value={exit.exitReason} />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartPanel({ trade }: { trade: TradeQuickPreviewModel }) {
  const t = useTranslations('dashboard.tradePreview');
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {trade.tradingviewUrl === null ? null : (
        <a
          href={trade.tradingviewUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-3 text-sm font-semibold break-all outline-none focus-visible:ring-2"
        >
          {t('openTradingView')} <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </a>
      )}
      {trade.hasChartAttachment ? (
        // The authenticated delivery route re-derives its own session and
        // Workspace authorization; this only points at it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/trades/${trade.tradeId}/chart-attachment`}
          alt={t('chartAlt', { symbol: trade.symbol })}
          className="border-border h-auto max-w-full rounded-lg border"
        />
      ) : null}
    </div>
  );
}

function NotesPanel({ trade }: { trade: TradeQuickPreviewModel }) {
  const t = useTranslations('dashboard.tradePreview');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <NoteBlock label={t('confirmationNotes')} value={trade.confirmationNotes} />
      <NoteBlock label={t('notes')} value={trade.notes} />
      <NoteBlock label={t('reviewNotes')} value={trade.reviewNotes} />
    </div>
  );
}

function NoteBlock({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <section>
      <h3 className="text-label text-muted-foreground uppercase">{label}</h3>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{value}</p>
    </section>
  );
}

function Figure({
  label,
  value,
  tone = false,
}: {
  label: string;
  value: string | null;
  tone?: boolean;
}) {
  const t = useTranslations('dashboard.tradePreview');
  const formatted =
    value === null ? null : formatAnalyticsMetric({ status: 'available', value }, 'r');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-[10px] font-medium uppercase">{label}</dt>
      <dd
        className={cn(
          'numeric truncate text-base leading-6 font-semibold',
          tone &&
            formatted?.status === 'available' &&
            formatted.tone === 'positive' &&
            'text-positive',
          tone &&
            formatted?.status === 'available' &&
            formatted.tone === 'negative' &&
            'text-negative',
        )}
      >
        {formatted?.status === 'available' ? formatted.text : t('notAvailableShort')}
      </dd>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('dashboard.tradePreview');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-[10px] font-medium uppercase">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{value ?? t('notAvailableShort')}</dd>
    </div>
  );
}
