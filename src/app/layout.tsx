import type { Metadata, Viewport } from 'next';

import { ThemeProvider } from '@/components/theme/theme-provider';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Trading OS',
    template: '%s · Trading OS',
  },
  description:
    'A trading journal that separates system performance from trader execution, so you know whether to fix the strategy or the discipline.',
  applicationName: 'Trading OS',
  robots: {
    // Nothing here is ready to be indexed until the marketing site ships.
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
