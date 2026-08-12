import type { AdminOverviewDashboard } from '@/server/services/admin/metrics';
import { KpiCard } from '@/components/product/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { AdminActivityChart } from './admin-activity-chart';
import { adminCopy } from './admin-copy';
import { AdminCountTable } from './admin-count-table';

const STATUS_ORDER = ['trialing', 'active', 'expired', 'canceled'] as const;
const PLAN_ORDER = ['starter', 'trader', 'professional', 'none'] as const;
const SOURCE_ORDER = ['trial', 'paid', 'complimentary'] as const;

/** Formats the DTO's ISO `generatedAt` for the "data as of" line — UTC-explicit, matching every other timestamp on this page. */
function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/**
 * The Phase 11C Admin Overview — aggregate counts and two 30-UTC-day
 * activity trends only (the locked metric catalogue). Renders directly from
 * `AdminOverviewDashboard`, the strict serializable DTO
 * `getAdminOverviewDashboard()` returns — no raw DB row, no session/grant
 * object, no user/workspace identifier ever reaches this component.
 */
export function AdminOverviewPage({ dashboard }: { dashboard: AdminOverviewDashboard }) {
  const c = adminCopy.overview;

  const statusRows = STATUS_ORDER.map((status) => ({
    key: status,
    label: c.subscriptions.statusLabels[status],
    count:
      dashboard.subscriptions.byEffectiveStatus.find((row) => row.status === status)?.count ?? 0,
  }));
  const planRows = PLAN_ORDER.map((plan) => ({
    key: plan,
    label: c.subscriptions.planLabels[plan],
    count: dashboard.subscriptions.byPlan.find((row) => row.plan === plan)?.count ?? 0,
  }));
  const sourceRows = SOURCE_ORDER.map((source) => ({
    key: source,
    label: c.subscriptions.sourceLabels[source],
    count: dashboard.subscriptions.bySource.find((row) => row.source === source)?.count ?? 0,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{c.title}</h1>
        <p className="text-muted-foreground text-sm">
          {c.generatedAtPrefix} {formatGeneratedAt(dashboard.generatedAt)} UTC
        </p>
      </div>

      <section aria-label={c.title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          label={c.totals.users}
          value={String(dashboard.totals.users)}
          hint={c.totals.usersHint}
          animate={false}
        />
        <KpiCard
          label={c.totals.workspaces}
          value={String(dashboard.totals.workspaces)}
          hint={c.totals.workspacesHint}
          animate={false}
        />
      </section>

      <section aria-labelledby="admin-subscriptions-heading" className="flex flex-col gap-4">
        <h2 id="admin-subscriptions-heading" className="text-card-title">
          {c.subscriptions.sectionTitle}
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{c.subscriptions.statusTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminCountTable
                caption={c.subscriptions.statusCaption}
                labelHeading={c.subscriptions.statusColumn}
                countHeading={c.subscriptions.countColumn}
                rows={statusRows}
              />
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                {c.subscriptions.statusCaption}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{c.subscriptions.planTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminCountTable
                caption={c.subscriptions.planCaption}
                labelHeading={c.subscriptions.planColumn}
                countHeading={c.subscriptions.countColumn}
                rows={planRows}
              />
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                {c.subscriptions.planCaption}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{c.subscriptions.sourceTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminCountTable
                caption={c.subscriptions.sourceCaption}
                labelHeading={c.subscriptions.sourceColumn}
                countHeading={c.subscriptions.countColumn}
                rows={sourceRows}
              />
              <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                {c.subscriptions.sourceCaption}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="admin-activity-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="admin-activity-heading" className="text-card-title">
            {c.activity.sectionTitle}
          </h2>
          <p className="text-muted-foreground text-sm">{c.activity.windowLabel}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AdminActivityChart
            titleId="admin-new-users-heading"
            title={c.activity.newUsersTitle}
            description={c.activity.newUsersDescription}
            caption={c.activity.newUsersCaption}
            data={dashboard.activity.newUsers30d}
            color="var(--chart-1)"
            dateColumnLabel={c.activity.dateColumn}
            countColumnLabel={c.activity.countColumn}
          />
          <AdminActivityChart
            titleId="admin-trades-logged-heading"
            title={c.activity.tradesTitle}
            description={c.activity.tradesDescription}
            caption={c.activity.tradesCaption}
            data={dashboard.activity.tradesLogged30d}
            color="var(--chart-2)"
            dateColumnLabel={c.activity.dateColumn}
            countColumnLabel={c.activity.countColumn}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * Mirrors `AdminOverviewPage`'s real layout so content swapping in does not
 * shift anything — the same "skeleton sized like the real page" convention
 * `AnalyticsSkeleton` (`src/components/analytics/analytics-page.tsx`)
 * already established. No provisional numeric zeros anywhere (Phase 11C's
 * own instruction) — every block here is a plain `bg-muted` placeholder.
 */
export function AdminOverviewSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-8" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-8 w-64 rounded-md" />
        <div className="bg-muted h-4 w-48 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="bg-card border-border h-28 rounded-lg border" />
        <div className="bg-card border-border h-28 rounded-lg border" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-muted h-6 w-40 rounded-md" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="bg-card border-border h-56 rounded-lg border" />
          <div className="bg-card border-border h-56 rounded-lg border" />
          <div className="bg-card border-border h-56 rounded-lg border" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-muted h-6 w-40 rounded-md" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="bg-card border-border h-80 rounded-lg border" />
          <div className="bg-card border-border h-80 rounded-lg border" />
        </div>
      </div>
    </div>
  );
}
