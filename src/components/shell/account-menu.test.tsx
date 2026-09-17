import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateId } from '@/lib/identifiers';
import { createRecordingDraft } from '@/components/trades/recording-draft';
import {
  loadRecordingDraft,
  saveRecordingDraft,
  type RecordingDraftScope,
} from '@/components/trades/recording-draft-storage';

import en from '../../../messages/en.json';
import { AccountMenu } from './account-menu';

const pushMock = vi.fn();
const signOutMock = vi.fn();

function MockLink({
  href,
  children,
  ref,
  ...rest
}: { href: string; children?: ReactNode; ref?: Ref<HTMLAnchorElement> } & Record<string, unknown>) {
  return (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  );
}

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  Link: MockLink,
}));
vi.mock('@/lib/auth/client', () => ({ signOut: () => signOutMock() }));
vi.mock('./language-switcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('@/components/theme/theme-toggle', () => ({ ThemeToggle: () => null }));

const MINE: RecordingDraftScope = { ownerKey: 'owner-a', workspaceKey: 'workspace-a' };
const SOMEONE_ELSE: RecordingDraftScope = { ownerKey: 'owner-b', workspaceKey: 'workspace-a' };
const copy = en.appNav.account.signOutDraft;

function keepDraft(scope: RecordingDraftScope, symbol: string) {
  const envelope = createRecordingDraft({
    mode: 'at_entry',
    tradingAccountId: '',
    mutationKey: generateId(),
    now: new Date(),
  });
  saveRecordingDraft(scope, {
    ...envelope,
    atEntry: { ...envelope.atEntry!, symbol },
  });
}

function hasDraft(scope: RecordingDraftScope) {
  return loadRecordingDraft(scope, new Date()).status === 'recovered';
}

async function chooseLogOut() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AccountMenu
        user={{ name: 'Test Trader', email: 'trader@example.com', image: null }}
        draftOwnerKey={MINE.ownerKey}
      />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: en.appNav.account.menuLabel }));
  await user.click(await screen.findByRole('menuitem', { name: en.appNav.account.logout }));
  return user;
}

beforeEach(() => {
  pushMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ data: { success: true }, error: null });
  window.localStorage.clear();
});

describe('AccountMenu — sign-out and unsaved Recording Drafts', () => {
  it('signs out straight away when no draft is kept', async () => {
    await chooseLogOut();
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('warns first, naming the draft, and staying keeps it', async () => {
    keepDraft(MINE, 'XAUUSD');
    const user = await chooseLogOut();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('XAUUSD');
    expect(signOutMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: copy.stay }));
    expect(signOutMock).not.toHaveBeenCalled();
    expect(hasDraft(MINE)).toBe(true);
  });

  it('confirming signs out, then clears only this user drafts', async () => {
    keepDraft(MINE, 'XAUUSD');
    keepDraft(SOMEONE_ELSE, 'EURUSD');
    const user = await chooseLogOut();
    await user.click(await screen.findByRole('button', { name: copy.confirm }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hasDraft(MINE)).toBe(false));
    expect(hasDraft(SOMEONE_ELSE)).toBe(true);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('keeps the draft when sign-out did not succeed', async () => {
    signOutMock.mockResolvedValue({ data: null, error: { status: 500 } });
    keepDraft(MINE, 'XAUUSD');
    const user = await chooseLogOut();
    await user.click(await screen.findByRole('button', { name: copy.confirm }));
    // Judged after the sign-out attempt has fully run, not before it answers.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(hasDraft(MINE)).toBe(true);
  });
});
