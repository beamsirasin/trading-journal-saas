import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsSnapshot } from '@/lib/analytics/metrics';
import {
  buildAnalyticsViewHref,
  type AnalyticsUrlSelection,
  type AnalyticsView,
} from '@/lib/analytics/url-filters';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';
import { AnalyticsExploreNav } from '@/components/analytics/analytics-explore-nav';
import { AnalyticsFilters } from '@/components/analytics/analytics-filters';
import { BehaviorZone } from '@/components/analytics/analytics-overview-behavior';
import { EdgeZone } from '@/components/analytics/analytics-overview-edge';
import { ResultsZone } from '@/components/analytics/analytics-overview-results';
import { AnalyticsComparisonPanel } from '@/components/analytics/comparison-panel';
import { ConditionPerformance } from '@/components/analytics/condition-performance';
import { ConfidencePerformance } from '@/components/analytics/confidence-performance';
import { ContextBreakdownPanel } from '@/components/analytics/context-breakdown-panel';
import { EmotionPerformance } from '@/components/analytics/emotion-performance';
import { EquityChart, type AnalyticsEquityDisplayPoint } from '@/components/analytics/equity-chart';
import { MistakeFrequency } from '@/components/analytics/mistake-frequency';
import { PerformancePanel } from '@/components/analytics/performance-panel';
import { RuleSummary } from '@/components/analytics/rule-summary';
import { SetupAdherencePanel } from '@/components/analytics/setup-adherence-panel';
import { SetupPerformancePanel } from '@/components/analytics/setup-performance-panel';
import { StrategyPerformancePanel } from '@/components/analytics/strategy-performance-panel';
import { SectionHeader } from '@/components/product/page-header';
import { ZoneSection } from '@/components/product/zone-section';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export interface AnalyticsEquityDisplayData {
  readonly trader: readonly AnalyticsEquityDisplayPoint[];
  readonly system: readonly AnalyticsEquityDisplayPoint[];
}

