import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { ProfileForm } from './profile-form';

const refreshMock = vi.fn();
const updateDisplayNameActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('@/server/actions/profile', () => ({
  updateDisplayNameAction: (...args: unknown[]) => updateDisplayNameActionMock(...args),
}));

const profile = {
  name: 'E2E User A',
  email: 'e2e-user-a@example.test',
  emailVerified: true,
  image: null,
  providers: ['email_password', 'google'] as const,
};

function renderProfile() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProfileForm profile={profile} />
    </NextIntlClientProvider>,
  );
}

describe('ProfileForm', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    updateDisplayNameActionMock.mockReset();
  });

  it('renders real safe identity fields, linked methods, and initials fallback', () => {
    renderProfile();
    expect(screen.getByLabelText('Display name')).toHaveValue('E2E User A');
    expect(screen.getAllByText('e2e-user-a@example.test')).toHaveLength(2);
    expect(screen.queryByDisplayValue('e2e-user-a@example.test')).not.toBeInTheDocument();
    expect(screen.getByText('Email/password')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByLabelText('Initials for E2E User A')).toHaveTextContent('EU');
    expect(document.body.textContent).not.toMatch(/credential|accessToken|refreshToken|providerId/);
  });

  it('saves a normalized display name and refreshes canonical shell data', async () => {
    updateDisplayNameActionMock.mockResolvedValue({
      ok: true,
      data: { changed: true, name: 'Ada Lovelace' },
    });
    renderProfile();
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: '  Ada Lovelace  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(updateDisplayNameActionMock).toHaveBeenCalledWith({ name: '  Ada Lovelace  ' }),
    );
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it('renders localized server field errors and does not refresh', async () => {
    updateDisplayNameActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'validation_error', fieldErrors: { name: ['too_long'] } },
    });
    renderProfile();
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Valid locally' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(
      await screen.findByText('Display name must be 80 characters or fewer.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'true');
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
