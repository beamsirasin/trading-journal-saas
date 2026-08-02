# Email delivery setup guide

How verification and password-reset emails are sent, and what is required to make them real. See [ADR 0013](decisions/0013-email-delivery-boundary.md) for the architectural reasoning — this document is the operational counterpart.

## Current state: no provider configured

`src/lib/auth/email.ts` selects an `EmailDeliveryAdapter` implementation by `NODE_ENV`:

| `NODE_ENV`                                                                                    | Adapter                  | Behavior                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development` (`next dev`)                                                                    | `ConsoleEmailAdapter`    | Warns that delivery is unavailable without logging the recipient or bearer URL.                                                                                           |
| `test` (Vitest only — unreachable from any running app instance)                              | `TestEmailAdapter`       | Captures sent emails in memory for assertions.                                                                                                                            |
| `production` (`next build` + `next start` — **always**, including this repo's own CI e2e run) | `ProductionEmailAdapter` | **Throws.** No email is sent. Sign-up/reset itself still succeeds (Better Auth treats the send as a background task — see ADR 0013) but the user never receives anything. |

**No real users should be allowed to register against a production deployment until this is resolved.** This is a hard prerequisite for launch, not a nice-to-have — tracked in `docs/roadmap.md`.

## What "resolved" looks like

1. Choose a transactional email provider. None has been selected yet — candidates to evaluate include Resend, Postmark, AWS SES, or a self-hosted relay, weighed against CLAUDE.md's VPS-portability constraint (§28: "email delivery behind an adapter" — already satisfied by this boundary regardless of which provider is chosen).
2. Add the provider's credential(s) as new server-only environment variables (e.g. `RESEND_API_KEY`) — document the name in `.env.example` (name and description only, never a real value) the same way every other secret in this repo is documented.
3. Replace `ProductionEmailAdapter`'s two method bodies in `src/lib/auth/email.ts` with real provider calls. No other file changes — `src/lib/auth/server.ts` and every UI component already call only `getEmailAdapter().sendVerificationEmail(...)`/`sendPasswordResetEmail(...)`, which is the entire point of the adapter boundary.
4. Write a real integration test against the provider's sandbox/test mode (most transactional providers offer one) before removing the "not yet configured" language from this document and from `.env.example`.

## What is verified today, and what is not

Verified (against a real running build, in CI's `e2e` job — see `.github/workflows/ci.yml`):

- Registration creates a real account and reaches the "check your email" UI state even with zero email provider configured (the send is best-effort/background — ADR 0013).
- Attempting to log in immediately after registering fails with the same generic error a wrong password would produce (`requireEmailVerification: true` blocks the sign-in; the UI never reveals that the specific reason was "unverified" rather than "wrong password").

Not verified, and cannot be verified without a real provider:

- An email actually arriving in an inbox.
- Clicking a real verification link and completing the flow to a logged-in, verified state.
- Password-reset delivery.

Development deliberately does not print verification or reset links. Console logs are routinely persisted or aggregated; treating them as a credential-delivery channel would leak bearer tokens outside the email boundary.

Do not treat any claim of "registration works end-to-end" elsewhere in this repo's docs as covering actual email delivery unless a specific report states a real provider was configured and observed.
