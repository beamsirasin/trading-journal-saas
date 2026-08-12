import { adminCopy } from '@/components/admin/admin-copy';
import { AdminVatPageSkeleton } from '@/components/admin/admin-vat-page';

export default function AdminVatLoading() {
  return (
    <>
      <AdminVatPageSkeleton />
      <span className="sr-only" role="status">
        {adminCopy.vat.loadingLabel}
      </span>
    </>
  );
}
