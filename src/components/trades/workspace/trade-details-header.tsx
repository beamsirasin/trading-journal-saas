'use client';

import { useTranslations } from 'next-intl';

import { deriveTradeResult } from '@/lib/trades/result';
import { cn } from '@/lib/utils';
import type { TradeDetail } from '@/server/dal/trades';
import { formatR, formatTradeDay, formatTradeMoney } from '@/components/trades/trade-format';

import { TradeResultBadge } from './trade-result-badge';

/**
 * TRADE DETAILS — the identity block every tab sits under.
 *
 * Three lines of identity, then one hero, then the comparison this product
 * exists to make. In that order, because a trader opening a Trade asks "which
 * one is this?" before "how did it go?" and "how did it go?" before "was that
 * the system or was that me?".
 *
 * THE HERO IS THE TRADER AXIS. Net P&L and Actual R together: the money is
 * what the account felt, the R is what makes this Trade comparable to every
 * other one regardless of how it was sized. Neither is derived here — both are
 * the Trade's own stored canonical figures.
 *
 * THE COMPARISON APPEARS ONLY WHEN IT IS TRUE. `executionGapR` is the calc
 * engine's own `Actual R - System R`, resolved server-side and already `null`
 * whenever either side is not final (an unresolved System, an open position).
 * When it is `null`, this renders an honest one-line explanation of WHY rather
 * than three rows of dashes or, worse, a fabricated 0.00R gap that would claim
 * the trader executed the plan perfectly.
 */
export function TradeDetailsHeader({
  trade,
  timezone,
  locale,
}: {
  trade: TradeDetail;
  timezone: string;
  locale: string;
}) {
  const t = useTranslations('trades.workspace.details');
  const tTrades = useTranslations('trades');

  const day = formatTradeDay(
    trade.exitedAt ?? trade.enteredAt ?? trade.createdAt,
    timezone,
    locale,
  );
  const netPnl = formatTradeMoney(trade.netPnlMinor, trade.tradingAccountBaseCurrency);
  const actualR = formatR(trade.status === 'closed' ? trade.actualR : trade.realizedRToDate);
  const isRealized = trade.status === 'open' && trade.closedBps > 0;

  // Symbol, then account, then the three context facts that are actually
  // recorded. A Trade with no session and no timeframe simply says less
  // rather than printing two placeholders.
  const context = [day, trade.session, trade.timeframe].filter(
    (value): value is string => value !== null && value !== '',
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div data-trade-details-identity="" className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm tracking-wide uppercase">
            {tTrades(`direction.${trade.direction}`)}
          </span>
          <span aria-hidden="true" className="text-subtle-foreground text-sm">
            ·
          </span>
          <span className="text-muted-foreground text-sm">
            {tTrades(`status.execution.${trade.status}`)}
          </span>
          <TradeResultBadge result={deriveTradeResult(trade)} />
        </div>
        <p className="text-muted-foreground min-w-0 text-xs break-words">
          {trade.tradingAccountName}
          {context.length === 0 ? null : (
            <>
              <span aria-hidden="true"> · </span>
              {context.join(' · ')}
            </>
          )}
        </p>
      </div>

      <div
        data-trade-details-hero=""
        className="border-border bg-muted/30 flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2 rounded-lg border p-3"
      >
        <Hero label={t('hero.netPnl')} value={netPnl} signMinor={trade.netPnlMinor} showPlus />
        <Hero
          label={isRealized ? t('hero.realizedR') : t('hero.actualR')}
          value={actualR}
          signMinor={trade.status === 'closed' ? trade.actualR : trade.realizedRToDate}
        />
      </div>

      <SystemComparison trade={trade} />
    </div>
  );
}

function Hero({
  label,
  value,
  signMinor,
  showPlus = false,
}: {
  label: string;
  value: string | null;
  /** The raw signed source, so tone comes from the number rather than its rendering. */
  signMinor: string | null;
  showPlus?: boolean;
}) {
  const t = useTranslations('trades.workspace.details');
  const isNegative = signMinor?.startsWith('-') ?? false;
  const isZero = signMinor !== null && Number(signMinor) === 0;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-label uppercase">{label}</span>
      <span
        className={cn(
          'numeric text-metric',
          value === null
            ? 'text-muted-foreground text-base'
            : isZero
              ? 'text-foreground'
              : isNegative
                ? 'text-negative'
                : 'text-positive',
        )}
      >
        {value === null
          ? t('notRecordedShort')
          : `${showPlus && !isNegative && !isZero ? '+' : ''}${value}`}
      </span>
    </div>
  );
}

/**
 * PLAN vs ACTUAL, SYSTEM vs TRADER — in three rows, and only when all three
 * are honest.
 *
 * The naming is deliberate and beginner-first: "What the system offered" and
 * "What you captured" say what the two numbers MEAN, with the canonical
 * metric names beside them so the vocabulary is still learnable. The gap is
 * the difference, signed the way CLAUDE.md section 6 locks it — negative means
 * the trader captured less than the system offered.
 */
function SystemComparison({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades.workspace.details');

  if (trade.executionGapR === null) {
    // Say which side is missing. "Not available" alone leaves the reader with
    // no idea whether to resolve a System outcome or to close a position.
    const reason =
      trade.systemStatus === 'no_trade'
        ? 'systemNoTrade'
        : trade.systemStatus !== 'resolved'
          ? 'systemPending'
          : trade.status !== 'closed'
            ? 'actualIncomplete'
            : 'unavailable';
    return (
      <p
        data-trade-comparison="unavailable"
        data-trade-comparison-reason={reason}
        className="text-muted-foreground border-border rounded-lg border border-dashed p-3 text-xs leading-relaxed"
      >
        {t(`comparison.${reason}`)}
      </p>
    );
  }

  return (
    <dl data-trade-comparison="available" className="flex min-w-0 flex-col gap-1.5">
      <ComparisonRow label={t('comparison.system')} value={formatR(trade.systemR)} />
      <ComparisonRow label={t('comparison.actual')} value={formatR(trade.actualR)} />
      <ComparisonRow
        label={t('comparison.gap')}
        value={formatR(trade.executionGapR)}
        raw={trade.executionGapR}
        emphasis
      />
    </dl>
  );
}

function ComparisonRow({
  label,
  value,
  raw,
  emphasis = false,
}: {
  label: string;
  value: string | null;
  raw?: string | null;
  emphasis?: boolean;
}) {
  const t = useTranslations('trades.workspace.details');
  const isNegative = raw?.startsWith('-') ?? false;
  const isZero = raw !== undefined && raw !== null && Number(raw) === 0;

  return (
    <div
      className={cn(
        'flex min-w-0 items-baseline justify-between gap-3 text-sm',
        emphasis && 'border-border border-t pt-1.5 font-semibold',
      )}
    >
      <dt className="text-muted-foreground min-w-0 break-words">{label}</dt>
      <dd
        className={cn(
          'numeric shrink-0',
          raw === undefined || value === null
            ? ''
            : isZero
              ? 'text-foreground'
              : isNegative
                ? 'text-negative'
                : 'text-positive',
        )}
      >
        {value ?? t('notRecordedShort')}
      </dd>
    </div>
  );
}