export function RealAnalyticsPage({
  snapshot,
  filterOptions,
  selection,
  equity,
  view,
}: {
  snapshot: AnalyticsSnapshot;
  filterOptions: AnalyticsFilterOptions;
  selection: AnalyticsUrlSelection;
  equity: AnalyticsEquityDisplayData;
  view: AnalyticsView;
}) {
  const t = useTranslations('analytics.real');
  const tTrades = useTranslations('trades');
  const scopeLabels = buildScopeLabels(snapshot, filterOptions, t);
  const formatDirection = (value: string) =>
    tTrades.has(`direction.${value}`) ? tTrades(`direction.${value}` as 'direction.long') : value;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AnalyticsFilters options={filterOptions} selection={selection} view={view} />

      <AnalyticsExploreNav view={view} />

      <p className="text-muted-foreground text-sm" aria-label={t('scope.label')}>
        {scopeLabels.join(' · ')}
      </p>

      {view === 'overview' ? (
        <>
          <h2 id="analytics-overview-top" className="sr-only">
            {t('overview.top')}
          </h2>
          <ResultsZone
            trader={snapshot.trader}
            system={snapshot.system}
            systemPendingCount={snapshot.systemPendingCount}
            comparison={snapshot.comparison}
            exploreHref={buildAnalyticsViewHref(selection, 'results')}
          />
          <EdgeZone
            setupAdherence={snapshot.setupAdherence}
            strategyPerformance={snapshot.strategyPerformance}
            setupPerformance={snapshot.setupPerformance}
            strategyOptions={filterOptions.strategies}
            setupOptions={filterOptions.setups}
            exploreHref={buildAnalyticsViewHref(selection, 'edge')}
          />
          <BehaviorZone
            confidence={snapshot.confidence}
            emotions={snapshot.emotions}
            exploreHref={buildAnalyticsViewHref(selection, 'behavior')}
          />
        </>
      ) : null}

      {/* Phase 15D — RESULTS Explore: Trader Performance (core, equity, Trade
          Management, Context), System Performance (core, equity), and the
          paired-only Comparison — every Phase 15C "Explore" anchor still
          lands here unchanged (brief §49). */}
      {view === 'results' ? (
        <ZoneSection
          zone="results"
          title={t('explore.results.title')}
          id="analytics-performance-heading"
        >
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <section aria-label={t('trader.title')} className="flex flex-col gap-4">
              {/* `PerformancePanel` already renders its own "Trader Performance"
                CardTitle — no duplicate SectionHeader here. */}
              <PerformancePanel series="trader" metrics={snapshot.trader} />
              <EquityChart
                series="trader"
                metric={snapshot.trader.equityCurve}
                points={equity.trader}
              />
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t('equity.description')}
              </p>

              <section
                aria-labelledby="analytics-trade-management-heading"
                className="flex flex-col gap-4"
              >
                <SectionHeader
                  id="analytics-trade-management-heading"
                  as="h3"
                  title={t('explore.tradeManagement.title')}
                  description={t('explore.tradeManagement.description')}
                />
                <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                  <RuleSummary rules={snapshot.rules} />
                  <MistakeFrequency mistakes={snapshot.mistakes} />
                </div>
              </section>

              <section aria-labelledby="analytics-context-heading" className="flex flex-col gap-4">
                <SectionHeader
                  id="analytics-context-heading"
                  as="h3"
                  title={t('explore.context.title')}
                />
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <ContextBreakdownPanel
                    title={t('explore.context.symbol.title')}
                    breakdown={snapshot.contextSymbol}
                    emptyLabel={t('explore.context.empty')}
                  />
                  <ContextBreakdownPanel
                    title={t('explore.context.direction.title')}
                    breakdown={snapshot.contextDirection}
                    formatValue={formatDirection}
                    emptyLabel={t('explore.context.empty')}
                  />
                  <ContextBreakdownPanel
                    title={t('explore.context.session.title')}
                    breakdown={snapshot.contextSession}
                    emptyLabel={t('explore.context.empty')}
                  />
                  <ContextBreakdownPanel
                    title={t('explore.context.timeframe.title')}
                    breakdown={snapshot.contextTimeframe}
                    emptyLabel={t('explore.context.empty')}
                  />
                </div>
              </section>
            </section>

            <section aria-label={t('system.title')} className="flex flex-col gap-4">
              {/* `PerformancePanel` already renders its own "System Performance"
                CardTitle — no duplicate SectionHeader here. */}
              <PerformancePanel
                series="system"
                metrics={snapshot.system}
                pendingCount={snapshot.systemPendingCount}
              />
              <EquityChart
                series="system"
                metric={snapshot.system.equityCurve}
                points={equity.system}
              />
            </section>

            <section
              aria-labelledby="analytics-comparison-heading"
              className="flex flex-col gap-4 xl:col-span-2"
            >
              <SectionHeader
                id="analytics-comparison-heading"
                as="h3"
                title={t('comparison.title')}
                description={t('comparison.description')}
              />
              <AnalyticsComparisonPanel comparison={snapshot.comparison} />
            </section>
          </div>
        </ZoneSection>
      ) : null}

      {/* Phase 15D — EDGE Explore: Strategy/Setup Performance (net-new
          composition) plus the existing Setup Adherence/Condition
          performance, relocated from the former "Setup Quality" section. */}
      {view === 'edge' ? (
        <ZoneSection
          zone="edge"
          title={t('explore.edge.title')}
          id="analytics-setup-quality-heading"
        >
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <section
              aria-labelledby="analytics-strategy-performance-heading"
              className="flex min-w-0 flex-col gap-4"
            >
              <SectionHeader
                id="analytics-strategy-performance-heading"
                as="h3"
                title={t('explore.strategyPerformance.title')}
              />
              <StrategyPerformancePanel
                performance={snapshot.strategyPerformance}
                options={filterOptions.strategies}
              />
            </section>

            <section
              aria-labelledby="analytics-setup-performance-heading"
              className="flex min-w-0 flex-col gap-4"
            >
              <SectionHeader
                id="analytics-setup-performance-heading"
                as="h3"
                title={t('explore.setupPerformance.title')}
              />
              <SetupPerformancePanel
                performance={snapshot.setupPerformance}
                setupOptions={filterOptions.setups}
                strategyOptions={filterOptions.strategies}
              />
            </section>

            <section
              aria-labelledby="analytics-setup-adherence-heading"
              className="flex min-w-0 flex-col gap-4 xl:col-span-2"
            >
              <SectionHeader
                id="analytics-setup-adherence-heading"
                as="h3"
                title={t('setupAdherence.average')}
              />
              <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                <SetupAdherencePanel adherence={snapshot.setupAdherence} />
                <ConditionPerformance conditions={snapshot.conditions} />
              </div>
            </section>
          </div>
        </ZoneSection>
      ) : null}

      {/* Phase 15D — BEHAVIOR Explore: the full independent Trader/System
          Confidence and Emotion analytics, unchanged since Phase 13H —
          relocated from the former "Psychology" section. */}
      {view === 'behavior' ? (
        <ZoneSection
          zone="behavior"
          title={t('explore.behavior.title')}
          id="analytics-psychology-heading"
        >
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <ConfidencePerformance confidence={snapshot.confidence} />
            <EmotionPerformance emotions={snapshot.emotions} />
          </div>
        </ZoneSection>
      ) : null}
    </div>
  );
}

