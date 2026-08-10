import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  changePasswordAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from './account-security';

const mocks = vi.hoisted(() => {
  class MockUnauthenticatedError extends Error {}
  class MockAccountSecurityError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    MockUnauthenticatedError,
    MockAccountSecurityError,
    requireSession: vi.fn(),
    changeOwnPassword: vi.fn(),
    revokeOwnOtherSession: vi.fn(),
    revokeAllOwnOtherSessions: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: 'redacted' }) }));
vi.mock('@/server/auth/dal', () => ({
  requireSession: mocks.requireSession,
  UnauthenticatedError: mocks.MockUnauthenticatedError,
}));
vi.mock('@/server/services/account-security', () => ({
  AccountSecurityError: mocks.MockAccountSecurityError,
  changeOwnPassword: mocks.changeOwnPassword,
  revokeOwnOtherSession: mocks.revokeOwnOtherSession,
  revokeAllOwnOtherSessions: mocks.revokeAllOwnOtherSessions,
}));

const userId = '0198a033-006f-7000-8000-000000000001';
const currentSessionId = '0198a033-006f-7000-8000-000000000002';

describe('account-security actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: userId }, sessionId: currentSessionId });
  });

  it('rejects unknown password fields before authentication or service work', async () => {
    const result = await changePasswordAction({
      currentPassword: 'Current1!secure',
      newPassword: 'Different2!secure',
      confirmNewPassword: 'Different2!secure',
      revokeSessions: false,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_error' } });
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.changeOwnPassword).not.toHaveBeenCalled();
  });

  it('derives the user server-side and never forwards a browser revocation-policy flag', async () => {
    mocks.changeOwnPassword.mockResolvedValue({ otherSessionsRevoked: true });
    const input = {
      currentPassword: 'Current1!secure',
      newPassword: 'Different2!secure',
      confirmNewPassword: 'Different2!secure',
    };
    await expect(changePasswordAction(input)).resolves.toEqual({
      ok: true,
      data: { otherSessionsRevoked: true },
    });
    expect(mocks.changeOwnPassword).toHaveBeenCalledWith(
      userId,
      currentSessionId,
      input,
      expect.any(Headers),
    );
  });

  it('accepts only a safe session ID and derives current-session ownership server-side', async () => {
    const targetSessionId = '0198a033-006f-7000-8000-000000000003';
    mocks.revokeOwnOtherSession.mockResolvedValue({ revoked: true });
    await expect(revokeSessionAction({ sessionId: targetSessionId })).resolves.toEqual({
      ok: true,
      data: { revoked: true },
    });
    expect(mocks.revokeOwnOtherSession).toHaveBeenCalledWith(
      userId,
      currentSessionId,
      targetSessionId,
      expect.any(Headers),
    );
    expect(
      await revokeSessionAction({ sessionId: targetSessionId, token: 'forged' }),
    ).toMatchObject({ ok: false, error: { code: 'validation_error' } });
  });

  it('allows no browser-selected victim list for bulk revocation', async () => {
    mocks.revokeAllOwnOtherSessions.mockResolvedValue({ revokedCount: 2 });
    await expect(revokeOtherSessionsAction({})).resolves.toEqual({
      ok: true,
      data: { revokedCount: 2 },
    });
    expect(mocks.revokeAllOwnOtherSessions).toHaveBeenCalledWith(
      userId,
      currentSessionId,
      expect.any(Headers),
    );
    expect(await revokeOtherSessionsAction({ sessionIds: [currentSessionId] })).toMatchObject({
      ok: false,
      error: { code: 'validation_error' },
    });
  });

  it('returns the established safe unauthenticated result', async () => {
    mocks.requireSession.mockRejectedValue(new mocks.MockUnauthenticatedError());
    expect(
      await revokeSessionAction({ sessionId: '0198a033-006f-7000-8000-000000000003' }),
    ).toEqual({ ok: false, error: { code: 'unauthenticated' } });
  });
});
