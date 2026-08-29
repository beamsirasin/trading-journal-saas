import { ArrowRight, Compass, ListChecks, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type {
  InsightCardView,
  InsightPillarKey,
  InsightStatementView,
  InsightTone,
} from '@/lib/dashboard/insight-presentation';
import { dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { MetricLabel } from '@/components/product/metric';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

const TONE_CLASS: Record<InsightTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

/**
 * A subtle header mark, never a meaning carrier. Each pillar keeps the same
 * neutral primary treatment as every other Dashboard section header — the
 * icons distinguish the three at a glance without giving Strategy a blue,
 * Psychology a purple and Discipline an orange identity (§19/§20).
 */
const PILLAR_ICON: Record<InsightPillarKey, typeof Compass> = {
  strategy: Compass,
  psychology: Sparkles,
  discipline: ListChecks,
};

/**
 * One compact insight pillar.
 *
 * SCANS IN A FEW SECONDS, BY CONSTRUCTION. There is exactly one hero figure;
 * the supporting comparisons are small labelled pairs beneath it, and the
 * sample/coverage line is smaller again. A second competing hero number, a
 * chart, a sparkline, a gauge, a ranking table or a breakdown list would all
 * turn this into the analytical report the Dashboard deliberately is not.
 *
 * COPY COMES FROM THE INSIGHT'S TYPE, NEVER FROM ITS VALUE. `statement.type`
 * is D8A's own token, so a card can never narrate a reason the domain did not
 * select — including the case where a Strategy is already filtered and D8A
 * answers with `selected_strategy_health` rather than a "best Strategy" claim.
 */
export function InsightPillarCard({ card }: { card: InsightCardView }) {
  const t = useTranslations('dashboard.insights');
  const headingId = `insight-pillar-${card.pillar}-heading`;
  const Icon = PILLAR_ICON[card.pillar];

  return (
    <section
      {...dashboardWidgetAttributes(card.layout)}
      data-insight-pillar={card.pillar}
      data-insight-status={card.status}
      {...(card.reason === null ? {} : { 'data-insight-reason': card.reason })}
      aria-labelledby={headingId}
      // `h-full` all the way down: the grid item stretches, this section must
      // pass that height on, and only then does the Card's own `h-full` give
      // the three cards one bottom edge and one Analytics baseline.
      className="h-full min-w-0"
    >
      <Card
        data-dashboard-panel={`insight-${card.pillar}`}
        // `h-full` so three cards in one row share an outer height whatever
        // each pillar's state contains; `flex-col` + `mt-auto` on the footer
        // keeps the Analytics affordance on one baseline across all three.
        className="flex h-full min-w-0 flex-col gap-3 p-4"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id={headingId} className="text-card-title">
              {t(`${card.pillar}.title`)}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug text-pretty">
              {t(`${card.pillar}.description`)}
            </p>
          </div>
        </div>

        {card.status === 'integrity_error' ? (
          <StateBlock
            role="alert"
            title={t('states.error.title')}
            description={t('states.error.description')}
          />
        ) : card.primary === null ? (
          <UnavailableState card={card} />
        ) : (
          <InsightBody card={card} primary={card.primary} />
        )}

        <div className="mt-auto pt-0.5">
          <Link
            href={card.analyticsHref}
            // Named, not "click here": five identical "View Analytics" links on
            // one page would be indistinguishable in a screen reader's link list.
            aria-label={t('viewAnalyticsLabel', { pillar: t(`${card.pillar}.title`) })}
            data-insight-analytics={card.analyticsView}
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring -ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('viewAnalytics')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </section>
  );
}

/**
 * R2C §17–§21 — THE CARD HAS A HERO INSIGHT AREA, AND IT IS A SURFACE.
 *
 * The three pillars used to render as two identical stacks of five lines
 * (sentence, subject, role label, figure, comparisons) separated by a rule,
 * with three more lines of caveat beneath. Everything was the same size and
 * the same weight, so nothing was findable: a reader had to parse the whole
 * card to learn which of the eight figures on it was the finding. That is a
 * report, not an insight card.
 *
 * The primary statement now sits on `--muted`, one surface step off the card,
 * exactly as the Execution Gap's summary cells do. The secondary sits on the
 * card plane beneath it. One glance separates "the finding" from "and also",
 * before a single label has been read — which is the two-second test §17 sets.
 *
 * The three cards share this frame even though their semantics differ, which
 * is what §20 asks for: same heading position, same hero area, same secondary
 * area, same footer baseline. Nothing about the CONTENT is forced into a
 * common shape — a pillar with no secondary statement simply renders none.
 */
function InsightBody({ card, primary }: { card: InsightCardView; primary: InsightStatementView }) {
  const t = useTranslations('dashboard.insights');

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="bg-muted/50 min-w-0 rounded-lg px-3 py-2.5">
        <Statement statement={primary} prominent />
      </div>

      {/* AT MOST ONE supporting insight reaches the Dashboard (§1). */}
      {card.secondary === null ? null : (
        <div className="min-w-0 px-3">
          <Statement statement={card.secondary} prominent={false} />
        </div>
      )}

      {/*
        §21 — the caveats leave the first visual layer. They are still here,
        still complete and still never a warning box; they are simply at
        11px, grouped, and below the two statements rather than interleaved
        with them at the same size as the findings.
      */}
      <div className="flex min-w-0 flex-col gap-0.5 px-3">
        {card.sample === null ? null : (
          /*
            §22 — a limited sample is a CAVEAT, not an error. It is one quiet
            line of text, never a warning box across the card, and it never
            claims significance or confidence.
          */
          <p
            data-insight-sample={card.sample.quality}
            className="text-muted-foreground text-[11px] leading-4"
          >
            {card.sample.quality === 'supported'
              ? `${t('sample.supported')} ${t('sample.trades', { count: card.sample.tradeCount })}`
              : `${t('sample.limited')} · ${t('sample.trades', { count: card.sample.tradeCount })}`}
          </p>
        )}
        <Coverage card={card} />
        {/* §12 — stated in words wherever cohorts overlap, so nothing on the
            card can be read as shares of a whole. */}
        {primary.nonAdditive || card.secondary?.nonAdditive === true ? (
          <p
            data-insight-non-additive
            className="text-muted-foreground text-[11px] leading-4 text-pretty"
          >
            {t('nonAdditive')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Subject, then the one figure, then the labelled comparisons it is read
 * against.
 *
 * The subject is rendered through its own copy for Emotion, confidence and
 * issue cohorts — "Fear-tagged Trades", "Confidence 25", "Trades tagged
 * 'Moved Stop'" — because a bare label would read as a property of the
 * Trades rather than as the cohort those Trades were grouped into.
 */
function Statement({
  statement,
  prominent,
}: {
  statement: InsightStatementView;
  prominent: boolean;
}) {
  const t = useTranslations('dashboard.insights');
  const label = statement.subjectLabel;
  const subject =
    label === null
      ? null
      : statement.subjectKind === 'emotion'
        ? t('subject.emotion', { label })
        : statement.subjectKind === 'confidence_level'
          ? t('subject.confidence', { label })
          : statement.subjectKind === 'rule' || statement.subjectKind === 'mistake'
            ? t('subject.issue', { label })
            : label;

  return (
    <div data-insight-statement={statement.type} className="flex min-w-0 flex-col gap-0.5">
      {/*
        LABEL -> FINDING -> VALUE (§21), in that order and on three lines
        rather than five. The eyebrow says what KIND of finding this is, the
        subject says which cohort it is about, and the figure states it. The
        role label used to own a fourth line of its own; it now sits on the
        figure's baseline, to its right, where it names the number without
        costing a row and without ever letting a bare `77.59%` be mistaken for
        the other rate this pillar publishes.
      */}
      <p className="text-muted-foreground text-[11px] leading-4">
        {t(`insight.${statement.type}`)}
      </p>
      {subject === null ? null : (
        <p
          data-insight-subject
          className={cn(
            'text-foreground min-w-0 leading-tight font-semibold break-words',
            prominent ? 'text-sm' : 'text-xs',
          )}
        >
          {subject}
        </p>
      )}
      {statement.headline === null ? null : (
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p
            data-insight-headline
            className={cn(
              'numeric font-semibold tracking-tight',
              prominent ? 'text-[1.75rem] leading-8' : 'text-base leading-6',
              TONE_CLASS[statement.headline.tone],
            )}
          >
            {statement.headline.text}
          </p>
          {statement.headlineRole === null ? null : (
            // The hero is NAMED. A bare percentage cannot be attributed to
            // Trade Rule Adherence over Rule Checks Followed, and a bare R
            // cannot be told from an expectancy.
            <MetricLabel variant="plain" className="min-w-0 break-words">
              {t(`comparison.${statement.headlineRole}`)}
            </MetricLabel>
          )}
        </div>
      )}
      {statement.comparisons.length === 0 ? null : (
        <dl className="mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
          {statement.comparisons.map((comparison) => (
            <div
              key={comparison.role}
              data-insight-comparison={comparison.role}
              className="flex min-w-0 items-baseline gap-1.5"
            >
              {/* Rule Checks Followed and Trade Rule Adherence are labelled
                  separately and completely — neither ever borrows the
                  other's name (§15). */}
              <dt className="text-muted-foreground text-[11px] leading-4">
                {t(`comparison.${comparison.role}`)}
              </dt>
              <dd
                className={cn(
                  'numeric text-[11px] leading-4 font-semibold',
                  /*
                    §28 — SUPPORTING FIGURES ARE NEUTRAL UNLESS THE SIGN IS
                    THE POINT.

                    Every comparison used to carry a tone, which put five and
                    six coloured numbers on a single card and made green mean
                    nothing more specific than "a number". An expectancy or a
                    baseline is a level, not an outcome; only the two
                    Execution Gap roles are the signed attribution figure this
                    product exists to surface, so only they keep their colour.
                    The hero above is unaffected — it stays toned.
                  */
                  SIGNED_COMPARISON_ROLES.has(comparison.role)
                    ? TONE_CLASS[comparison.figure.tone]
                    : 'text-foreground',
                )}
              >
                {comparison.figure.text}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The comparison roles whose SIGN is the finding rather than incidental.
 *
 * Both are Execution Gap figures: a negative one says the execution captured
 * less than the System offered on that cohort, and that direction is the
 * whole reason the figure is on the card.
 */
const SIGNED_COMPARISON_ROLES: ReadonlySet<string> = new Set([
  'average_execution_gap',
  'associated_execution_gap',
]);

/**
 * §11/§24 — coverage appears only where it changes how the card should be
 * read: while it is the reason there is no insight, or while a real gap
 * remains between what was recorded and what was eligible. A pillar with
 * complete coverage says nothing, rather than printing a reassuring 100%.
 */
function Coverage({ card }: { card: InsightCardView }) {
  const t = useTranslations('dashboard.insights');
  const coverage = card.coverage;
  if (coverage === null) return null;

  const complete =
    coverage.kind === 'psychology'
      ? coverage.taggedTradeCount >= coverage.eligibleTradeCount
      : coverage.kind === 'discipline'
        ? coverage.evaluatedTradeCount >= coverage.eligibleTradeCount
        : coverage.classifiedTradeCount >= coverage.eligibleTradeCount;
  if (complete && card.status !== 'low_coverage') return null;
  if (coverage.eligibleTradeCount === 0) return null;

  return (
    <p
      data-insight-coverage={coverage.kind}
      className="text-muted-foreground text-[11px] leading-4"
    >
      {coverage.kind === 'psychology'
        ? t('coverage.psychology', {
            tagged: coverage.taggedTradeCount,
            eligible: coverage.eligibleTradeCount,
            rate: coverage.ratePercent,
          })
        : coverage.kind === 'discipline'
          ? t('coverage.discipline', {
              evaluated: coverage.evaluatedTradeCount,
              eligible: coverage.eligibleTradeCount,
            })
          : t('coverage.strategy', {
              classified: coverage.classifiedTradeCount,
              eligible: coverage.eligibleTradeCount,
            })}
    </p>
  );
}

/**
 * Every D8A reason gets its own words. "No data" would collapse four
 * genuinely different facts — nothing closed yet, a cohort under the policy
 * floor, no Strategy assigned, nothing evaluated — into one unactionable
 * sentence.
 */
function UnavailableState({ card }: { card: InsightCardView }) {
  const t = useTranslations('dashboard.insights');
  const reason = card.reason ?? 'no_eligible_trades';

  if (reason === 'no_eligible_trades') {
    return (
      <StateBlock
        title={t(`states.no_eligible_trades.${card.pillar}.title`)}
        description={t(`states.no_eligible_trades.${card.pillar}.description`)}
      />
    );
  }
  if (reason === 'sample_below_policy') {
    return (
      <StateBlock
        title={t('states.sample_below_policy.title')}
        description={t('states.sample_below_policy.description', {
          minimum: card.minimumCohortTradeCount,
        })}
      />
    );
  }
  return (
    <StateBlock
      title={t(`states.${reason}.title`)}
      description={t(`states.${reason}.description`)}
    />
  );
}

function StateBlock({
  title,
  description,
  role,
}: {
  title: string;
  description: string;
  role?: 'alert';
}) {
  return (
    <div
      {...(role === undefined ? {} : { role })}
      data-insight-state={role === 'alert' ? 'error' : 'unavailable'}
      className="flex min-w-0 flex-col gap-1"
    >
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
    </div>
  );
}
