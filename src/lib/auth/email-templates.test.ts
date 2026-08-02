import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { buildPasswordResetEmail, buildVerificationEmail, escapeHtml, resolveSupportedEmailLocale } =
  await import('./email-templates');

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<script>&"'</script>`)).toBe(
      '&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;',
    );
  });
});

describe('resolveSupportedEmailLocale', () => {
  it('accepts en and th, and falls back to en for anything else', () => {
    expect(resolveSupportedEmailLocale('en')).toBe('en');
    expect(resolveSupportedEmailLocale('th')).toBe('th');
    expect(resolveSupportedEmailLocale(undefined)).toBe('en');
    expect(resolveSupportedEmailLocale('fr')).toBe('en');
    expect(resolveSupportedEmailLocale('')).toBe('en');
  });
});

describe('buildVerificationEmail', () => {
  const url = 'https://app.test/verify?token=abc123';

  it('includes the raw url in the plain-text body and the escaped url as the HTML href', () => {
    const email = buildVerificationEmail(url, 'en');
    expect(email.text).toContain(url);
    expect(email.html).toContain(`href="${url}"`);
    expect(email.subject).toBe('Verify your email — Trading OS');
  });

  it('renders Thai copy for the th locale', () => {
    const email = buildVerificationEmail(url, 'th');
    expect(email.subject).toContain('ยืนยัน');
    expect(email.text).toContain(url);
  });

  it('mentions ignoring the email if the account was not requested', () => {
    const email = buildVerificationEmail(url, 'en');
    expect(email.text.toLowerCase()).toContain('ignore');
  });

  it('rejects a non-HTTP(S) action url', () => {
    expect(() => buildVerificationEmail('javascript:alert(1)', 'en')).toThrow();
  });
});

describe('buildPasswordResetEmail', () => {
  const url = 'https://app.test/reset-password?token=xyz789';

  it('includes the raw url in the plain-text body and the escaped url as the HTML href', () => {
    const email = buildPasswordResetEmail(url, 'en');
    expect(email.text).toContain(url);
    expect(email.html).toContain(`href="${url}"`);
    expect(email.subject).toBe('Reset your password — Trading OS');
  });

  it('mentions that the password will not change if the email is ignored', () => {
    const email = buildPasswordResetEmail(url, 'en');
    expect(email.text.toLowerCase()).toContain('not change');
  });
});
