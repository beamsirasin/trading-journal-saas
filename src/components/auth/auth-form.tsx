'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

import { safeCallbackPath } from '@/lib/auth/callback-url';
import { signIn, signUp } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * Real email/password + Google sign-in, replacing Phase 1.1's
 * `DemoAuthForm`. Keeps the same visual skeleton that component established
 * (Google button + divider + native-validated form + a live status region)
 * — only the behavior underneath changed from "nothing is sent" to "a real
 * Better Auth request".
 *
 * Error handling never reveals whether an account exists (CLAUDE.md's
 * account-enumeration rule, Phase 2 brief §10/§23): a login failure always
 * shows the same generic invalid-credentials message regardless of which
 * part was wrong, and a registration attempt against an existing email is
 * routed to the same "check your email" outcome a genuine signup gets
 * rather than surfacing Better Auth's `USER_ALREADY_EXISTS` error.
 */
export function AuthForm({
  mode,
  googleEnabled,
  callbackUrl,
}: {
  mode: 'login' | 'register';
  googleEnabled: boolean;
  callbackUrl?: string | undefined;
}) {
  const t = useTranslations('auth');
  const router = useRouter();
  const formId = useId();
  const isRegister = mode === 'register';

  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const destination = safeCallbackPath(callbackUrl) ?? '/app';

  async function handleGoogleSignIn() {
    setStatus('pending');
    // Triggers a full-page redirect to Google on success; there is
    // deliberately no code after this that assumes the browser is still on
    // this page. An error here (network failure before the redirect even
    // starts) is the only case that returns control to this component.
    const result = await signIn.social({ provider: 'google', callbackURL: destination });
    if (result.error) {
      setStatus('error');
      setErrorMessage(t('googleError'));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('pending');
    setErrorMessage(null);

    const form = new FormData(event.currentTarget);
    const emailValue = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    if (isRegister) {
      const name = String(form.get('name') ?? '');
      // Unprefixed path: next-intl's own middleware (src/proxy.ts) resolves
      // it to the visitor's actual locale (cookie, then Accept-Language,
      // then default) the moment the emailed link is opened — the same
      // precedence every other unauthenticated route already follows, so
      // this does not need to duplicate that logic.
      const result = await signUp.email({
        email: emailValue,
        password,
        name,
        callbackURL: '/verify-email/complete',
      });

      if (result.error) {
        const code = result.error.code;
        if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
          // Anti-enumeration: identical outcome to a genuine signup.
          setStatus('idle');
          router.push(`/verify-email?email=${encodeURIComponent(emailValue)}`);
          return;
        }
        setStatus('error');
        setErrorMessage(mapGenericError(result.error, t('registerError'), t('rateLimitedError')));
        return;
      }

      router.push(`/verify-email?email=${encodeURIComponent(emailValue)}`);
      return;
    }

    const result = await signIn.email({ email: emailValue, password });
    if (result.error) {
      setStatus('error');
      setErrorMessage(mapGenericError(result.error, t('loginError'), t('rateLimitedError')));
      return;
    }

    router.push(destination);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled={!googleEnabled || status === 'pending'}
          aria-describedby={googleEnabled ? undefined : `${formId}-google-note`}
          onClick={handleGoogleSignIn}
        >
          <GoogleMark />
          {t('continueWithGoogle')}
        </Button>
        {googleEnabled ? null : (
          <p id={`${formId}-google-note`} className="text-muted-foreground text-center text-xs">
            {t('googleNotConnected')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">{t('or')}</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isRegister ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-name`}>{t('name')}</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              autoComplete="name"
              required
              placeholder={t('namePlaceholder')}
            />
          </div>
        ) : null}

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

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={`${formId}-password`}>{t('password')}</Label>
            {isRegister ? null : (
              <Link
                href="/forgot-password"
                className="text-muted-foreground text-xs underline underline-offset-4"
              >
                {t('forgotPasswordLink')}
              </Link>
            )}
          </div>
          <Input
            id={`${formId}-password`}
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            minLength={isRegister ? 12 : undefined}
            {...(isRegister ? { 'aria-describedby': `${formId}-password-hint` } : {})}
          />
          {isRegister ? (
            <p id={`${formId}-password-hint`} className="text-muted-foreground text-xs">
              {t('passwordHint')}
            </p>
          ) : null}
        </div>

        <Button type="submit" className="min-h-11 w-full" disabled={status === 'pending'}>
          {isRegister ? t('registerSubmit') : t('loginSubmit')}
        </Button>

        {/*
          Unconditional wrapper: a region inserted at the same moment its
          text appears is frequently missed by screen readers.
        */}
        <div aria-live="polite" role="status">
          {status === 'error' && errorMessage !== null ? (
            <div className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-4">
              <CircleAlert className="text-destructive size-5 shrink-0" aria-hidden="true" />
              <p className="text-foreground text-sm leading-relaxed">{errorMessage}</p>
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}

interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
}

function mapGenericError(
  error: AuthErrorLike,
  defaultMessage: string,
  rateLimitMessage: string,
): string {
  if (error.status === 429) {
    return rateLimitMessage;
  }
  return defaultMessage;
}

/** Inline mark so the button does not depend on a remote image. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.63 4.1-5.35 4.1-3.22 0-5.85-2.66-5.85-5.94S8.78 6.3 12 6.3c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.72 14.53 2.8 12 2.8 6.98 2.8 2.9 6.88 2.9 11.9S6.98 21 12 21c5.24 0 8.7-3.68 8.7-8.86 0-.6-.06-1.05-.15-1.5Z"
      />
    </svg>
  );
}
