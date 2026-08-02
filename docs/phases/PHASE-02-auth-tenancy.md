# Phase 02 — Neon PostgreSQL, Better Auth, User Preferences and Tenant-Isolated Workspace Foundation

**Depends on:** 00b, 01, 01.1 · **Blocks:** everything with a database record

> Supersedes and absorbs both [`PHASE-02-auth.md`](PHASE-02-auth.md) (originally "Authentication & Session," Auth.js-based) and [`PHASE-03-tenancy.md`](PHASE-03-tenancy.md) (originally "Data Model & Tenancy Core"). The commissioning brief for this phase combined authentication and tenancy into one deliverable and specified Better Auth instead of Auth.js — see [ADR 0009](../decisions/0009-self-hosted-better-auth.md) for why. Both superseded documents remain for their historical record of the original two-phase plan; this document is the actual scope and the actual result.

## Goal

Convert the Phase 01/01.1 visual prototype into an authenticated, tenant-isolated foundation: real users, real database-backed sessions, and exactly one personal workspace per user — verified server-side on every request, never inferred from a client-supplied value.

## What was explicitly out of scope (still true after this phase)

Trading accounts, strategies, trades, analytics calculations, subscriptions, real payments, admin back office, broker/CSV/OCR imports, AI integration, multiple user-created workspaces, workspace invitations, team management or role-management UI, Redis, passkeys, two-factor auth, native mobile apps.

## Architecture decisions

Full reasoning lives in the ADRs; this is the index.

| Decision                                                                                                          | ADR                                                               |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Self-hosted Better Auth, not Auth.js/Clerk/Supabase/Firebase/Neon Managed Auth                                    | [0009](../decisions/0009-self-hosted-better-auth.md)              |
| Database-backed sessions, short read-through cookie cache, proxy is optimistic-only                               | [0010](../decisions/0010-database-backed-sessions.md)             |
| Tenant/workspace authorization model — one personal workspace per user, membership/role functions ready for teams | [0011](../decisions/0011-tenant-workspace-authorization-model.md) |
| Migration strategy — Drizzle code-first, `DATABASE_URL`/`DATABASE_MIGRATION_URL` split                            | [0012](../decisions/0012-migration-strategy.md)                   |
| Email delivery — an owned adapter boundary, fails closed with no provider configured                              | [0013](../decisions/0013-email-delivery-boundary.md)              |
| Identifier strategy — UUIDv7 everywhere, `text` under Better Auth / `uuid` under the app                          | [0008](../decisions/0008-identifier-strategy.md)                  |

## What shipped

### Schema (`drizzle/0000_init_auth_tenancy.sql`)

