# Phase Roadmap

The MVP is dependency-ordered and independently reviewable. A phase may land in named reviewable slices, as Phase 3A–3C did.

Read [`../../CLAUDE.md`](../../CLAUDE.md) first, then the active phase document. Do not implement work belonging to a later phase.

| #                                         | Phase                               | Ships                                                        | Depends on |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------ | ---------- |
| [00](PHASE-00-foundation.md)              | Foundation & Conventions            | Repo, toolchain, design tokens, CI                           | —          |
| [00b](PHASE-00b-core-primitives.md)       | Core Technical Primitives           | Money, time, theme, shell, DB boundary                       | 00         |
| [01](PHASE-01-design-system.md)           | Design System, Marketing & Shell    | Tokens, landing site, demo dashboard                         | 00b        |
| [01.1](PHASE-01-1-simplification-i18n.md) | UI Simplification & Localization    | Simplified bilingual product surfaces                        | 01         |
| [02](PHASE-02-auth-tenancy.md)            | Auth, Database & Tenancy            | Better Auth, workspaces, isolation                           | 01.1       |
| 03A–03C                                   | Onboarding, Accounts & Entitlements | Wizard, account CRUD/switcher, trial, active-account limits  | 02         |
| [04](PHASE-04-billing.md)                 | Billing & Checkout                  | Monthly plans, snapshots, conditional VAT, mock payment      | 03         |
| [05](PHASE-05-onboarding-accounts.md)     | Onboarding & Trading Accounts       | Review and extend the core scope delivered early in Phase 03 | 04         |
| [06](PHASE-06-strategies.md)              | Strategies & Versions               | Strategy CRUD, immutable versioning                          | 05         |
| [07](PHASE-07-calc-engine.md)             | Trade Model & Calculation Engine    | Schema + pure R-multiple engine, tests                       | 06         |
| [08](PHASE-08-journal.md)                 | Trade Journal                       | Manual entry, system vs actual, mistakes                     | 07         |
| [09](PHASE-09-analytics.md)               | Dashboard & Analytics               | Real data behind the Phase 01 surfaces                       | 08         |
| [10](PHASE-10-settings.md)                | Settings                            | Profile, workspace, subscription                             | 04, 08     |
| [11](PHASE-11-admin.md)                   | SaaS Administration                 | Admin role, user/subscription oversight                      | 04         |
| [12](PHASE-12-hardening.md)               | Hardening & Launch                  | A11y, responsive, security, deploy                           | all        |

## Sequencing rationale

**Design system early (01).** A token set nothing consumes cannot be reviewed. Building the marketing site and the application shell against it exercises every token and breakpoint while changing one is still cheap.

**Auth and tenancy together (02).** The original separate Phase 03 tenancy plan was absorbed into Phase 02. The later Phase 3A–3C implementation delivered onboarding, trading accounts, and their entitlement foundation. See [PHASE-02-auth-tenancy.md](PHASE-02-auth-tenancy.md) and the [roadmap](../roadmap.md#what-phase-03-delivered).

**Calculation engine before journal UI (07 → 08).** The engine is pure and deterministic, so it can be fully specified and tested with zero UI. Building the journal first would bake formula assumptions into forms and force rework.

**Server entitlements before billing (03C → 04).** Account creation and restoration already enforce the active-account allowance server-side. Phase 04 builds billing and checkout on that boundary; the UI is never the control.

**Analytics replaces authenticated fixtures with measured read models (09).** The public `/demo` fixtures remain labelled and isolated; authenticated Dashboard/Analytics use persisted snapshots and Phase 07D.

## Superseded

**Phase 11 — Landing & Marketing** was folded into Phase 01 and its document removed; see the roadmap's "Superseded" section for why it moved forward.

**The original Phase 03 — Data Model & Tenancy Core** was folded into Phase 02. [`PHASE-03-tenancy.md`](PHASE-03-tenancy.md) is a superseded historical plan, distinct from the completed Phase 3A–3C implementation.

## Status

Phases 00–11, including [Phase 10 — Settings](PHASE-10-settings.md) and [Phase 11 — SaaS Administration](PHASE-11-admin.md), are complete. Phase 11 delivered: 11B (platform-admin persistence/authorization foundation), 11C (the EN-only `/admin` route shell and read-only operator Overview dashboard), 11D (read-only, searchable/paginated `/admin/users` and `/admin/workspaces` list + detail pages), 11E (exactly three named Subscription Support mutations — Extend Trial, Grant/Revoke Complimentary Plan — with atomic Admin Audit writes, plus a read-only `/admin/audit` UI), 11F (DB-authoritative platform VAT configuration wired into every canonical quotation/checkout/billing-presentation path, plus `/admin/vat`), and 11G (full regression closeout). No arbitrary paid-plan override, past-due recovery, or paid cancellation exists — deliberately out of scope, not deferred. [Phase 12 — Hardening & Launch Readiness](PHASE-12-hardening.md) is next.
