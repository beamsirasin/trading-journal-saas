# Phase 00 — Foundation & Conventions

**Depends on:** nothing · **Blocks:** everything

## Goal

A repository that builds, lints, typechecks, tests, and renders a themed shell — with zero product features. Every later phase inherits these conventions, so getting them wrong is expensive and getting them right is invisible.

## Scope

### Repository & toolchain

- `git init`, `.gitignore`, `.editorconfig`, `.nvmrc`
- Next.js scaffold — **current stable release at time of init**. Record the exact version in `CLAUDE.md` §2.
- TypeScript `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- pnpm, lockfile committed
- ESLint + Prettier + Tailwind class sorting; `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- Vitest configured with path aliases matching `tsconfig`
- GitHub Actions: install → lint → typecheck → test → build on every push

### Environment handling

- `src/config/env.ts` — Zod-parsed, fails fast at boot with a readable error listing every missing var
- `.env.example` documenting `DATABASE_URL`, auth secrets, app URL. **Never commit real values.**
- Separate server-only and client-safe (`NEXT_PUBLIC_*`) schemas; server secrets must be unreachable from client bundles

### Database wiring (no product tables)

- `drizzle.config.ts` pointing at `DATABASE_URL`
- Drizzle client singleton, configured so `numeric` returns **strings** (see `CLAUDE.md` §5)
- Local Postgres via `docker-compose.yml` for development; Neon reserved for deployment
- One trivial migration proving generate → apply → commit works end to end

### Money & time primitives

- `src/lib/money/` — minor-unit `bigint` helpers, currency scale lookup (JPY = 0 decimals), decimal.js price helpers, formatters
- `src/lib/time/` — UTC storage helpers, IANA-timezone display, **timezone-aware day bucketing** (used later by every date-grouped analytic)
- Unit tests for both. These are load-bearing; they get tested now, not later.

### Design system

- Tailwind theme: blue/navy/cyan identity as CSS custom properties, semantic tokens (`surface`, `surface-raised`, `border`, `text-muted`, `positive`, `negative`, `warning`) — **not raw palette values at call sites**
- Dark mode primary + complete light mode, `next-themes`, no flash on load
- Type scale, spacing scale, consistent radii, elevation layers
- shadcn/ui initialized with the project theme
- Motion primitives wrapping `motion`, honoring `prefers-reduced-motion` globally
- Base primitives: `Button`, `Card`, `Input`, `Skeleton`, `EmptyState`, `ErrorState`
- Application shell: sidebar + topbar, responsive to mobile drawer
- Placeholder `/` route so Phase 02 auth has a destination

## Out of scope

Auth, database product tables, any product feature, real landing page content.

---

## Outcome — completed 2026-07-31

The delivered brief was narrower than the plan above. Database wiring, money/time primitives, shadcn/ui, and the app shell were scoped out and moved to **Phase 00b** (see [roadmap](../roadmap.md)) rather than dropped.

### Shipped

```
.gitignore  .editorconfig  .nvmrc  .prettierrc.mjs  .prettierignore
package.json  pnpm-lock.yaml  pnpm-workspace.yaml  tsconfig.json
next.config.ts  eslint.config.mjs  postcss.config.mjs
vitest.config.ts  vitest.setup.ts  playwright.config.ts
.github/workflows/ci.yml   .env.example
src/app/{layout,page,globals}.*   src/app/page.test.tsx
src/components/ui/{card,badge}.tsx
src/config/env.ts   src/config/env.test.ts
src/lib/utils.ts    src/lib/utils.test.ts
e2e/home.spec.ts
README.md  CLAUDE.md  docs/{product-spec,architecture,data-dictionary,
                            calculation-spec,design-system,roadmap}.md
docs/decisions/0001-initial-stack.md
```

Versions pinned: Next.js 16.2.12 · React 19.2.4 · TypeScript 5.9.3 · Tailwind 4.3.3 · Vitest 4.1.10 · Playwright 1.62.0.

### Deferred to Phase 00b

`drizzle.config.ts` · `src/server/db/client.ts` · `docker-compose.yml` · `drizzle/0000_*.sql` · `src/lib/money/**` · `src/lib/time/**` · shadcn/ui init · Motion primitives · `src/components/shell/**` · `Button`, `Input`, `Skeleton`, `EmptyState`, `ErrorState`.

### Definition of Done

- [x] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [x] Dark and light mode both correct — verified by e2e across both media preferences
- [x] No horizontal overflow — verified by e2e at desktop and mobile viewports
- [x] `prefers-reduced-motion` verified to suppress animation (e2e)
- [x] Env schema validated and unit-tested; readable failure message
- [x] No secrets committed — `.env.example` holds names only
- [x] CI workflow exists
- [ ] **CI green — unverified.** No remote is configured, so the workflow has never executed. Every step it runs was executed locally and passed.
- [ ] Money and time helpers unit-tested — deferred with the helpers to 00b
- [ ] No flash of wrong theme — not applicable until the theme switcher exists

## Risks

- **Next.js version drift.** Pinned exactly at 16.2.12 and recorded in `CLAUDE.md` §2.
- **Token discipline.** If a later phase reaches for a raw hex value, the design system failed here. Semantic tokens only.
- **Drizzle numeric mode** — carried to 00b. If misconfigured, prices silently become JS numbers and every downstream calculation is subtly wrong. Verify with a test asserting a `numeric` column round-trips as a string.
- **CI is unproven.** It cannot be trusted until it has run once against a remote.
