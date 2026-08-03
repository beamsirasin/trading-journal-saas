'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { sendVerificationEmail } from '@/lib/auth/client';
import { mapGenericError } from '@/lib/auth/client-error';
import { RESEND_VERIFICATION_WINDOW_SECONDS } from '@/lib/auth/rate-limit-config';
import { Button } from '@/components/ui/button';

/**
 * Set by `/verify-email`'s server component from the `notice` query param
 * `AuthForm` attaches after its own post-registration dispatch attempt
 * (`src/components/auth/auth-form.tsx`) — seeds this button's initial
 * displayed state so the SAME outcome that just happened during
 * registration doesn't have to be silently discarded and rediscovered only
 * if the user happens to press Resend.
 */
export type VerificationDispatchNotice = 'rate-limited' | 'delivery-failed';

/**
 * Better Auth's client actions resolve `{ data, error }` rather than
 * throwing — `sendVerificationEmail`'s result was previously discarded here,
 * so a failed resend (SMTP down, rate-limited, etc.) still showed "sent",
 * pretending delivery succeeded. `result.error` now drives the outcome, and
 * a failure leaves the user able to press the button again once the
 * underlying problem (e.g. the local SMTP sink) is back.
 */
export function ResendVerificationButton({
  email,
  initialNotice,
}: {
  email: string;
  initialNotice?: VerificationDispatchNotice | undefined;
}) {
  const t = useTranslations('auth');
  const [status, setStatus] = useState<'idle' | 'pending' | 'sent' | 'error'>(
    initialNotice !== undefined ? 'error' : 'idle',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialNotice === 'rate-limited'
      ? t('verifyEmailRateLimited')
      : initialNotice === 'delivery-failed'
        ? t('verifyEmailDeliveryFailed')
        : null,
  );
  // Approximates the real /send-verification-email window
  // (`src/lib/auth/rate-limit-config.ts`) so the button re-enables around
  // when the actual bucket clears. Only seeded from the registration flow's
  // own dispatch attempt (`initialNotice`) — a manual click that itself hits
  // 429 does NOT re-arm this: it already shows the rate-limited message via
  // `mapGenericError` below and stays clickable, so a user who wants to try
  // again immediately still can, exactly as before this feature existed.
  const [cooldownActive, setCooldownActive] = useState(initialNotice === 'rate-limited');

  useEffect(() => {
    if (!cooldownActive) return undefined;
    const timeout = setTimeout(
      () => setCooldownActive(false),
      RESEND_VERIFICATION_WINDOW_SECONDS * 1000,
    );
    return () => clearTimeout(timeout);
  }, [cooldownActive]);

  async function handleResend() {
    setStatus('pending');
    setErrorMessage(null);
    const result = await sendVerificationEmail({ email, callbackURL: '/verify-email/complete' });
    if (result.error) {
      setStatus('error');
      setErrorMessage(mapGenericError(result.error, t('genericError'), t('rateLimitedError')));
      return;
    }
    setCooldownActive(false);
    setStatus('sent');
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={status === 'pending' || cooldownActive}
        onClick={handleResend}
      >
        {t('verifyEmailResend')}
      </Button>
      <p aria-live="polite" role="status" className="text-xs">
        {status === 'sent' ? (
          <span className="text-muted-foreground">{t('verifyEmailResendSuccess')}</span>
        ) : null}
        {status === 'error' && errorMessage !== null ? (
          <span className="text-destructive">{errorMessage}</span>
        ) : null}
      </p>
    </div>
  );
}
