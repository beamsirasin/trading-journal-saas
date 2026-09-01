'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { TradeDetail } from '@/server/dal/trades';
import { ActualSection } from '@/components/trades/trade-actual-section';
import { formatR, formatTradeInstant, formatTradeMoney } from '@/components/trades/trade-format';
import { PanelEmpty, PanelSection } from '@/components/trades/workspace/panel-primitives';

/**
 * EXECUTION — what actually happened, in the order it happened.
 *
 * ONE TIMELINE, BUILT ONLY FROM RECORDED EVENTS. This product's execution
 * domain stores exactly three kinds of fact: the entry (`entered_at`, with the
 * actual entry price and initial stop), each partial or full exit leg
 * (`trade_exits`, ordered by `sequence`, each with its own closed basis
 * points, price, realized P&L and reason), and the settled final result.
 * Those are the only events rendered.
 *
 * NOTHING IS INVENTED TO FILL THE SHAPE. A "stop moved to break even" entry
 * would read beautifully here and this domain does not record one — no column,
 * no table, no timestamp — so it is not drawn. The component is deliberately
 * built as a list of typed events rather than as three hard-coded blocks, so
 * that when the domain does gain stop-adjustment or scale-in events they can
 * be appended to the same list without this file being redesigned. Extending
 * the execution SCHEMA is not this UI pass's job (CLAUDE.md section 10: do not
 * rewrite unrelated code).
 *
 * PARTIAL CLOSES ARE FIRST-CLASS. The legs are the whole point of the tab: a
 * position scaled out in three pieces is three events with three realized
 * figures, and the settled Actual R at the end is the calc engine's own
 * figure over all of them — never these legs re-summed in React.
 *
 * `ActualSection` follows the timeline and is reused verbatim: it owns the
 * full execution record and every mutation (Open, Add Exit, Close Remaining,
 * and the correction dialogs). The timeline is the reading; that section is
 * the working surface.
 */
export function TradeExecutionPanel({
  trade,
  timezone,
  locale,
  canWrite,
}: {
  trade: TradeDetail;
  timezone: string;
  locale: string;
  canWrite: boolean;
}) {
  const t = useTranslations('trades.workspace.details');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection title={t('groups.timeline')}>
        <ExecutionTimeline trade={trade} timezone={timezone} locale={locale} />
      </PanelSection>

      <div className="border-border border-t pt-5">
        <ActualSection trade={trade} timezone={timezone} locale={locale} canWrite={canWrite} />
      </div>
    </div>
  );
}

interface TimelineEvent {
  readonly key: string;
  readonly kind: 'entry' | 'exit' | 'result';
  readonly at: string | null;
  readonly title: string;
  readonly lines: readonly string[];
}

function ExecutionTimeline({
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

  const money = (value: string | null) => formatTradeMoney(value, trade.tradingAccountBaseCurrency);

  const events: TimelineEvent[] = [];

  if (trade.enteredAt !== null) {
    const lines: string[] = [];
    if (trade.actualEntry !== null) {
      lines.push(
        t('timeline.entryPrice', {
          direction: tTrades(`direction.${trade.direction}`),
          price: trade.actualEntry,
        }),
      );
    }
    if (trade.actualInitialStop !== null) {
      lines.push(`${tTrades('field.initialStop')}: ${trade.actualInitialStop}`);
    }
    if (trade.actualPositionSize !== null) {
      lines.push(`${tTrades('field.actualPositionSize')}: ${trade.actualPositionSize}`);
    }
    events.push({
      key: 'entry',
      kind: 'entry',
      at: trade.enteredAt,
      title: t('timeline.entry'),
      lines,
    });
  }

  for (const exit of trade.exits) {
    const lines: string[] = [];
    if (exit.exitPrice !== null) lines.push(`${tTrades('field.exit')}: ${exit.exitPrice}`);
    const realized = money(exit.realizedPnlMinor);
    if (realized !== null) lines.push(`${tTrades('field.realizedPnl')}: ${realized}`);
    if (exit.exitReason !== null) lines.push(`${tTrades('field.exitReason')}: ${exit.exitReason}`);
    events.push({
      key: exit.exitId,
      kind: 'exit',
      at: exit.exitedAt,
      // A leg that closes the whole remainder is still just a leg; the
      // percentage says which it was without a second vocabulary for it.
      title: t('timeline.exit', {
        sequence: exit.sequence,
        percent: (exit.closedBps / 100).toFixed(exit.closedBps % 100 === 0 ? 0 : 2),
      }),
      lines,
    });
  }

  if (trade.status === 'closed') {
    const lines: string[] = [];
    const net = money(trade.netPnlMinor);
    if (net !== null) lines.push(`${tTrades('field.netPnl')}: ${net}`);
    events.push({
      key: 'result',
      kind: 'result',
      at: trade.exitedAt,
      title: `${tTrades('field.actualR')} ${formatR(trade.actualR) ?? tTrades('common.notAvailable')}`,
      lines,
    });
  }

  if (events.length === 0) {
    return (
      <PanelEmpty
        title={t('empty.execution.title')}
        description={t('empty.execution.description')}
      />
    );
  }

  return (
    <ol data-trade-timeline={events.length} className="flex min-w-0 flex-col">
      {events.map((event, index) => (
        <li key={event.key} className="flex min-w-0 gap-3">
          {/*
            The rail is drawn with a dot and a connector rather than a border
            on the content, so the last event's connector can stop at its dot
            instead of trailing into empty space. Purely decorative: the
            ordered list already carries the sequence for assistive tech.
          */}
          <div aria-hidden="true" className="flex flex-col items-center pt-1.5">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                event.kind === 'result' ? 'bg-primary' : 'bg-border',
              )}
            />
            {index === events.length - 1 ? null : <span className="bg-border w-px flex-1" />}
          </div>
          <div className={cn('min-w-0 flex-1', index === events.length - 1 ? 'pb-0' : 'pb-4')}>
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
              <p
                className={cn(
                  'min-w-0 text-sm break-words',
                  event.kind === 'result' ? 'font-semibold' : 'font-medium',
                )}
              >
                {event.title}
              </p>
              <p className="text-muted-foreground shrink-0 text-xs">
                {formatTradeInstant(event.at, timezone, locale) ?? ''}
              </p>
            </div>
            {event.lines.map((line) => (
              <p key={line} className="text-muted-foreground mt-0.5 text-xs break-words">
                {line}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
