# ADR 0001 — Initial stack

- **Status:** Accepted (auth row superseded — see below)
- **Date:** 2026-07-31
- **Phase:** 00 — Foundation

> **2026-08-02:** The "Auth.js (NextAuth v5)" row below was a Phase 00 placeholder, recorded before Phase 02 requirements were specified. Phase 02 selected Better Auth instead, for reasons this ADR did not consider — see [ADR 0009](0009-self-hosted-better-auth.md).

## Context

Greenfield multi-tenant trading-journal SaaS. Constraints from `CLAUDE.md`: TypeScript strict, pnpm, PostgreSQL through a standard `DATABASE_URL`, version-controlled migrations, deterministic and unit-tested financial calculations, and **portability to a plain VPS later** — so no dependency on provider-specific database features.

## Decisions

### Installed in Phase 00

| Choice                    | Version | Rationale                                                                                                                                                                                                     |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js**               | 16.2.12 | Current stable at init. App Router with server actions gives one trust boundary for mutations instead of a separate API surface to secure twice. Self-hostable via `next start`, which protects the VPS path. |
| **TypeScript**            | 5.9.3   | Strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Financial code is where silent `undefined` costs real money.                                                   |
| **React**                 | 19.2.4  | Bundled with Next 16.                                                                                                                                                                                         |
| **Tailwind CSS**          | 4.3.3   | CSS-first configuration via `@theme` suits a semantic-token design system. No config file to drift from the stylesheet.                                                                                       |
| **Zod**                   | 4.4.3   | Validation at every boundary. Used now for environment parsing.                                                                                                                                               |
| **Vitest**                | 4.1.10  | Vite-native, fast, ESM-first. The calculation engine will have thousands of cases; runner speed matters.                                                                                                      |
| **React Testing Library** | 16.3.2  | Tests behaviour and accessible roles rather than implementation.                                                                                                                                              |
| **Playwright**            | 1.62.0  | Cross-browser E2E with first-class mobile emulation, `prefers-color-scheme`, and `prefers-reduced-motion` — all of which are product requirements here, not extras.                                           |
| **ESLint**                | 9.39.5  | Flat config, with `eslint-config-prettier` so it never fights the formatter.                                                                                                                                  |
| **Prettier**              | 3.9.6   | Formatting **and** import ordering, via `@ianvs/prettier-plugin-sort-imports`, plus Tailwind class sorting. One command fixes both; CI checks both.                                                           |
| **clsx + tailwind-merge** | —       | Conditional classes with correct conflict resolution.                                                                                                                                                         |

### Committed but not yet installed

Deliberately deferred to the phase that uses them. Installing a dependency before there is code to use it produces unused packages, dead configuration, and lockfile churn.

| Choice                        | Phase | Rationale                                                                                                                                                                      |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Drizzle ORM** + drizzle-kit | 01    | SQL-first with generated, committed, forward-only migrations. Its typed schema maps cleanly onto `NUMERIC`-as-string, which the money strategy requires.                       |
| **Neon PostgreSQL**           | 01    | Managed Postgres, serverless-friendly, generous free tier. Accessed through a plain `DATABASE_URL` — no Neon-specific driver features — so it can be swapped for any Postgres. |
| **Auth.js (NextAuth v5)**     | 02    | Google OAuth and email magic links, database sessions for server-side revocation, Drizzle adapter. Behind `src/lib/auth/` so the provider is replaceable.                      |
| **React Hook Form**           | 04    | Uncontrolled inputs keep long forms fast; integrates with Zod via a resolver, so client and server share one schema.                                                           |
| **shadcn/ui**                 | 04    | Radix primitives with accessibility built in, vendored into the repo rather than imported as a dependency — so it can be themed to the design system instead of fought.        |
| **Motion** (Framer Motion)    | 04    | Declarative animation with a real reduced-motion story. Global CSS guard remains the backstop.                                                                                 |
| **Recharts**                  | 08    | Composable React charts, adequate for equity curves, histograms, and distributions. Simpler than visx for the MVP's chart set.                                                 |
| **Vercel**                    | 12    | Zero-config Next.js deployment for the initial launch. See the constraint below.                                                                                               |

## Consequences

**Positive**

- One deployable unit; no API service to secure or version separately.
- The calculation engine stays framework-independent and exhaustively testable.
- Formatting, import order, lint, types, and tests are all enforced by CI from the first commit.
- Standard `DATABASE_URL` keeps the VPS exit open.

**Negative / accepted**

- Next.js majors move quickly; version is pinned exactly and upgraded deliberately.
- Server actions are Next-specific. Business logic lives in `server/services/`, so a migration away would rewrite the transport, not the logic.
- Tailwind 4 is recent enough that some ecosystem plugins lag. Nothing in the current set is affected.
- Vercel and Neon are both convenience choices. **The constraint that makes them reversible is: no provider-specific database features, no Vercel-only runtime APIs.** If that constraint is ever violated, this ADR is what it violated.

## Alternatives considered

| Alternative                            | Why not                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remix / TanStack Start                 | Fine frameworks; Next has the larger ecosystem and the team is already committed to it.                                                                                                         |
| Prisma                                 | Heavier runtime, less direct SQL control. Drizzle's generated-SQL migrations are easier to review, which matters for financial data.                                                            |
| Supabase                               | Bundles auth and storage that are not needed, and its row-level-security model would compete with the application-level tenancy guard rather than complement it.                                |
| Jest                                   | Slower, and needs more configuration to match a Vite-based toolchain.                                                                                                                           |
| Cypress                                | Weaker mobile emulation and media-feature emulation than Playwright.                                                                                                                            |
| Chart.js / visx                        | Chart.js is canvas-based and harder to make accessible; visx is more power than the MVP needs.                                                                                                  |
| Decimal columns for prices _and_ money | A single strategy cannot serve both: `1.08532` has no cent representation, and `BIGINT` minor units are exact for cash. Two representations, documented, beats one that is wrong half the time. |
