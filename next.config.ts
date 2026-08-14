import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Phase 12B security-header baseline. Applied to every route via a single
 * blanket matcher — nothing in this app needs a relaxed policy for a subset
 * of routes (no route is ever framed by this app or anyone else, no route
 * uses camera/microphone/geolocation/payment browser APIs), so one rule set
 * covers public pages, `/app/*`, `/admin`, auth pages, and API routes alike.
 *
 * `Content-Security-Policy-Report-Only` is deliberately not enforcing: the
 * `next-themes` flash-prevention script (`src/components/theme/theme-provider.tsx`)
 * is a blocking inline script with no nonce wiring today, and a future real
 * payment provider's script/frame requirements are unknown — enforcing a
 * policy now would either break theming or need rewriting the moment a
 * provider is chosen. Report-Only observes real violations (in-browser
 * devtools; no report endpoint exists yet) without breaking anything,
 * establishing the target shape for a later nonce-based enforcing policy.
 * See docs/deployment-checklist.md's "Security headers" section.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deliberately minimal, deny-by-default allowlist: nothing in this app
  // uses any of these browser APIs today, so there is nothing to allow.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
  // Only in a production build/start (never `next dev`, so plain localhost
  // HTTP never carries this header). Harmless if a hosting layer also sets
  // it — browsers ignore a duplicate identical directive — but this has not
  // been verified against a live deployment; see docs/deployment-checklist.md.
  // `max-age` only: no `preload` (irreversible without a domain submission
  // decision) and no `includeSubDomains` (no subdomain inventory exists yet).
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
    : []),
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * Founder review (Trade Plan UX correction slice, chart upload):
       * Next.js Server Actions default to a 1 MB request-body limit, and
       * Vercel Functions independently cap every request body at 4.5 MB —
       * whichever is smaller wins in production. `CHART_ATTACHMENT_MAX_BYTES`
       * (`src/lib/storage/chart-attachment.ts`) is 3 MB; `multipart/form-data`
       * framing for a single file field adds only boundary/header bytes
       * (well under 1 KB), not base64-style ~37% inflation, so 3.5 MB leaves
       * comfortable headroom for that overhead while staying safely under
       * Vercel's 4.5 MB ceiling. Chosen over a client-direct-to-Blob
       * upload-token flow (Vercel Blob's other supported pattern) because a
       * 3 MB chart-screenshot ceiling does not warrant that added
       * architecture — the smaller, simpler option (CLAUDE.md "avoid
       * premature abstractions").
       */
      bodySizeLimit: '3.5mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
