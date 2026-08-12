import 'server-only';

import { PREPARED_VAT_RATE_BASIS_POINTS, type VatConfiguration } from '@/lib/billing';

/**
 * NOT RUNTIME AUTHORITY — as of Phase 11F, `platform_vat_configuration`
 * (`src/server/services/platform-vat-configuration.ts`'s
 * `getEffectivePlatformVatConfiguration()`) is the ONE production source of
 * VAT configuration; every quotation/checkout/presentation call site
 * resolves it from there, never from this constant. This name was
 * `DEFAULT_VAT_CONFIGURATION` before Phase 11F, when it WAS the live
 * fallback (`server/billing/presentation.ts`'s and `server/services/
 * checkout.ts`'s default parameter values) — renamed specifically so it can
 * never again be mistaken for that role. It survives only as a fixture
 * value matching migration 0009's baseline seed shape (`enabled: false`,
 * `700` basis points), for tests that want a `VatConfiguration`-shaped
 * literal without resolving one from a database. Do not import this from
 * any production (`server/`, `app/`) code path.
 */
export const VAT_CONFIGURATION_LAUNCH_FIXTURE: VatConfiguration = Object.freeze({
  enabled: false,
  rateBasisPoints: PREPARED_VAT_RATE_BASIS_POINTS,
});
