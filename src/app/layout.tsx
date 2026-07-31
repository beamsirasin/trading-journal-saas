import type { Metadata, Viewport } from 'next';

import { ThemeProvider } from '@/components/theme/theme-provider';

import './globals.css';

/**
 * `metadataBase` resolves the relative `canonical` and `openGraph.url` values
 * that each page declares. Without it Next.js warns at build time and emits
 * relative OG URLs, which crawlers cannot follow.
 *
 * Vercel supplies the deployment host, so preview builds advertise themselves
 * rather than production. The localhost fallback keeps `next build` working
 * on a machine with no environment configured — this value is not a secret
 * and is deliberately not routed through `env.server.ts`, which would pull a
 * `server-only` module into a file that also renders on the client.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL !== undefined
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Trading OS',
    template: '%s · Trading OS',
  },
  description:
    'A trading journal that separates system performance from trader execution, so you know whether to fix the strategy or the discipline.',
  applicationName: 'Trading OS',
  openGraph: {
    siteName: 'Trading OS',
    type: 'website',
    locale: 'en',
  },
  robots: {
    // The product is a design preview: the routes exist, the data is
    // fictional, and nothing is purchasable. Indexing it would put a
    // half-built product in search results as though it were finished.
    // Flipped on deliberately at launch, not by forgetting this line.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the palette so mobile browser chrome does not flash the wrong colour.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070b14' },
    { media: '(prefers-color-scheme: light)', color: '#f6f8fc' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required, not incidental: next-themes sets
    // the theme class on <html> before hydration, which React would otherwise
    // report as a mismatch it cannot reconcile.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh overflow-x-hidden antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
