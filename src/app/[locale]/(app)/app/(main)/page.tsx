import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { parseCalendarNavigation } from '@/lib/dashboard/calendar-navigation';
import { parseDashboardFilterState } from '@/lib/dashboard/filters';
import { calendarDateIn } from '@/lib/time';
import { getDashboardPageData } from '@/server/services/dashboard';
import { DashboardCalendarSection } from '@/components/dashboard/calendar/dashboard-calendar-section';
import { DashboardTransitionOverlay } from '@/components/dashboard/dashboard-transition-overlay';
import { NoActiveTradingAccountRecovery } from '@/components/dashboard/empty-trading-dashboard';
import { InsightPillarsDataSection } from '@/components/dashboard/insights/insight-pillars-data-section';
import {
  DashboardDataError,
  DashboardSkeleton,
  RealDashboard,
} from '@/components/dashboard/real-dashboard';
import { RiskPerformanceSection } from '@/components/dashboard/risk/risk-performance-section';
import {
  DashboardToolbar,
  DashboardToolbarControlsSkeleton,
} from '@/components/dashboard/toolbar/dashboard-toolbar';
import { DashboardToolbarControls } from '@/components/dashboard/toolbar/dashboard-toolbar-controls';
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

  /*
    THE TOOLBAR PARSES THE URL FOR ITSELF, SYNCHRONOUSLY.

    It needs the applied filter state to render its own labels, and it must
    not wait on the five analytical reads to do it — the bar a reader uses to
    CHANGE the range would then only appear once the current range had
    finished computing. Parsing is pure and cheap, so both halves of the page
    call the same canonical parser rather than one passing state to the other
    across a Suspense boundary. On invalid filters the toolbar renders no
    controls at all: the page body below is already showing the error, and
    controls seeded from unparseable state would be lying about what is
    applied.
  */
  const parsedFilters = parseDashboardFilterState(rawSearchParams);
  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';

  return (
    <>
      <DashboardToolbar
        title={t('title')}
        controls={
          parsedFilters.ok ? (
            <Suspense fallback={<DashboardToolbarControlsSkeleton />}>
              <DashboardToolbarControls filters={parsedFilters.state} dateLocale={dateLocale} />
            </Suspense>
          ) : null
        }
      />
      {/*
        `canvas`, not `wide` (D4.5 §1): the Dashboard is the one surface where a
        1728/1920-class monitor was showing a 1536px column with ~128px of dead
        margin either side. The gutters are unchanged (16/24/32px) — only the
        ceiling moved, so 1280 and 1440 are byte-for-byte what they were and
        only the widths the old cap was actually clipping change.

        The page's own `<h1>` lives in the sticky toolbar above, which is the
        frozen toolbar contract's composition — one Dashboard identity, one set
        of global controls, on one line. The supporting sentence that used to
        sit beneath it is gone: a full row of chrome restating what the five
        figures below it already say is exactly the vertical budget the first
        viewport could least afford, and a data surface does not have to
        introduce itself twice. The page description survives where it is
        actually read — in `generateMetadata` above.

        `relative`, so the transition veil can cover exactly the analytical
        area and nothing above it. `DashboardTransitionOverlay` is the ONLY
        client component in this subtree; everything beside it stays
        server-rendered.
      */}
      <Container width="canvas" className="relative flex min-w-0 flex-col pt-4 pb-8">
        <DashboardTransitionOverlay />
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent locale={locale} rawSearchParams={rawSearchParams} />
        </Suspense>
      </Container>
    </>
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
      insightSlot={
        // D8's own streamed boundary: five bulk projections behind one
        // service call, resolved after the five core reads have painted.
        <Suspense fallback={<InsightPillarsSkeleton />}>
          <InsightPillarsDataSection filters={parsed.state} />
        </Suspense>
      }
      riskSlot={
        // D7's boundary, streamed on its own for the same reason: the modeled
        // balance read spans the Account's whole authoritative money history
        // rather than the selected range, and must never hold the five
        // bounded core reads off the screen while it does.
        <Suspense fallback={<RiskPerformanceSkeleton />}>
          <RiskPerformanceSection
            filters={parsed.state}
            timezone={timezone}
            dateLocale={dateLocale}
          />
        </Suspense>
      }
    />
  );
}

/** Reserves the Calendar card's geometry — see `DashboardSkeleton`'s note. */
function DashboardCalendarSkeleton() {
  return <div aria-hidden="true" className="bg-card h-[630px] animate-pulse rounded-lg" />;
}

/** Reserves the three insight pillars' geometry — see `DashboardSkeleton`. */
function InsightPillarsSkeleton() {
  return (
    <div aria-hidden="true" className="grid animate-pulse gap-4 md:grid-cols-2 xl:grid-cols-3">
      {/* 404 -> 272: one finding per card instead of two, and the coverage /
          overlap / supported-sample lines moved behind each card's ⓘ.
          Measured at 1440 on the populated fixture; the three stretch to one
          row height, so a single value reserves all three correctly. */}
      <div className="bg-card h-[272px] rounded-lg" />
      <div className="bg-card h-[272px] rounded-lg" />
      <div className="bg-card h-[272px] rounded-lg md:col-span-2 xl:col-span-1" />
    </div>
  );
}

/** Reserves the Risk Performance card's geometry — same note. */
function RiskPerformanceSkeleton() {
  return <div aria-hidden="true" className="bg-card h-[488px] animate-pulse rounded-lg" />;
}
