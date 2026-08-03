/**
 * The `/send-verification-email` rate-limit window, in seconds. Shared
 * between `server.ts`'s actual enforcement (`buildRateLimitCustomRules`) and
 * the client-side cooldown shown after a 429 (`resend-verification-button.tsx`)
 * so the two can never drift silently out of sync.
 *
 * Not a secret: an attacker can already observe this window by timing
 * responses against the real endpoint, and the server remains the sole
 * authority regardless of what the client displays — this only sizes a UI
 * cooldown, never a security decision. `buildRateLimitCustomRules`'s
 * e2e-widened branch changes `max`, not `window`, so one constant covers
 * both configurations.
 */
export const RESEND_VERIFICATION_WINDOW_SECONDS = 60;
