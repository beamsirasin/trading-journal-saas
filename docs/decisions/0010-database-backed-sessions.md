# ADR 0010 — Database-backed sessions, with a short read-through cookie cache

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 02 — Auth and tenancy

## Context

The Phase 2 brief requires (§22, §23) that logout genuinely invalidate a session, that a revoked session be rejected on its next use, and that an expired session be rejected — all verifiable by a real integration/e2e test, not merely "the cookie was cleared client-side." It also requires (§8) that `src/proxy.ts` remain an _optimistic_ check only — no database round trip on every request — with the real authorization decision made server-side, close to the data.

## Decision

Better Auth's **database-backed session store** (`sessions` table, ADR 0008 for its ID column), with a **short read-through cookie cache** layered on top for performance:

```ts
session: {
  modelName: 'sessions',
  expiresIn: 60 * 60 * 24 * 7, // 7 days
  updateAge: 60 * 60 * 24,     // refresh once per day of activity
  cookieCache: { enabled: true, maxAge: 60 }, // 60s read-through cache only
},
```

Two layers, two different jobs:

1. **`src/proxy.ts`** — `getSessionCookie(request)` checks only whether a session cookie is _present_, never whether it is valid. This is Better Auth's own documented recommendation for middleware/proxy: no database round trip on every request, redirect-only, purely a UX shortcut for the unauthenticated-visitor case.
2. **`src/server/auth/dal.ts`** — `getOptionalSession()` calls `auth.api.getSession({ query: { disableCookieCache: true } })`. Better Auth 1.6.25 otherwise returns a valid signed `session_data` cookie before consulting PostgreSQL. Explicitly disabling that cache is the actual authorization boundary and makes revocation immediate.

A forged or expired cookie passes proxy's presence check and is rejected at the DAL layer — proven directly by `e2e/auth-authorization.spec.ts`'s fabricated-cookie and post-logout-cookie-replay tests, and by `src/server/auth/dal.integration.test.ts`.

## Consequences

**Positive**

- A revoked session is actually revoked: deleting (or Better Auth's own `signOut()` deleting) the `sessions` row makes the next `getSession()` call return `null`, full stop — no denylist, no waiting for a JWT to expire.
- `src/proxy.ts` stays cheap (no per-request database hit) while still forcing every real decision through a code path that is unit/integration-testable in isolation from the framework's routing layer.
- The 60-second cookie cache may serve non-authoritative library/client flows, but the server DAL always bypasses it. A replayed signed cache cookie cannot authorize after its database session is removed.

**Negative / accepted**

- Every protected request does at least one database read — an accepted cost given the immediate-revocation requirement. The cookie cache is never used to make an application authorization decision.
- `updateAge: 1 day` means a session's expiry silently extends on any activity within a day of its last extension — documented here so a future reader does not mistake this for a bug; it is the standard "sliding expiration" trade-off, not an oversight.

## Alternatives considered

| Alternative                                                                               | Why not                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stateless JWT sessions (no `sessions` table)                                              | Cannot be revoked before expiry without a separate denylist — which is a database-backed session store by another name, just less honestly named.                                                                                                                                                                                                                                |
| No cookie cache at all (`cookieCache.enabled: false`)                                     | Keeping it permits non-authoritative Better Auth flows to benefit while the DAL's explicit `disableCookieCache` preserves immediate revocation for application authorization.                                                                                                                                                                                                    |
| Making `src/proxy.ts` call `auth.api.getSession()` directly (a "real" check in the proxy) | Contradicts Better Auth's own documented middleware guidance and CLAUDE.md's "proxy is not the authorization boundary" instruction (Phase 2 brief §8) — would add a database round trip to every single request, including ones that never reach a page that needs authorization at all (static assets excluded by the matcher, but every other route would still pay the cost). |
