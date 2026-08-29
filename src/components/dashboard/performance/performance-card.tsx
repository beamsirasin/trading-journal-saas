import { MonitorCog, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsDisplayTone } from '@/lib/analytics/presentation';
import { plainValue } from '@/lib/dashboard/metric-display';
import {
  PERFORMANCE_METRIC_KEYS,
  type PerformanceCardModel,
  type PerformanceMetricCell,
  type PerformanceSide,
  type PerformanceValue,
} from '@/lib/dashboard/performance-card';
import { dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
import { MetricLabel } from '@/components/product/metric';
import { Card } from '@/components/ui/card';

/**
 * Identity, not judgement.
 *
 * The two sides carry the product's existing System/Trader hues, but only as
 * a small header mark — never as a card background, a coloured border band,
 * or a large tinted surface. A green System card beside a red Trader card
 * would assert that following the rules is virtue and executing is failure,
 * which is precisely the reading CLAUDE.md §1 forbids. The concepts are
 * separated by title and copy; the hue is only a wayfinding aid.
 */
const SIDE_ICON: Record<PerformanceSide, typeof MonitorCog> = {
  system: MonitorCog,
  trader: UserRound,
};

const SIDE_MARK: Record<PerformanceSide, string> = {
  system: 'bg-system/10 text-system',
  trader: 'bg-trader/10 text-trader',
};

const TONE_CLASS: Record<AnalyticsDisplayTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

/**
 * One analytical performance card.
 *
 * More internal hierarchy than a D3 Basic KPI card, not a bigger one: an
 * identity mark, one hero Total R, the W/BE/L composition behind it, and a
 * compact supporting grid. Seven equally sized figures would read as a
 * spreadsheet and would tell a reader nothing about which number matters.
 *
 * THE CARD IS WIDE, SO IT IS LAID OUT WIDE. Everything used to stack: header,
 * then a full-width hero band with a rule under it, then a three-column grid
 * beneath that — around 250px of card to carry seven figures, with the hero's
 * own row leaving two thirds of the width empty beside a single number. The
 * card now splits along its long axis: identity and hero on the left, the six
 * supporting metrics in a grid on the right, divided by one hairline. Same
 * figures, same order, same states, same dominance (the hero is still 32px
 * against the cells' 20px) — about 100px less height, with the width the card
 * already had doing the work the height used to.
 *
 * THE SPLIT IS A CONTAINER QUERY, NOT A BREAKPOINT. Two of these sit side by
 * side inside a two-column section, so the viewport says nothing useful about
 * how wide either card actually is — a `lg:` split would fire at exactly the
 * width where each card is at its narrowest. `@container/perf` asks the card
 * itself, which also keeps the layout correct if the section is ever
 * re-proportioned. Below 34rem of card width it stacks, unchanged.
 *
 * The definition affordance is positioned against the card rather than
 * carried in a header row: it belongs to the whole card, and a row existing
 * only to hold it at the far end of the left column would put it on the
 * divider, where it would read as the metric grid's control instead.
 *
 * Both sides render through this single component, so their geometry, states,
 * and metric order cannot diverge.
 */
export function PerformanceCard({ model }: { model: PerformanceCardModel }) {
  const t = useTranslations('dashboard.real');
  const tPerf = useTranslations('dashboard.performance');
  const tKpi = useTranslations('dashboard.basicKpi');
  const Icon = SIDE_ICON[model.side];
  const title = t(`${model.side}.title`);
  const headingId = `performance-${model.side}-heading`;

  return (
    <Card
      {...dashboardWidgetAttributes(model.layout)}
      data-dashboard-panel={model.side}
      data-performance-status={model.populationEmpty ? 'empty' : 'available'}
      role="group"
      aria-labelledby={headingId}
      className="@container/perf relative flex min-w-0 flex-col p-4 sm:p-5"
    >
      {/*
        Anchored to the card. The identity block reserves its lane with `pe-8`,
        so the two can never collide however long a title becomes.
      */}
      <div className="absolute end-3 top-3 z-10">
        <MetricInfo triggerLabel={tKpi('infoTrigger', { metric: title })} title={title}>
          <PerformanceDefinitions side={model.side} />
        </MetricInfo>
      </div>

      {model.populationEmpty ? (
        <>
          <PerformanceIdentity
            headingId={headingId}
            title={title}
            tagline={tPerf(`${model.side}.tagline`)}
            markClassName={SIDE_MARK[model.side]}
            Icon={Icon}
          />
          <div className="mt-4 flex flex-1 flex-col justify-center">
            <p className="border-border bg-muted/40 text-muted-foreground rounded-md border p-3 text-sm leading-relaxed">
              {t(`${model.side}.empty`)}
            </p>
            {/* The Trade count stays truthful and useful at zero, so it survives
                the empty state while the rest of the grid would only repeat it. */}
            <dl className="mt-4">
              <PerformanceCell
                cell={{ key: 'sampleCount', value: plainValue(String(model.sampleCount)) }}
              />
            </dl>
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-col gap-4 @[34rem]/perf:flex-row @[34rem]/perf:items-center @[34rem]/perf:gap-6">
          <div className="flex min-w-0 flex-col @[34rem]/perf:w-[13.5rem] @[34rem]/perf:shrink-0">
            <PerformanceIdentity
              headingId={headingId}
              title={title}
              tagline={tPerf(`${model.side}.tagline`)}
              markClassName={SIDE_MARK[model.side]}
              Icon={Icon}
            />
            <div className="mt-3 min-w-0">
              <MetricLabel variant="plain">{tPerf(`${model.side}.heroLabel`)}</MetricLabel>
              <p className="mt-0.5">
                <PerformanceFigure value={model.hero} variant="hero" />
              </p>
              {model.composition === null ? null : (
                <p className="text-muted-foreground numeric mt-1 text-xs leading-4">
                  {tKpi('compositionTrades', {
                    wins: model.composition.wins,
                    breakEvens: model.composition.breakEvens,
                    losses: model.composition.losses,
                  })}
                </p>
              )}
            </div>
          </div>

          {/*
            One hairline, running in the direction the split actually runs — on
            top when stacked, on the leading edge when side by side. §14:
            surface separation and spacing, never a second bordered box.
          */}
          <dl className="border-border grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3.5 border-t pt-4 sm:grid-cols-3 @[34rem]/perf:gap-x-3 @[34rem]/perf:border-s @[34rem]/perf:border-t-0 @[34rem]/perf:ps-5 @[34rem]/perf:pe-6 @[34rem]/perf:pt-0">
            {model.metrics.map((cell) => (
              <PerformanceCell key={cell.key} cell={cell} />
            ))}
          </dl>
        </div>
      )}
    </Card>
  );
}

/**
 * The identity block, shared by the populated and the empty composition so
 * the two states cannot drift apart. `pe-8` is the lane the absolutely
 * positioned definition button occupies.
 */
function PerformanceIdentity({
  headingId,
  title,
  tagline,
  markClassName,
  Icon,
}: {
  headingId: string;
  title: string;
  tagline: string;
  markClassName: string;
  Icon: typeof MonitorCog;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 pe-8 @[34rem]/perf:pe-0">
      <span
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', markClassName)}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 id={headingId} className="text-card-title">
          {title}
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs leading-4 text-pretty">{tagline}</p>
      </div>
    </div>
  );
}

function PerformanceCell({ cell }: { cell: PerformanceMetricCell }) {
  const tPerf = useTranslations('dashboard.performance');
  return (
    <div
      data-performance-metric={cell.key}
      data-performance-metric-status={cell.value.status}
      {...(cell.value.status === 'unavailable'
        ? { 'data-performance-metric-reason': cell.value.reason }
        : {})}
      className="flex min-w-0 flex-col gap-0.5"
    >
      <dt>
        <MetricLabel variant="plain" className="break-words">
          {tPerf(`metrics.${cell.key}`)}
        </MetricLabel>
      </dt>
      <dd className="min-w-0">
        <PerformanceFigure value={cell.value} variant="cell" />
      </dd>
    </div>
  );
}

/**
 * Two sizes, one hierarchy. The hero sits a step above the D3 KPI scale so
 * these cards read as the heavier analytical surface; the supporting cells
 * sit a step below it.
 *
 * Sizes are spelled here rather than layered onto `MetricValue`'s
 * `text-metric`: tailwind-merge does not recognise this project's custom text
 * scale as a font-size group, so both utilities would survive the merge and
 * stylesheet order — not the caller — would decide which one applied.
 *
 * Colour is never the only channel: an unavailable metric says why in words,
 * and a signed hero keeps its `+`/`-` in the text as well as its tone.
 */
function PerformanceFigure({
  value,
  variant,
}: {
  value: PerformanceValue;
  variant: 'hero' | 'cell';
}) {
  const t = useTranslations('dashboard.real');
  const tKpi = useTranslations('dashboard.basicKpi');

  if (value.status === 'available') {
    return (
      <span
        className={cn(
          'numeric inline-flex items-baseline break-words',
          variant === 'hero'
            ? 'text-[2rem] leading-none font-semibold tracking-tight'
            : 'text-xl leading-7 font-semibold tracking-tight',
          TONE_CLASS[value.tone],
        )}
      >
        {value.text}
      </span>
    );
  }

  return (
    <span className="text-muted-foreground text-sm leading-snug">
      {value.status === 'empty'
        ? tKpi('empty')
        : value.status === 'error'
          ? t('unavailable.data_integrity_error')
          : t(`unavailable.${value.reason}`)}
    </span>
  );
}

/**
 * One definition affordance per card rather than six.
 *
 * Six icon buttons inside a six-cell grid would be exactly the spreadsheet
 * this card is meant not to be, and the definitions are more useful read
 * together — they only differ between the sides by which population they
 * describe.
 */
function PerformanceDefinitions({ side }: { side: PerformanceSide }) {
  const tPerf = useTranslations('dashboard.performance');
  return (
    <>
      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
        {tPerf(`${side}.purpose`)}
      </p>
      <dl className="mt-3 flex flex-col gap-2.5">
        {(['totalR', ...PERFORMANCE_METRIC_KEYS] as const)
          .filter((key) => key !== 'sampleCount')
          .map((key) => (
            <div key={key}>
              <dt className="text-foreground text-xs font-semibold">
                {tPerf(key === 'totalR' ? `${side}.heroLabel` : `metrics.${key}`)}
              </dt>
              <dd className="text-muted-foreground text-xs leading-relaxed">
                {tPerf(`${side}.definitions.${key}`)}
              </dd>
            </div>
          ))}
      </dl>
    </>
  );
}
