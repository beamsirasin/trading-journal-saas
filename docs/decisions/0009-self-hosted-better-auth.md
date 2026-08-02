# ADR 0009 — Self-hosted Better Auth, not a hosted auth service

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 02 — Auth and tenancy

## Context

ADR 0001 provisionally named Auth.js (NextAuth v5) as the Phase 02 auth library. The Phase 2 brief revisited that choice explicitly and specified Better Auth instead, with a hard constraint carried over from CLAUDE.md §2 and §28: **VPS portability**. Whatever is chosen now must run unmodified behind a self-hosted Next.js process on a plain Linux VPS with a plain PostgreSQL database — no dependency on Vercel-only APIs, no dependency on a managed auth product (Neon Managed Auth, Clerk, Supabase Auth, Firebase Auth), and no dependency on Vercel's own identity primitives.

This ADR supersedes the "Auth.js (NextAuth v5)" row in ADR 0001's "committed but not yet installed" table — that was a placeholder recorded before Phase 02 requirements were fully specified, not a considered decision against the alternatives below.

## Decision

**Better Auth, self-hosted**, via:

- `better-auth` (core) + `better-auth/adapters/drizzle` (`@better-auth/drizzle-adapter`) against the project's own Postgres, through the same `getDb()` client every other query uses.
- `better-auth/next-js` (`toNextJsHandler`, `nextCookies`) for the Next.js App Router integration — a single catch-all route handler (`src/app/api/auth/[...all]/route.ts`), not a separate auth microservice.
- `better-auth/react` (`createAuthClient`) for the handful of client-side calls the auth forms need.
- One authoritative `betterAuth()` instance (`src/lib/auth/server.ts`), lazily constructed so building the app never opens a database connection.

Rejected explicitly: Auth.js/NextAuth, Clerk, Supabase Auth, Firebase Auth, Neon's managed auth product, and any Vercel-specific identity primitive.

## Consequences

**Positive**

- Better Auth speaks plain PostgreSQL through Drizzle — the same driver (`postgres.js`) and the same connection string shape every other table in this codebase uses. Nothing about auth is Neon-specific or Vercel-specific.
- Database-backed sessions (ADR 0010) give a real, immediate revoke — a hosted service with opaque session semantics would make "logout invalidates the session server-side" (Phase 2 brief §22) harder to prove and to test.
- Self-hosting means the schema is this repo's own migrations (ADR 0012), reviewable in the same PR as the feature that needs it, rather than a black box on a third-party dashboard.
- No per-monthly-active-user billing tier to plan around before the product has users.

**Negative / accepted**

- This repo now owns auth's correctness — password hashing, rate limiting, session expiry — rather than delegating it to a specialized vendor. Better Auth's own implementation is the safety net; CLAUDE.md's "avoid custom auth primitives" instinct is honored by not hand-rolling password hashing, token generation, or session storage ourselves, only by wiring Better Auth's.
- Google OAuth and email delivery still depend on external services (Google's OAuth endpoints, a future transactional email provider) — self-hosting the auth _library_ does not remove every external dependency, only the identity-provider lock-in.
- Better Auth is a comparatively young project versus Auth.js; version pinned exactly (`better-auth@1.6.25`) and upgraded deliberately, matching this repo's general pinning discipline (CLAUDE.md §2).

## Alternatives considered

| Alternative                           | Why not                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth.js (NextAuth v5)                 | ADR 0001's original placeholder. Viable, but its database-session story is less first-class than Better Auth's (session strategy historically leaned toward JWT), and its Drizzle adapter's schema conventions were a less direct fit for this repo's snake_case-column / camelCase-field convention. |
| Clerk / Supabase Auth / Firebase Auth | All are hosted services with their own user stores outside this repo's Postgres database — directly conflicts with VPS portability (CLAUDE.md §28) and would mean workspace/tenant data (owned by this repo) and identity data (owned by the vendor) can drift or require a sync layer.               |
| Neon Managed Auth                     | Ties authentication to the Neon platform specifically — the opposite of "Neon is a Postgres provider, swappable for any Postgres" (ADR 0001's stated constraint).                                                                                                                                     |
| Vercel-specific identity primitives   | Not portable off Vercel at all; rejected outright by CLAUDE.md §28.                                                                                                                                                                                                                                   |
| Stateless JWT-only sessions           | A revoked JWT session token remains valid until expiry unless a denylist is maintained separately — which reintroduces a database lookup anyway, at which point a database-backed session (ADR 0010) is simpler and more honest about what it costs.                                                  |
