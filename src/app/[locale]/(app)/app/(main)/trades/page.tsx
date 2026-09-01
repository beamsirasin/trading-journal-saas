import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { dayRangeIn } from '@/lib/time';
import { parseTradeDetailsTab } from '@/lib/trades/details-tabs';
import { TradeIdSchema } from '@/lib/trades/schemas';
import { tradesStateFilterStatus } from '@/lib/trades/state-filter';
import {
  buildTradesWorkspaceHref,
  parseTradesWorkspaceState,
  TRADES_WORKSPACE_BASE_PATH,
  tradesWorkspaceCarryParams,
  type TradesWorkspaceState,
} from '@/lib/trades/workspace-filters';
import { getWorkspaceEntitlement } from '@/server/auth/dal';
import {
  countWorkspaceTrades,
  getTradeCreateOptions,
  getWorkspaceTradeDetail,
  listWorkspaceTrades,
} from '@/server/dal/trades';
import { getDashboardPageData } from '@/server/services/dashboard';
import {
  DashboardToolbar,
  DashboardToolbarControlsSkeleton,
} from '@/components/dashboard/toolbar/dashboard-toolbar';
import { DashboardToolbarControls } from '@/components/dashboard/toolbar/dashboard-toolbar-controls';
import { Container } from '@/components/shell/container';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { TradesStateNav } from '@/components/trades/workspace/trades-state-nav';
import { TradesSummaryRow } from '@/components/trades/workspace/trades-summary-row';
import { TradesWorkspace } from '@/components/trades/workspace/trades-workspace';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type SearchValue = string | string[] | undefined;
type PageSearchParams = Record<string, SearchValue>;

const TRADES_PAGE_SIZE = 25;
const DATE_LOCALE: Record<string, string> = { en: 'en-GB', th: 'th' };
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function single(value: SearchValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'trades' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/trades'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/trades'),
    },
  };
}

/**
 * THE TRADES WORKSPACE.
 *
 * ONE SHELL, SHARED WITH THE DASHBOARD. The sticky toolbar, its Date Range /
 * Filters / Account controls, the `canvas` container width and the streamed
 * Suspense boundaries are the Dashboard's own components used directly, not
 * re-skinned copies. That is the whole point: this page must be recognisably
 * the same product, and a second toolbar built to look like the first is a
 * toolbar that will stop looking like it within a release.
 *
 * THE ACCOUNT CONTROL IS PAGE-LEVEL HERE, so `/app/trades` joins the
 * Dashboard in `ROUTES_WITH_OWN_ACCOUNT_CONTROL` and the global header
 * suppresses its own switcher. There is never more than one visible account
 * selector on this page.
 *
 * THE TOOLBAR PARSES THE URL FOR ITSELF, SYNCHRONOUSLY — the same contract the
 * Dashboard establishes. Parsing is pure and cheap, so the bar a reader uses
 * to CHANGE the scope never waits on the reads that compute the current one.
 *
 * IT IS A TRADE LOG AT ALL TIMES. The Calendar/Trade Log mode switcher that
 * stood above the table is gone, and with it the month grid this page used to
 * be able to become. The control in that slot now chooses the POPULATION —
 * All / Open / Closed — and the table is always the workspace. The Calendar's
 * own components and domain reads are left in the repository untouched, unwired
 * from this route; removing them is a separate task.
 *
 * TWO PARSERS, ONE URL. `parseTradesWorkspaceState` owns the canonical filter
 * vocabulary plus this page's `state`/`attention`; `date` and the pager's
 * `cursor`/`trail` are read here directly. Both halves fail closed on a key
 * neither recognises, so a typo'd filter is an error rather than a silently
 * widened population.
 */
export default async function TradesPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');
  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';

  const parsed = parseTradesWorkspaceState(query);

  return (
    <>
      <DashboardToolbar
        title={t('title')}
        controls={
          parsed.ok ? (
            <Suspense fallback={<DashboardToolbarControlsSkeleton />}>
              <DashboardToolbarControls
                filters={parsed.state.filters}
                dateLocale={dateLocale}
                href={{
                  basePath: TRADES_WORKSPACE_BASE_PATH,
                  extraParams: tradesWorkspaceCarryParams(parsed.state),
                }}
              />
            </Suspense>
          ) : null
        }
      />
      <Container width="canvas" className="relative flex min-w-0 flex-col gap-6 pt-4 pb-8">
        {!parsed.ok ? (
          <TradesFilterError />
        ) : (
          <>
            <TradesStateNav state={parsed.state.state} />
            <Suspense fallback={<TradesWorkspaceSkeleton />}>
              <TradesContent state={parsed.state} query={query} locale={locale} />
            </Suspense>
          </>
        )}
      </Container>
    </>
  );
}

