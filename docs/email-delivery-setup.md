# Email delivery setup guide

How verification and password-reset emails are sent, and what is required to make them real. See [ADR 0013](decisions/0013-email-delivery-boundary.md) for the architectural reasoning — this document is the operational counterpart.

## Current state: local SMTP for development, no provider in production

`src/lib/auth/email.ts` selects an `EmailDeliveryAdapter` implementation by `NODE_ENV`:

| `NODE_ENV`                                                                                    | Adapter                  | Behavior                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development` (`next dev`), SMTP fully configured                                             | `SmtpEmailAdapter`       | Sends the real Better Auth verification/reset email through a local SMTP sink (e.g. Mailpit) — see below.                                                                                                                       |
| `development` (`next dev`), SMTP not configured                                               | `ConsoleEmailAdapter`    | Warns that delivery is unavailable without logging the recipient or bearer URL.                                                                                                                                                 |
| `test` (Vitest only — unreachable from any running app instance)                              | `TestEmailAdapter`       | Captures sent emails in memory for assertions.                                                                                                                                                                                  |
| `production` (`next build` + `next start` — **always**, including this repo's own CI e2e run) | `ProductionEmailAdapter` | **Throws**, regardless of whether SMTP env vars happen to be set. No email is sent. Sign-up/reset itself still succeeds (Better Auth treats the send as a background task — see ADR 0013) but the user never receives anything. |

**Selection is by `NODE_ENV` alone, never by the presence of `SMTP_*` variables.** A production deployment that accidentally carries a leftover `SMTP_HOST` still gets `ProductionEmailAdapter` — the local SMTP adapter is structurally unreachable outside `next dev`.

**No real users should be allowed to register against a production deployment until a real provider is configured.** This is a hard prerequisite for launch, not a nice-to-have — tracked in `docs/roadmap.md`.

## Local development: sending real emails to Mailpit

[Mailpit](https://mailpit.axllent.org/) is a local SMTP sink: it accepts any outbound mail on `127.0.0.1:1025` with no authentication and no TLS, and shows every captured message in a web inbox at `http://127.0.0.1:8025`. It never delivers anywhere real — it is a development tool, not a production email provider.

1. **Download the Windows static binary.** Get the latest `mailpit-windows-amd64.zip` from the [Mailpit releases page](https://github.com/axllent/mailpit/releases) and extract `mailpit.exe` somewhere on your machine (no installer, no admin rights required).
2. **Run `mailpit.exe`.** Double-click it, or run it from a terminal:
   ```
   .\mailpit.exe
   ```
   It listens for SMTP on `127.0.0.1:1025` and serves the web inbox on `127.0.0.1:8025` by default. Leave it running in the background while you use the app.
3. **Open `http://127.0.0.1:8025`.** This is the web inbox — every email your local app sends will appear here in real time.
4. **Configure local SMTP environment variables.** In `.env.local` (never committed):
   ```
   SMTP_HOST=127.0.0.1
   SMTP_PORT=1025
   SMTP_SECURE=false
   EMAIL_FROM_ADDRESS=no-reply@trading-os.local
   EMAIL_FROM_NAME=Trading OS
   ```
   Leave `SMTP_USERNAME`/`SMTP_PASSWORD` unset — Mailpit does not require authentication, and setting only one of the two falls back to the non-delivering `ConsoleEmailAdapter` rather than guessing.
5. **Restart the Next.js development server** (`pnpm dev`) so the new environment variables are picked up.
6. **Register an account** at `/en/register` (or `/th/register`) with any email address — Mailpit accepts mail to any address, real or not.
7. **Open the captured email** in the Mailpit web inbox (`http://127.0.0.1:8025`).
8. **Follow the verification link.** It completes the same `requireEmailVerification` flow a real provider would, entirely locally.

The same setup delivers password-reset emails through the "forgot password" flow.

## What "resolved" looks like

1. Choose a transactional email provider. None has been selected yet — candidates to evaluate include Resend, Postmark, AWS SES, or a self-hosted relay, weighed against CLAUDE.md's VPS-portability constraint (§28: "email delivery behind an adapter" — already satisfied by this boundary regardless of which provider is chosen).
2. Add the provider's credential(s) as new server-only environment variables (e.g. `RESEND_API_KEY`) — document the name in `.env.example` (name and description only, never a real value) the same way every other secret in this repo is documented.
3. Replace `ProductionEmailAdapter`'s two method bodies in `src/lib/auth/email.ts` with real provider calls. No other file changes — `src/lib/auth/server.ts` and every UI component already call only `getEmailAdapter().sendVerificationEmail(...)`/`sendPasswordResetEmail(...)`, which is the entire point of the adapter boundary.
4. Write a real integration test against the provider's sandbox/test mode (most transactional providers offer one) before removing the "not yet configured" language from this document and from `.env.example`.

## What is verified today, and what is not

Verified (against a real running build, in CI's `e2e` job — see `.github/workflows/ci.yml`):

- Registration creates a real account and reaches the "check your email" UI state even with zero email provider configured (the send is best-effort/background — ADR 0013).
- Attempting to log in immediately after registering fails with the same generic error a wrong password would produce (`requireEmailVerification: true` blocks the sign-in; the UI never reveals that the specific reason was "unverified" rather than "wrong password").
- With Mailpit running and `SMTP_*`/`EMAIL_FROM_*` configured locally, a full register → open captured email → click verification link → log in round trip can be exercised by hand in development (see above). This is a manual local check, not part of the automated CI suite, which never configures SMTP and therefore always exercises the `ConsoleEmailAdapter`/`ProductionEmailAdapter` paths.

Not verified, and cannot be verified without a real _production_ provider:

- An email actually arriving in a real inbox outside local development.
- Password-reset delivery in production.

Development deliberately does not print verification or reset links when SMTP is unconfigured. Console logs are routinely persisted or aggregated; treating them as a credential-delivery channel would leak bearer tokens outside the email boundary. The `SmtpEmailAdapter` itself never logs the email body, url, or SMTP credentials either — Mailpit's own web inbox is the only place a sent message's contents are visible.

Do not treat any claim of "registration works end-to-end" elsewhere in this repo's docs as covering actual _production_ email delivery unless a specific report states a real provider was configured and observed.
