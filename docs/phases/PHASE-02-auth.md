# Phase 02 — Authentication & Session

> **Superseded.** The commissioning brief for Phase 02 combined authentication with tenancy and specified Better Auth rather than Auth.js. See [`PHASE-02-auth-tenancy.md`](PHASE-02-auth-tenancy.md) for what was actually built, and [ADR 0009](../decisions/0009-self-hosted-better-auth.md) for why. This document is preserved as the historical record of the original plan below.

**Depends on:** 00b · **Blocks:** 03+

## Goal

Real users can sign up and sign in with Google or email, and every authenticated request resolves to a trusted `WorkspaceContext`.

## Scope

### Auth.js (NextAuth v5)

- Google OAuth provider
- Email provider — magic link, via an `EmailSender` adapter (Resend or SMTP; swappable)
- Drizzle adapter tables: `accounts`, `sessions`, `verification_tokens`
- Database session strategy (server-side revocation; simpler to reason about than JWT for a multi-tenant app)
- Account linking: same verified email across Google and magic link resolves to **one** user

### Signup side effects (transactional)

On first successful sign-in, in a single transaction:

1. Create `user` with timezone `UTC` (corrected during onboarding)
2. Create personal `workspace`
3. Create `workspace_member` with role `owner`
4. Start the 7-day trial _(record written here; enforced in Phase 03)_

Failure at any step rolls back all of it. A user without a workspace is an unreachable state.

### Session → context

- Server helper `getSessionContext()` returning `WorkspaceContext`, wired to Phase 01's resolver
- Middleware protecting `/app/*`; unauthenticated → `/login?next=…`
- Post-login routing: onboarding incomplete → `/onboarding`, else `/app`
- `next` redirect target validated as a **same-origin relative path** (open-redirect defence)

### UI

- `/login`, `/signup` — split layout, product framing on one side
- Google button + email field; email screen states: idle → sending → sent → error
- "Check your email" confirmation, resend with cooldown
- `/auth/error` with human-readable causes
- Sign out
- Full loading / error states, keyboard accessible, labelled inputs

## Out of scope

Password auth, 2FA, team invitations, onboarding wizard content (Phase 04), entitlement enforcement (Phase 03).

## Deliverables

```
src/lib/auth/{config,adapter,email-sender}.ts
src/server/db/schema/auth.ts
src/app/(auth)/login|signup|auth/error/page.tsx
src/middleware.ts
drizzle/0002_auth.sql
tests/auth/{signup-transaction,redirect-safety}.test.ts
```

## Definition of Done

- [ ] Google sign-in works end to end
- [ ] Magic link works end to end
- [ ] Same email via both providers resolves to one user, not two
- [ ] Signup atomically creates user + workspace + owner membership
- [ ] `/app/*` unreachable unauthenticated
- [ ] `next` param cannot redirect off-origin
- [ ] Auth pages responsive at 320 / 768 / 1440, dark and light
- [ ] Typecheck, lint, tests, build pass
- [ ] OAuth secrets in env only, never committed

## Risks

- **Account linking and email verification.** Auto-linking on unverified email is an account-takeover vector. Link only when the provider asserts the email is verified.
- **Magic link deliverability** in development. Log links to console in dev rather than depending on an email provider.
- **Session revocation.** Confirm sign-out invalidates the DB session row, not just the cookie.
