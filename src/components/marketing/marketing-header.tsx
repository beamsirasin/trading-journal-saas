import Link from 'next/link';

import { Brand } from '@/components/shell/brand';
import { Container } from '@/components/shell/container';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';

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
export function MarketingHeader() {
  return (
    <header className="bg-background/85 border-border sticky top-0 z-40 border-b backdrop-blur-sm">
      <Container className="flex h-14 items-center gap-4">
        <Brand href="/" />

        <nav aria-label="Site" className="ml-6 hidden items-center gap-1 md:flex">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />

          <Button asChild variant="ghost" size="sm" className="hidden min-h-11 md:inline-flex">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm" className="hidden min-h-11 md:inline-flex">
            <Link href="/register">Start free trial</Link>
          </Button>

          <MarketingMobileNav />
        </div>
      </Container>
    </header>
  );
}
