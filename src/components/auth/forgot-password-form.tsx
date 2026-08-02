'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

import { requestPasswordReset } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Deliberately shows the same "check your email" outcome whether or not the
 * address has an account — `requestPasswordReset` itself does not signal
 * which happened, and this form does not add a distinction on top of it
 * (CLAUDE.md's account-enumeration rule, Phase 2 brief §10).
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const formId = useId();
  const [status, setStatus] = useState<'idle' | 'pending' | 'sent'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('pending');
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    await requestPasswordReset({ email, redirectTo: '/reset-password' });
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-card-title">{t('forgotPasswordSentTitle')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('forgotPasswordSentBody')}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-email`}>{t('email')}</Label>
        <Input
          id={`${formId}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder={t('emailPlaceholder')}
        />
      </div>
      <Button type="submit" className="min-h-11 w-full" disabled={status === 'pending'}>
        {t('forgotPasswordSubmit')}
      </Button>
    </form>
  );
}
