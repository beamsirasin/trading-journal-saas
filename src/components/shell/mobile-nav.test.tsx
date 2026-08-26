import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { MobileNav } from './mobile-nav';
import { NAV_ITEMS } from './nav-items';

function MockLink({
  href,
  children,
  ref,
  ...rest
}: { href: string; children?: ReactNode; ref?: Ref<HTMLAnchorElement> } & Record<string, unknown>) {
  return (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  );
}

// `useRouter`/`useSearchParams` are still needed even though the drawer no
// longer renders `LanguageSwitcher`: the nav rows use the locale-aware `Link`
// and `usePathname` to decide which route is current.
vi.mock('@/i18n/navigation', () => ({
  Link: MockLink,
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * A controllable `matchMedia`, so the breakpoint-crossing behaviour can be
 * driven rather than waited for. jsdom has no layout engine and never fires
 * these on its own.
 */
let mediaListeners: ((event: MediaQueryListEvent) => void)[] = [];
let desktopMatches = false;

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: desktopMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        mediaListeners.push(listener);
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        mediaListeners = mediaListeners.filter((existing) => existing !== listener);
      },
      dispatchEvent: vi.fn(),
    }),
  });
}

function crossToDesktop() {
  desktopMatches = true;
  for (const listener of [...mediaListeners]) {
    listener({ matches: true } as MediaQueryListEvent);
  }
}

function renderDrawer() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <MobileNav />
    </NextIntlClientProvider>,
  );
}

const OPEN_MENU = /open navigation menu/i;

beforeEach(() => {
  mediaListeners = [];
  desktopMatches = false;
  installMatchMedia();
});

afterEach(() => {
  mediaListeners = [];
});

describe('MobileNav — opening and closing', () => {
  it('starts closed, with no navigation landmark on the page', () => {
    renderDrawer();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('opens from the trigger and exposes the navigation', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    // The routes and nothing else. The wordmark that used to be counted here
    // moved out when the drawer was anchored below the global header, which
    // keeps its own copy visible — see the wordmark case below.
    expect(within(dialog).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);
  });

  /**
   * The five preference-band cases that stood here are gone with the band
   * itself: language and theme moved into the account menu, which sits in the
   * header at every width, so the drawer no longer carries either.
   *
   * What replaces them is the guarantee that actually matters now — this
   * surface navigates and does nothing else. Where the preferences went is
   * asserted where they landed, in `shell-frame.test.tsx`.
   */
  it('carries routes and nothing else', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('button', { name: /language/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /theme/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('group', { name: en.appNav.preferences })).toBeNull();

    // Every route still reachable, which is the job this surface kept.
    for (const item of NAV_ITEMS) {
      expect(
        within(dialog).getByRole('link', {
          name: en.appNav.items[item.key as keyof typeof en.appNav.items],
        }),
      ).toHaveAttribute('href', item.href);
    }
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderDrawer();
    const trigger = screen.getByRole('button', { name: OPEN_MENU });

    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Focus must not be left on a element that no longer exists.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from the SAME header hamburger that opened it', async () => {
    // The one behaviour the removed X used to own. The drawer is modal, so
    // Radix would otherwise treat this press as an outside-dismiss AND let
    // the button own click reopen it — see `isTriggerPress` in the
    // component. One press, one close.
    const user = userEvent.setup();
    renderDrawer();

    const trigger = screen.getByRole('button', { name: OPEN_MENU });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reopens on the next press, so the control is a real toggle', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('states its expanded state, and renames itself for the action it now performs', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const trigger = screen.getByRole('button', { name: OPEN_MENU });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAccessibleName('Close');
    // It says it controls the thing it actually controls.
    expect(dialog).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
  });

  it('keeps the hamburger glyph identical in both states, rather than morphing to an X', async () => {
    // The header is the one part of the shell that never moves. A glyph that
    // swapped under the user finger would be the exception.
    const user = userEvent.setup();
    renderDrawer();

    const trigger = screen.getByRole('button', { name: OPEN_MENU });
    const closedGlyph = trigger.querySelector('svg')!.outerHTML;

    await user.click(trigger);
    await screen.findByRole('dialog');

    expect(trigger.querySelector('svg')!.outerHTML).toBe(closedGlyph);
  });

  it('shows no X close control inside the drawer', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    // The primitive own corner button is off, and the drawer own close
    // affordance is hidden until focused — so nothing visible sits on top of
    // the first navigation row.
    const closes = within(dialog).getAllByRole('button', { name: 'Close' });
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveClass('sr-only');
  });

  it('still offers keyboard and screen-reader users an explicit way out', async () => {
    // Removing a VISIBLE affordance must not remove the behaviour. Radix
    // hides everything outside a modal from assistive tech, including the
    // header hamburger, so without this the only route out from inside the
    // dialog would be an unannounced Escape.
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close).toHaveClass('focus-visible:not-sr-only');

    await user.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('still closes on the backdrop, which the hamburger exception must not disable', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    await screen.findByRole('dialog');

    // Everything outside the panel that is NOT the trigger still dismisses.
    // The backdrop is the affordance a user actually aims at, so it is the
    // one asserted here rather than a bare `document.body` press.
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes after a route is selected, rather than covering the page just requested', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('link', { name: en.appNav.items.analytics }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  /**
   * The drawer now opens BELOW the global header, which keeps the wordmark on
   * screen and interactive-looking for the whole time the drawer is open — so
   * the drawer no longer repeats it. What replaced that guarantee is this one:
   * the brand appears exactly once at any moment, never twice stacked.
   *
   * The header's own copy is `ShellFrame`'s, not this component's, so it is
   * absent from this render — which is exactly why "zero here" is the right
   * assertion and `shell-frame.test.tsx` owns "exactly one in the shell".
   */
  it('does not repeat the wordmark the global header already shows', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('link', { name: 'TradeChemist' })).not.toBeInTheDocument();
    // The dialog still has to announce itself as something.
    expect(dialog).toHaveAccessibleName(en.appNav.drawerTitle);
  });
});

