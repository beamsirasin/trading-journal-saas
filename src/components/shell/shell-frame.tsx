'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type CSSProperties, type ReactNode } from 'react';

import type { ActiveTradingAccountSummary, SessionUser } from '@/server/auth/dal';
import { Button } from '@/components/ui/button';

import { AccountMenu } from './account-menu';
import { AccountSwitcher } from './account-switcher';
import { Brand } from './brand';
import { MAIN_CONTENT_ID, SIDEBAR_COOKIE_NAME, SIDEBAR_ELEMENT_ID } from './constants';
import { DesktopSidebar } from './desktop-sidebar';
import { MobileNav } from './mobile-nav';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The interactive frame: a global header, the desktop sidebar beneath it, and
 * the workspace beside it.
 *
 * LAYOUT — the header is a GLOBAL bar, not a column heading.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ☰  TradeChemist            account/utilities │  full viewport width
 *   ├──────────────┬───────────────────────────────┤
 *   │  navigation  │           workspace           │
 *   └──────────────┴───────────────────────────────┘
 *
 * The header spans edge to edge and is a SIBLING of the sidebar rather than a
 * child of the workspace column. That is what keeps the brand, the toggle and
 * the account controls perfectly still while the sidebar opens and closes —
 * only the workspace below the header changes its offset. An earlier version
 * nested the header inside the padded workspace column, so every header
 * control slid sideways with the sidebar; the two are deliberately decoupled
 * now.
 *
 * THE HEADER CARRIES IDENTITY AND ACCOUNT, NOT PREFERENCES. Language and
 * theme used to sit here as two standing icon buttons. They are set-once
 * preferences, not tools, and a bar the user looks at all day should not
 * spend 88px on controls most people touch twice ever — so they now live
 * inside the account menu, at every width, which is also where a user goes
 * looking for "my settings". See `AccountMenu`.
 *
 * The header is also the one surface that INVERTS in light mode: a deep
 * branded band across the top of a near-white application. `data-shell-chrome`
 * rebinds the semantic colour tokens inside it (globals.css), so every
 * control it holds — brand, toggle, account switcher, profile menu trigger —
 * resolves to the chrome palette without any of them being told about it.
 *
 * Client, because collapsed/expanded is client state — but deliberately only the
 * FRAME. Page content arrives as `children` already rendered on the server,
 * so putting a `useState` here does not drag the workspace across the client
 * boundary with it.
 *
 * State persists through a plain cookie rather than `localStorage`, because
 * the SERVER has to know it: read from `localStorage`, the first paint would
 * always show one state and then animate to the other after hydration, on
 * every navigation. `AppShell` reads the cookie and hands it back as
 * `defaultExpanded`, so the first byte of HTML is already correct. It holds one
 * character, is not a credential, and is `SameSite=Lax`.
 */
