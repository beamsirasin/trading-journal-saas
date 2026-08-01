import type { Metadata, Viewport } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Noto_Sans_Thai } from 'next/font/google';
import { notFound } from 'next/navigation';

import { resolveSiteUrl } from '@/config/site-url';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { routing } from '@/i18n/routing';

import '../globals.css';

/**
 * Noto Sans Thai, Latin + Thai subsets, self-hosted at build time by
 * `next/font`.
 *
 * This reverses the Phase 00b/01 "no web font" default, and the reversal is
 * deliberate rather than a brand decision this time — see ADR 0007. The
 * system font stack that default relied on has no guaranteed Thai coverage:
 * Windows silently substitutes a different typeface for Thai glyphs within
 * the same string, which breaks vertical rhythm and line-height exactly
 * where mixed Thai/English UI (a Thai sentence naming an English metric)
 * needs it least.
 *
 * Specifically **"Noto Sans Thai"**, not "Noto Sans" — Google ships Thai
 * coverage as a distinct family (confirmed against `next/font`'s own
 * font-data manifest: "Noto Sans" lists no `thai` subset at all, only
 * "Noto Sans Thai" does, alongside `latin`). One family across both scripts
 * is what keeps Thai and Latin text visually consistent at the script
 * boundary; two separately-sourced fonts would not guarantee that.
 *
 * `next/font` downloads and subsets the font once at build time and serves
 * it from the app's own origin — no runtime request to Google, no CLS, no
 * dependency on the visitor's OS having Thai fonts installed.
 */
const notoSansThai = Noto_Sans_Thai({
  subsets: ['latin', 'thai'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type LayoutParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<LayoutParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const appLocale = locale as (typeof routing.locales)[number];
  const t = await getTranslations({ locale: appLocale, namespace: 'metadata' });

  /**
   * `metadataBase` resolves the relative `canonical` and `openGraph.url`
   * values each page declares. `NEXT_PUBLIC_APP_URL` is the portable source
   * of truth documented in `.env.example`; Vercel's deployment host is only
   * a convenience fallback for an unconfigured preview, and a VPS needs no
   * provider-specific variable.
   */
  const siteUrl = resolveSiteUrl({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });

  return {
    metadataBase: siteUrl,
    title: {
      default: t('title'),
      template: `%s · ${t('brandName')}`,
    },
    description: t('description'),
    applicationName: t('brandName'),
    openGraph: {
      siteName: t('brandName'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/'),
    },
    alternates: localizedAlternates(appLocale, '/'),
    robots: {
      // The product is a design preview: the routes exist, the data is
      // fictional, and nothing is purchasable. Indexing it would put a
      // half-built product in search results as though it were finished.
      // Flipped on deliberately at launch, not by forgetting this line.
      index: false,
      follow: false,
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the palette so mobile browser chrome does not flash the wrong colour.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070b14' },
    { media: '(prefers-color-scheme: light)', color: '#f6f8fc' },
  ],
};

/**
 * The sole root layout. There is deliberately no `app/layout.tsx` above this
 * one — every page route is reached through `[locale]`, so this is where
 * `<html>` and `<body>` belong. `app/global-error.tsx` is the fallback for
 * anything that fails before this layout mounts (see its own comment).
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LayoutParams>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for the `[locale]` segment to be statically rendered rather
  // than forced dynamic — without it next-intl cannot tell during a static
  // build which locale a given render belongs to.
  setRequestLocale(locale);

  return (
    // suppressHydrationWarning is required, not incidental: next-themes sets
    // the theme class on <html> before hydration, which React would otherwise
    // report as a mismatch it cannot reconcile.
    <html lang={locale} className={notoSansThai.variable} suppressHydrationWarning>
      <body className="min-h-dvh overflow-x-hidden antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
