# Phase 04 — Billing & Checkout

**Status:** ✅ **Complete**, including the 04H-A production payment-provider guard · **Depends on:** completed Phase 03 · **Blocks:** remaining customer billing work in 05, 10, and 11 · **Next implementation phase:** [05 — Onboarding & Trading Accounts](PHASE-05-onboarding-accounts.md)

Every item in this document's locked contract and Definition of Done is implemented and tested. See [`docs/roadmap.md`](../roadmap.md#what-phase-04-delivered) for the implementation summary with concrete file paths, and [`docs/deployment-checklist.md`](../deployment-checklist.md) for what to verify before a real deployment. The only remaining gap between this phase and a launchable paid product is a real payment provider — see "Payment-provider boundary" below.

## Goal

Add customer billing and checkout behavior on top of the trial and active-account entitlement foundation delivered in Phase 3C. Phase 04 must preserve one product feature set across all plans, produce immutable billing snapshots, and be ready for future exclusive VAT without collecting or advertising VAT at launch.

## Locked product contract

### Monthly plans

| Plan         | Maximum active trading accounts | THB / month | USD / month | Features and analytics |
| ------------ | ------------------------------: | ----------: | ----------: | ---------------------- |
| Starter      |                               1 |     THB 149 |       USD 5 | All included           |
| Trader       |                               5 |     THB 299 |       USD 9 | All included           |
| Professional |                              15 |     THB 499 |      USD 15 | All included           |

These are the final monthly plans. Do not add annual pricing without a separate approved decision.

Every paid plan includes exactly the same product features and analytics. Plans differ only by the maximum number of active trading accounts. All paid plans include unlimited strategies, setups, trades, and trade history.

Paid-plan definitions and prices remain deployment-controlled static configuration, not admin-editable rows. The future VAT enablement/rate is separate admin configuration owned by Phase 11.

Plan prices are represented and calculated as integer minor units plus a currency code. Do not use floating-point arithmetic for prices, tax, or totals.

### Trial

- 7 days, no card required, starting when workspace onboarding completes
- Exactly 1 active trading account
- Every product feature and all analytics unlocked
- Expiry never deletes user data; existing data remains retained and visible under the product's expired/read-only rules
- The trial allowance is an explicit entitlement, not derived from Starter or the largest paid plan

### Active-account entitlement

- Only active trading accounts consume the plan or trial allowance; archived accounts do not count
- Both account creation and restoration must enforce the effective limit server-side inside the mutation transaction
- UI gating and usage indicators are explanatory conveniences, never the authorization boundary
- Concurrent requests must not permit limit + 1
- Downgrades below current active usage never delete or archive records automatically; creation and restoration remain blocked until active usage is within the allowance
- Strategies, setups, trades, trade history, features, and analytics must never be gated by paid-plan tier

The entitlement resolver and create/restore enforcement already exist from Phase 3C. Phase 04 extends billing around that foundation; it must not replace server enforcement with client-only checks.

## Subscription state

The billing model extends the existing workspace entitlement state with provider/customer references and billing-period state as required by the provider boundary. Exact schema changes are decided during implementation and must reuse the existing authoritative workspace entitlement record rather than create conflicting entitlement sources.

State transitions remain explicitly enumerated and tested:

```text
trialing  --upgrade-->  active
trialing  --expire--->  expired
active    --cancel--->  active (cancel at period end) --period end--> canceled
active    --fail----->  past_due --recover--> active | --expire--> expired
expired/canceled --resubscribe--> active
```

Trial expiry is evaluated from `trial_ends_at` on read; correctness must not depend on a cron job.

## Billing and tax snapshots

Each checkout/payment record must preserve an immutable snapshot sufficient to explain the charge later, including:

- plan key and billing currency
- displayed plan price / subtotal in integer minor units
- whether VAT collection was enabled for that payment
- applied VAT rate and VAT amount, both zero/absent when disabled as appropriate to the storage design
- final total in integer minor units
- provider/customer/payment references and timestamps required for reconciliation

Historical snapshots never change when plan prices, plan limits, VAT enablement, or the VAT rate changes. Billing history reads snapshots; it does not recalculate old payments from current configuration.

## VAT behavior

### Launch state

The business is not initially VAT registered, so the product launches with VAT collection disabled.

While disabled:

- displayed plan prices are the checkout subtotal
- VAT is not added at checkout or at the payment gateway
- public pages show no VAT pricing notice
- checkout and billing history show no VAT line

### Future enabled state

VAT configuration itself belongs to Phase 11 admin tooling. It must be admin-only, enable/disable capable, and support a configurable rate initially prepared as 7%. Phase 04 owns how customer pricing and checkout consume the trusted server-side configuration.

When enabled:

- plan prices remain tax-exclusive; VAT is added at checkout/payment gateway and is never included in the displayed plan prices
- Thai public pages show exactly: `ราคาไม่รวมภาษีมูลค่าเพิ่ม 7%`
- English public pages show exactly: `Prices exclude 7% VAT.`
- checkout shows subtotal, VAT, and final total before payment confirmation
- all calculations use integer minor units and one documented deterministic rounding rule
- the server obtains the enabled state and rate from trusted configuration and calculates tax; client input can never determine the VAT rate or VAT amount
- the payment gateway receives the server-calculated final total and consistent snapshot metadata

