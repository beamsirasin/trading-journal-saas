'use client';

import { useTranslations } from 'next-intl';

import { tradeHoldingTime } from '@/lib/trades/holding-time';
import type { TradeDetail } from '@/server/dal/trades';
import { formatR, formatTradeInstant, formatTradeMoney } from '@/components/trades/trade-format';
import { Fact, FactGrid, PanelSection } from '@/components/trades/workspace/panel-primitives';

/**
 * OVERVIEW — "what happened in this Trade?", answered in four small groups
 * rather than one long stats table.
 *
 *   RESULT      the four figures the product exists to compare
 *   TRADE       identity and timing
 *   PRICE       where it was entered, stopped, targeted and exited
 *   COST & SIZE what it cost to hold and how big it was
 *
 * NOTHING IS COMPUTED HERE. Every figure is the Trade's own stored canonical
 * value — including `executionGapR`, which the DAL already derived through the
 * calc engine's own `executionGapR` rather than being `actualR - systemR`
 * subtracted again at a presentation boundary (CLAUDE.md section 6).
 *
 * EMPTY ROWS ARE DROPPED, NOT PADDED. A price-mode Trade has no monetary
 * initial risk and a money-mode Trade has no exit price; printing a dash for
 * either would suggest a missing record rather than an inapplicable field. The
 * groups that would be entirely empty do not render at all.
 */
export function TradeOverviewPanel({
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
  const instant = (value: string | null) => formatTradeInstant(value, timezone, locale);
  const held = tradeHoldingTime(trade.enteredAt, trade.exitedAt);

  const hasPrices =
    trade.actualEntry !== null ||
    trade.actualExit !== null ||
    trade.actualInitialStop !== null ||
    trade.plannedTarget !== null;
  const hasCosts =
    trade.actualPositionSize !== null ||
    trade.actualInitialRiskMinor !== null ||
    trade.commissionMinor !== '0' ||
    trade.feesMinor !== '0' ||
    trade.swapMinor !== '0';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection title={t('groups.result')}>
        <FactGrid>
          <Fact label={tTrades('field.netPnl')} value={money(trade.netPnlMinor)} tone="neutral" />
          <Fact
            label={tTrades('field.actualR')}
            value={formatR(trade.status === 'closed' ? trade.actualR : trade.realizedRToDate)}
            hint={t('hints.actualR')}
            tone="neutral"
          />
          <Fact
            label={tTrades('field.systemR')}
            value={formatR(trade.systemR)}
            hint={t('hints.systemR')}
            tone="neutral"
          />
          <Fact
            label={tTrades('field.executionGap')}
            value={formatR(trade.executionGapR)}
            hint={t('hints.executionGap')}
            tone="neutral"
          />
        </FactGrid>
      </PanelSection>

      <PanelSection title={t('groups.trade')}>
        <FactGrid>
          <Fact label={tTrades('field.symbol')} value={trade.symbol} />
          <Fact
            label={tTrades('field.direction')}
            value={tTrades(`direction.${trade.direction}`)}
          />
          <Fact label={tTrades('field.enteredAt')} value={instant(trade.enteredAt)} />
          <Fact label={tTrades('field.exitedAt')} value={instant(trade.exitedAt)} />
          <Fact
            label={t('holdingTime')}
            value={
              held === null
                ? null
                : held.days > 0
                  ? t('duration.dayHour', { days: held.days, hours: held.hours })
                  : held.hours > 0
                    ? t('duration.hourMinute', { hours: held.hours, minutes: held.minutes })
                    : t('duration.minute', { minutes: held.minutes })
            }
          />
          <Fact label={tTrades('field.account')} value={trade.tradingAccountName} />
        </FactGrid>
      </PanelSection>

      {hasPrices ? (
        <PanelSection title={t('groups.price')}>
          <FactGrid>
            <Fact
              label={tTrades('field.actualEntry')}
              value={trade.actualEntry}
              omitWhenEmpty
              tone="neutral"
            />
            <Fact
              label={tTrades('field.exit')}
              value={trade.actualExit}
              omitWhenEmpty
              tone="neutral"
            />
            <Fact
              label={tTrades('field.initialStop')}
              value={trade.actualInitialStop}
              omitWhenEmpty
              tone="neutral"
            />
            {/*
              The Target is the PLANNED one and is labelled as such. There is
              no "actual target" in this domain — a target is an intention, and
              what actually happened is the Exit two rows above.
            */}
            <Fact
              label={t('plannedTarget')}
              value={trade.plannedTarget}
              omitWhenEmpty
              tone="neutral"
            />
          </FactGrid>
        </PanelSection>
      ) : null}

      {hasCosts ? (
        <PanelSection title={t('groups.cost')}>
          <FactGrid>
            <Fact
              label={tTrades('field.actualPositionSize')}
              value={trade.actualPositionSize}
              omitWhenEmpty
              tone="neutral"
            />
            <Fact
              label={tTrades('field.initialRisk')}
              value={money(trade.actualInitialRiskMinor)}
              omitWhenEmpty
              tone="neutral"
            />
            <Fact
              label={tTrades('field.commission')}
              value={money(trade.commissionMinor)}
              tone="neutral"
            />
            <Fact label={tTrades('field.fees')} value={money(trade.feesMinor)} tone="neutral" />
            <Fact label={tTrades('field.swap')} value={money(trade.swapMinor)} tone="neutral" />
          </FactGrid>
        </PanelSection>
      ) : null}
    </div>
  );
}
