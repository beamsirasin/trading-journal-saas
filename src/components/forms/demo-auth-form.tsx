'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Login and registration, as a visual prototype.
 *
 * NO AUTHENTICATION EXISTS. Nothing is sent anywhere, no session is created,
 * and no credential is stored — not even in memory beyond the input element.
 *
 * The honest-behaviour rules this component follows:
 *
 *   - Submitting does NOT pretend to succeed. It reveals a status message
 *     saying authentication is not built, announced via `aria-live` so it
 *     reaches a screen reader rather than only appearing on screen.
 *   - The submit button stays ENABLED and the fields stay real, so the form
 *     is genuinely keyboard-operable and native validation demonstrates the
 *     interaction. A disabled form cannot be evaluated.
 *   - The Google button is `disabled` and labelled "Coming in Phase 2".
 *     Google OAuth is not configured; a button that opened nothing, or worse
 *     a fake consent screen, would be a lie about the product's state.
 *
 * Validation is native HTML (`required`, `type="email"`, `minLength`). React
 * Hook Form would be a dependency added for a form that submits nowhere —
 * it earns its place when there is a server action to submit to.
 */
export function DemoAuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [submitted, setSubmitted] = useState(false);
  const formId = useId();
  const isRegister = mode === 'register';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Nothing is read off the form. The event is intercepted purely to stop
    // the browser navigating to a nonexistent endpoint.
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          disabled
          aria-describedby={`${formId}-google-note`}
        >
          <GoogleMark />
          Continue with Google
        </Button>
        <p id={`${formId}-google-note`} className="text-muted-foreground text-center text-xs">
          Google sign-in is not connected yet — coming in Phase 2.
        </p>
      </div>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">or</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <form onSubmit={handleSubmit} noValidate={false} className="flex flex-col gap-4">
        {isRegister ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              autoComplete="name"
              required
              placeholder="Alex Chen"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-email`}>Email</Label>
          <Input
            id={`${formId}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={`${formId}-password`}>Password</Label>
            {isRegister ? null : (
              <span className="text-muted-foreground text-xs">Reset arrives with Phase 2</span>
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
              At least 12 characters.
            </p>
          ) : null}
        </div>

        <Button type="submit" className="min-h-11 w-full">
          {isRegister ? 'Preview account creation' : 'Preview login'}
        </Button>

        {/*
          `aria-live="polite"` with the region always present in the DOM.
          A region inserted at the same moment its text appears is frequently
          missed by screen readers, which is why the wrapper is unconditional
          and only its contents change.
        */}
        <div aria-live="polite" role="status">
          {submitted ? (
            <div className="border-info/30 bg-info/10 flex gap-3 rounded-lg border p-4">
              <CircleAlert className="text-info size-5 shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-1 text-sm leading-relaxed">
                <p className="text-foreground font-medium">Nothing was submitted</p>
                <p className="text-muted-foreground">
                  This is a design preview. Authentication, accounts and sessions arrive in Phase 2
                  — no data left your browser and no account was created. You can{' '}
                  <Link
                    href="/demo"
                    prefetch={false}
                    className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
                  >
                    explore the demo dashboard
                  </Link>{' '}
                  in the meantime.
                </p>
              </div>
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
