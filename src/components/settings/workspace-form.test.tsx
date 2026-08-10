import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsWorkspaceSummary } from '@/server/auth/settings-dal';

import en from '../../../messages/en.json';
import { WorkspaceForm } from './workspace-form';

const refreshMock = vi.fn();
const updateWorkspaceNameActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('@/server/actions/workspace', () => ({
  updateWorkspaceNameAction: (...args: unknown[]) => updateWorkspaceNameActionMock(...args),
}));

const owner: SettingsWorkspaceSummary = {
  name: 'Personal workspace',
  kind: 'personal',
  role: 'owner',
  accessMode: 'writable',
  renameAvailability: 'available',
};

function renderWorkspace(workspace: SettingsWorkspaceSummary = owner) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WorkspaceForm workspace={workspace} />
    </NextIntlClientProvider>,
  );
}

describe('WorkspaceForm', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    updateWorkspaceNameActionMock.mockReset();
  });

  it('renders the real personal workspace and never exposes a slug field', () => {
    renderWorkspace();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Personal workspace');
    expect(screen.getByText('Personal workspace')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByLabelText(/slug/i)).not.toBeInTheDocument();
  });

  it('renames through the name-only action and refreshes canonical data', async () => {
    updateWorkspaceNameActionMock.mockResolvedValue({
      ok: true,
      data: { changed: true, name: 'Execution Lab' },
    });
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: '  Execution Lab  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save workspace' }));

    await waitFor(() =>
      expect(updateWorkspaceNameActionMock).toHaveBeenCalledWith({ name: '  Execution Lab  ' }),
    );
    expect(await screen.findByText('Workspace saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Execution Lab');
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['member', 'writable', 'owner_required', 'Only a workspace owner can rename this workspace.'],
    [
      'owner',
      'read_only',
      'read_only_workspace',
      'This workspace is read-only. Restore valid subscription access from Manage plan before renaming it.',
    ],
    [
      'owner',
      'over_limit',
      'over_limit_workspace',
      'This workspace is over its active-account allowance. Resolve the account limit or change plan before renaming it.',
    ],
  ] as const)(
    'keeps %s/%s workspace readable but non-editable',
    (role, accessMode, renameAvailability, explanation) => {
      renderWorkspace({ ...owner, role, accessMode, renameAvailability });
      expect(screen.getByLabelText('Workspace name')).toHaveValue('Personal workspace');
      expect(screen.getByLabelText('Workspace name')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Save workspace' })).not.toBeInTheDocument();
      expect(screen.getByText(explanation)).toBeInTheDocument();
    },
  );

  it('renders localized field errors with an accessible invalid state', async () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save workspace' }));
    expect(await screen.findByText('Enter a workspace name.')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace name')).toHaveAttribute('aria-invalid', 'true');
    expect(updateWorkspaceNameActionMock).not.toHaveBeenCalled();
  });
});
