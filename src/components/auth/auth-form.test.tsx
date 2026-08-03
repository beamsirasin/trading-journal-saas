import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { AuthForm } from './auth-form';

const pushMock = vi.fn();
const signUpEmailMock = vi.fn();
const sendVerificationEmailMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/auth/client', () => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: (...args: unknown[]) => signUpEmailMock(...args) },
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}));

const VALID_PASSWORD = 'Correct-Horse9';
const REGISTERED_EMAIL = 'jane@example.test';

function renderRegisterForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AuthForm mode="register" googleEnabled={false} />
    </NextIntlClientProvider>,
  );
}

function fillCore() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Doe' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: REGISTERED_EMAIL } });
}

function fillValidPasswords() {
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
    target: { value: VALID_PASSWORD },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: VALID_PASSWORD },
  });
}

function submitButton() {
  return screen.getByRole('button', { name: 'Create account' });
}

const EXPECTED_VERIFY_EMAIL_URL = `/verify-email?email=${encodeURIComponent(REGISTERED_EMAIL)}`;

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
    sendVerificationEmailMock.mockReset();
    sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });
  });

  it('redirects to the locale-neutral verification-pending route on a successful sign-up', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(EXPECTED_VERIFY_EMAIL_URL);
  });

  it('routes an already-registered email to the same verification-pending route (anti-enumeration)', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS', status: 422 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(EXPECTED_VERIFY_EMAIL_URL);
  });

  it('routes the rare concurrent-signup race (FAILED_TO_CREATE_USER) to the same non-enumerating outcome', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'FAILED_TO_CREATE_USER', status: 422 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(EXPECTED_VERIFY_EMAIL_URL);
  });

  it('never navigates with the password in the URL — only the email is ever passed to router.push', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const [destination] = pushMock.mock.calls[0] as [string];
    expect(destination).not.toContain(VALID_PASSWORD);
    expect(destination).not.toContain('password');
  });

  it('sends password to signUp.email but never a confirmPassword field', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(signUpEmailMock).toHaveBeenCalledTimes(1));
    const call = signUpEmailMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.password).toBe(VALID_PASSWORD);
    expect(call).not.toHaveProperty('confirmPassword');
  });

  it('shows a localized, announced error when the server rejects a weak password', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'WEAK_PASSWORD', status: 400 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    const status = await screen.findByRole('status');
    await waitFor(() =>
      expect(status).toHaveTextContent('Your password does not meet the requirements below.'),
    );
  });
});

describe('AuthForm password confirmation and strength UX', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signUpEmailMock.mockReset();
    sendVerificationEmailMock.mockReset();
    sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });
  });

  it('renders an independent confirm-password field', () => {
    renderRegisterForm();
    expect(screen.getByLabelText('Password', { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('toggles visibility of the password and confirm-password fields independently', () => {
    renderRegisterForm();
    const password = screen.getByLabelText('Password', { exact: true });
    const confirm = screen.getByLabelText('Confirm password');
    expect(password).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'password');

    const [showPasswordToggle, showConfirmToggle] = screen.getAllByRole('button', {
      name: 'Show password',
    });
    fireEvent.click(showPasswordToggle!);
    expect(password).toHaveAttribute('type', 'text');
    // The confirm-password field is unaffected by revealing the password field.
    expect(confirm).toHaveAttribute('type', 'password');

    fireEvent.click(showConfirmToggle!);
    expect(confirm).toHaveAttribute('type', 'text');
  });

  it('does not show a mismatch error before the confirm-password field has been interacted with', () => {
    renderRegisterForm();
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: VALID_PASSWORD },
    });
    expect(screen.queryByText('Passwords do not match.')).not.toBeInTheDocument();
  });

  it('shows a mismatch error after interaction, and prevents submission', async () => {
    renderRegisterForm();
    fillCore();
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: VALID_PASSWORD },
    });
    const confirm = screen.getByLabelText('Confirm password');
    fireEvent.change(confirm, { target: { value: 'DoesNotMatch9!' } });
    fireEvent.blur(confirm);

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    fireEvent.click(submitButton());
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it('permits submission once passwords match and every requirement is met', () => {
    renderRegisterForm();
    fillCore();
    fillValidPasswords();
    expect(submitButton()).not.toBeDisabled();
  });

  it('keeps the submit button disabled until every requirement passes', () => {
    renderRegisterForm();
    fillCore();
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'alllowercase' }, // fails every class except length
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'alllowercase' },
    });
    expect(submitButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: VALID_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: VALID_PASSWORD },
    });
    expect(submitButton()).not.toBeDisabled();
  });

  it('updates the requirement checklist live while typing', () => {
    renderRegisterForm();
    const password = screen.getByLabelText('Password', { exact: true });

    expect(screen.getByText('Contains an uppercase letter').closest('li')).toHaveAttribute(
      'aria-label',
      'Contains an uppercase letter: Not met yet',
    );

    fireEvent.change(password, { target: { value: VALID_PASSWORD } });

    expect(screen.getByText('Contains an uppercase letter').closest('li')).toHaveAttribute(
      'aria-label',
      'Contains an uppercase letter: Met',
    );
  });

  it('prevents double submission while a request is pending', async () => {
    let resolveSignUp: (value: { data: unknown; error: null }) => void = () => {};
    signUpEmailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignUp = resolve;
      }),
    );
    renderRegisterForm();
    fillCore();
    fillValidPasswords();

    fireEvent.click(submitButton());
    expect(submitButton()).toBeDisabled();
    fireEvent.click(submitButton());
    expect(signUpEmailMock).toHaveBeenCalledTimes(1);

    resolveSignUp({ data: {}, error: null });
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));

    // The second click while pending must not have queued a second signup
    // or a second verification-email dispatch once the first resolved.
    expect(signUpEmailMock).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Phase 2.1 follow-up: a re-registration of an existing-but-unverified email
 * must automatically get a fresh verification message, without the browser
 * ever learning whether the email was new, already registered, or already
 * verified. `src/lib/auth/server.ts`'s `sendOnSignUp` is now off, so this
 * dispatch step is the ONLY thing that ever sends one — these tests are the
 * unit-level proof of that sequencing.
 */