export function ShellFrame({
  children,
  banner,
  user,
  defaultExpanded,
  activeAccount,
  switchableAccounts,
  canCreateAccount,
}: {
  children: ReactNode;
  /** Server-rendered entitlement banner, or `null`. Passed in rather than rendered here so it stays a server component. */
  banner: ReactNode;
  user: SessionUser;
  /** `true` when the persisted preference shows the secondary navigation panel beside the rail. */
  defaultExpanded: boolean;
  activeAccount: ActiveTradingAccountSummary | null;
  switchableAccounts: readonly ActiveTradingAccountSummary[];
  canCreateAccount: boolean;
}) {
  const t = useTranslations('appNav');
  const [navExpanded, setNavExpanded] = useState(defaultExpanded);

  function toggleSidebar() {
    const next = !navExpanded;
    setNavExpanded(next);
    // The cookie still stores "is collapsed", so its meaning is unchanged
    // from when this was a hide/show toggle — only what "collapsed" LOOKS
    // like changed: first to a rail, now to a rail without its secondary panel.
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${next ? '0' : '1'}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  }

  return (
    <div
      className="bg-background min-h-dvh"
      style={
        {
          // Consumed ONLY by the workspace below the header. The secondary
          // panel DISPLACES content rather than floating over it, so this
          // tracks the open state directly — collapsed, the workspace starts
          // after the rail; expanded, after the rail plus the panel.
          '--shell-workspace-offset': navExpanded
            ? 'var(--shell-nav-open-width)'
            : 'var(--shell-rail-width)',
        } as CSSProperties
      }
    >
      {/*
        `w-full`, no left offset, ever. This bar belongs to the application,
        not to the workspace column.
      */}
      <header
        data-shell-chrome
        className="border-shell-chrome-border sticky top-0 z-40 w-full border-b"
      >
        {/*
          THE MOBILE LEFT GUTTER IS 0.5rem, NOT 0.75rem.

          The drawer trigger is a 44px square with a 20px glyph centred in it,
          so the glyph's centre lands at gutter + 22px. At the old `pl-3` that
          was 34px from the viewport edge — far enough in that the control
          read as floating in the bar rather than anchoring its left end,
          while the right-hand account cluster sat hard against its own edge.
          At `pl-2` the centre is 30px and the glyph's own left edge is 20px,
          which is the alignment a phone's system bars use.

          The TARGET did not shrink to get there: it is still 44x44, still the
          full height of the row's control band, and the four pixels came out
          of the padding beside it rather than out of the button. `sm` restores
          the roomier gutter, and `lg` drops it entirely so the desktop toggle
          can sit on the sidebar's own centre line (below).
        */}
        <div className="flex h-[var(--shell-header-height-mobile)] items-center gap-1.5 pr-3 pl-2 sm:pr-4 sm:pl-3 lg:h-[var(--shell-header-height)] lg:gap-0 lg:pl-0">
          {/* Mobile opens the off-canvas drawer; desktop reveals the labels
              beside the icon column. Different interactions, but the same
              slot, so the control never appears to move across the
              breakpoint. */}
          <MobileNav />

          {/*
            THE HEADER'S LEFT CELL IS THE SIDEBAR'S ICON COLUMN.

            Same token, same width, same centring — so the toggle sits exactly
            on the collapsed sidebar's centre line and the brand begins exactly
            where the sidebar's labels begin. Before this, the header simply
            used its own `px-4` gutter, which put the toggle's glyph six pixels
            off the icons directly below it: close enough to look like a
            mistake rather than a decision.

            The row's own left padding is dropped at `lg` for the same reason —
            any gutter here would push both controls out of register with the
            column beneath them.
          */}
          <div className="hidden shrink-0 items-center justify-center lg:flex lg:w-[var(--shell-rail-width)]">
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={navExpanded ? t('collapseSidebar') : t('expandSidebar')}
              aria-expanded={navExpanded}
              aria-controls={SIDEBAR_ELEMENT_ID}
              onClick={toggleSidebar}
            >
              {/*
                THE SAME HAMBURGER THE PHONE SHOWS. This was `PanelLeft`, a
                glyph that describes the MECHANISM — a panel hinged on the left
                — and reads as a diagram of the sidebar rather than as a
                control. The hamburger is what a menu toggle looks like
                everywhere else, so it needs no learning, and using it here
                means the shell opens navigation with one recognisable mark at
                both widths instead of two different ones that happen to sit in
                the same slot.

                One stable icon in every state, still: a glyph that swapped to
                an X on toggle would be the one thing in this bar that moves.
                1.125rem sits it on the same optical weight as the nav icons
                directly below, and the button's own centring puts it on the
                rail's centre line.
              */}
              <Menu className="size-[1.125rem]" aria-hidden="true" />
            </Button>
          </div>

          {/* The brand lives here at EVERY width — never inside the sidebar,
              and never reduced to its mark on desktop, so collapsing
              navigation to the icon column never costs the product its name.
              On desktop it starts flush with the sidebar's label column. */}
          <Brand href="/app" compact size="lg" />

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            {activeAccount === null ? null : (
              <AccountSwitcher
                activeAccount={activeAccount}
                accounts={switchableAccounts}
                canCreateAccount={canCreateAccount}
              />
            )}

            <AccountMenu user={user} />
          </div>
        </div>
      </header>

      <DesktopSidebar expanded={navExpanded} />

      {/*
        Only this column moves, and only when the secondary panel is opened or
        closed. It shares the shell's duration and easing with the panel, so
        the workspace edge and the panel edge arrive together rather than one
        chasing the other.
      */}
      <div className="flex min-h-[calc(100dvh-var(--shell-header-height))] min-w-0 flex-col transition-[padding] duration-[var(--shell-motion-duration)] ease-[var(--shell-motion-easing)] lg:pl-[var(--shell-workspace-offset)]">
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1">
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}