The notice text must reflect the configured rate if it changes in the future; the exact 7% strings above are the initially prepared state.

## Payment-provider boundary

Keep payment processing behind `src/server/payments/` with a narrow `PaymentProvider` interface. Phase 04's approved scope remains a mock payment flow unless a separate decision approves a real provider.

- Checkout shows the plan, currency, subtotal, conditional VAT, and final total
- The mock path carries an explicit non-production notice and simulates success, decline, and processing delay
- No real charges occur, no card data is stored, and no PCI scope is introduced
- Provider requests are created from trusted server-side plan and VAT configuration, never from client-supplied prices, rates, tax, or totals

### Production capability guard (04H-A)

The mock provider must never be reachable by ordinary public production traffic. `src/config/billing-capability.ts` (pure) and `src/config/billing-capability.server.ts` (the server-only source of truth) resolve one of three capabilities before `checkoutAction`/`reconcileCheckoutAction` ever construct a provider:

- `development_mock` — `NODE_ENV` is exactly `development` or exactly `test`; always available.
- `automated_test_mock` — `NODE_ENV` is exactly `production`, **and** `E2E_TEST_MODE=true`, **and** `BETTER_AUTH_URL` is an exact loopback origin, **and** the authenticated caller's database-stored email matches one of the fixed e2e checkout identities `e2e/support/provision-user.ts` provisions for the real Playwright projects that run checkout specs. All four conditions are independent, server-only, and never derived from browser input.
- `unavailable` — everything else, including normal production and any runtime whose `NODE_ENV` is missing, empty, or an unrecognized value (`staging`, `preview`, a typo) — that classification fails closed rather than defaulting to development trust or crashing.

When capability is `unavailable`: `checkoutAction`/`reconcileCheckoutAction` return a typed `payment_provider_unavailable` result before any database write, the checkout page renders an honest unavailable panel instead of the mock-payment form, and public pricing, plan reads, billing history, downgrade, and cancellation remain available. See [`docs/deployment-checklist.md`](../deployment-checklist.md) for the production verification steps.

## UI

- Public and in-app pricing show the same three monthly plans, prices, feature parity, and active-account allowances
- Upgrade, downgrade, cancel, and resubscribe flows show the resulting active-account allowance without inventing feature changes
- Checkout shows a complete server-calculated order summary
- Trial countdown and expiry messaging state the 7-day, one-account, full-feature entitlement and data retention accurately
- Read-only/expired messaging explains what is blocked and confirms that user data is retained

## Phase ownership

- **Phase 04:** customer billing state, checkout, conditional VAT presentation/calculation, payment-provider boundary, billing snapshots, and reconciliation behavior
- **Phase 11:** admin-only VAT enable/disable and configurable-rate management, with audit logging
- **Phase 12:** entitlement, VAT, rounding, tamper-resistance, and immutable-snapshot verification

## Out of scope

Real payment processing, invoices, proration, coupons, annual pricing/billing, dunning emails, and the admin VAT configuration UI.

## Definition of Done

- [x] Starter/Trader/Professional are the only paid plans, with 1/5/15 active accounts and THB 149/299/499 or USD 5/9/15 monthly pricing
- [x] Paid-plan feature and analytics lists are identical; strategies, setups, trades, and trade history are unlimited
- [x] Trial is exactly 7 days, 1 active account, and full-featured; expiry deletes no data
- [x] Archived accounts do not count; create and restore enforcement remains server-side and race-safe
- [x] Subscription state transitions are fully tested and invalid transitions rejected
- [x] Checkout trusts only server-side plan prices, VAT configuration, and calculated totals
- [x] VAT-disabled public pages and checkout contain no VAT notice or VAT line
- [x] VAT-enabled public pages use the required Thai and English notices, and checkout shows subtotal, VAT, and final total
- [x] Exclusive VAT uses integer minor units and a documented deterministic rounding rule
- [x] Historical price, currency, VAT, and total snapshots remain immutable across configuration changes
- [x] Mock checkout covers success, decline, and delay paths without a real charge or stored card data
- [x] Responsive, accessible dark and light states are complete
- [x] Typecheck, lint, tests, and build pass during implementation
- [x] **(04H-A)** Mock checkout is unreachable by ordinary public production traffic; production always returns `payment_provider_unavailable` outside the guarded automated-test seam, with zero billing rows created and no entitlement change

## Risks

- **Client tampering.** A hidden input or request payload must never be trusted for price, VAT rate, tax amount, or final total.
- **Rounding drift.** Checkout, stored snapshots, and provider requests must call the same integer minor-unit calculation and deterministic rounding rule.
- **Historical mutation.** Recomputing old payments from today's plan or VAT configuration makes billing records unauditable.
- **Entitlement drift.** Pricing UI and billing state must consume the same locked plan registry as server-side account enforcement without introducing feature-tier gates.
