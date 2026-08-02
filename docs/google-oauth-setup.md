# Google OAuth setup guide

Manual, one-time setup for enabling "Continue with Google" (`src/components/auth/auth-form.tsx`). No Google credentials are configured in this environment as of Phase 2 — the button renders truthfully disabled (`isGoogleSignInConfigured()` returns `false`) until both environment variables below are set.

**Status: not yet performed.** Nothing in this section has been verified against a real Google Cloud project.

## 1. Create or select a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one dedicated to this product — do not reuse an unrelated project's OAuth client).

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen.**
2. User type: **External** (unless every user will be a Google Workspace member of a specific organization, which is not this product's model).
3. Fill in the app name, support email, and — before requesting production access — the scopes actually used (Better Auth's default Google provider requests `openid`, `email`, `profile`; no others are configured here).
4. While the app is in **Testing** mode, only explicitly-added test users can sign in — fine for development, insufficient for real signups. Submitting for verification (required past 100 users, or immediately if you want any Google user to sign in without a warning screen) is a separate, longer process not covered here.

## 3. Create an OAuth client

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
2. Application type: **Web application**.
3. Add **Authorized redirect URIs** — see the exact paths below. Add one entry per environment you actually deploy to; do not add a wildcard.
4. Save. Copy the **Client ID** and **Client secret**.

## 4. Exact callback URLs

Better Auth mounts its handler at `/api/auth` (the default `basePath`, confirmed against the installed `better-auth@1.6.25` source) and Google's callback path is `/api/auth/callback/google`. The full authorized redirect URI is:

```
<BETTER_AUTH_URL>/api/auth/callback/google
```

| Environment       | `BETTER_AUTH_URL`                                                                                        | Authorized redirect URI to add                              |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Local development | `http://localhost:3000`                                                                                  | `http://localhost:3000/api/auth/callback/google`            |
| Vercel Preview    | `https://<your-preview-domain>` (Vercel assigns one per deployment, or use a stable alias if configured) | `https://<your-preview-domain>/api/auth/callback/google`    |
| Production        | `https://<your-production-domain>`                                                                       | `https://<your-production-domain>/api/auth/callback/google` |

**Preview deployments are the awkward case**: Vercel generates a unique URL per deployment by default, which does not match any single registered redirect URI. Either (a) configure a stable Preview alias/domain in Vercel and always deploy Preview under that alias, or (b) accept that Google sign-in will not work on ad-hoc Preview URLs and is only exercised in Production and local development. This repo has not picked between (a) and (b) yet — record the choice here once made.

## 5. Store the credentials

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
```

Both are **server-only** — never prefixed `NEXT_PUBLIC_`, never read from a client component. `src/lib/auth/server.ts`'s `isGoogleSignInConfigured()` is the single source of truth for whether the button renders active; it reads both variables server-side and passes a plain boolean prop to the client form. Store real values only in `.env.local` (gitignored) and in Vercel's per-scope environment variables (see [`docs/neon-setup.md`](neon-setup.md#vercel-environment-scopes) for the Development/Preview/Production distinction) — never commit them, never put them in `.env.example`.

## 6. What happens with no credentials configured (current state)

- The Google button renders, but disabled, with the localized note "Google sign-in is not available right now." (`auth.googleNotConnected`) — never a button that looks clickable but silently fails.
- `socialProviders` is omitted entirely from the `betterAuth()` config (`buildSocialProviders()` returns `undefined`) when either variable is missing — the `/api/auth/sign-in/social` endpoint itself is not registered, not merely hidden in the UI.
- Cancelled sign-in, access-denied, and provider-error cases (once credentials exist) redirect to `/auth-error` with a localized, safe message — never a raw Google/Better-Auth error payload (`onAPIError.errorURL` in `src/lib/auth/server.ts`).

## Verification status

No real Google OAuth flow has been exercised in this environment — no credentials exist to test with. Do not treat any claim of "Google sign-in works" elsewhere in this repo's docs as verified unless a specific report states it was observed against a real, configured client.
