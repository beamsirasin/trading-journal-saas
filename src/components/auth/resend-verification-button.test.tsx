import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { ResendVerificationButton } from './resend-verification-button';

const sendVerificationEmailMock = vi.fn();

vi.mock('@/lib/auth/client', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}));

function renderButton(
  props: Partial<Omit<Parameters<typeof ResendVerificationButton>[0], 'email'>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResendVerificationButton email="jane@example.test" {...props} />
    </NextIntlClientProvider>,
  );
}

describe('ResendVerificationButton', () => {
  beforeEach(() => {
    sendVerificationEmailMock.mockReset();
  });

  it('shows the success message and calls the real endpoint with the registered email', async () => {
    sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));

    await waitFor(() => screen.getByText('Verification email sent.'));
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      email: 'jane@example.test',
      callbackURL: '/verify-email/complete',
    });
  });

  /**
   * Regression test: this button used to `await` the result and unconditionally
   * flip to "sent" regardless of `result.error`, so a failed SMTP delivery
   * (Mailpit down, adapter throwing) still told the user an email was on its
   * way. It must now show a truthful, retryable failure state instead.
   */
  it('shows a truthful failure message instead of a false success when delivery fails', async () => {
    sendVerificationEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'INTERNAL_SERVER_ERROR', status: 500 },
    });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));

    await waitFor(() => screen.getByText('Something went wrong. Please try again.'));
    expect(screen.queryByText('Verification email sent.')).not.toBeInTheDocument();
  });

  it('shows the rate-limited message on a 429, and the button remains available to retry', async () => {
    sendVerificationEmailMock.mockResolvedValue({
      data: null,
      error: { code: 'TOO_MANY_REQUESTS', status: 429 },
    });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));

    await waitFor(() => screen.getByText('Too many attempts. Please wait a moment and try again.'));
    expect(screen.getByRole('button', { name: 'Resend email' })).not.toBeDisabled();
  });

  /**
   * `AuthForm` (`src/components/auth/auth-form.tsx`) seeds this state via the
   * `notice` query param after its own post-registration dispatch attempt —
   * these tests exercise the seeded state directly, independent of that flow.
   */
  describe('seeded from a registration-time dispatch notice', () => {
    it('starts disabled with the rate-limited message for `initialNotice="rate-limited"`', () => {
      renderButton({ initialNotice: 'rate-limited' });

      expect(
        screen.getByText(
          'Too many verification emails were requested. Please wait a moment and try again.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resend email' })).toBeDisabled();
      expect(sendVerificationEmailMock).not.toHaveBeenCalled();
    });

    it('shows the delivery-failed message but keeps the button clickable for `initialNotice="delivery-failed"`', () => {
      renderButton({ initialNotice: 'delivery-failed' });

      expect(
        screen.getByText("We couldn't send the verification email yet. Please try again."),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resend email' })).not.toBeDisabled();
    });

    it('renders normally, with no notice and an enabled button, when no `initialNotice` is given', () => {
      renderButton();

      expect(screen.getByRole('button', { name: 'Resend email' })).not.toBeDisabled();
      expect(
        screen.queryByText(
          'Too many verification emails were requested. Please wait a moment and try again.',
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("We couldn't send the verification email yet. Please try again."),
      ).not.toBeInTheDocument();
    });

    it('lets a manual click succeed and clear the seeded delivery-failed notice', async () => {
      sendVerificationEmailMock.mockResolvedValue({ data: { status: true }, error: null });
      renderButton({ initialNotice: 'delivery-failed' });

      fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));

      await waitFor(() => screen.getByText('Verification email sent.'));
      expect(
        screen.queryByText("We couldn't send the verification email yet. Please try again."),
      ).not.toBeInTheDocument();
    });
  });
});