async function TradesContent({
  state,
  query,
  locale,
}: {
  state: TradesWorkspaceState;
  query: PageSearchParams;
  locale: string;
}) {
  const t = await getTranslations('trades');
  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';

  /*
    THE ANALYTICS SCOPE IS RESOLVED ONCE, AND THE LIST IS SCOPED FROM ITS
    RESULT.

    `getDashboardPageData` performs the canonical, authenticated scope
    resolution — active Account, persisted timezone, verified Strategy / Setup
    / Version identities, and the date bounds computed in the reader's own
    zone. The list below is then narrowed with exactly those resolved values
    rather than with the raw query string, which is what keeps the four summary
    figures and the rows beneath them describing the same scope. Nothing is
    trusted from the client: every identifier was verified against the active
    workspace before it reaches the DAL, and the DAL re-applies its own
    workspace condition regardless (CLAUDE.md section 4).
  */
  const dashboard = await getDashboardPageData(state.filters).catch(() => null);
  if (dashboard === null || !dashboard.ok) {
    // `no_active_trading_account` is a real onboarding state rather than a
    // failure, and it is the one case where the workspace has nothing to scope
    // to at all.
    return dashboard !== null && dashboard.code === 'no_active_trading_account' ? (
      <TradesNoAccount />
    ) : (
      <TradesFilterError />
    );
  }

  const scope = dashboard.data.scope;
  const timezone = scope.timezone;
  const statusFilter = tradesStateFilterStatus(state.state);

  const cursor = single(query.cursor);
  const trail = single(query.trail) ?? '';
  const dateParam = single(query.date);

  /*
    `?date=` OUTLIVES THE CONTROL THAT USED TO SET IT.

    It was the Trading Calendar's "show me this day" narrowing, and with the
    Calendar gone from this page nothing in the UI produces it any more. It is
    still honoured, because links carrying it exist and a day-scoped list is a
    perfectly coherent thing to land on — it simply has no on-page gesture now.
  */
  const selectedDate = dateParam !== undefined && DATE_PATTERN.test(dateParam) ? dateParam : null;
  const selectedDayRange = selectedDate === null ? null : dayRangeIn(selectedDate, timezone);

  /*
    WHICH DATE WINDOW THE LIST USES, AND WHY IT IS THE JOURNAL'S.

    The list is bounded on `occurred_at` — `coalesce(exited_at, entered_at,
    created_at)` — because a workspace has to be able to show Trades that are
    still open, and those have no exit date to be bounded on. Canonical
    analytics is anchored on `exited_at` by definition, which is exactly right
    for the four settled figures above and exactly wrong as the only way into
    a list of live positions.

    That difference is deliberate and is why the summary card labels its own
    count rather than letting the reader infer one from the number of rows.

    A `?date=` day takes precedence over the toolbar's range: it is a
    narrower, more explicit request aimed at the same axis.
  */
  const journalDateRange =
    selectedDayRange !== null && selectedDayRange.ok
      ? selectedDayRange.value
      : scope.dateBounds.kind === 'bounded'
        ? {
            start: new Date(scope.dateBounds.start),
            end: new Date(scope.dateBounds.endExclusive),
          }
        : undefined;

  /*
    ONE SCOPE OBJECT, USED BY THE LIST AND BY ITS COUNT.

    `status` is the top-level population, resolved from the segmented control
    through the canonical `trades.status` vocabulary — `open` and `closed`
    narrow to exactly that lifecycle value, and `all` adds no condition at all,
    so PLANNED and CANCELED Trades appear under All Trades and under neither of
    the other two.
  */
  const listScope = {
    ...(scope.accountScope.kind === 'account'
      ? { tradingAccountId: scope.accountScope.accountId }
      : {}),
    ...(statusFilter === null ? {} : { status: statusFilter }),
    ...(scope.strategyId === null ? {} : { strategyId: scope.strategyId }),
    ...(scope.setupId === null ? {} : { setupId: scope.setupId }),
    ...(scope.strategyVersionId === null ? {} : { strategyVersionId: scope.strategyVersionId }),
    ...(journalDateRange === undefined ? {} : { journalDateRange }),
    ...(state.attention === null ? {} : { attention: state.attention }),
  } as const;

  const [page, entitlement, createOptions, openTradeCount] = await Promise.all([
    listWorkspaceTrades({ ...listScope, cursor: cursor ?? null, limit: TRADES_PAGE_SIZE }),
    getWorkspaceEntitlement(),
    getTradeCreateOptions(),
    /*
      Counted ONLY where a count is the answer the summary row needs and the
      analytics payload cannot give it: open positions are outside the
      canonical Trader population by construction. Under All Trades and Closed
      Trades the row keeps reporting the eligible settled population it always
      has, and this read is not issued at all.
    */
    state.state === 'open' ? countWorkspaceTrades(listScope) : Promise.resolve(null),
  ]);

  const writeAuthorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');
  const canWrite = writeAuthorization.allowed;

  // `?trade=` is validated as a UUID here and then re-scoped to the active
  // workspace by the DAL; a foreign or soft-deleted id is `trade_not_found`,
  // identical to one that never existed.
  const tradeParam = single(query.trade);
  const parsedTradeId = tradeParam === undefined ? null : TradeIdSchema.safeParse(tradeParam);
  const requestedTradeId =
    parsedTradeId !== null && parsedTradeId.success ? parsedTradeId.data : null;
  const detailResult =
    requestedTradeId === null ? null : await getWorkspaceTradeDetail(requestedTradeId);
  const selectedTradeCandidate =
    detailResult !== null && detailResult.ok ? detailResult.trade : null;
  // A bucket filter also governs the sheet: a Trade whose System outcome was
  // resolved in another tab must not stay open inside a "pending" bucket that
  // no longer contains it.
  const selectedTrade =
    state.attention === 'system-pending' && selectedTradeCandidate?.systemStatus !== 'pending'
      ? null
      : selectedTradeCandidate;

  const trades = page.items.map((trade) => ({
    ...trade,
    // Formatted server-side, in the reader's persisted zone — never the
    // browser's and never the server's (CLAUDE.md section 7).
    occurredAtDisplay: formatTradeInstant(trade.occurredAt, timezone, dateLocale) ?? '—',
  }));

  const isFiltered =
    scope.dateBounds.kind === 'bounded' ||
    scope.strategyId !== null ||
    scope.setupId !== null ||
    scope.strategyVersionId !== null;

  const logTradeAction =
    canWrite && (trades.length > 0 || selectedDate !== null) ? (
      <Button asChild>
        <Link href="/app/trades/new">
          <Plus aria-hidden="true" />
          {t('logTrade')}
        </Link>
      </Button>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TradesSummaryRow
        data={dashboard.data}
        scope={
          openTradeCount === null
            ? { kind: 'settled' }
            : { kind: 'open', tradeCount: openTradeCount }
        }
      />

      {canWrite ? null : (
        <div
          role="status"
          className="border-warning/30 bg-warning/10 rounded-lg border p-4 text-sm"
        >
          {t(`errors.${writeAuthorization.code}`)}
        </div>
      )}

      <section aria-labelledby="trades-workspace-heading" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="trades-workspace-heading" className="text-card-title">
              {t('list.title')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {state.attention !== null
                ? t(`list.attentionDescription.${state.attention}`)
                : t(selectedDate !== null ? 'list.descriptionDay' : 'list.description')}
            </p>
          </div>
          {logTradeAction}
        </div>

        <TradesWorkspace
          trades={trades}
          selectedTrade={selectedTrade}
          selectedTradeId={selectedTrade?.tradeId ?? null}
          detailsTab={parseTradeDetailsTab(query.tab, query.section)}
          nextCursor={page.nextCursor}
          currentCursor={cursor ?? null}
          cursorTrail={trail}
          attention={state.attention}
          isDayFiltered={selectedDate !== null}
          isFiltered={isFiltered}
          canWrite={canWrite}
          timezone={timezone}
          locale={dateLocale}
          classificationOptions={createOptions.strategies}
          clearFiltersHref={buildTradesWorkspaceHref({
            filters: {
              ...state.filters,
              datePreset: 'all',
              customDateRange: null,
              strategyId: null,
              setupId: null,
              strategyVersionId: null,
            },
            state: 'all',
            attention: null,
          })}
        />
      </section>
    </div>
  );
}

/**
 * Reserves the workspace's geometry while the scope resolves, so the toolbar
 * above it does not jump when the content arrives.
 */
function TradesWorkspaceSkeleton() {
  return (
    <div aria-hidden="true" className="flex animate-pulse flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <div className="bg-card border-border h-[72px] rounded-lg border" />
        <div className="bg-card border-border h-[72px] rounded-lg border" />
        <div className="bg-card border-border h-[72px] rounded-lg border" />
        <div className="bg-card border-border h-[72px] rounded-lg border" />
      </div>
      <div className="bg-card border-border h-[420px] rounded-lg border" />
    </div>
  );
}

async function TradesFilterError() {
  const t = await getTranslations('trades.workspace');
  return (
    <div role="alert" className="border-border rounded-lg border border-dashed p-6 text-sm">
      <p className="text-foreground font-medium">{t('filterError.title')}</p>
      <p className="text-muted-foreground mt-1 leading-relaxed">{t('filterError.description')}</p>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/app/trades">{t('filterError.action')}</Link>
      </Button>
    </div>
  );
}

async function TradesNoAccount() {
  const t = await getTranslations('trades.workspace');
  return (
    <div role="status" className="border-border rounded-lg border border-dashed p-6 text-sm">
      <p className="text-foreground font-medium">{t('noAccount.title')}</p>
      <p className="text-muted-foreground mt-1 leading-relaxed">{t('noAccount.description')}</p>
      <Button asChild className="mt-4">
        <Link href="/app/accounts">{t('noAccount.action')}</Link>
      </Button>
    </div>
  );
}
