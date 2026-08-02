import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { DISPATCH_STAGES, logDispatchStage, sanitizeErrorCode } = await import('./dispatch-log');

it('defines exactly the seven required dispatch stages', () => {
  expect(DISPATCH_STAGES).toEqual([
    'verification.callback.enter',
    'verification.callback.recipient-valid',
    'email.adapter.selected',
    'smtp.transport.created',
    'smtp.send.started',
    'smtp.send.succeeded',
    'smtp.send.failed',
  ]);
});

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string): void {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

describe('logDispatchStage', () => {
  afterEach(() => {
    setNodeEnv(originalNodeEnv);
    vi.restoreAllMocks();
  });

  it('logs the stage name in development', () => {
    setNodeEnv('development');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logDispatchStage('verification.callback.enter');

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toContain('verification.callback.enter');
  });

  it('logs the stage name plus a detail string when provided', () => {
    setNodeEnv('development');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logDispatchStage('email.adapter.selected', 'SmtpEmailAdapter');

    expect(info.mock.calls[0]?.[0]).toContain('email.adapter.selected');
    expect(info.mock.calls[0]?.[0]).toContain('SmtpEmailAdapter');
  });

  it('never logs anything in test', () => {
    setNodeEnv('test');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logDispatchStage('smtp.send.started');

    expect(info).not.toHaveBeenCalled();
  });

  it('never logs anything in production', () => {
    setNodeEnv('production');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logDispatchStage('smtp.send.failed', 'ECONNREFUSED');

    expect(info).not.toHaveBeenCalled();
  });
});

describe('sanitizeErrorCode', () => {
  it('extracts a whitelisted short error.code', () => {
    expect(sanitizeErrorCode({ code: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
    expect(sanitizeErrorCode({ code: 'ETIMEDOUT' })).toBe('ETIMEDOUT');
  });

  it('falls back to the error name when code is absent but the name is safe', () => {
    expect(sanitizeErrorCode(new Error('connection refused to 127.0.0.1:1025'))).toBe('Error');

    class SmtpAuthError extends Error {
      override name = 'SmtpAuthError';
    }
    expect(sanitizeErrorCode(new SmtpAuthError('bad credentials'))).toBe('SmtpAuthError');
  });

  it('never leaks the error message, only a code or "UNKNOWN"', () => {
    const sensitive = new Error(
      'ECONNREFUSED 127.0.0.1:1025 user=admin pass=hunter2 recipient=victim@example.test',
    );
    const result = sanitizeErrorCode(sensitive);
    expect(result).toBe('Error');
    expect(result).not.toContain('127.0.0.1');
    expect(result).not.toContain('hunter2');
    expect(result).not.toContain('victim@example.test');
  });

  it('returns UNKNOWN for a code that does not match the safe pattern', () => {
    expect(sanitizeErrorCode({ code: 'contains a real host 127.0.0.1 and : chars' })).toBe(
      'UNKNOWN',
    );
    expect(sanitizeErrorCode({ code: 123 })).toBe('UNKNOWN');
    expect(sanitizeErrorCode('a plain string, not an object')).toBe('UNKNOWN');
    expect(sanitizeErrorCode(undefined)).toBe('UNKNOWN');
    expect(sanitizeErrorCode(null)).toBe('UNKNOWN');
  });
});
