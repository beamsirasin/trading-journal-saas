import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { SetupFormDialog } from './setup-form';

const createSetupActionMock = vi.fn();
const updateSetupActionMock = vi.fn();

vi.mock('@/server/actions/strategies', () => ({
  createSetupAction: (...args: unknown[]) => createSetupActionMock(...args),
  updateSetupAction: (...args: unknown[]) => updateSetupActionMock(...args),
}));

function renderDialog(node: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  createSetupActionMock.mockReset();
  updateSetupActionMock.mockReset();
});

describe('SetupFormDialog — create', () => {
  it('submits with a stable mutationKey across a retry', async () => {
    createSetupActionMock.mockResolvedValue({ ok: false, error: { code: 'unexpected_error' } });
    renderDialog(
      <SetupFormDialog
        mode="create"
        strategyId="s-1"
        isCurrentVersionLocked={false}
        defaultSortOrder={0}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wave 2 Reversal' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSetupActionMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSetupActionMock).toHaveBeenCalledTimes(2));

    const first = (createSetupActionMock.mock.calls[0]?.[0] as Record<string, unknown>).mutationKey;
    const second = (createSetupActionMock.mock.calls[1]?.[0] as Record<string, unknown>)
      .mutationKey;
    expect(first).toBe(second);
    expect((createSetupActionMock.mock.calls[0]?.[0] as Record<string, unknown>).strategyId).toBe(
      's-1',
    );
  });

  it('requires a change note when the parent Strategy Version is locked', async () => {
    renderDialog(
      <SetupFormDialog
        mode="create"
        strategyId="s-1"
        isCurrentVersionLocked={true}
        defaultSortOrder={0}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wave 3 Continuation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(createSetupActionMock).not.toHaveBeenCalled();
  });
});

describe('SetupFormDialog — edit', () => {
  it('consumes the canonical current-Version result on success', async () => {
    updateSetupActionMock.mockResolvedValue({
      ok: true,
      data: {
        strategyId: 's-1',
        setupId: 'set-1',
        versionId: 'v-2',
        versionNumber: 2,
        copied: true,
      },
    });
    const onSuccess = vi.fn();
    renderDialog(
      <SetupFormDialog
        mode="edit"
        strategyId="s-1"
        setupId="set-1"
        isCurrentVersionLocked={false}
        initialValues={{ name: 'Wave 2 Reversal', description: '', sortOrder: '0' }}
        trigger={<button>Open</button>}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        strategyId: 's-1',
        setupId: 'set-1',
        versionId: 'v-2',
        versionNumber: 2,
        copied: true,
      }),
    );
  });
});
