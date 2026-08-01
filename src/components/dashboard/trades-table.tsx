import { ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { DemoTrade } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { OutcomeBadge, QuadrantNote } from '@/components/product/outcome-badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroller,
} from '@/components/ui/table';

import { DEMO_TIME_ZONE, formatNet, formatR, formatTradeDate, toneForR } from './format';

const R_TONE = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-muted-foreground',
} as const;

/**
 * Recent trades.
 *
 * Two presentations of the same data, not one squeezed into both: a real
 * `<table>` from `md` up, and a stack of record cards below it. Forcing a
 * nine-column financial table into a 375px viewport produces something
 * technically visible and practically unusable, which the design system
 * rules out.
 *
 * BOTH are in the DOM; the inactive one is `display:none` (`hidden md:block`
 * / `md:hidden`). That is what removes it from the accessibility tree, so a
 * screen reader is offered the trades once — but a DOM query still finds it,
 * which is why each presentation carries `data-trades-view` for tests to
 * scope by. Rendering only one would require measuring the viewport in
 * JavaScript, which costs a client component and a layout shift on first
 * paint to solve a problem CSS already solves.
 *
 * Every row shows BOTH outcomes. A recent-trades list that showed only the
 * P&L would be the conventional journal this product exists to replace.
 */
export function TradesTable({ trades }: { trades: readonly DemoTrade[] }) {
  const t = useTranslations('trades.table');
  const tCommon = useTranslations('common');
  // `routing.locales` guarantees only 'en' | 'th' reach a rendered page.
  const locale = useLocale() as 'en' | 'th';

  return (
    <>
      {/*
        The label is deliberately distinct from any surrounding section
        heading. A scroll region and its enclosing section are both exposed as
        landmarks, and giving them the same accessible name leaves a screen
        reader user with two indistinguishable "Recent trades" regions.
      */}
      <TableScroller
        label={t('scrollRegionLabel')}
        data-trades-view="table"
        className="hidden md:block"
      >
        <Table>
          <TableCaption>{t('timezoneCaption', { timezone: DEMO_TIME_ZONE })}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('instrument')}</TableHead>
              <TableHead>{t('strategy')}</TableHead>
              <TableHead>{t('closed')}</TableHead>
              <TableHead>{t('system')}</TableHead>
              <TableHead>{t('actual')}</TableHead>
              <TableHead className="text-right">{t('systemR')}</TableHead>
              <TableHead className="text-right">{t('actualR')}</TableHead>
              <TableHead className="text-right">{t('net')}</TableHead>
              <TableHead>{t('mistakes')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-foreground font-medium">{trade.symbol}</span>
                    <span className="text-muted-foreground text-xs capitalize">
                      {trade.direction === 'long' ? tCommon('long') : tCommon('short')}
                    </span>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-foreground">{trade.strategy}</span>
                    <span className="text-muted-foreground text-xs">{trade.strategyVersion}</span>
                  </div>
                </TableCell>

                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatTradeDate(trade.closedAt, locale)}
                </TableCell>

                <TableCell>
                  <OutcomeBadge outcome={trade.systemOutcome} axis="system" />
                </TableCell>

                <TableCell>
                  <OutcomeBadge outcome={trade.actualOutcome} axis="trader" />
                </TableCell>

                <TableCell className={cn('numeric text-right', R_TONE[toneForR(trade.systemR)])}>
                  {formatR(trade.systemR)}
                </TableCell>

                <TableCell className={cn('numeric text-right', R_TONE[toneForR(trade.actualR)])}>
                  {formatR(trade.actualR)}
                </TableCell>

                <TableCell
                  className={cn(
                    'numeric text-right whitespace-nowrap',
                    R_TONE[toneForR(trade.actualR)],
                  )}
                >
                  {formatNet(trade.net)}
                </TableCell>

                <TableCell>
                  <MistakeList mistakes={trade.mistakes} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroller>

      <ul data-trades-view="cards" className="flex flex-col gap-3 md:hidden">
        {trades.map((trade) => (
          <li
            key={trade.id}
            className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-foreground font-semibold">{trade.symbol}</span>
                <span className="text-muted-foreground text-xs capitalize">
                  {trade.direction === 'long' ? tCommon('long') : tCommon('short')} ·{' '}
                  {trade.strategy} {trade.strategyVersion}
                </span>
              </div>
              <span
                className={cn(
                  'numeric font-semibold whitespace-nowrap',
                  R_TONE[toneForR(trade.actualR)],
                )}
              >
                {formatNet(trade.net)}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">{t('system')}</dt>
                <dd className="flex items-center gap-2">
                  <OutcomeBadge outcome={trade.systemOutcome} axis="system" />
                  <span className={cn('numeric text-xs', R_TONE[toneForR(trade.systemR)])}>
                    {formatR(trade.systemR)}
                  </span>
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground text-xs">{t('actual')}</dt>
                <dd className="flex items-center gap-2">
                  <OutcomeBadge outcome={trade.actualOutcome} axis="trader" />
                  <span className={cn('numeric text-xs', R_TONE[toneForR(trade.actualR)])}>
                    {formatR(trade.actualR)}
                  </span>
                </dd>
              </div>
            </dl>

            <QuadrantNote systemOutcome={trade.systemOutcome} actualOutcome={trade.actualOutcome} />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <MistakeList mistakes={trade.mistakes} />
              <span className="text-muted-foreground text-xs">
                {formatTradeDate(trade.closedAt, locale)}
              </span>
            </div>

            {trade.chartUrl === undefined ? null : (
              <ChartLink href={trade.chartUrl} symbol={trade.symbol} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function MistakeList({ mistakes }: { mistakes: readonly string[] }) {
  const t = useTranslations('common');

  if (mistakes.length === 0) {
    return <span className="text-muted-foreground text-xs">{t('rulesFollowed')}</span>;
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {mistakes.map((mistake) => (
        <li
          key={mistake}
          className="border-warning/30 bg-warning/10 text-warning rounded border px-1.5 py-0.5 text-[11px] font-medium"
        >
          {mistake}
        </li>
      ))}
    </ul>
  );
}

/**
 * `rel="noopener noreferrer"` and an explicit "opens in a new tab" for screen
 * readers — an unannounced target change is disorienting, and the link leaves
 * the product entirely.
 */
function ChartLink({ href, symbol }: { href: string; symbol: string }) {
  const t = useTranslations('common');
  const tTable = useTranslations('trades.table');

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 text-xs transition-colors"
    >
      <ExternalLink className="size-3.5" aria-hidden="true" />
      {t('viewChart')}
      <span className="sr-only">
        {tTable('viewChartFor', { symbol })}, {t('opensNewTab')}
      </span>
    </a>
  );
}