describe('MobileNav — surface and width', () => {
  it('renders on the header chrome surface rather than the page surface', async () => {
    // Mobile only. The drawer hangs off the header and shares an edge with it,
    // so it takes the header palette in BOTH themes; the desktop sidebar
    // does not carry this and keeps its own light surface in light mode.
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveAttribute('data-shell-chrome');
    expect(dialog).toHaveClass('bg-sidebar');
  });

  it('caps its width and always leaves the page visible beside it', async () => {
    // 240px ceiling, and never closer than 80px to the right edge, so the
    // drawer settles at 240px on every common phone and more than a third of
    // the workspace stays in view behind it. Rendered widths are asserted for
    // real, at 320/390/430/440, in `e2e/app-shell.spec.ts` — jsdom has no
    // layout engine.
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveClass('w-[min(15rem,calc(100vw-5rem))]');
    // The primitive 3/4-of-viewport default must not survive the merge.
    expect(dialog.className.split(' ')).not.toContain('w-3/4');
  });

  it('carries no Settings row, since Settings lives in the account menu', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).queryByRole('link', { name: en.appNav.items.settings }),
    ).not.toBeInTheDocument();
    expect(dialog.querySelector('a[href="/app/settings"]')).toBeNull();
  });
});

describe('MobileNav — keyboard operation', () => {
  it('opens with the keyboard alone', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.tab();
    expect(screen.getByRole('button', { name: OPEN_MENU })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('MobileNav — breakpoint crossing', () => {
  it('closes itself when the viewport grows past the desktop breakpoint', async () => {
    // Otherwise the user is left with a modal overlay, a focus trap and locked
    // scrolling, while the trigger that would dismiss it is now `lg:hidden`.
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    await screen.findByRole('dialog');

    crossToDesktop();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not close while the viewport stays below the breakpoint', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole('button', { name: OPEN_MENU }));
    await screen.findByRole('dialog');

    for (const listener of [...mediaListeners]) {
      listener({ matches: false } as MediaQueryListEvent);
    }

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
