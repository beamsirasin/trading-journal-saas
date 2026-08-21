import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsSnapshot } from '@/lib/analytics/metrics';
import type { AnalyticsUrlSelection } from '@/lib/analytics/url-filters';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';
import { AnalyticsFilters } from '@/components/analytics/analytics-filters';
import { BehaviorZone } from '@/components/analytics/analytics-overview-behavior';
import { EdgeZone } from '@/components/analytics/analytics-overview-edge';
import { ResultsZone } from '@/components/analytics/analytics-overview-results';
import { AnalyticsComparisonPanel } from '@/components/analytics/comparison-panel';
import { ConditionPerformance } from '@/components/analytics/condition-performance';
import { ConfidencePerformance } from '@/components/analytics/confidence-performance';
import { EmotionPerformance } from '@/components/analytics/emotion-performance';
import { EquityChart, type AnalyticsEquityDisplayPoint } from '@/components/analytics/equity-chart';
import { MistakeFrequency } from '@/components/analytics/mistake-frequency';
import { PerformancePanel } from '@/components/analytics/performance-panel';
import { RuleSummary } from '@/components/analytics/rule-summary';
import { SetupAdherencePanel } from '@/components/analytics/setup-adherence-panel';
import { SectionHeader } from '@/components/product/page-header';
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
}: {
  snapshot: AnalyticsSnapshot;
  filterOptions: AnalyticsFilterOptions;
  selection: AnalyticsUrlSelection;
  equity: AnalyticsEquityDisplayData;
}) {
  const t = useTranslations('analytics.real');
  const scopeLabels = buildScopeLabels(snapshot, filterOptions, t);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <AnalyticsFilters options={filterOptions} selection={selection} />

      <p className="text-muted-foreground text-sm" aria-label={t('scope.label')}>
        {scopeLabels.join(' · ')}
      </p>

      <ResultsZone
        trader={snapshot.trader}
        system={snapshot.system}
        systemPendingCount={snapshot.systemPendingCount}
        comparison={snapshot.comparison}
      />
      <EdgeZone setupAdherence={snapshot.setupAdherence} />
      <BehaviorZone confidence={snapshot.confidence} emotions={snapshot.emotions} />

      <section aria-labelledby="analytics-performance-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="analytics-performance-heading"
          title={t('performance.title')}
          description={t('performance.description')}
        />
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <PerformancePanel
            series="system"
            metrics={snapshot.system}
            pendingCount={snapshot.systemPendingCount}
          />
          <PerformancePanel series="trader" metrics={snapshot.trader} />
        </div>
      </section>

      <section aria-labelledby="analytics-comparison-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="analytics-comparison-heading"
          title={t('comparison.title')}
          description={t('comparison.description')}
        />
        <AnalyticsComparisonPanel comparison={snapshot.comparison} />
      </section>

      <section aria-labelledby="analytics-equity-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="analytics-equity-heading"
          title={t('equity.title')}
          description={t('equity.description')}
        />
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <EquityChart
            series="trader"
            metric={snapshot.trader.equityCurve}
            points={equity.trader}
          />
          <EquityChart
            series="system"
            metric={snapshot.system.equityCurve}
            points={equity.system}
          />
        </div>
      </section>

      <section aria-labelledby="analytics-setup-quality-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="analytics-setup-quality-heading"
          title={t('setupQuality.title')}
          description={t('setupQuality.description')}
        />
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <SetupAdherencePanel adherence={snapshot.setupAdherence} />
          <ConditionPerformance conditions={snapshot.conditions} />
        </div>
      </section>

      <section aria-labelledby="analytics-psychology-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="analytics-psychology-heading"
          title={t('psychology.title')}
          description={t('psychology.description')}
        />
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <ConfidencePerformance confidence={snapshot.confidence} />
          <EmotionPerformance emotions={snapshot.emotions} />
        </div>
      </section>

      <div className="grid min-w-0 gap-8 xl:grid-cols-2">
        <section aria-labelledby="analytics-rules-heading" className="flex flex-col gap-4">
          <SectionHeader
            id="analytics-rules-heading"
            title={t('rules.title')}
            description={t('rules.description')}
          />
          <RuleSummary rules={snapshot.rules} />
        </section>

        <section aria-labelledby="analytics-mistakes-heading" className="flex flex-col gap-4">
          <SectionHeader
            id="analytics-mistakes-heading"
            title={t('mistakes.title')}
            description={t('mistakes.description')}
          />
          <MistakeFrequency mistakes={snapshot.mistakes} />
        </section>
      </div>
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
      <AnalyticsFilters options={options} selection={defaultSelection} />
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
