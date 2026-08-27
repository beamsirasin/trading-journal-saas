import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { parseCalendarNavigation } from '@/lib/dashboard/calendar-navigation';
import { parseDashboardFilterState } from '@/lib/dashboard/filters';
import { calendarDateIn } from '@/lib/time';
import { getDashboardPageData } from '@/server/services/dashboard';
import { DashboardCalendarSection } from '@/components/dashboard/calendar/dashboard-calendar-section';
import { NoActiveTradingAccountRecovery } from '@/components/dashboard/empty-trading-dashboard';
import {
  DashboardDataError,
  DashboardSkeleton,
  RealDashboard,
} from '@/components/dashboard/real-dashboard';
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
  const t = await getTranslations({ locale: appLocale, namespace: 'dashboard' });

  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app'),
    },
  };
}

export default async function AppOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('dashboard');

  return (
    /*
      `canvas`, not `wide` (D4.5 §1): the Dashboard is the one surface where a
      1728/1920-class monitor was showing a 1536px column with ~128px of dead
      margin either side. The gutters are unchanged (16/24/32px) — only the
      ceiling moved, so 1280 and 1440 are byte-for-byte what they were and
      only the widths the old cap was actually clipping change.

      `gap-5` puts 20px between the page header and the account context bar,
      which is where the rest of the page's explicit rhythm starts.
    */
    <Container width="canvas" className="flex min-w-0 flex-col gap-5 py-6">
      <PageHeader title={t('title')} description={t('description')} />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent locale={locale} rawSearchParams={rawSearchParams} />
      </Suspense>
    </Container>
  );
}

async function DashboardContent({
  locale,
  rawSearchParams,
}: {
  locale: string;
  rawSearchParams: PageSearchParams;
}) {
  /*
    TWO PARSERS, ONE URL (D6A). The filter parser owns
    `range`/`account`/`strategy`/`setup`/`version`/`unit`; the calendar parser
    owns `mode`/`month`/`day`/`trade`. Each tolerates the other's keys and BOTH
    still fail closed on anything neither recognises, so a typo'd parameter is
    an error rather than a silently widened population or a silently moved
    calendar.
  */
  const parsed = parseDashboardFilterState(rawSearchParams);
  if (!parsed.ok) return <DashboardDataError />;
  const navigation = parseCalendarNavigation(rawSearchParams);
  if (!navigation.ok) return <DashboardDataError />;

  const dashboard = await getDashboardPageData(parsed.state).catch(() => null);
  if (dashboard === null) return <DashboardDataError />;
  if (!dashboard.ok && dashboard.code === 'no_active_trading_account') {
    return <NoActiveTradingAccountRecovery />;
  }
  if (!dashboard.ok) return <DashboardDataError />;

  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';
  // The Calendar's own timezone comes from the analytics scope the five core
  // reads already resolved — one source, so a Calendar month can never be cut
  // on a different boundary from the KPIs beside it, and no extra preference
  // probe is issued.
  const timezone = dashboard.data.scope.timezone;
  const today = calendarDateIn(new Date(), timezone);

  return (
    <RealDashboard
      data={dashboard.data}
      dateLocale={dateLocale}
      calendarSlot={
        // Its own Suspense boundary: the Calendar's month read must not hold
        // the five core reads' output off the screen, and paging the month
        // re-renders only this subtree.
        <Suspense fallback={<DashboardCalendarSkeleton />}>
          <DashboardCalendarSection
            filters={parsed.state}
            navigation={navigation.state}
            timezone={timezone}
            todayDate={today.ok ? today.value : '1970-01-01'}
            dateLocale={dateLocale}
          />
        </Suspense>
      }
    />
  );
}

/** Reserves the Calendar card's geometry — see `DashboardSkeleton`'s note. */
function DashboardCalendarSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="border-border bg-card h-96 animate-pulse rounded-lg border"
    />
  );
}
