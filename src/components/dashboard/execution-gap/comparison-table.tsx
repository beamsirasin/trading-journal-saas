import { useTranslations } from 'next-intl';

import type { AnalyticsUnavailableReason } from '@/lib/analytics/metrics';
import { formatAnalyticsMetric, type AnalyticsDisplayStyle } from '@/lib/analytics/presentation';
import type { ComparisonTableRow } from '@/lib/dashboard/comparison-table';
import {
  COMPARISON_EXCLUSION_REASONS,
  type ComparisonExclusions,
} from '@/lib/dashboard/execution-comparison';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';

/**
 * THREE ROWS BY THREE COLUMNS, IN A REAL TABLE.
 *
 * This replaces two side-by-side baseline cards that printed the same three
 * metric names twice, once each, with no relationship stated between them.
 * The duplication disappears here not because a figure was deleted but
 * because a comparison is one fact rather than two: `System 35.80R` beside
 * `Actual 22.00R` in one row is the same information the two cards carried,
 * minus the second set of labels and minus the reader's job of aligning them
 * by eye across a 24px gutter.
 *
 * A `<table>` rather than a grid of divs, because it IS tabular: three
 * metrics against three measurements, and a screen reader needs the row and
 * column headers to say which cell is which. The two cards it replaces were
 * two definition lists that a screen reader read as six unrelated pairs.
 */
export function ComparisonTable({
  rows,
  exclusions,
  className,
}: {
  rows: readonly ComparisonTableRow[];
  exclusions: ComparisonExclusions;
  className?: string;
}) {
  const t = useTranslations('dashboard.executionGap');

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {/*
        THE TABLE IS THE CARD'S SUBJECT, SO IT IS SET LIKE ONE.

        It was `text-sm` throughout — column headers, row labels and figures
        all at 14px — which flattened the hierarchy exactly where it matters
        most, and left the header's 30px Gap figure reading as the card's
        content with the table as a footnote under it. It is the other way
        round: the table is the working, the header is the conclusion.

        The figures stay at 14px, which is the size they always were. What
        changed is everything around them: the column headers drop to 12px so
        they stop competing, and the figures take `font-medium` (`font-semibold`
        for the difference). Worth knowing if this looks wrong later — 14px in
        `--font-mono` has a visibly smaller x-height than 14px in the sans
        face, so these figures read smaller than the row labels beside them at
        the identical declared size. The answer is weight and surrounding
        scale rather than a bigger number, which would break the alignment
        with every other figure on the Dashboard.
      */}
      <table data-comparison-table className="w-full min-w-0 border-collapse text-sm">
        <caption className="sr-only">{t('table.caption')}</caption>
        <thead>
          <tr className="border-border border-b">
            <th
              scope="col"
              className="text-subtle-foreground py-1.5 pe-2 text-start text-xs font-medium"
            >
              {t('table.metricColumn')}
            </th>
            <th
              scope="col"
              className="text-subtle-foreground numeric px-2 py-1.5 text-end text-xs font-medium"
            >
              {t('table.systemColumn')}
            </th>
            <th
              scope="col"
              className="text-subtle-foreground numeric px-2 py-1.5 text-end text-xs font-medium"
            >
              {t('table.actualColumn')}
            </th>
            {/*
              The visible header is one glyph, which is not a label. The
              accessible name spells out the operation AND its direction,
              because "Δ" alone leaves a screen-reader user to guess whether
              the column is Actual minus System or the reverse — and the sign
              of every cell in it depends on that answer.
            */}
            <th
              scope="col"
              className="text-subtle-foreground numeric py-1.5 ps-2 text-end text-xs font-medium"
            >
              <span aria-hidden="true">{t('table.deltaColumn')}</span>
              <span className="sr-only">{t('table.deltaColumnLabel')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-comparison-row={row.key} className="border-border/60 border-b">
              <th
                scope="row"
                className="text-muted-foreground py-2.5 pe-2 text-start font-medium whitespace-nowrap"
              >
                {t(`table.row.${row.key}`)}
              </th>
              <Cell metric={row.system} style={row.style} column="system" />
              <Cell metric={row.actual} style={row.style} column="actual" />
              {/*
                THE ONLY TONED COLUMN. System and Actual are both plain: a
                System total of +35.80R is not "good news" and colouring it
                green would say it was. The difference is where direction is
                the content — negative means the execution captured less than
                the paired System offered — and the sign is in the text
                either way, so colour reinforces and never carries it alone.
              */}
              <Cell metric={row.delta} style={row.deltaStyle} column="delta" toned />
            </tr>
          ))}
        </tbody>
      </table>

      <ExclusionNote exclusions={exclusions} />
    </div>
  );
}

