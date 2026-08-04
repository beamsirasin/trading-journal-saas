import 'server-only';

import { PREPARED_VAT_RATE_BASIS_POINTS, type VatConfiguration } from '@/lib/billing';

/**
 * Launch configuration. Only server code may supply this trusted object to
 * checkout quotation. Phase 11 will replace this constant with admin-owned
 * persistence; customer requests must never contain or override it.
 */
export const DEFAULT_VAT_CONFIGURATION: VatConfiguration = Object.freeze({
  enabled: false,
  rateBasisPoints: PREPARED_VAT_RATE_BASIS_POINTS,
});
