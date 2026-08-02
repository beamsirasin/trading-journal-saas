import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { ResendVerificationButton } from './resend-verification-button';

const sendVerificationEmailMock = vi.fn();

vi.mock('@/lib/auth/client', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
}));

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResendVerificationButton email="jane@example.test" />
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
});
