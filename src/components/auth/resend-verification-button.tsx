'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { sendVerificationEmail } from '@/lib/auth/client';
import { mapGenericError } from '@/lib/auth/client-error';
import { Button } from '@/components/ui/button';

/**
 * Better Auth's client actions resolve `{ data, error }` rather than
 * throwing — `sendVerificationEmail`'s result was previously discarded here,
 * so a failed resend (SMTP down, rate-limited, etc.) still showed "sent",
 * pretending delivery succeeded. `result.error` now drives the outcome, and
 * a failure leaves the user able to press the button again once the
 * underlying problem (e.g. the local SMTP sink) is back.
 */
export function ResendVerificationButton({ email }: { email: string }) {
  const t = useTranslations('auth');
  const [status, setStatus] = useState<'idle' | 'pending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleResend() {
    setStatus('pending');
    setErrorMessage(null);
    const result = await sendVerificationEmail({ email, callbackURL: '/verify-email/complete' });
    if (result.error) {
      setStatus('error');
      setErrorMessage(mapGenericError(result.error, t('genericError'), t('rateLimitedError')));
      return;
    }
    setStatus('sent');
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={status === 'pending'}
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
