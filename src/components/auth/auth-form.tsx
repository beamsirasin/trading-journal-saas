'use client';

import { CircleAlert, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';

import { safeCallbackPath } from '@/lib/auth/callback-url';
import { sendVerificationEmail, signIn, signUp } from '@/lib/auth/client';
import { mapGenericError } from '@/lib/auth/client-error';
import { evaluatePasswordPolicy, evaluatePasswordStrength } from '@/lib/auth/password-policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link, useRouter } from '@/i18n/navigation';

import { PasswordRequirements } from './password-requirements';
import { PasswordStrengthMeter } from './password-strength-meter';

const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server errors that must never surface as "something went wrong": both mean
 * the account genuinely could not be created for reasons that would leak
 * account existence if described accurately — a real duplicate
 * (`USER_ALREADY_EXISTS*`, though `requireEmailVerification: true` means
 * Better Auth's own synthetic-success path almost always returns 200 instead
 * of throwing this) or the rare concurrent-signup race where a duplicate
 * insert loses to another request and Better Auth reports
 * `FAILED_TO_CREATE_USER` instead of the friendly synthetic response
 * (`src/lib/auth/server.ts`'s findings). Both route to the exact same
 * generic "check your email" outcome a genuine signup gets.
 */
const NON_ENUMERATING_SIGNUP_ERROR_CODES = new Set([
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'FAILED_TO_CREATE_USER',
]);

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
 * routed to the same generic "check your email" outcome a genuine signup
 * gets rather than surfacing Better Auth's `USER_ALREADY_EXISTS` error.
 *
 * Password policy (Phase 2.1): `evaluatePasswordPolicy`
 * (`src/lib/auth/password-policy.ts`) drives the live checklist and the
 * submit-button gate here, but is UX only — `src/lib/auth/server.ts`'s
 * `/sign-up/email` before-hook runs the identical shared policy server-side
 * and is the actual security boundary. `confirmPassword` exists only in
 * this component's local state; it is never sent to `signUp.email(...)`.
 *
 * Verification dispatch (Phase 2.1 follow-up): every ACCEPTED `signUp.email`
 * outcome (a genuine new account or the anti-enumeration synthetic-duplicate
 * response) is followed by exactly one `sendVerificationEmail(...)` call,
 * awaited before navigating — see `src/lib/auth/server.ts`'s `sendOnSignUp`
 * comment for why the automatic dispatch had to move here instead of relying
 * on Better Auth's own on-signup hook.
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

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const destination = safeCallbackPath(callbackUrl) ?? '/app';

  const policy = evaluatePasswordPolicy(password);
  const strength = evaluatePasswordStrength(password);
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const emailFormatValid = EMAIL_FORMAT_PATTERN.test(email);

  const canSubmitRegister =
    name.trim().length > 0 &&
    emailFormatValid &&
    policy.valid &&
    confirmPassword.length > 0 &&
    !passwordsMismatch;

  const submitDisabled = status === 'pending' || (isRegister && !canSubmitRegister);

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

    if (isRegister) {
      // Re-validates everything the disabled-button state already implies —
      // a keyboard Enter-to-submit or a programmatic `form.requestSubmit()`
      // can still reach here even while the button itself is disabled.
      if (!canSubmitRegister) {
        setConfirmTouched(true);
        setStatus('idle');
        return;
      }

      // `confirmPassword` is deliberately not part of this call. No
      // `callbackURL` here: `sendOnSignUp` is off (`src/lib/auth/server.ts`),
      // so a real signup no longer sends anything on its own — the
      // `sendVerificationEmail` call below is what actually dispatches, for
      // every accepted outcome, and owns the callback URL itself.
      const signUpResult = await signUp.email({ email, password, name });

      if (signUpResult.error) {
        const code = signUpResult.error.code;
        const isAcceptedDuplicateOutcome =
          code !== undefined && NON_ENUMERATING_SIGNUP_ERROR_CODES.has(code);
        if (!isAcceptedDuplicateOutcome) {
          if (code === 'WEAK_PASSWORD') {
            setStatus('error');
            setErrorMessage(t('passwordPolicyError'));
            return;
          }
          setStatus('error');
          setErrorMessage(
            mapGenericError(signUpResult.error, t('registerError'), t('rateLimitedError')),
          );
          return;
        }
        // Else: an anti-enumeration-safe duplicate/race outcome — fall
        // through to the same dispatch+navigate path a genuine signup takes.
      }

      // Reached for a genuine new signup AND for an accepted duplicate/race
      // outcome — this browser cannot tell them apart, and does not need to.
      // `sendVerificationEmail` (the same public, already anti-enumeration-safe
      // `/send-verification-email` endpoint `ResendVerificationButton` calls)
      // decides silently whether a real message goes out: yes for a
      // brand-new or still-unverified existing account, a no-op (identical
      // response shape and timing) for an already-verified one.
      const dispatchResult = await sendVerificationEmail({
        email,
        callbackURL: '/verify-email/complete',
      });

      setStatus('idle');
      const params = new URLSearchParams({ email });
      if (dispatchResult.error) {
        params.set(
          'notice',
          dispatchResult.error.status === 429 ? 'rate-limited' : 'delivery-failed',
        );
      }
      router.push(`/verify-email?${params.toString()}`);
      return;
    }

    const result = await signIn.email({ email, password });
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
              value={name}
              onChange={(event) => setName(event.target.value)}
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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
          <div className="relative">
            <Input
              id={`${formId}-password`}
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              minLength={isRegister ? 12 : undefined}
              className="pr-11"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={isRegister ? `${formId}-password-requirements` : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-11 items-center justify-center"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {isRegister ? (
            <>
              <PasswordRequirements policy={policy} id={`${formId}-password-requirements`} />
              <PasswordStrengthMeter strength={strength} password={password} />
            </>
          ) : null}
        </div>

        {isRegister ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-confirm-password`}>{t('confirmPassword')}</Label>
            <div className="relative">
              <Input
                id={`${formId}-confirm-password`}
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                className="pr-11"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                onBlur={() => setConfirmTouched(true)}
                aria-invalid={confirmTouched && passwordsMismatch}
                aria-describedby={
                  confirmTouched && passwordsMismatch
                    ? `${formId}-confirm-password-error`
                    : undefined
                }
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                aria-label={showConfirmPassword ? t('hidePassword') : t('showPassword')}
                className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-11 items-center justify-center"
              >
                {showConfirmPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {confirmTouched && passwordsMismatch ? (
              <p
                id={`${formId}-confirm-password-error`}
                role="alert"
                className="text-destructive text-xs"
              >
                {t('confirmPasswordMismatch')}
              </p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" className="min-h-11 w-full" disabled={submitDisabled}>
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