describe('AuthForm post-registration verification dispatch', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signUpEmailMock.mockReset();
    sendVerificationEmailMock.mockReset();
  });

  it('calls sendVerificationEmail exactly once after a genuine new signup', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(signUpEmailMock).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      email: REGISTERED_EMAIL,
      callbackURL: '/verify-email/complete',
    });
  });

  it('calls sendVerificationEmail exactly once after an accepted duplicate-signup outcome', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS', status: 422 },
    });
    sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
  });

  it('awaits sendVerificationEmail before navigating', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    let resolveDispatch: (value: { data: unknown; error: null }) => void = () => {};
    sendVerificationEmailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1));
    // The dispatch call is still pending — navigation must not have happened yet.
    expect(pushMock).not.toHaveBeenCalled();

    resolveDispatch({ data: { status: true }, error: null });
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
  });

  it('does not call sendVerificationEmail when signup itself fails with a weak password', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'WEAK_PASSWORD', status: 400 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await screen.findByRole('status');
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  it('does not call sendVerificationEmail when signup fails for any other genuine reason', async () => {
    signUpEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', status: 500 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(signUpEmailMock).toHaveBeenCalledTimes(1));
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('navigates with a rate-limited notice when the dispatch itself is rate-limited (429)', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    sendVerificationEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'TOO_MANY_REQUESTS', status: 429 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(`${EXPECTED_VERIFY_EMAIL_URL}&notice=rate-limited`);
  });

  it('navigates with a delivery-failed notice when the dispatch fails for any other reason', async () => {
    signUpEmailMock.mockResolvedValue({ data: {}, error: null });
    sendVerificationEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', status: 500 },
    });
    renderRegisterForm();

    fillCore();
    fillValidPasswords();
    fireEvent.click(submitButton());

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(`${EXPECTED_VERIFY_EMAIL_URL}&notice=delivery-failed`);
  });

  it('navigates to the same plain URL (no notice) for new, duplicate, and rate-limited-race outcomes alike', async () => {
    sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });

    for (const signUpError of [
      null,
      { code: 'USER_ALREADY_EXISTS', status: 422 },
      { code: 'FAILED_TO_CREATE_USER', status: 422 },
    ] as const) {
      pushMock.mockClear();
      signUpEmailMock.mockReset();
      signUpEmailMock.mockResolvedValue({
        data: signUpError === null ? {} : null,
        error: signUpError,
      });
      const { unmount } = renderRegisterForm();

      fillCore();
      fillValidPasswords();
      fireEvent.click(submitButton());

      await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
      expect(pushMock).toHaveBeenCalledWith(EXPECTED_VERIFY_EMAIL_URL);
      unmount();
    }
  });
});
