import { getTranslations } from 'next-intl/server';

import { Brand } from '@/components/shell/brand';
import { Container } from '@/components/shell/container';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { MarketingMobileNav } from './marketing-mobile-nav';
import { MARKETING_NAV } from './nav';

/**
 * Public site header.
 *
 * A server component: only the drawer needs interactivity, so only the drawer
 * is a client component. Making the whole header client-side to get one
 * button would ship the nav data and the theme toggle's dependencies to every
 * visitor before they scroll.
 *
 * Sticky with a translucent backdrop. The backdrop is `bg-background/80` plus
 * a small blur rather than a heavy glass panel — the design direction calls
 * for restraint, and text over a strongly blurred surface loses contrast.
 */
export async function MarketingHeader() {
  const t = await getTranslations('nav');

  return (
    <header className="bg-background/85 border-border sticky top-0 z-40 border-b backdrop-blur-sm">
      <Container className="flex h-14 items-center gap-4">
        {/*
          `compact` for the same reason the app shell's header uses it: at
          320px this row's wordmark, language, theme and menu controls total
          more than the available width, and no 44px touch target may shrink
          to make room. Needed here from the moment the wordmark became
          "TradeChemist" — the shorter previous name happened to fit.
        */}
        <Brand href="/" compact />

        {/*
          `whitespace-nowrap` on each link: without it, "How it works" wraps
          mid-phrase at exactly 768px, where this nav first appears and the
          header's content sits within a pixel of the available width. `Brand`
          carries the same protection for the same reason — see its comment.
          `ml-4` rather than the original `ml-6` reclaims a little of that
          margin so the fit isn't hairline-tight against browser/font
          rendering variance.
        */}
        <nav aria-label={t('siteNav')} className="ml-4 hidden items-center gap-1 lg:flex">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              {...(item.prefetch === false ? { prefetch: false } : {})}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex min-h-11 min-w-11 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors"
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />

          <Button asChild variant="ghost" size="sm" className="hidden min-h-11 lg:inline-flex">
            <Link href="/login">{t('login')}</Link>
          </Button>
          <Button asChild size="sm" className="hidden min-h-11 lg:inline-flex">
            <Link href="/register">{t('register')}</Link>
          </Button>

          <MarketingMobileNav />
        </div>
      </Container>
    </header>
  );
}
