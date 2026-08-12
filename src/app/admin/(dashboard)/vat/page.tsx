import { getVatConfigurationReadModel } from '@/server/services/admin/vat';
import { AdminVatPage } from '@/components/admin/admin-vat-page';

/**
 * `getVatConfigurationReadModel()` re-checks `requirePlatformAdmin()` itself.
 * The single mutation dialog it renders (`AdminVatSupport`) calls its own
 * Server Action, which independently re-verifies authority again inside its
 * own transaction — neither layer trusts the other alone.
 */
export default async function AdminVatRoute() {
  const readModel = await getVatConfigurationReadModel();
  return <AdminVatPage readModel={readModel} />;
}
