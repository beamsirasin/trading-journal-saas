# Phase 04 Deployment Checklist

What to verify before deploying the completed Phase 04 billing/checkout surface — including the 04H-A production payment-provider guard — to a real environment. This is a review aid, not a substitute for the automated checks in [Verification commands](#verification-commands).

Full contract: [PHASE-04-billing.md](phases/PHASE-04-billing.md). Implementation summary with file paths: [roadmap.md](roadmap.md#what-phase-04-delivered).

**No real payment gateway exists yet.** Nothing in this checklist enables real payments — it verifies that the mock provider stays inert for public traffic. A real provider, implemented behind `src/server/payments/payment-provider.ts`'s existing interface, is required before public paid activation can launch.

## Environment

Reference: [`.env.example`](../.env.example), [`src/config/env.schema.ts`](../src/config/env.schema.ts), [`src/config/billing-capability.server.ts`](../src/config/billing-capability.server.ts).

- [ ] `NODE_ENV` is exactly `production` in the deployed runtime (`next build && next start` sets this automatically; verify nothing overrides it). Any other value — missing, empty, `staging`, `preview`, a typo — makes `billing-capability.server.ts` fail closed to `unavailable`, so this is self-checking, but confirm it explicitly rather than relying on the failure mode.
- [ ] Mock checkout is unavailable: an authenticated production request to checkout/reconciliation returns `payment_provider_unavailable`, not a working mock form. See [Payments](#payments) below for how to confirm this without a real customer account.
- [ ] `E2E_TEST_MODE` is **absent or not exactly `"true"`**. This variable exists only for `.github/workflows/ci.yml`'s `e2e` job; a real deployment must never set it. (Any value other than the exact string `"true"` — including a truthy-looking one — is already treated as unset.)
- [ ] No guarded test identity or provisioning seam is active. The automated-test capability additionally requires `BETTER_AUTH_URL` to resolve to an exact loopback origin (`localhost`/`127.0.0.1`/`[::1]`) — a production `BETTER_AUTH_URL` never does. There is no separate "internal production demo mode"; none currently exists in this codebase, and building one is out of scope unless a future decision explicitly approves it (see `docs/phases/PHASE-04-billing.md`'s Payment-provider boundary section for the conditions such a mode would require).
- [ ] `.env.local` is not deployed. It is git-ignored (`.gitignore`'s `.env*` entry, with `.env.example` explicitly excepted) and must never be copied into a deployment artifact or hosting-platform secret store verbatim — set real values directly in the hosting platform's environment configuration instead.
- [ ] Test-database variables (`TEST_DATABASE_URL`, `TEST_DATABASE_ACK`) are **not** set in the production environment. They exist only for local development and CI (see [`docs/migration-runbook.md`](migration-runbook.md#test-database-safety)); a real deployment has no use for them and setting them is a signal something is misconfigured.
- [ ] `TEST_DATABASE_URL`, wherever it _is_ used (local machines, CI), still differs from `DATABASE_URL`/`DATABASE_MIGRATION_URL` and its database name contains a `test` or `e2e` segment — enforced by `scripts/test-database-safety.mjs`, not merely a convention.
- [ ] Environment validation passes: the app boots without a `getServerEnv()` parse failure (an unrecognized `NODE_ENV`, a malformed `BETTER_AUTH_URL`, etc. fail the whole app closed at first use, by design — see `src/config/env.schema.ts`).

## Database

Reference: [`docs/migration-runbook.md`](migration-runbook.md), [`docs/data-dictionary.md`](data-dictionary.md).

- [ ] A backup/point-in-time-recovery plan exists and has been verified against your actual hosting plan's capabilities before this deploy, not assumed.
- [ ] Migrations `0005_extend_workspace_entitlements_for_billing.sql` and `0006_create_billing_transaction_snapshots.sql` are applied — both are required before Phase 04 application code runs; `0006` in particular creates the `billing_transactions` table and its immutability trigger that checkout depends on unconditionally.
- [ ] `pnpm db:check` reports no drift between the committed migrations and the schema files (run against `DATABASE_MIGRATION_URL`/the direct connection — see the runbook for why the pooled endpoint cannot reliably hold migration locks).
- [ ] Migration application is a deliberate, explicit step before traffic is routed to the new code — never auto-migrate-on-boot (CLAUDE.md §4/§10).
- [ ] The workspace-deletion restriction is understood: `billing_transactions.workspace_id` is `ON DELETE RESTRICT`, so a workspace with any billing history cannot be deleted until a future explicit financial-record retention/anonymization process exists. This is deliberate, not a bug to work around with a cascading delete.
- [ ] Rollback plan is application-first and data-preserving: Drizzle migrations are forward-only (no `db:migrate:down`). Roll back a bad deploy by reverting the _application_ code first if possible; a schema rollback is a new forward migration that reverses the change, never a hand-edit of an already-applied migration file. See the runbook's [Rollback](migration-runbook.md#rollback) section.
- [ ] Migrations `0000`–`0006` are not rewritten after release — CLAUDE.md's migration discipline and this repository's own policy (every completed-phase task in this repo is instructed not to touch them). Schema changes after this point are new, forward migrations only.

## Payments

Reference: [`src/config/billing-capability.ts`](../src/config/billing-capability.ts), [`src/config/billing-capability.server.ts`](../src/config/billing-capability.server.ts), [`src/server/actions/checkout.ts`](../src/server/actions/checkout.ts).

- [ ] Public paid activation remains unavailable until a real payment provider is implemented — confirm the deployed checkout page shows the honest "Payments are not available yet" panel for an ordinary authenticated account, not the mock-payment form.
- [ ] No mock confirmation button (or any other free-activation control) renders for ordinary production users. The checkout page decides this server-side (`getBillingCheckoutCapability`) before rendering, not by hiding a button with CSS.
- [ ] Calling the checkout server action directly (bypassing the UI — e.g. via browser devtools or a raw request) still fails closed: `payment_provider_unavailable`, zero billing rows created, zero entitlement change. This is enforced in `getConfiguredPaymentProvider`/`assertPaymentProviderAvailable`, not only by the UI, so there is no client-reachable bypass.
- [ ] Reconciliation through the mock provider is unavailable in the same way and for the same reason as checkout — it shares the same capability gate.
- [ ] Existing subscription-management reads and actions remain usable: plan/billing-history pages load, and downgrade/cancellation/reversal work for an already-active seeded subscription. None of these touch payment-provider capability.

## VAT

Reference: [`docs/phases/PHASE-04-billing.md`](phases/PHASE-04-billing.md#vat-behavior), [`docs/localization-glossary.md`](localization-glossary.md#8-vat-pricing-notice).

- [ ] VAT collection is disabled at initial launch — confirm `src/config/billing.server.ts`'s `DEFAULT_VAT_CONFIGURATION.enabled` is `false` in the deployed build (it is the compiled-in default; there is no environment variable to check).
- [ ] No VAT notice or VAT line appears anywhere — public pricing, checkout, or billing history — while disabled.
- [ ] Do not enable VAT until the business's legal/tax registration and the admin-configuration UI (Phase 11 — not yet built) are both ready. There is currently no way to enable VAT at all short of changing and redeploying the compiled-in default; that is intentional until Phase 11 ships trusted admin configuration.
- [ ] The business is **not** represented as currently VAT-registered anywhere in deployed copy — it is not, and none of this checklist changes that.

## Testing and verification commands

**The complete guarded PostgreSQL integration suite measures roughly 7 minutes.** Any CI step, local wrapper script, or scheduler timeout around it must allow at least 10 minutes — a run terminated at 5 minutes is not a failed run, it is an _incomplete_ one, and must never be reported as passing. `.github/workflows/ci.yml`'s `integration` job is already set to `timeout-minutes: 15`, which covers this; if you wrap these commands in your own script or scheduler, match that headroom. Do not shorten individual product test timeouts to compensate — the suite's runtime comes from spinning up real PostgreSQL transactions across many files, not from any single slow test.

### Verification commands

Run from the repository root, with a real (never production) database configured per [Test database safety](migration-runbook.md#test-database-safety):

```bash
# Fast, no database
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                    # unit/component suite

# Schema drift check — no live connection required beyond DATABASE_MIGRATION_URL
pnpm db:check

# Guarded PostgreSQL integration suite — ~7 minutes, see the timeout note above
TEST_DATABASE_URL=... TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE pnpm test:integration

# Production build + supply-chain canaries
pnpm build
pnpm scan:client

# Everything above except integration/E2E, as one aggregate (what CI's `verify` job runs)
pnpm check

# Production-build Playwright E2E — builds and serves the app itself
pnpm test:e2e:install         # once
pnpm test:e2e                 # full suite; e2e/checkout.spec.ts alone for a focused payment-guard check

# Diff hygiene
git diff --check
```

A zero-collected run (for example `pnpm test:integration` with no `TEST_DATABASE_URL` set, which fails fast with "TEST_DATABASE_URL is not set") is a **failure**, not a skip and not a pass — it means the check did not actually run.

## Security

- [ ] Production build (`pnpm build`) succeeds.
- [ ] Client-secret scan (`pnpm scan:client`) reports no server-only variable name or secret-shaped value in the client bundle.
- [ ] Tenant-isolation tests pass — a user cannot reach another workspace's billing transaction, entitlement, or subscription state by editing an ID (covered across `src/server/actions/checkout.integration.test.ts`, `src/server/services/checkout.integration.test.ts`, and the workspace-mutation-authorization suite).
- [ ] Billing authorization tests pass — every checkout/reconciliation/subscription-management path authenticates via the database-backed session, derives the workspace server-side, and rejects a removed member (same suites as above, plus `src/server/payments/configured-payment-provider.integration.test.ts` for the production-capability guard specifically).
- [ ] Idempotency/concurrency tests pass — workspace-scoped checkout idempotency, provider idempotency, and the one-non-terminal-checkout-per-workspace rule are all exercised by the integration suite.
- [ ] No raw payment-provider payloads, credentials, or card/bank data appear in audit-log metadata or application logs — `src/server/services/audit-log.ts`'s `AuditLogMetadata` is a closed, typed allowlist of safe identifiers and string-serialized amounts by construction; nothing else can be logged through it.

## Smoke tests

Run these by hand against the deployed environment after the automated checks pass:

- [ ] Public pricing renders correctly in both THB and USD, on `/th/pricing` and `/en/pricing`.
- [ ] A new account can register, complete onboarding, and land in an active 7-day trial with exactly 1 active trading account.
- [ ] An expired trial shows the read-only state and explains that data is retained (construct this with a trusted test-only expired-trial fixture rather than waiting 7 real days).
- [ ] `/app/plan` renders the current plan/trial state and upgrade options correctly.
- [ ] `/app/billing` renders billing history (empty state for a fresh account is acceptable and must say what happens next, not just "No data" — CLAUDE.md §8).
- [ ] Downgrade and cancellation (and their reversal) work for an existing seeded active subscription.
- [ ] The production payment-unavailable UI renders on `/app/checkout` for an ordinary authenticated account: no mock form, no confirm button, an honest message, and a working link back to plans/billing history.
- [ ] Mobile viewport and both Thai/English renderings show no horizontal overflow and correct localized copy on the pages above.

Do not claim in any of the above that real payments can be collected — every smoke test here is about the mock provider staying correctly inert, not about exercising a real charge.

## Security headers (Phase 12B)

Reference: [`next.config.ts`](../next.config.ts), [`e2e/security-headers.spec.ts`](../e2e/security-headers.spec.ts).

A single blanket `headers()` rule in `next.config.ts` applies to every route — public pages, `/app/*`, `/admin`, auth pages, and API routes alike, including redirect responses from `src/proxy.ts`'s middleware and Better Auth's own `/api/auth/*` route. Nothing in this application needs a relaxed policy for a subset of routes (no route is ever framed, no route uses camera/microphone/geolocation/payment browser APIs), so one rule set is deliberate, not an oversight.

- [ ] `X-Content-Type-Options: nosniff` — present on every route.
- [ ] `X-Frame-Options: DENY` — present on every route. Chosen over relying on CSP's `frame-ancestors` alone because CSP is Report-Only (below) and therefore does not itself block framing yet.
- [ ] `Referrer-Policy: strict-origin-when-cross-origin` — present on every route.
- [ ] `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` — a deliberately minimal deny-by-default allowlist; nothing in this codebase uses any of these APIs today, so nothing is exception-listed.
- [ ] `Strict-Transport-Security: max-age=31536000` — present only when `NODE_ENV=production` (i.e. `next build && next start`; never `next dev`). No `preload` (irreversible without a domain-submission decision) and no `includeSubDomains` (no subdomain inventory exists). **Not yet verified against a live Vercel deployment** — if Vercel's platform also injects this header for the production domain, reconcile rather than assume; a duplicate `Strict-Transport-Security` header should be resolved to one canonical value at first real deploy.
- [ ] `Content-Security-Policy-Report-Only` — present on every route, **not enforcing**. See disposition below.

### CSP disposition

**Report-Only, not enforcing, and deliberately deferred from enforcement.** The `next-themes` flash-prevention script (`src/components/theme/theme-provider.tsx`) is a blocking inline script with no nonce wiring, and Radix (via shadcn/ui) sets inline `style` attributes for popover/dialog/tooltip positioning — an enforcing policy without `'unsafe-inline'` on both `script-src` and `style-src`, or a nonce architecture, would break theming and floating-UI positioning today. A future real payment provider's script/frame/connect requirements are also unknown and must not be guessed at.

Current Report-Only policy: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. No report endpoint exists yet — violations surface in browser devtools only, which is sufficient for the groundwork this slice does. No hardcoded external resource domain (fonts, analytics, tracking) exists anywhere in the codebase to allowlist.

**Enforcing CSP, and the nonce-based rewrite of the theme script it requires, is explicitly deferred** — it is a larger, `src/proxy.ts`-touching change that belongs with (or shortly after) the real payment-provider integration, once that provider's own script/frame requirements are known and don't force a second policy rewrite immediately after the first.

### Test/mock production guards (re-verified, unchanged)

Re-confirmed against current source in Phase 12B, not modified: the mock payment provider (`src/config/billing-capability.server.ts`) and the auth rate-limit widening (`src/lib/auth/server.ts`'s `buildRateLimitCustomRules`) both fail closed on a missing/malformed `E2E_TEST_MODE`, and both additionally require a loopback `BETTER_AUTH_URL` — `NODE_ENV=production` with `E2E_TEST_MODE=true` alone is insufficient in either case. The payment guard has a third layer: even with the seam armed, only a fixed set of e2e-provisioned identities can reach the mock provider. No production email or payment integration was added in this slice — both remain explicitly unavailable/fail-closed by design.

### Known development-only diagnostic

The `next-themes`/React inline-script console diagnostic observed in development is unchanged and undisturbed by Phase 12B. Production behavior, theme correctness, and the theme E2E suite all continue to pass (see `e2e/theme.spec.ts`); no workaround was applied and none is currently justified. `ThemeProvider` was not modified in this slice.

## Rate limiting (documented gap, not fixed here)

Current billing-abuse protection is entirely durable-database-based, with no request-rate limiting layer:

- Workspace-row locking (`FOR UPDATE`) serializes concurrent requests against the same workspace.
- Workspace-scoped checkout idempotency (`billing_transactions`'s unique `(workspace_id, idempotency_key)` index) prevents duplicate transactions from a retried request.
- Provider-side idempotency (a deterministic key derived from the billing transaction id) prevents duplicate provider-side charges on retry.
- Exactly one non-terminal checkout is permitted per workspace at a time.
- Reconciliation is idempotent — repeated calls converge on the same stored result rather than re-processing.

None of this bounds the _rate_ at which a single actor can attempt new checkouts across different idempotency keys, or protects against high-volume abuse from one IP or account. **Durable user/IP rate limiting is a requirement for the future real payment-provider integration**, not for the current mock-only surface (which a normal production user cannot reach at all — see [Payments](#payments)). Do not add Redis or new rate-limiting infrastructure to close this gap now; it belongs with the real-provider work.
