import { MonitorCog, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsDisplayTone } from '@/lib/analytics/presentation';
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
 * THREE METRICS, NOT SEVEN. An identity mark, one hero Total R, and the two
 * readings that qualify it — Win Rate and Avg Win / Loss. The card used to
 * carry a hero, a W/BE/L composition line and six supporting cells: seven
 * values a side, fourteen across the section, on the surface that exists to
 * answer one comparison at a glance. Avg R, Expectancy, Profit Factor, Max
 * Drawdown and the Trade count are all still computed and still on the
 * Dashboard's own payload; they are simply no longer rendered here, because
 * reading them is diagnosis and diagnosis is Analytics' job.
 *
 * WHY THESE THREE. Total R answers "how much did this side produce". Win Rate
 * and Avg Win / Loss are the two independent factors that produced it — how
 * often, and how big — and neither is interpretable without the other: a 40%
 * win rate is excellent at 3x and ruinous at 0.5x. Any fourth metric on this
 * card is a recombination of the same three.
 *
 * THE LAYOUT STILL SPLITS ON THE CARD'S OWN WIDTH, AND THE MEASUREMENT IS
 * WHY. A purely stacked card reads beautifully but is 231px at every width —
 * 38px TALLER at 1440 than the seven-metric card it replaced, because a wide
 * card then carries a 200px column with 400px of empty lane beside it. With
 * the two qualifiers beside the hero it is 156px. Below 34rem of card width
 * it stacks, and even there it is 231px against the old card's 348px.
 * Shorter at every tested width, which is the whole point of the cut.
 *
 * The definition affordance is positioned against the card rather than
 * carried in a header row: it belongs to the whole card, and it is now the
 * only place the per-side purpose copy lives.
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
            markClassName={SIDE_MARK[model.side]}
            Icon={Icon}
          />
          {/*
            The honest empty state, and nothing beside it. It used to be
            followed by a `Trades: 0` cell, which restated in a metric slot
            exactly what the sentence above it already says — and `Trades` is
            no longer one of this card's visible metrics in any state.
          */}
          <div className="mt-4 flex flex-1 flex-col justify-center">
            <p className="border-border bg-muted/40 text-muted-foreground rounded-md border p-3 text-sm leading-relaxed">
              {t(`${model.side}.empty`)}
            </p>
          </div>
        </>
      ) : (
        /*
          THREE METRICS, ONE HIERARCHY, TWO PLANES.

          The card reads top to bottom: whose result this is, then the one
          figure that answers the section's question, then the two readings
          that qualify it. Total R stays the hero on its raised surface;
          Win Rate and Avg Win / Loss sit side by side beneath it on the card
          plane, deliberately NOT in raised cells of their own — six little
          boxes across the section would be the nested-box repetition this
          card has spent three passes removing, and would flatten the very
          hierarchy that makes the comparison readable.

          THE HAIRLINE IS GONE WITH THE GRID IT DIVIDED. Six cells beside a
          hero needed a rule to say where one group ended; two qualifiers under
          a label do not, and the surface step on the hero already carries the
          hierarchy. Spacing separates them now — §15's "restrained divider or
          spacing boundary", resolved in favour of spacing.

          Both cards render this identical shape, so the System hero and the
          Trader hero sit at the same offset and the two qualifier pairs sit on
          one baseline. That alignment is what makes the left-to-right
          comparison instant, and it is why neither side may ever grow a
          metric the other does not have.
        */
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/*
            THE IDENTITY ROW SPANS THE CARD, and it has to. Inside the 13rem
            hero column "System Performance" truncated to "System Perfor…" at
            1440 — the column is sized for a Total R figure, not for a
            two-word title plus a mark plus the ⓘ's reserved lane. A truncated
            side name in a comparison of exactly two sides is the one label
            that can never be allowed to clip.
          */}
          <PerformanceIdentity
            headingId={headingId}
            title={title}
            markClassName={SIDE_MARK[model.side]}
            Icon={Icon}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3 @[34rem]/perf:flex-row @[34rem]/perf:items-center @[34rem]/perf:gap-5">
            {/*
            THE ANSWER SITS ON A RAISED SURFACE (R2C §5/§22).

            One rule, applied everywhere on this page a figure is the answer
            rather than a supporting reading: the Execution Gap's four summary
            cells, each insight pillar's primary statement, and this — the
            Total R the two metrics beneath it qualify. A step in SURFACE
            rather than a border, so the hierarchy is built from planes and
            never from a second box (§23), and it costs no new colour:
            `--muted` is the frozen `#262626` in dark and the light palette's
            own step in light.
          */}
            <div className="bg-muted/50 min-w-0 rounded-lg px-3 py-2.5 @[34rem]/perf:w-[13rem] @[34rem]/perf:shrink-0">
              <MetricLabel variant="plain">{tPerf(`${model.side}.heroLabel`)}</MetricLabel>
              <p className="mt-0.5">
                <PerformanceFigure value={model.hero} variant="hero" />
              </p>
            </div>

            {/*
              The two qualifiers, on one row at every width — they are a PAIR
              ("how often" beside "how big"), and splitting them onto separate
              lines would break the one relationship they exist to express.
              Two short figures fit a 320px card comfortably.

              BESIDE THE HERO ONCE THE CARD IS WIDE ENOUGH, STACKED BELOW IT
              OTHERWISE. Measured, a purely stacked card is 231px at every
              width — 38px TALLER at 1440 than the seven-metric card it
              replaced, because a wide card then leaves ~400px of empty lane
              beside a 200px column. Beside the hero it is ~165px, shorter
              than both. Below 34rem of CARD width (a 1280px page gives each
              card 568px, a 1024px page only 440px) it stacks, and even there
              it is 231px against the old card's 348px.

              The threshold is a container query, not a breakpoint: two of
              these sit inside a two-column section, so the viewport does not
              say how wide either card actually is.
            */}
            <dl className="grid min-w-0 grid-cols-2 gap-x-4 px-3 @[34rem]/perf:flex-1 @[34rem]/perf:px-0">
              {model.metrics.map((cell) => (
                <PerformanceCell key={cell.key} cell={cell} />
              ))}
            </dl>
          </div>
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
  markClassName,
  Icon,
}: {
  headingId: string;
  title: string;
  markClassName: string;
  Icon: typeof MonitorCog;
}) {
  return (
    // The tagline is gone from this block. "Strategy outcomes" / "Your actual
    // execution" restated, in four words, exactly what this card's info
    // popover already says at length under `purpose` — and the visible copy
    // budget for this section is the three metric labels plus the two side
    // names. `pe-8` still reserves the absolutely-positioned ⓘ's lane.
    <div className="flex min-w-0 items-center gap-2.5 pe-8">
      <span
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', markClassName)}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <h3 id={headingId} className="text-card-title min-w-0 truncate">
        {title}
      </h3>
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
 * Sizes are spelled here rather than layered onto `MetricValue` because this
 * component owns a two-step hierarchy instead of the shared single metric
 * role. The shared merger still guarantees last-size-wins behaviour if these
 * figures later move onto the common abstraction.
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
        {(['totalR', ...PERFORMANCE_METRIC_KEYS] as const).map((key) => (
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
