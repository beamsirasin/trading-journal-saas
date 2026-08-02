'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

import { resetPassword } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';

export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const t = useTranslations('auth');
  const formId = useId();
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === undefined) return;

    setStatus('pending');
    const newPassword = String(new FormData(event.currentTarget).get('password') ?? '');
    const result = await resetPassword({ newPassword, token });
    setStatus(result.error ? 'error' : 'success');
  }

  if (token === undefined || status === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-card-title">{t('resetPasswordInvalidTitle')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('resetPasswordInvalidBody')}
        </p>
        <Button asChild className="min-h-11">
          <Link href="/forgot-password">{t('resetPasswordInvalidCta')}</Link>
        </Button>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-card-title">{t('resetPasswordSuccessTitle')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('resetPasswordSuccessBody')}
        </p>
        <Button asChild className="min-h-11">
          <Link href="/login">{t('resetPasswordSuccessCta')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${formId}-password`}>{t('newPassword')}</Label>
        <Input
          id={`${formId}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-describedby={`${formId}-password-hint`}
        />
        <p id={`${formId}-password-hint`} className="text-muted-foreground text-xs">
          {t('passwordHint')}
        </p>
      </div>
      <Button type="submit" className="min-h-11 w-full" disabled={status === 'pending'}>
        {t('resetPasswordSubmit')}
      </Button>
    </form>
  );
}
