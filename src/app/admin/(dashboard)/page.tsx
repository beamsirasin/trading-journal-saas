import { getAdminOverviewDashboard } from '@/server/services/admin/metrics';
import { AdminOverviewPage } from '@/components/admin/admin-overview-page';

/**
 * `getAdminOverviewDashboard()` re-checks `requirePlatformAdmin()` itself
 * (Phase 11's "the layout guard alone is not sufficient" instruction) — this
 * page never trusts the layout above it as the only authorization boundary.
 * Read-only: no Server Action, no form, no mutation surface exists on this
 * page (Phase 11C is read-only by contract).
 */
export default async function AdminOverviewRoute() {
  const dashboard = await getAdminOverviewDashboard();
  return <AdminOverviewPage dashboard={dashboard} />;
}
