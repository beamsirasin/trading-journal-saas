# Phase Roadmap

The MVP is decomposed into 14 phases. Each is dependency-ordered, independently reviewable, and ends in **one coherent commit**.

Read [`../../CLAUDE.md`](../../CLAUDE.md) first, then the active phase document. Do not implement work belonging to a later phase.

| #                                     | Phase                            | Ships                                    | Depends on |
| ------------------------------------- | -------------------------------- | ---------------------------------------- | ---------- |
| [00](PHASE-00-foundation.md)          | Foundation & Conventions         | Repo, toolchain, design tokens, CI       | —          |
| [00b](PHASE-00b-core-primitives.md)   | Core Technical Primitives        | Money, time, theme, shell, DB boundary   | 00         |
| [01](PHASE-01-design-system.md)       | Design System, Marketing & Shell | Tokens, landing site, demo dashboard     | 00b        |
| [02](PHASE-02-auth.md)                | Authentication & Session         | Google + email auth, sessions            | 00b        |
| [03](PHASE-03-tenancy.md)             | Data Model & Tenancy Core        | Workspaces, membership, scoped queries   | 02         |
| [04](PHASE-04-billing.md)             | Plans, Trial & Entitlements      | 3 plans, 7-day trial, mock payment       | 03         |
| [05](PHASE-05-onboarding-accounts.md) | Onboarding & Trading Accounts    | Wizard, account CRUD, limit enforcement  | 04         |
| [06](PHASE-06-strategies.md)          | Strategies & Versions            | Strategy CRUD, immutable versioning      | 05         |
| [07](PHASE-07-calc-engine.md)         | Trade Model & Calculation Engine | Schema + pure R-multiple engine, tests   | 06         |
| [08](PHASE-08-journal.md)             | Trade Journal                    | Manual entry, system vs actual, mistakes | 07         |
| [09](PHASE-09-analytics.md)           | Dashboard & Analytics            | Real data behind the Phase 01 surfaces   | 08         |
| [10](PHASE-10-settings.md)            | Settings                         | Profile, workspace, subscription         | 04, 08     |
| [11](PHASE-11-admin.md)               | SaaS Administration              | Admin role, user/subscription oversight  | 04         |
| [12](PHASE-12-hardening.md)           | Hardening & Launch               | A11y, responsive, security, deploy       | all        |

## Sequencing rationale

**Design system early (01).** A token set nothing consumes cannot be reviewed. Building the marketing site and the application shell against it exercises every token and breakpoint while changing one is still cheap.

**Auth before tenancy (02 → 03).** This reverses the Phase 00b order. Safe only because no tenant-scoped records exist before Phase 05 — so the failure the old order guarded against, scope retrofitted onto existing queries, has no queries to apply to. The obligation transfers: Phase 03 ships isolation tests before any business table, and Phase 02 writes no product query. See [ADR 0006](../decisions/0006-design-system-and-demo-data.md).

**Calculation engine before journal UI (07 → 08).** The engine is pure and deterministic, so it can be fully specified and tested with zero UI. Building the journal first would bake formula assumptions into forms and force rework.

**Billing before the features it gates (04 → 05).** Entitlement checks are server-side authorization, not UI decoration. Retrofitting them after the resources exist reliably leaves gaps.

**Analytics replaces data, not screens (09).** Phase 01 built the analytics surfaces against fixtures. Phase 09 swaps the source.

## Superseded

**Phase 11 — Landing & Marketing** was folded into Phase 01 and its document removed; see the roadmap's "Superseded" section for why it moved forward.

## Status

Phases 00, 00b and 01 are complete. Everything from 02 onward is not started — there is no authentication, no database schema and no product mutation path.
