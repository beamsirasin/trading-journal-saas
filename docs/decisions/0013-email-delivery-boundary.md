# ADR 0013 — Email delivery: an owned adapter boundary, not a provider dependency

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 02 — Auth and tenancy

## Context

Email/password auth needs to send two kinds of email: a verification link on sign-up, and a password-reset link. No transactional email provider is configured for this phase — no Resend key, no SMTP credentials exist anywhere in this environment, and CLAUDE.md's "explicitly out of scope" list plus the Phase 2 brief's own deferral list do not include provisioning one. The brief is explicit that this must never be faked: no pretend delivery, no exposed token in an HTTP response, and production must fail closed rather than silently discard an email a user is waiting on.

## Decision

One interface, three implementations, selected by `NODE_ENV` — never by anything a client can influence (`src/lib/auth/email.ts`):

```ts
export interface EmailDeliveryAdapter {
  sendVerificationEmail(params: { to: string; url: string }): Promise<void>;
  sendPasswordResetEmail(params: { to: string; url: string }): Promise<void>;
}
```

- **`ConsoleEmailAdapter`** (`development` — `next dev`) — warns that no provider is configured, but never logs the recipient or bearer URL. Local verification requires a real development mail sink/provider.
- **`TestEmailAdapter`** (`test` — Vitest only; `next build`/`next start` always force `NODE_ENV=production`, so this branch is unreachable from any running instance of the app itself) — captures every call in memory, for a test to assert an email was "sent" and extract the link's token without a network call.
- **`ProductionEmailAdapter`** (`production` — every `next build`/`next start` invocation, including this phase's own e2e run in CI) — **throws** a clear, caught, sanitized error rather than pretending to send.

`src/lib/auth/server.ts` calls only `getEmailAdapter().sendVerificationEmail(...)` / `sendPasswordResetEmail(...)`; it never knows which implementation is active. The call sites do not change when a real provider is eventually wired in — only `ProductionEmailAdapter`'s body does.

**A thrown `ProductionEmailAdapter` error does not fail registration itself.** Better Auth invokes `sendVerificationEmail` through its own `runInBackgroundOrAwait` helper (confirmed by reading the installed `better-auth@1.6.25` source, `dist/api/routes/sign-up.mjs` and `dist/context/create-context.mjs`), which catches and logs rather than propagating — sign-up still succeeds, a session is still issued, and the UI still reaches its "check your email" state. What genuinely never happens is the email arriving, which is the honest, fail-closed behavior this ADR asks for: the account is real, the invitation to verify it is not delivered, and nothing in the response pretends otherwise.

## Consequences

**Positive**

- Registration, password-reset request, and resend-verification UI are all real and testable end-to-end (`e2e/pricing-and-auth.spec.ts`) — including in CI, which runs a genuine production build with zero email provider configured — without the product ever claiming an email was delivered when it was not.
- Dropping in a real provider later (Resend, SES, Postfix relay — undecided) touches exactly one file (`ProductionEmailAdapter`'s two methods), not `src/lib/auth/server.ts` or any UI component.
- No verification or reset token is exposed in an HTTP response or runtime log. Only `TestEmailAdapter`'s process-local in-memory array exposes it to unit tests.

**Negative / accepted**

- A full register → click emailed link → verify → log in round trip **cannot be demonstrated end-to-end** in this environment or in CI until a real provider is configured — documented here as a known limitation, not silently worked around by weakening the production fail-closed behavior. `e2e/pricing-and-auth.spec.ts`'s registration test verifies the account is created and reaches the pending-verification screen, then verifies logging in immediately fails (correctly) because the email was never actually verified.
- A user who registers today receives no email at all — acceptable only because this product has no real users yet; provisioning a real provider before allowing real signups outside development is a hard prerequisite for launch, tracked in `docs/roadmap.md`.

## Alternatives considered

| Alternative                                                                                               | Why not                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A free-tier or trial email provider, wired in now                                                         | Not requested by the Phase 2 brief, and CLAUDE.md's "smallest safe implementation" guidance favors the adapter boundary (cheap to add a real provider later) over provisioning a vendor account for a phase that has no real users to email yet.                         |
| Silently succeed with no email sent (no throw)                                                            | Exactly the "pretend delivery" behavior the brief forbids — a user would be told to check an inbox that will never receive anything, with no signal anywhere that delivery failed.                                                                                       |
| Returning the verification/reset link in the API response for now, so the flow "works" without a provider | Defeats the purpose of email verification (proving inbox ownership) and would leak a sensitive token to anything that can observe the HTTP response — explicitly forbidden by the brief.                                                                                 |
| One adapter implementation gated on an env var instead of `NODE_ENV`                                      | `NODE_ENV` is not client-influenceable and already the axis every other environment-sensitive choice in this codebase pivots on (`resolveAuthSecret`, `getDatabaseUrl`); a separate env var would be one more thing to keep in sync with what a build is actually doing. |
