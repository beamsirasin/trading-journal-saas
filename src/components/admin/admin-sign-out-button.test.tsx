import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateId } from '@/lib/identifiers';
import { createRecordingDraft } from '@/components/trades/recording-draft';
import {
  loadRecordingDraft,
  saveRecordingDraft,
  type RecordingDraftScope,
} from '@/components/trades/recording-draft-storage';

import { AdminSignOutButton } from './admin-sign-out-button';

const signOutMock = vi.fn();
const assignMock = vi.fn();

vi.mock('@/lib/auth/client', () => ({ signOut: () => signOutMock() }));

const MINE: RecordingDraftScope = { ownerKey: 'owner-a', workspaceKey: 'workspace-a' };
const SOMEONE_ELSE: RecordingDraftScope = { ownerKey: 'owner-b', workspaceKey: 'workspace-a' };

function keepDraft(scope: RecordingDraftScope, symbol: string) {
  const envelope = createRecordingDraft({
    mode: 'at_entry',
    tradingAccountId: '',
    mutationKey: generateId(),
    now: new Date(),
  });
  saveRecordingDraft(scope, { ...envelope, atEntry: { ...envelope.atEntry!, symbol } });
}

function hasDraft(scope: RecordingDraftScope) {
  return loadRecordingDraft(scope, new Date()).status === 'recovered';
}

async function signOutFromAdmin() {
  const user = userEvent.setup();
  render(<AdminSignOutButton draftOwnerKey={MINE.ownerKey} />);
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  return user;
}

beforeEach(() => {
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ data: { success: true }, error: null });
  assignMock.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  });
  window.localStorage.clear();
});

/**
 * The admin shell signs out the same person, on the same browser, holding the
 * same Add Trade drafts as the product shell — so it owes them the same
 * promise (UX Rules §5.11).
 */
describe('AdminSignOutButton — unsaved Recording Drafts', () => {
  it('signs out straight away when no draft is kept', async () => {
    await signOutFromAdmin();
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/en/login'));
  });

  it('warns first, naming the draft, and staying keeps it', async () => {
    keepDraft(MINE, 'XAUUSD');
    const user = await signOutFromAdmin();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('XAUUSD');
    expect(signOutMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(signOutMock).not.toHaveBeenCalled();
    expect(hasDraft(MINE)).toBe(true);
  });

  it('confirming signs out, then clears only this user’s drafts', async () => {
    keepDraft(MINE, 'XAUUSD');
    keepDraft(SOMEONE_ELSE, 'EURUSD');
    const user = await signOutFromAdmin();
    await user.click(await screen.findByRole('button', { name: 'Sign out and remove' }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hasDraft(MINE)).toBe(false));
    expect(hasDraft(SOMEONE_ELSE)).toBe(true);
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/en/login'));
  });

  it('keeps the draft when sign-out did not succeed', async () => {
    signOutMock.mockResolvedValue({ data: null, error: { status: 500 } });
    keepDraft(MINE, 'XAUUSD');
    const user = await signOutFromAdmin();
    await user.click(await screen.findByRole('button', { name: 'Sign out and remove' }));
    // Judged after the attempt has fully run, not before it answers.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/en/login'));
    expect(hasDraft(MINE)).toBe(true);
  });

  it('names a draft with no symbol rather than listing nothing', async () => {
    keepDraft(MINE, '');
    await signOutFromAdmin();
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('a draft with no symbol yet');
  });
});
