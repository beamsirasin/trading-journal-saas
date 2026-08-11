import type {
  AdminWorkspacePlanFilter,
  AdminWorkspaceSourceFilter,
} from '@/server/dal/admin/workspaces';
import { getAdminWorkspaceList } from '@/server/services/admin/workspace-oversight';
import { AdminWorkspaceListPage } from '@/components/admin/admin-workspace-list-page';

const PLAN_FILTERS: readonly AdminWorkspacePlanFilter[] = [
  'starter',
  'trader',
  'professional',
  'none',
];
const SOURCE_FILTERS: readonly AdminWorkspaceSourceFilter[] = ['trial', 'paid', 'complimentary'];

function toPlanFilter(value: string | undefined): AdminWorkspacePlanFilter | null {
  return PLAN_FILTERS.find((plan) => plan === value) ?? null;
}

function toSourceFilter(value: string | undefined): AdminWorkspaceSourceFilter | null {
  return SOURCE_FILTERS.find((source) => source === value) ?? null;
}

/**
 * `getAdminWorkspaceList()` re-checks `requirePlatformAdmin()` itself. Read-
 * only: no Server Action, no form beyond the search/filter controls' plain
 * navigation, no mutation surface exists on this page.
 */
export default async function AdminWorkspacesRoute({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; source?: string; cursor?: string }>;
}) {
  const { q, plan, source, cursor } = await searchParams;
  const query = q ?? '';
  const planFilter = toPlanFilter(plan);
  const sourceFilter = toSourceFilter(source);
  const page = await getAdminWorkspaceList({
    q: query,
    plan: planFilter,
    source: sourceFilter,
    cursor: cursor ?? null,
  });
  return (
    <AdminWorkspaceListPage
      page={page}
      query={query}
      plan={planFilter ?? ''}
      source={sourceFilter ?? ''}
      hasCursor={cursor !== undefined && cursor !== ''}
    />
  );
}
