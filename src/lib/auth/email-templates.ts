import 'server-only';

/**
 * Bilingual content for the two auth emails Better Auth triggers
 * (`src/lib/auth/server.ts`'s `sendVerificationEmail`/`sendResetPassword`).
 *
 * Deliberately separate from `src/i18n/` (next-intl): that catalog renders
 * React trees for the UI, while this renders a static plain-text/HTML pair
 * for an email client. Reusing next-intl here would mean the message loader
 * and every future email now shares one namespace with page copy for no
 * benefit — two unrelated rendering targets that happen to both be
 * "strings" is not the two-call-sites case that would justify sharing.
 */
export type SupportedEmailLocale = 'en' | 'th';

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface EmailCopy {
  readonly subject: string;
  readonly heading: string;
  readonly intro: string;
  readonly cta: string;
  readonly expiry: string;
  readonly ignore: string;
}

const COPY: Record<SupportedEmailLocale, { verification: EmailCopy; passwordReset: EmailCopy }> = {
  en: {
    verification: {
      subject: 'Verify your email — Trading OS',
      heading: 'Verify your email',
      intro:
        'Click the button below to verify your email address and finish setting up your Trading OS account.',
      cta: 'Verify email',
      expiry: 'This link expires soon and can only be used once.',
      ignore: 'If you did not create this account, you can safely ignore this email.',
    },
    passwordReset: {
      subject: 'Reset your password — Trading OS',
      heading: 'Reset your password',
      intro: 'Click the button below to choose a new password for your Trading OS account.',
      cta: 'Reset password',
      expiry: 'This link expires soon and can only be used once.',
      ignore:
        'If you did not request a password reset, you can safely ignore this email — your password will not change.',
    },
  },
  th: {
    verification: {
      subject: 'ยืนยันอีเมลของคุณ — Trading OS',
      heading: 'ยืนยันอีเมลของคุณ',
      intro: 'คลิกปุ่มด้านล่างเพื่อยืนยันอีเมลและตั้งค่าบัญชี Trading OS ของคุณให้เสร็จสมบูรณ์',
      cta: 'ยืนยันอีเมล',
      expiry: 'ลิงก์นี้จะหมดอายุในไม่ช้าและใช้ได้เพียงครั้งเดียว',
      ignore: 'หากคุณไม่ได้สร้างบัญชีนี้ คุณสามารถละเว้นอีเมลฉบับนี้ได้อย่างปลอดภัย',
    },
    passwordReset: {
      subject: 'รีเซ็ตรหัสผ่านของคุณ — Trading OS',
      heading: 'รีเซ็ตรหัสผ่านของคุณ',
      intro: 'คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่สำหรับบัญชี Trading OS ของคุณ',
      cta: 'รีเซ็ตรหัสผ่าน',
      expiry: 'ลิงก์นี้จะหมดอายุในไม่ช้าและใช้ได้เพียงครั้งเดียว',
      ignore:
        'หากคุณไม่ได้ร้องขอการรีเซ็ตรหัสผ่าน คุณสามารถละเว้นอีเมลฉบับนี้ได้อย่างปลอดภัย รหัสผ่านของคุณจะไม่ถูกเปลี่ยน',
    },
  },
};

/** Documented fallback per the task brief: used whenever a locale is absent or unrecognized. */
export const FALLBACK_EMAIL_LOCALE: SupportedEmailLocale = 'en';

export function resolveSupportedEmailLocale(candidate: string | undefined): SupportedEmailLocale {
  return candidate === 'en' || candidate === 'th' ? candidate : FALLBACK_EMAIL_LOCALE;
}

/** Escapes the five HTML-significant characters. Applied to every value interpolated into the HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Rejects anything that is not a well-formed, absolute `http(s)` URL. Better
 * Auth generates this URL itself (never client input), but validating it
 * here means a future regression upstream fails loudly here rather than
 * rendering a broken or unsafe link.
 */
function assertSafeActionUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Refusing to render an email action link with a non-HTTP(S) protocol.');
  }
  return url;
}

function render(copy: EmailCopy, url: string): RenderedEmail {
  const safeUrl = assertSafeActionUrl(url);
  const escapedUrl = escapeHtml(safeUrl);

  const text = [copy.heading, '', copy.intro, '', safeUrl, '', copy.expiry, copy.ignore].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
            <tr><td style="font-size:20px;font-weight:600;color:#0f172a;padding-bottom:16px;">${escapeHtml(copy.heading)}</td></tr>
            <tr><td style="font-size:14px;line-height:1.6;color:#334155;padding-bottom:24px;">${escapeHtml(copy.intro)}</td></tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${escapedUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">${escapeHtml(copy.cta)}</a>
              </td>
            </tr>
            <tr><td style="font-size:12px;line-height:1.6;color:#64748b;padding-bottom:8px;">${escapeHtml(copy.expiry)}</td></tr>
            <tr><td style="font-size:12px;line-height:1.6;color:#64748b;">${escapeHtml(copy.ignore)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: copy.subject, text, html };
}

export function buildVerificationEmail(url: string, locale: SupportedEmailLocale): RenderedEmail {
  return render(COPY[locale].verification, url);
}

export function buildPasswordResetEmail(url: string, locale: SupportedEmailLocale): RenderedEmail {
  return render(COPY[locale].passwordReset, url);
}