Better Auth's core tables (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`) plus this repo's application tables (`workspaces`, `workspace_members`, `user_preferences`, `audit_logs`). Full column-level detail: [`docs/data-dictionary.md`](../data-dictionary.md#phase-02--auth-and-tenancy-implemented).

### Authentication

- Email/password (Better Auth's own hashing, 12-character minimum, `requireEmailVerification: true`, `revokeSessionsOnPasswordReset: true`) and Google OAuth (registered only when both `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are present — the button never renders active when it can't work).
- Database-backed rate limiting on sign-in, sign-up, forgot-password, reset-password, resend-verification, and Google sign-in initiation.
- Anti-enumeration: login always shows the same generic error; registering an already-used email reaches the same "check your email" screen a genuine signup does.
- Full UI: login, register, verify-email (pending + completion), forgot-password, reset-password, auth-error — all localized (Thai/English), all reachable with the keyboard alone, 44×44px touch targets, no raw backend error codes ever shown.

### Workspace provisioning

`ensurePersonalWorkspace(userId)` — idempotent, transactional, safe under concurrency by construction (the database's partial unique index and composite unique constraint are the actual guarantee, not a check-then-insert). Wired to Better Auth's `databaseHooks.user.create.after`, and re-invoked defensively from `getActiveWorkspaceContext()` in case that hook ever fails independently.

### Authorization boundary

`src/server/auth/dal.ts` — `getOptionalSession`, `requireSession`, `getCurrentUser`, `getActiveWorkspaceContext`, `requireWorkspaceMembership`, `requireWorkspaceRole`. `src/proxy.ts` (renamed from `middleware.ts`) performs only an optimistic, cookie-presence redirect; every real decision happens in the DAL, re-verified against the database.

### Preferences synchronization

`src/server/actions/preferences.ts` (`syncPreferences`) keeps the pre-login cookie-based locale/theme choice and the authenticated database row in agreement: initializes the database row from the pre-login cookie at first provisioning, updates both the database and the cookie/persistence mechanism on any later change, never overwrites an authenticated preference from a browser's reported language.

### Tests

- Unit (Vitest, `pnpm test`): env schema, identifier format, callback-URL safety, audit-action allowlist, and existing suites — 300 tests, all passing.
- Integration (Vitest + real Postgres, `pnpm test:integration`, gated on `TEST_DATABASE_URL`): `src/server/services/workspace-provisioning.integration.test.ts` (5 tests — idempotency, concurrency, audit events) and `src/server/auth/dal.integration.test.ts` (8 tests — the authorization matrix: cross-user workspace access, membership/role checks, session resolution).
- E2E (Playwright, `pnpm test:e2e`): `e2e/pricing-and-auth.spec.ts` reworked for real auth (real registration, real invalid-credentials error, anti-enumeration, Google-disabled state, accessibility); new `e2e/auth-authorization.spec.ts` (route protection with callback-path preservation, fabricated-cookie rejection, logout server-side invalidation, authenticated-visitor redirect away from login/register, cross-user session isolation). Both gated on `DATABASE_URL` being set — every page under test now opens a real database connection.
- CI (`.github/workflows/ci.yml`): `integration` and `e2e` jobs each spin up a fresh `postgres:17-alpine` service container and apply the committed migrations before running — proving they produce a complete, working schema from nothing, on every push. A second build canary proves the app still builds cleanly even when `DATABASE_URL` is set but unreachable, not just when it's absent.

## Assumptions recorded during this phase

| #    | Assumption                                                                                                         | Rationale                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 | New users default to `UTC` timezone in `user_preferences`, corrected later                                         | No timezone-detection UI exists yet; matches CLAUDE.md's timezone model without inventing detection logic ahead of need.                                                                                                                                                     |
| P2-2 | `workspace_members.role` supports `owner`/`member` only this phase, stored as `text` not a Postgres `enum`         | Matches the brief's explicit minimum; a `text` column with an allowed-values check is cheaper to widen than `ALTER TYPE`. See [ADR 0011](../decisions/0011-tenant-workspace-authorization-model.md).                                                                         |
| P2-3 | Workspace ID authorization (`requireWorkspaceMembership`) is tested at the DAL/integration level only, not via e2e | Phase 02 ships no route that accepts a workspace ID from the client — no such UI surface exists until Phase 05+. The browser-level counterpart lands with the first route that does.                                                                                         |
| P2-4 | Google OAuth on Vercel Preview deployments — stable-alias vs. accept-as-unsupported — not yet decided              | Vercel's per-deployment Preview URLs don't match a single registered OAuth redirect URI. See [`docs/google-oauth-setup.md`](../google-oauth-setup.md#4-exact-callback-urls).                                                                                                 |
| P2-5 | Email delivery has no real provider configured; `ProductionEmailAdapter` fails closed                              | No transactional email provider was in scope for this phase. See [ADR 0013](../decisions/0013-email-delivery-boundary.md) and [`docs/email-delivery-setup.md`](../email-delivery-setup.md). Real user registration must not be enabled in production until this is resolved. |

## Known limitations / deferred to Phase 3+

- No team workspaces, no invitations, no role-management UI (schema is ready; the brief explicitly deferred the UI).
- No real email provider — verification/reset links are never actually delivered outside local development's console log.
- No Google OAuth credentials configured in this environment — the button is truthfully disabled everywhere this was implemented; real-provider verification is outstanding.
- No Neon project configured in this environment — schema and migrations are complete and structurally verified (CI's fresh-Postgres-service jobs), but Neon-specific deployment has not been directly observed.
- Workspace-ID-in-URL/payload authorization has a DAL-level integration test but no e2e counterpart yet (no route accepts one).
