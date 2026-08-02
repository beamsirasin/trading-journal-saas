import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ConsoleEmailAdapter } = await import('./email');

describe('ConsoleEmailAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never writes recipient addresses or bearer links to development logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new ConsoleEmailAdapter();
    const email = 'private@example.test';
    const url = 'http://localhost/verify?token=verification-secret';

    await adapter.sendVerificationEmail({ to: email, url });
    await adapter.sendPasswordResetEmail({ to: email, url });

    const output = warn.mock.calls.flat().join(' ');
    expect(output).not.toContain(email);
    expect(output).not.toContain(url);
    expect(output).not.toContain('verification-secret');
  });
});
