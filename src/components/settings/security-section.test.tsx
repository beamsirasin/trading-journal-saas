import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountSecurityView } from '@/server/auth/account-security-dal';

import en from '../../../messages/en.json';
import { SecuritySection } from './security-section';

const refreshMock = vi.fn();
const changePasswordActionMock = vi.fn();
const revokeSessionActionMock = vi.fn();
const revokeOtherSessionsActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('@/server/actions/account-security', () => ({
  changePasswordAction: (...args: unknown[]) => changePasswordActionMock(...args),
  revokeSessionAction: (...args: unknown[]) => revokeSessionActionMock(...args),
  revokeOtherSessionsAction: (...args: unknown[]) => revokeOtherSessionsActionMock(...args),
}));

const currentSessionId = '0198a033-006f-7000-8000-000000000001';
const otherSessionId = '0198a033-006f-7000-8000-000000000002';
const credentialSecurity: AccountSecurityView = {
  providers: ['email_password'],
  canChangePassword: true,
  sessions: [
    {
      sessionId: currentSessionId,
      isCurrent: true,
      createdAt: '2026-08-10T01:00:00.000Z',
      expiresAt: '2026-08-17T01:00:00.000Z',
      agentLabel: 'chrome_windows',
    },
    {
      sessionId: otherSessionId,
      isCurrent: false,
      createdAt: '2026-08-09T01:00:00.000Z',
      expiresAt: '2026-08-16T01:00:00.000Z',
      agentLabel: 'browser',
    },
  ],
};

function renderSecurity(security: AccountSecurityView = credentialSecurity) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <SecuritySection security={security} timezone="UTC" />
    </NextIntlClientProvider>,
  );
}

describe('SecuritySection', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    changePasswordActionMock.mockReset();
    revokeSessionActionMock.mockReset();
    revokeOtherSessionsActionMock.mockReset();
  });

  it('shows only safe methods and password-manager-compatible credential fields', () => {
    const { container } = renderSecurity();
    expect(screen.getByText('Email/password')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
    expect(container.textContent).not.toMatch(/accessToken|refreshToken|idToken|IP address:\s*\d/i);
    expect(
      screen.queryByRole('button', { name: /disconnect|unlink|change email|set password/i }),
    ).toBeNull();
    expect(screen.queryByRole('heading', { name: /danger zone/i })).toBeNull();
  });

  it('omits password controls for an OAuth-only account and names the provider truthfully', () => {
    renderSecurity({ ...credentialSecurity, providers: ['google'], canChangePassword: false });
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(screen.getByText(/currently signs in through a linked provider/i)).toBeInTheDocument();
  });

  it('clears password fields and reconciles other sessions after canonical success', async () => {
    changePasswordActionMock.mockResolvedValue({
      ok: true,
      data: { otherSessionsRevoked: true },
    });
    renderSecurity();
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'Current1!secure' },
    });
    fireEvent.change(screen.getByLabelText(/^New password$/), {
      target: { value: 'Different2!secure' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Different2!secure' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('Password changed. Other sessions have been signed out.'),
    ).toBeInTheDocument();
    expect(changePasswordActionMock).toHaveBeenCalledWith({
      currentPassword: 'Current1!secure',
      newPassword: 'Different2!secure',
      confirmNewPassword: 'Different2!secure',
    });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText(/^New password$/)).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Sign out: Web browser/i })).toBeNull();
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('labels the current session without rendering a current-session revoke control', () => {
    renderSecurity();
    expect(screen.getByText('This session')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Sign out: Chrome on Windows/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out: Web browser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out other sessions' })).toBeInTheDocument();
  });

  it('revokes only the selected safe session ID after confirmation', async () => {
    revokeSessionActionMock.mockResolvedValue({ ok: true, data: { revoked: true } });
    renderSecurity();
    fireEvent.click(screen.getByRole('button', { name: /Sign out: Web browser/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Sign out$/ }));
    await waitFor(() =>
      expect(revokeSessionActionMock).toHaveBeenCalledWith({ sessionId: otherSessionId }),
    );
    expect(revokeSessionActionMock).not.toHaveBeenCalledWith({ sessionId: currentSessionId });
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('shows the factual no-other-session state without a disabled bulk button', () => {
    renderSecurity({ ...credentialSecurity, sessions: [credentialSecurity.sessions[0]!] });
    expect(screen.getByText('No other active sessions.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out other sessions' })).toBeNull();
  });
});
