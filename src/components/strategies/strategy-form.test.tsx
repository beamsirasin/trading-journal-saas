import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { StrategyFormDialog } from './strategy-form';

const createStrategyActionMock = vi.fn();
const updateStrategyActionMock = vi.fn();

vi.mock('@/server/actions/strategies', () => ({
  createStrategyAction: (...args: unknown[]) => createStrategyActionMock(...args),
  updateStrategyAction: (...args: unknown[]) => updateStrategyActionMock(...args),
}));

function renderDialog(node: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  createStrategyActionMock.mockReset();
  updateStrategyActionMock.mockReset();
});

describe('StrategyFormDialog — create', () => {
  it('blocks submission and shows an error when the name is blank', async () => {
    renderDialog(
      <StrategyFormDialog mode="create" trigger={<button>Open</button>} onSuccess={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(createStrategyActionMock).not.toHaveBeenCalled();
  });

  it('submits with a stable mutationKey across a retry within the same open dialog', async () => {
    createStrategyActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    renderDialog(
      <StrategyFormDialog mode="create" trigger={<button>Open</button>} onSuccess={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Elliott Wave + RSI' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createStrategyActionMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createStrategyActionMock).toHaveBeenCalledTimes(2));

    const firstKey = (createStrategyActionMock.mock.calls[0]?.[0] as Record<string, unknown>)
      .mutationKey;
    const secondKey = (createStrategyActionMock.mock.calls[1]?.[0] as Record<string, unknown>)
      .mutationKey;
    expect(typeof firstKey).toBe('string');
    expect(firstKey).toBe(secondKey);
  });

  it('calls onSuccess with the canonical current-Version data and closes on success', async () => {
    createStrategyActionMock.mockResolvedValue({
      ok: true,
      data: { strategyId: 's-1', versionId: 'v-1', versionNumber: 1, alreadyCreated: false },
    });
    const onSuccess = vi.fn();
    renderDialog(
      <StrategyFormDialog mode="create" trigger={<button>Open</button>} onSuccess={onSuccess} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Breakout and Retest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({
        strategyId: 's-1',
        versionId: 'v-1',
        versionNumber: 1,
        alreadyCreated: false,
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('StrategyFormDialog — edit', () => {
  const initialValues = { name: 'Momentum continuation', description: '', notes: '' };

  it('saves without a change note when the current Version is unlocked', async () => {
    updateStrategyActionMock.mockResolvedValue({
      ok: true,
      data: { strategyId: 's-1', versionId: 'v-1', versionNumber: 1, copied: false },
    });
    renderDialog(
      <StrategyFormDialog
        mode="edit"
        strategyId="s-1"
        isCurrentVersionLocked={false}
        initialValues={initialValues}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByLabelText('Change note')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateStrategyActionMock).toHaveBeenCalledTimes(1));
    const payload = updateStrategyActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.changeNote).toBeUndefined();
  });

  it('requires a change note and explains the new Version when the current Version is locked', async () => {
    renderDialog(
      <StrategyFormDialog
        mode="edit"
        strategyId="s-1"
        isCurrentVersionLocked={true}
        initialValues={initialValues}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText(/version is locked/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Change note')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('This field is required.')).not.toHaveLength(0);
    expect(updateStrategyActionMock).not.toHaveBeenCalled();
  });
});
