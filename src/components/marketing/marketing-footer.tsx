import Link from 'next/link';

import { Brand } from '@/components/shell/brand';
import { Container } from '@/components/shell/container';

import { FOOTER_GROUPS } from './nav';

/**
 * Public site footer.
 *
 * Contains no company name, address, registration number or support email.
 * None of those facts exist yet, and inventing them would put fabricated
 * business details on a public page — a worse outcome than a footer that is
 * visibly incomplete.
 *
 * Legal links are marked "Coming soon" and are not links at all, because a
 * link to a privacy policy that 404s is a stronger false claim than no link.
 */
export function MarketingFooter() {
  return (
    <footer className="border-border bg-surface mt-auto border-t">
      <Container className="flex flex-col gap-10 py-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <Brand href="/" />
            <p className="text-muted-foreground text-sm leading-relaxed">
              A trading journal that separates strategy edge from execution.
            </p>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title} className="flex flex-col gap-3">
              <h2 className="text-foreground text-sm font-semibold">{group.title}</h2>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li key={item.href}>
                    {item.pending === true ? (
                      <span className="text-muted-foreground/70 inline-flex items-center gap-1.5 text-sm">
                        {item.label}
                        <span className="border-border text-muted-foreground/70 rounded border px-1 py-0.5 text-[10px]">
                          Soon
                        </span>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        {...(item.prefetch === false ? { prefetch: false } : {})}
                        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 min-w-11 items-center text-sm transition-colors"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-border text-muted-foreground flex flex-col gap-3 border-t pt-8 text-xs leading-relaxed">
          <p>
            Trading OS is a journaling and analytics tool. It does not provide financial advice,
            execute orders, or connect to a broker. Trading involves risk of loss, and past
            performance does not indicate future results.
          </p>
          <p>
            Product in active development. Figures shown anywhere on this site are fictional demo
            data.
          </p>
        </div>
      </Container>
    </footer>
  );
}
