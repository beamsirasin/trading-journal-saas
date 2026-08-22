import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import type { AnalyticsEquityPoint } from '@/lib/analytics/metrics';
import { parseAnalyticsUrlFilters, parseAnalyticsView } from '@/lib/analytics/url-filters';
import { formatInstant, parseInstant } from '@/lib/time';
import { getAnalyticsPageData } from '@/server/services/analytics';
import {
  AnalyticsDataError,
  AnalyticsFilterError,
  AnalyticsNoActiveAccount,
  AnalyticsSkeleton,
  RealAnalyticsPage,
  type AnalyticsEquityDisplayData,
} from '@/components/analytics/analytics-page';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = Record<string, string | string[] | undefined>;
const DATE_LOCALE: Record<string, string> = { en: 'en-GB', th: 'th' };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'analytics' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/analytics'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/analytics'),
    },
  };
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('analytics');

  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsContent locale={locale} rawSearchParams={rawSearchParams} />
      </Suspense>
    </Container>
  );
}

async function AnalyticsContent({
  locale,
  rawSearchParams,
}: {
  locale: string;
  rawSearchParams: PageSearchParams;
}) {
  const parsed = parseAnalyticsUrlFilters(rawSearchParams);
  const view = parseAnalyticsView(rawSearchParams.view);
  const result = await getAnalyticsPageData(
    parsed.ok ? parsed.input : { unsupportedAnalyticsFilter: true },
  ).catch(() => null);
  if (result === null) return <AnalyticsDataError />;
  if (!result.ok) {
    if (result.code === 'no_active_trading_account') return <AnalyticsNoActiveAccount />;
    if (result.code === 'invalid_filters') {
      return <AnalyticsFilterError options={result.filterOptions} />;
    }
    return <AnalyticsDataError />;
  }
  if (!parsed.ok) return <AnalyticsFilterError options={result.data.filterOptions} />;

  const snapshot = result.data.snapshot;
  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';
  const equity: AnalyticsEquityDisplayData = {
    trader:
      snapshot.trader.equityCurve.status === 'available'
        ? formatEquityPoints(snapshot.trader.equityCurve.value, snapshot.scope.timezone, dateLocale)
        : [],
    system:
      snapshot.system.equityCurve.status === 'available'
        ? formatEquityPoints(snapshot.system.equityCurve.value, snapshot.scope.timezone, dateLocale)
        : [],
  };
  return (
    <RealAnalyticsPage
      snapshot={snapshot}
      filterOptions={result.data.filterOptions}
      selection={parsed.selection}
      equity={equity}
      view={view}
    />
  );
}

function formatEquityPoints(
  points: readonly AnalyticsEquityPoint[],
  timezone: string,
  locale: string,
) {
  return points.map((point) => {
    const instant = parseInstant(point.occurredAt);
    const display = instant.ok
      ? formatInstant(instant.value, timezone, { style: 'date', locale })
      : null;
    return {
      ...point,
      occurredAtDisplay: display?.ok === true ? display.value : '—',
    };
  });
}
