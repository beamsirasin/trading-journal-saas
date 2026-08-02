import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { AuthForm } from './auth-form';

const pushMock = vi.fn();
const signUpEmailMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/auth/client', () => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: (...args: unknown[]) => signUpEmailMock(...args) },
}));

function renderRegisterForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AuthForm mode="register" googleEnabled={false} />
    </NextIntlClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct-horse-battery-staple' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

/**
 * `AuthForm` has no locale-branching logic of its own — it redirects through
 * `useRouter` from `@/i18n/navigation` (next-intl's `createNavigation`),
 * which prepends whichever locale segment the CURRENT route is under. The
 * only thing this component's own code could get wrong is the RELATIVE path
 * handed to that shared wrapper (e.g. accidentally hardcoding
 * `/en/verify-email`, which would silently break under `/th/register`).
 * Asserting the exact relative target is therefore the correct unit
 * boundary: it is locale-neutral by construction, so a registration on
 * `/en/register` and one on `/th/register` push the identical relative
 * argument here, and next-intl's own (separately maintained) navigation
 * wrapper is what turns that into `/en/verify-email` or `/th/verify-email`
 * respectively.
 */
describe('AuthForm registration redirect', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signUpEmailMock.mockReset();
  });

  it('redirects to the locale-neutral verification-pending route on a successful sign-up', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    renderRegisterForm();

    fillAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(
      `/verify-email?email=${encodeURIComponent('jane@example.test')}`,
    );
  });

  it('routes an already-registered email to the same verification-pending route (anti-enumeration)', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS', status: 422 },
    });
    renderRegisterForm();

    fillAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(
      `/verify-email?email=${encodeURIComponent('jane@example.test')}`,
    );
  });
});
