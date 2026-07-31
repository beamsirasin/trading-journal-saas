# Phase 04 — Plans, Trial & Entitlements

**Depends on:** 03 · **Blocks:** 05, 10, 11

## Goal

Three subscription plans, a 7-day trial, a mock payment flow, and **server-side entitlement enforcement** — shipped before the resources they gate exist.

## Scope

### Plan definitions (`src/config/plans.ts`)

Static config, not database rows. Plans change by deploy, not by admin edit.

| Plan         | Trading accounts | Strategies | Trade history | Price (assumption) |
| ------------ | ---------------- | ---------- | ------------- | ------------------ |
| Starter      | 1                | 3          | unlimited     | 9 USD / mo         |
| Trader       | 3                | unlimited  | unlimited     | 19 USD / mo        |
| Professional | 10               | unlimited  | unlimited     | 39 USD / mo        |

Prices as **minor units + currency code** (`900`, `USD`). Limits are the primary differentiator, per the product brief; exact numbers are assumption **A3** — confirm before Phase 11 publishes them.

### Subscription state

```
subscriptions   id workspace_id(unique) plan status
                trial_ends_at current_period_start current_period_end
                cancel_at_period_end created_at updated_at

status ∈ { trialing, active, past_due, canceled, expired }
```

State machine, explicitly enumerated and tested:

```
trialing  --upgrade-->  active
trialing  --expire--->  expired
active    --cancel--->  active (cancel_at_period_end) --period end--> canceled
active    --fail----->  past_due --recover--> active | --expire--> expired
expired/canceled --resubscribe--> active
```

Trial: **7 days, no card required, starts at signup** (assumption A4). Trial grants Trader-tier limits so the product is evaluable.

### Entitlements

```ts
resolveEntitlements(subscription): Entitlements   // pure, unit-tested
requireEntitlement(resource)                       // server-action guard
canCreate(ctx, 'tradingAccount')                   // { allowed, reason, limit, used }
```

Rules:

- Enforcement is **server-side**, in the guard. UI gating is a courtesy, never the control.
- Expired/canceled → **read-only**: existing data stays fully visible and exportable; creation and mutation are blocked. Never hide or delete a user's data for non-payment.
- Downgrade below current usage does not delete records. Existing items remain read-only; creation blocked until under limit. Surface this plainly.
- Limit checks count live rows inside the same transaction as the insert — a count-then-insert race must not permit limit+1.

### Mock payment

Behind `src/lib/payments/` with a `PaymentProvider` interface. `MockPaymentProvider` is the only implementation.

- Checkout page: plan summary, fake card form, deliberate "this is a mock" notice
- Simulated outcomes: success, decline, processing delay — so failure UI is real
- Writes subscription state directly; **no real charges, no card data stored, no PCI surface**
- Interface shaped to fit a real provider later (checkout session, webhook handler, customer ref) without touching feature code

### UI

- `/pricing` (in-app), plan cards with current-plan state
- Upgrade / downgrade / cancel / resubscribe flows with confirmation
- Trial countdown banner, escalating in the final 48 hours; dismissible, reappears at expiry
- Read-only mode banner explaining exactly what is blocked and how to restore access

## Out of scope

Real payment processing, invoices, tax, proration, coupons, annual billing, dunning emails.

## Deliverables

```
src/config/plans.ts
src/server/db/schema/subscriptions.ts
src/server/services/{subscription,entitlements}.ts
src/lib/payments/{provider,mock-provider}.ts
src/server/actions/billing.ts
src/app/(app)/billing/**
drizzle/0003_subscriptions.sql
tests/billing/{state-machine,entitlements,limit-race}.test.ts
```

## Definition of Done

- [ ] All state transitions covered by tests, invalid transitions rejected
- [ ] Entitlement resolution unit-tested per plan × status matrix
- [ ] Guard blocks over-limit creation **server-side**, verified by calling the action directly
- [ ] Concurrent creation cannot exceed the limit
- [ ] Trial expiry flips to read-only without data loss
- [ ] Downgrade below usage does not delete anything
- [ ] Mock checkout covers success, decline, and delay paths
- [ ] Responsive, dark + light, four states present
- [ ] Typecheck, lint, tests, build pass

## Assumptions

- **A3** plan limits and prices above · **A4** 7-day trial, no card, Trader-tier limits

## Risks

- **Trial expiry needs no cron.** Evaluate `trial_ends_at` on read so status is always correct without a scheduler. A background job may come later; correctness must not depend on it.
- **Mock/real divergence.** Keep the interface narrow and provider-shaped, or the eventual real integration becomes a rewrite.
- **Read-only must be genuinely read-only.** Audit every mutation guard, not just the obvious ones.