type Translator = ReturnType<typeof useTranslations<'analytics.real'>>;

function buildScopeLabels(
  snapshot: AnalyticsSnapshot,
  options: AnalyticsFilterOptions,
  t: Translator,
): string[] {
  const range = t(
    `filters.${snapshot.scope.datePreset === '30d' ? 'range30' : snapshot.scope.datePreset === '90d' ? 'range90' : 'rangeAll'}`,
  );
  const labels = [range];
  if (snapshot.scope.accountScope.kind === 'all') {
    labels.push(t('filters.allAccounts'));
  } else {
    const accountId = snapshot.scope.accountScope.accountId;
    const account = options.accounts.find((item) => item.tradingAccountId === accountId);
    labels.push(account?.name ?? t('filters.activeAccount'));
  }
  const strategy = options.strategies.find((item) => item.strategyId === snapshot.scope.strategyId);
  const setup = options.setups.find((item) => item.setupId === snapshot.scope.setupId);
  const version = options.strategyVersions.find(
    (item) => item.strategyVersionId === snapshot.scope.strategyVersionId,
  );
  if (strategy !== undefined) labels.push(strategy.label);
  if (setup !== undefined) labels.push(setup.label);
  if (version !== undefined) {
    labels.push(
      t('filters.versionOption', { name: version.strategyName, number: version.versionNumber }),
    );
  }
  return labels;
}

export function AnalyticsFilterError({ options }: { options: AnalyticsFilterOptions }) {
  const t = useTranslations('analytics.real');
  const defaultSelection: AnalyticsUrlSelection = {
    range: '90d',
    account: null,
    strategy: null,
    setup: null,
    version: null,
  };
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsFilters options={options} selection={defaultSelection} view="overview" />
      <Card role="alert">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert className="size-5" aria-hidden="true" /> {t('invalid.title')}
          </CardTitle>
          <CardDescription>{t('invalid.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/app/analytics"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('filters.reset')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function AnalyticsNoActiveAccount() {
  const t = useTranslations('analytics.real');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('noActive.title')}</CardTitle>
        <CardDescription>{t('noActive.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/app/accounts"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('noActive.action')}
        </Link>
      </CardContent>
    </Card>
  );
}

export function AnalyticsDataError() {
  const t = useTranslations('analytics.real');
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>{t('error.title')}</CardTitle>
        <CardDescription>{t('error.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/app/analytics"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('error.retry')}
        </Link>
      </CardContent>
    </Card>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-8" aria-hidden="true">
      <div className="border-border bg-card h-64 rounded-lg border" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border-border bg-card h-[34rem] rounded-lg border" />
        <div className="border-border bg-card h-[34rem] rounded-lg border" />
      </div>
      <div className="border-border bg-card h-56 rounded-lg border" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="border-border bg-card h-96 rounded-lg border" />
        <div className="border-border bg-card h-96 rounded-lg border" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="border-border bg-card h-72 rounded-lg border" />
        <div className="border-border bg-card h-72 rounded-lg border" />
      </div>
    </div>
  );
}
