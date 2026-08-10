import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TimezoneForm } from './timezone-form';

const refreshMock = vi.fn();
const updateTimezoneMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('@/server/actions/preferences', () => ({
  updateTimezonePreferenceAction: (...args: unknown[]) => updateTimezoneMock(...args),
}));

function renderTimezone() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TimezoneForm initialTimezone="Asia/Bangkok" />
    </NextIntlClientProvider>,
  );
}

describe('TimezoneForm', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    updateTimezoneMock.mockReset();
  });

  it('shows the canonical timezone and explanatory semantics', () => {
    renderTimezone();
    expect(screen.getByLabelText('Timezone')).toHaveValue('Asia/Bangkok');
    expect(screen.getByText(/Stored historical timestamps are not changed/)).toBeInTheDocument();
  });

  it('rejects invalid arbitrary text before calling the server', () => {
    renderTimezone();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Mars/Olympus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save timezone' }));
    expect(screen.getByText('Choose a valid IANA timezone.')).toBeInTheDocument();
    expect(updateTimezoneMock).not.toHaveBeenCalled();
  });

  it('persists a valid timezone and refreshes server data', async () => {
    updateTimezoneMock.mockResolvedValue({
      ok: true,
      data: { changed: true, changedFields: ['timezone'] },
    });
    renderTimezone();
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Europe/London' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save timezone' }));

    await waitFor(() =>
      expect(updateTimezoneMock).toHaveBeenCalledWith({ timezone: 'Europe/London' }),
    );
    expect(await screen.findByText('Timezone saved.')).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});
