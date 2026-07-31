# Phase Roadmap

The MVP is decomposed into 13 phases. Each is dependency-ordered, independently reviewable, and ends in **one coherent commit**.

Read [`../../CLAUDE.md`](../../CLAUDE.md) first, then the active phase document. Do not implement work belonging to a later phase.

| #                                     | Phase                            | Ships                                    | Depends on |
| ------------------------------------- | -------------------------------- | ---------------------------------------- | ---------- |
| [00](PHASE-00-foundation.md)          | Foundation & Conventions         | Repo, toolchain, design system, CI       | —          |
| [01](PHASE-01-tenancy.md)             | Data Model & Tenancy Core        | Workspaces, membership, scoped queries   | 00         |
| [02](PHASE-02-auth.md)                | Authentication & Session         | Google + email auth, session→workspace   | 01         |
| [03](PHASE-03-billing.md)             | Plans, Trial & Entitlements      | 3 plans, 7-day trial, mock payment       | 02         |
| [04](PHASE-04-onboarding-accounts.md) | Onboarding & Trading Accounts    | Wizard, account CRUD, limit enforcement  | 03         |
| [05](PHASE-05-strategies.md)          | Strategies & Versions            | Strategy CRUD, immutable versioning      | 04         |
| [06](PHASE-06-calc-engine.md)         | Trade Model & Calculation Engine | Schema + pure R-multiple engine, tests   | 05         |
| [07](PHASE-07-journal.md)             | Trade Journal                    | Manual entry, system vs actual, mistakes | 06         |
| [08](PHASE-08-analytics.md)           | Dashboard & Analytics            | Attribution dashboard, charts            | 07         |
| [09](PHASE-09-settings.md)            | Settings                         | Profile, workspace, subscription         | 03, 07     |
| [10](PHASE-10-admin.md)               | SaaS Administration              | Admin role, user/subscription oversight  | 03         |
| [11](PHASE-11-landing.md)             | Landing & Marketing              | Public site, pricing page                | 03         |
| [12](PHASE-12-hardening.md)           | Hardening & Launch               | A11y, responsive, security, deploy       | all        |

## Sequencing rationale

**Tenancy before auth (01 → 02).** The scoping primitive is the load-bearing security boundary. Building it first, with its own tests, means auth plugs into a guard that already provably works — rather than retrofitting scope onto queries written without it.

**Calculation engine before journal UI (06 → 07).** The engine is pure and deterministic, so it can be fully specified and tested with zero UI. Building the journal first would bake formula assumptions into forms and force rework.

**Billing before the features it gates (03 → 04).** Entitlement checks are server-side authorization, not UI decoration. Retrofitting them after the resources exist reliably leaves gaps.

**Landing page late (11).** It depends on final pricing and positioning, and blocks nothing. Phase 00 ships a placeholder route so auth has somewhere to land.

## Status

All phases: **not started.** No application code exists in this repository yet.
