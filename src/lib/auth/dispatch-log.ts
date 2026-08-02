import 'server-only';

/**
 * Temporary diagnostic instrumentation for the verification/reset email
 * dispatch pipeline, added to make each stage independently observable while
 * repairing it — development only (never `test`, never `production`), and
 * never returned in any HTTP response (these are `console.info` calls only,
 * nowhere near a response body).
 *
 * Every call site logs the stage name alone, or the stage name plus a
 * whitelisted short error CODE for a failure stage — never an email address,
 * URL, token, SMTP host, credential, secret, or the raw `Error` object,
 * whose `.message` could carry any of those (e.g. a connection string in a
 * DNS/connect error).
 */
/** Exported so tests can enumerate the exact stage set without duplicating it. */
export const DISPATCH_STAGES = [
  'verification.callback.enter',
  'verification.callback.recipient-valid',
  'email.adapter.selected',
  'smtp.transport.created',
  'smtp.send.started',
  'smtp.send.succeeded',
  'smtp.send.failed',
] as const;

export type DispatchStage = (typeof DISPATCH_STAGES)[number];

/** Node/Nodemailer error codes are short, uppercase, underscore-safe identifiers — anything else collapses to "UNKNOWN" rather than risk echoing a message. */
const SAFE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,31}$/;

/** Extracts a safe-to-log identifier from an unknown thrown value — never its `.message`. */
export function sanitizeErrorCode(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && SAFE_CODE_PATTERN.test(code)) {
      return code;
    }
  }
  if (error instanceof Error && SAFE_CODE_PATTERN.test(error.name)) {
    return error.name;
  }
  return 'UNKNOWN';
}

export function logDispatchStage(stage: DispatchStage, detail?: string): void {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }
  console.info(
    detail !== undefined ? `[email:dispatch] ${stage} (${detail})` : `[email:dispatch] ${stage}`,
  );
}
