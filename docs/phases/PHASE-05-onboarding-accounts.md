# Phase 05 — Onboarding & Trading Accounts

**Depends on:** 04 · **Blocks:** 06, 07

**Status:** The onboarding and trading-account core was delivered early, in Phase 3A–3C, and integrated with Phase 04's billing/entitlement work. This document was written before that implementation landed and described a schema, wizard shape, and file layout that were never built as originally planned. Phase 05B (documentation reconciliation) rewrote this document to match what actually shipped. What remains under the Phase 05 heading is listed in [Remaining Phase 05 work](#remaining-phase-05-work) below — review and polish, not a new build.

## Goal

A new user goes from first login to a configured trading account in one short session, and trading accounts are fully manageable under plan limits. **Met** by the Phase 3A–3C implementation described below.

---

## Delivered early in Phase 3A–3C

### Actual `trading_accounts` schema

Table `trading_accounts` (`src/server/db/schema/trading-accounts.ts`; created by `drizzle/0001_fantastic_jigsaw.sql`, `mutation_key` added by `drizzle/0002_tidy_union_jack.sql`). Full column reference: `docs/data-dictionary.md`.

| Column                       | Type           | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                         | uuid           | Primary key                                                                                                                                                                                                                                                                                                                                            |
| `workspace_id`               | uuid           | Required tenant FK, `ON DELETE CASCADE`                                                                                                                                                                                                                                                                                                                |
| `name`                       | text           | Required. No workspace-level uniqueness constraint                                                                                                                                                                                                                                                                                                     |
| `broker_name`                | text           | Nullable                                                                                                                                                                                                                                                                                                                                               |
| `platform_name`              | text           | Nullable                                                                                                                                                                                                                                                                                                                                               |
| `account_mode`               | text, CHECK    | `live` \| `demo` \| `prop` \| `backtest`                                                                                                                                                                                                                                                                                                               |
| `base_currency`              | text, CHECK    | Uppercase alphanumeric, 2–10 characters — shape-validated only, not limited to ISO-4217 fiat, so crypto tickers (BTC, ETH, USDT, USDC) are valid                                                                                                                                                                                                       |
| `starting_balance`           | numeric(20,10) | Non-negative; represented as a string in TypeScript. **Not currency minor units** — `base_currency` is not limited to fiat, so there is no guaranteed per-currency decimal scale to convert against. This follows CLAUDE.md §5's "instrument price" convention, the same as an entry/stop/target price, not the `bigint` minor-unit `Money` convention |
| `timezone`                   | text           | Required IANA zone                                                                                                                                                                                                                                                                                                                                     |
| `risk_per_trade_percent`     | numeric(12,4)  | Nullable; greater than 0, at most 100                                                                                                                                                                                                                                                                                                                  |
| `maximum_daily_loss_percent` | numeric(12,4)  | Nullable; greater than 0, at most 100                                                                                                                                                                                                                                                                                                                  |
| `is_archived`                | boolean        | Default `false`. The only removal mechanism — see [Archive, not delete](#archive-not-delete)                                                                                                                                                                                                                                                           |
| `mutation_key`               | uuid           | Required; workspace-scoped create-idempotency key                                                                                                                                                                                                                                                                                                      |
| `created_at` / `updated_at`  | timestamptz    |                                                                                                                                                                                                                                                                                                                                                        |

- Unique index on `(workspace_id, mutation_key)` — the create-idempotency guarantee.
- Indexes on `(workspace_id)` and `(workspace_id, is_archived)`.
- `user_preferences.active_trading_account_id` references this table with `ON DELETE SET NULL`, and is re-validated against workspace ownership and archived state on every read rather than trusted from the stored value.
- Workspace deletion cascades to its trading accounts (`workspace_id` is `ON DELETE CASCADE`) — the ordinary tenant-owned-record convention, unlike `billing_transactions`, which is deliberately `ON DELETE RESTRICT` as a financial record.
- No `current_balance` column exists (Phase 07+ ledger work). No `deleted_at` column exists.

### Onboarding

Two steps, one atomic server submission, not persisted step-by-step:

1. **Trading-account information** — name, broker (optional), platform (optional), account mode, base currency, starting balance.
2. **Timezone and risk preferences** — IANA timezone (detected from the browser, user confirms), risk-per-trade percent (optional), maximum-daily-loss percent (optional).

Both steps live in one client component and submit together — there is no third "Trading style" step, and no per-step server persistence to resume from. Abandoning the wizard mid-flow loses in-progress field values (they exist only in React state) but never creates a partial account: nothing is written until the single final submission succeeds.

- Page: `src/app/[locale]/(app)/app/onboarding/page.tsx`
- Wizard: `src/components/onboarding/onboarding-wizard.tsx`
- Action: `src/server/actions/onboarding.ts` — `completeOnboardingAction`
- Service: `src/server/services/trading-account.ts` — `completeOnboarding()`

`completeOnboarding()` is the one authoritative transaction: it locks the workspace row (`SELECT ... FOR UPDATE`), re-verifies active membership, and is retry-safe — a repeated or racing submission reuses the workspace's existing account and preference rather than creating a second one, and never restarts or extends the trial. Only a genuinely fresh completion creates the first account, sets `user_preferences.active_trading_account_id`, sets `workspaces.onboarding_completed_at`, and starts the trial (`startTrialInTx()`, `src/server/services/entitlement.ts`). **The trial starts only after onboarding completes successfully — never at registration.**

`workspaces.onboarding_completed_at` (not a column on the user) gates every other `/app/*` route via `src/app/[locale]/(app)/app/(main)/layout.tsx`; the onboarding page itself redirects away once onboarding is already complete. Both checks read `src/lib/trading-accounts/onboarding-guard.ts`'s `isOnboardingComplete()`.

Strategies and setups (an earlier draft's step 3, "Trading style") belong to Phase 06 — see [Deferred](#deferred).

### Trading-account management

- Page: `src/app/[locale]/(app)/app/(main)/accounts/` (list, new, edit)
- Actions: `src/server/actions/trading-accounts.ts`
- Service: `src/server/services/trading-account-management.ts`
- List/manage UI: `src/components/trading-accounts/accounts-manager.tsx`
- Header switcher: `src/components/shell/account-switcher.tsx`

Implemented and complete:

- Create an additional account — idempotent on a client-generated `mutationKey`, entitlement-gated, workspace-row-locked so concurrent creates fully serialize.
- Edit a non-archived account — rejects an archived target; audits only which field _names_ changed, never the values.
- Select the active/viewing account among **non-archived** accounts — not gated by access mode itself (a read-only or over-limit workspace can still switch which of its non-archived accounts is active).
- Archive an account — deterministic fallback reassignment (the workspace's oldest remaining non-archived account, by `created_at` then `id`) when the archived account was the caller's own active one; blocks archiving the workspace's last usable account; idempotent.
- Restore an archived account — entitlement-gated (only when a slot is available); idempotent.
- Server-side `1`/`5`/`15` paid-plan limits and the trial's `1`-account limit, enforced inside the same locked transaction as the mutation itself — never only in the UI.
- Archived accounts never count toward the active-account limit.
- Workspace isolation and active-membership re-verification on every mutation, independent of the action layer.
- Real database row locks (`FOR UPDATE`) serialize concurrent create/archive/restore/select attempts for the same workspace — verified by real-PostgreSQL concurrency tests, not merely asserted.

### Archived accounts

- Do not count toward the active-account entitlement limit.
- Cannot be selected as the active/viewing account — `setActiveTradingAccount` unconditionally rejects an archived target, and the header switcher's account list (`listSwitchableTradingAccounts`) excludes archived accounts entirely, so they never appear there.
- Remain visible in the archived-account section of `/app/accounts`, with a Restore action.
- Retain all data — archiving flips only `is_archived`; nothing else about the row changes or is deleted.
- May be restored only when the entitlement limit allows it.

Read-only users may switch between non-archived accounts for historical navigation — this already works today, since `setActiveTradingAccount` is not gated by access mode. Selecting an _archived_ account is a different, not-yet-needed case: once trade history and analytics exist (Phase 07+), those future pages are expected to query an archived account's data directly, without requiring it to become the active/viewing account first — the same pattern `getActiveTradingAccount`'s repair-on-read logic already uses for "resolve a specific account by ID, scoped to this workspace," just reused for a non-active one. No such page exists yet, so nothing here needs building for Phase 05 itself.

### Archive, not delete

Trading accounts are archived, never hard-deleted. There is no delete action, no `deleted_at` column, and none is planned — archive (reversible, retains all data) is the approved permanent design, not an interim stand-in for a future delete feature.

### Entitlement integration

- `src/server/services/entitlement.ts` — `lockAndResolveEntitlement()`, the row-locked read every account mutation goes through.
- `src/lib/entitlements/resolve.ts` — `authorizeWorkspaceMutation()`, the one operation-matrix function (`ordinary_write` / `create_trading_account` / `restore_trading_account` / `archive_trading_account`) every server-side caller consults.

Three access modes, computed once and shared by every mutation:

- **`writable`** — full create/edit/archive/restore/select.
- **`over_limit`** — may select (among non-archived accounts) and archive; cannot create, restore, update, or perform ordinary business writes.
- **`read_only`** — may select (among non-archived accounts) for historical navigation; may read analytics and retained data; cannot create, restore, update, or archive.

Only active (non-archived) trading accounts count toward the allowance. Starter allows 1 active account, Trader 5, Professional 15; the 7-day full-feature trial allows 1. No plan imposes a strategy, setup, trade, trade-history, or analytics limit.

---

## Remaining Phase 05 work

- **Documentation reconciliation** — this document and `docs/data-dictionary.md` (Phase 05B, in progress/complete as of this revision).
- **Archived-account management UX polish** — e.g. the archived-account card currently shows less detail (mode, currency only) than the active-account card (which also shows broker, platform, starting balance, risk fields); bring them to parity.
- **Clearer archive-versus-delete messaging** — confirm the product copy (archive dialog, empty states) unambiguously communicates that archiving is reversible and that there is no separate delete, so a user never expects data loss that cannot happen or looks for a delete option that does not exist.
- **Responsive/accessibility regression review** — a focused pass confirming the existing onboarding/account-management coverage (already substantial — see the e2e suites) has no gaps introduced since Phase 3B, rather than a from-scratch audit.
- **Final closeout** — once the above land, a Phase 05 closeout task mirroring Phase 04's 04H-C: full regression run and an explicit close/no-close recommendation.

## Deferred

| Item                                                                                                                                                                             | Target                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Strategy / trading-style setup (an earlier draft's onboarding step 3)                                                                                                            | Phase 06                                                                                                   |
| Currency lock after first trade — `base_currency` is currently editable on any non-archived account; this cannot be implemented until a `trades` table exists to check against   | Phase 07, or whichever phase introduces trade persistence                                                  |
| Break-even tolerance (`break_even_tolerance_r`) — not a `trading_accounts` column; belongs to the calculation engine / trade-classification design (CLAUDE.md §6, assumption A1) | Calculation engine phase (07)                                                                              |
| Deposits/withdrawals and balance reconciliation                                                                                                                                  | Future scope, not yet phased                                                                               |
| Multi-currency conversion                                                                                                                                                        | Out of scope for the MVP (CLAUDE.md §9)                                                                    |
| Hard deletion                                                                                                                                                                    | **Not planned.** Archive is the approved permanent design — see [Archive, not delete](#archive-not-delete) |

## Out of scope

Strategies, trades, balance reconciliation, deposits/withdrawals, multi-currency conversion.

## Definition of Done

- [x] Onboarding completes on desktop and mobile in two steps, one atomic submission
- [x] Timezone confirmed by the user, stored as IANA, used for display
- [x] Account creation and restoration blocked at the active-account limit server-side, including direct action calls and concurrent requests
- [x] Archived accounts do not count toward the active-account limit and can be restored only when an active slot is available
- [x] Archive preserves all data; there is no delete to block
- [x] Starting balance and risk/loss percentages are stored as `NUMERIC` strings; no float anywhere in the path
- [x] Loading, empty, error, and success states are present, responsive, and accessible for onboarding and account management
- [x] Typecheck, lint, tests, and build pass
- [ ] Archived-account management UX polish (parity with the active-account card) — see [Remaining Phase 05 work](#remaining-phase-05-work)
- [ ] Archive-versus-delete messaging reviewed for clarity
- [ ] Responsive/accessibility regression review completed
- [ ] Final Phase 05 closeout run and recommendation

Formally dropped from this list, not carried forward as outstanding: a resumable step-by-step wizard, a third "Trading style" onboarding step, currency-lock-after-first-trade, and conditional hard deletion — each is either re-scoped under [Deferred](#deferred) or not planned at all, and none blocks closing Phase 05.

## Risks

- **Timezone detection is a suggestion, not a fact.** A wrong timezone silently misattributes every trade to the wrong day. The wizard requires the user to confirm the detected value, never assumes it silently.
- **Starting balance parsing.** Decimal input must parse to a valid `NUMERIC` string or be rejected — never coerced into a wrong number. (Not a minor-units conversion — see the schema note above.)
