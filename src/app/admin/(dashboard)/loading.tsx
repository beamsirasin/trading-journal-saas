import { adminCopy } from '@/components/admin/admin-copy';
import { AdminOverviewSkeleton } from '@/components/admin/admin-overview-page';

/**
 * Route-level loading boundary — mirrors `(app)/loading.tsx`'s posture
 * (skeleton matching the real layout, `aria-hidden` on the visual skeleton,
 * a visually-hidden `role="status"` label for assistive tech) with EN-only
 * copy instead of `next-intl`.
 */
export default function AdminOverviewLoading() {
  return (
    <>
      <AdminOverviewSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.loading.label}
      </span>
    </>
  );
}