function Cell({
  metric,
  style,
  column,
  toned = false,
}: {
  metric: ComparisonTableRow['system'];
  style: AnalyticsDisplayStyle;
  column: 'system' | 'actual' | 'delta';
  toned?: boolean;
}) {
  const t = useTranslations('dashboard.real');
  const formatted = formatAnalyticsMetric(metric, style);

  return (
    <td
      data-comparison-cell={column}
      data-metric-status={formatted.status}
      className={cn(
        'numeric py-2.5 text-end tabular-nums',
        column === 'delta' ? 'ps-2 font-semibold' : 'px-2 font-medium',
        toned &&
          formatted.status === 'available' &&
          formatted.tone === 'positive' &&
          'text-positive',
        toned &&
          formatted.status === 'available' &&
          formatted.tone === 'negative' &&
          'text-negative',
        !toned && 'text-foreground',
      )}
    >
      {formatted.status === 'available' ? (
        formatted.text
      ) : (
        // Words, not a dash. "No losses" and "no comparable Trades" are
        // different facts and only one of them is the reader's to act on.
        <span className="text-muted-foreground text-xs font-normal">
          {formatted.status === 'error'
            ? t('unavailable.data_integrity_error')
            : t(`unavailable.${formatted.reason as AnalyticsUnavailableReason}`)}
        </span>
      )}
    </td>
  );
}

/**
 * WHY THE TOTALS ARE NOT THE ONES THE TWO CARDS SHOWED.
 *
 * This table counts the paired population, so its System total reads 35.80R
 * where the retired System baseline read 36.25R. That is a number moving in
 * front of a reader who did not ask for it, and a bare count cannot explain
 * it: "excluding 6 Trades" says how many but not why, and the why is the part
 * that tells them whether anything is wrong. Each reason is a lifecycle state
 * they can act on, and the counts come from the same read the table does —
 * never from the workspace-wide Needs Attention panel, whose five counts
 * overlap, ignore the active Account and ignore the date range.
 */
function ExclusionNote({ exclusions }: { exclusions: ComparisonExclusions }) {
  const t = useTranslations('dashboard.executionGap');

  /*
    IT IS SET TO BE READ, NOT TO BE TIDY.

    This was 12px in `subtle-foreground` — the quietest pairing the design
    system has, on the one line that explains why the System total says
    35.80R when the reader last saw 36.25R. A note nobody reads leaves that
    discrepancy looking like a bug in the product rather than like six
    Trades that have not finished.

    13px in `muted-foreground` (6.87:1 against the card) instead, and the
    link takes `--primary` rather than an underline alone: underline-only on
    a muted line is barely distinguishable from emphasis, and this is the
    one thing on the card that navigates somewhere.
  */
  if (exclusions.total === 0) {
    return (
      <p data-comparison-exclusions="none" className="text-muted-foreground text-[13px] leading-5">
        {t('excluded.none')}
      </p>
    );
  }

  const reasons = COMPARISON_EXCLUSION_REASONS.filter(
    (reason) => exclusions.byReason[reason] > 0,
  ).map((reason) => t(`excluded.reason.${reason}`, { count: exclusions.byReason[reason] }));

  return (
    <p
      data-comparison-exclusions={exclusions.total}
      className="text-muted-foreground text-[13px] leading-5"
    >
      {t('excluded.summary', { count: exclusions.total })}
      {' — '}
      {reasons.join(' · ')}.{' '}
      <Link
        href="/app/trades"
        className="text-primary hover:text-primary/80 focus-visible:ring-ring rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2"
      >
        {t('excluded.link')}
      </Link>
    </p>
  );
}
