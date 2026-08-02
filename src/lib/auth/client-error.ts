/** Shape of a better-auth client action's `error` — the library's actions resolve `{ data, error }` rather than throwing. */
export interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
}

/**
 * Maps a better-auth client error to one of two pre-translated messages,
 * never surfacing the raw Better Auth error code/message to the user.
 * Rate-limited responses (429) get a distinct message so a legitimate user
 * knows to wait rather than assuming the action failed outright — shared by
 * every form/action that calls a rate-limited Better Auth endpoint
 * (`src/components/auth/auth-form.tsx`, `resend-verification-button.tsx`).
 */
export function mapGenericError(
  error: AuthErrorLike,
  defaultMessage: string,
  rateLimitMessage: string,
): string {
  if (error.status === 429) {
    return rateLimitMessage;
  }
  return defaultMessage;
}
