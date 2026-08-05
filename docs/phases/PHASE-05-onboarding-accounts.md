# Phase 05 — Onboarding & Trading Accounts

**Depends on:** 04 · **Blocks:** 06, 07

> **Implementation note:** The core onboarding and trading-account scope was delivered early in Phase 3A–3C. Phase 04 must preserve and integrate with that server-side entitlement boundary; this document remains the product contract for later account work.

## Goal

A new user goes from first login to a configured trading account in under two minutes, and trading accounts are fully manageable under plan limits.

## Scope

### Trading accounts schema

```
trading_accounts  id workspace_id name broker
                  account_type ∈ { live, demo, backtest, prop_challenge }
                  currency(ISO-4217) starting_balance(BIGINT minor units)
                  risk_model ∈ { fixed_fractional, fixed_amount }
                  risk_value(NUMERIC 12,4)          -- % or minor units per risk_model
                  break_even_tolerance_r(NUMERIC 6,4, default 0.05)
                  timezone(IANA, nullable → inherits user)
                  is_archived created_at updated_at deleted_at
```

`break_even_tolerance_r` lives here deliberately — it is the per-account configurable tolerance required by `CLAUDE.md` §6, consumed by the Phase 06 engine.

Currency is **immutable after the first trade**. Changing it would silently reinterpret every stored minor-unit amount.

### Onboarding wizard (`/onboarding`)

1. **Profile** — display name, **timezone** (detect from browser, user confirms; never assume)
2. **First trading account** — name, type, currency, starting balance, risk model
3. **Trading style** — instruments traded, typical timeframe _(personalization only; no logic depends on it)_
4. **Done** — route to dashboard with a clear next action

- Resumable: progress persisted per step, safe to abandon and return
- Skippable where sensible, but a trading account is required before journaling
- `onboarding_completed_at` on user
- Mobile: one step per screen, large touch targets, numeric keyboards for amounts

### Account management (`/app/accounts`)

- List with balance, trade count, archived state
- Create and restore — gated by the active-account entitlement **server-side inside the mutation transaction**; direct action calls must not bypass the limit
- Edit; currency locked once trades exist, with a clear explanation of why
- Archive (reversible, excluded from default views, retains analytics) and delete (only when zero trades; otherwise archive)
- Empty state that teaches, not just "No accounts"

Only active trading accounts count toward the allowance. Archived accounts do not count. Starter allows 1 active account, Trader 5, and Professional 15; the 7-day full-feature trial allows 1. Plans do not impose strategy, setup, trade, trade-history, analytics, or other feature limits.

## Out of scope

Strategies, trades, balance reconciliation, deposits/withdrawals, multi-currency conversion.

## Deliverables

```
src/server/db/schema/trading-accounts.ts
src/server/services/trading-account.ts
src/server/actions/{trading-account,onboarding}.ts
src/app/(app)/onboarding/**   src/app/(app)/accounts/**
drizzle/0004_trading_accounts.sql
tests/accounts/{entitlement-gate,currency-lock}.test.ts
```

## Definition of Done

- [ ] Wizard completes on desktop and mobile; resumable mid-flow
- [ ] Timezone confirmed by the user, stored as IANA, used for display
- [ ] Account creation and restoration blocked at the active-account limit **server-side**, including direct action calls and concurrent requests
- [ ] Archived accounts do not count toward the active-account limit and can be restored only when an active slot is available
- [ ] Currency immutable after first trade, enforced in the service layer
- [ ] Archive preserves analytics; delete blocked when trades exist
- [ ] All amounts stored as minor units; no float anywhere in the path
- [ ] Four states present, responsive, accessible
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Timezone detection is a suggestion, not a fact.** A wrong timezone silently misattributes every trade to the wrong day. Always require confirmation.
- **Starting balance parsing.** Localized decimal input ("1.234,56") must parse to minor units correctly or be rejected — never coerced into a wrong number.
