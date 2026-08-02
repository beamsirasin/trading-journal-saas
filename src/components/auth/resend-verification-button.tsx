'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { sendVerificationEmail } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

export function ResendVerificationButton({ email }: { email: string }) {
  const t = useTranslations('auth');
  const [status, setStatus] = useState<'idle' | 'pending' | 'sent'>('idle');

  async function handleResend() {
    setStatus('pending');
    await sendVerificationEmail({ email, callbackURL: '/verify-email/complete' });
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
      <p aria-live="polite" role="status" className="text-muted-foreground text-xs">
        {status === 'sent' ? t('verifyEmailResendSuccess') : null}
      </p>
    </div>
  );
}
