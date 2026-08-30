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
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
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
        {/*
          TITLE + ⓘ, matching every other header on this page.

          Each pillar carried a one-line description ("Which system produced
          the results", "How recorded state lines up with results", "How
          closely the rules were followed") that explained the card's subject
          and nothing about the figures under it. Three of them, side by side,
          were three permanent lines of definition in the row that is supposed
          to be read for its findings. The wording is unchanged and now opens
          from the ⓘ — the same affordance the KPI row, the Execution Gap, the
          Calendar and Risk Performance all use, so the page has one help
          pattern rather than two.

          NO METRIC IS TOUCHED. Which figures each pillar publishes is a
          separate product decision and is deliberately left exactly as it is.
        */}
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <h3 id={headingId} className="text-card-title truncate">
              {t(`${card.pillar}.title`)}
            </h3>
            <MetricInfo
              triggerLabel={t('infoTrigger', { pillar: t(`${card.pillar}.title`) })}
              title={t(`${card.pillar}.title`)}
              description={t(`${card.pillar}.description`)}
            >
              <InsightContext card={card} />
            </MetricInfo>
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
 * The one statement sits on `--muted`, one surface step off the card, exactly
 * as the Execution Gap's summary cells do, with at most one labelled
 * supporting figure beneath its hero.
 *
 * ONE STATEMENT, AND THE SECOND IS GONE RATHER THAN DEMOTED. Each pillar used
 * to render its runner-up as a full second finding on the card plane, which
 * is two independent analyses in a space meant to say one thing.
 *
 * The three cards share this frame even though their semantics differ: same
 * heading position, same hero area, same footer baseline. Nothing about the
 * CONTENT is forced into a common shape — Strategy leads with a ranked
 * subject, Psychology with an associative sentence, and Discipline with a
 * bare rate and no sentence at all (`presentation: 'status'`).
 */
function InsightBody({ card, primary }: { card: InsightCardView; primary: InsightStatementView }) {
  const t = useTranslations('dashboard.insights');

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="bg-muted/50 min-w-0 rounded-lg px-3 py-2.5">
        <Statement statement={primary} />
      </div>

      {/*
        THERE IS NO SECOND STATEMENT HERE ANY MORE, AND NO SLOT FOR ONE.

        Each pillar used to render its runner-up as a full second finding —
        its own subject, its own hero figure, its own comparisons — which is
        two independent analyses on a card meant to say one thing. The
        Strategy Setup, the second Psychology cohort and the
        compliant-vs-non-compliant difference all still exist in D8A and are
        all rendered at the Analytics destination this card links to.
      */}

      {/*
        WHAT STAYS ON THE FACE IS ONLY WHAT WOULD MAKE THE FINDING MISLEADING
        IF IT WERE HIDDEN. Everything else — full coverage, the overlapping-
        cohort note, the trade count of a well-supported sample — moved into
        this card's own info popover, which is a real button reachable by
        pointer, touch and keyboard.
      */}
      <div className="flex min-w-0 flex-col gap-0.5 px-3">
        {card.sample === null || card.sample.quality === 'supported' ? null : (
          /*
            A limited sample is a CAVEAT, not an error: one quiet line, never
            a warning box, never a claim about significance or confidence.

            IT IS CONDITIONAL NOW, AND THAT IS THE POINT. A supported sample
            printed "Observed over 66 Trades" on every card on every visit —
            a line that only ever said "this is fine". A reader learns nothing
            from a caveat that is always present, and stops reading the one
            that matters. Below the policy floor it appears; at or above it,
            the count is in the popover instead.
          */
          <p
            data-insight-sample={card.sample.quality}
            className="text-muted-foreground text-[11px] leading-4"
          >
            {`${t('sample.limited')} · ${t('sample.trades', { count: card.sample.tradeCount })}`}
          </p>
        )}
        {/*
          THE ONE SCOPE CAVEAT THAT CANNOT MOVE. Trade Rule Adherence counts
          only fully evaluated Trades — a Trade holding an unresolved required
          check is excluded from its denominator, not counted as compliant.
          When such Trades exist the headline rate describes a subset, and
          saying so is the difference between a rate and a misleading rate.
          It is deliberately NOT the headline: it qualifies the answer rather
          than replacing it.
        */}
        {card.coverage?.kind === 'discipline' && card.coverage.incompleteTradeCount > 0 ? (
          <p
            data-insight-incomplete-checks={card.coverage.incompleteTradeCount}
            className="text-muted-foreground text-[11px] leading-4 text-pretty"
          >
            {`${t('insight.required_checks_incomplete')} · ${t('sample.trades', {
              count: card.coverage.incompleteTradeCount,
            })}`}
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
function Statement({ statement }: { statement: InsightStatementView }) {
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
      {/*
        THE EYEBROW IS A FINDING'S LABEL, SO A STATUS CARD DOES NOT GET ONE.
        Strategy and Psychology name an observation ("Strongest observed
        Strategy", "Tagged Trades averaged below the baseline") and the figure
        below is that observation's evidence. Discipline has no observation to
        name — its answer IS the rate — and an eyebrow there could only repeat
        the role label already sitting beside the number.
      */}
      {statement.presentation === 'status' ? null : (
        <p className="text-muted-foreground text-[11px] leading-4">
          {t(`insight.${statement.type}`)}
        </p>
      )}
      {subject === null ? null : (
        <p
          data-insight-subject
          className="text-foreground min-w-0 text-sm leading-tight font-semibold break-words"
        >
          {subject}
        </p>
      )}
      {statement.headline === null ? null : (
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p
            data-insight-headline
            className={cn(
              'numeric text-[1.75rem] leading-8 font-semibold tracking-tight',
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
/**
 * The context that left the card's face, gathered behind its ⓘ.
 *
 * Every string here already existed and is unchanged — this is a relocation,
 * not new methodology copy. Three things arrive: how many observations the
 * finding rests on (whatever the quality, so a supported sample is still
 * knowable), the pillar's coverage of its eligible population, and the
 * overlapping-cohort note wherever the subject is a cohort a Trade can belong
 * to more than one of.
 *
 * The overlap note can safely live here NOW, and could not before: with two
 * cohorts on the face a reader could read them as shares of a whole, so the
 * note had to sit beside them. With exactly one cohort rendered there is no
 * visible partition to misread.
 */
function InsightContext({ card }: { card: InsightCardView }) {
  const t = useTranslations('dashboard.insights');
  const coverage = card.coverage;
  const showOverlap = card.primary?.nonAdditive === true;
  if (card.sample === null && coverage === null && !showOverlap) return null;

  return (
    <dl className="mt-3 flex flex-col gap-1.5">
      {card.sample === null ? null : (
        <div data-insight-info-sample className="text-muted-foreground text-xs leading-relaxed">
          {card.sample.quality === 'supported'
            ? `${t('sample.supported')} ${t('sample.trades', { count: card.sample.tradeCount })}`
            : `${t('sample.limited')} · ${t('sample.trades', { count: card.sample.tradeCount })}`}
        </div>
      )}
      {coverage === null || coverage.eligibleTradeCount === 0 ? null : (
        <div data-insight-info-coverage className="text-muted-foreground text-xs leading-relaxed">
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
        </div>
      )}
      {showOverlap ? (
        <div data-insight-info-overlap className="text-muted-foreground text-xs leading-relaxed">
          {t('nonAdditive')}
        </div>
      ) : null}
    </dl>
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
