import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveTradingAccountSummary, SessionUser } from '@/server/auth/dal';
import { ThemeProvider } from '@/components/theme/theme-provider';

import en from '../../../messages/en.json';
import { SIDEBAR_COOKIE_NAME } from './constants';
import { ShellFrame } from './shell-frame';

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

/*
  The route the shell believes it is rendering.

  It matters to exactly one thing here: the header suppresses its own Account
  switcher on a route that owns a page-level one (see
  `ROUTES_WITH_OWN_ACCOUNT_CONTROL`). The DEFAULT is therefore a route that
  does NOT — the application-wide case, which is what most of this file is
  describing — and the Dashboard is set explicitly where it is the subject.
*/
let mockPathname = '/app/trades';

vi.mock('@/i18n/navigation', () => ({
  Link: MockLink,
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/server/actions/trading-accounts', () => ({
  setActiveTradingAccountAction: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({ signOut: vi.fn() }));

const USER: SessionUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  image: null,
};

const ACCOUNT: ActiveTradingAccountSummary = {
  id: 'acc-1',
  name: 'Main Trading Account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
};

/** `expanded` = rail + secondary panel. `false` = the resting rail alone. */
function renderShell(expanded = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ThemeProvider>
        <ShellFrame
          user={USER}
          defaultExpanded={expanded}
          activeAccount={ACCOUNT}
          switchableAccounts={[ACCOUNT]}
          canCreateAccount
          banner={null}
        >
          <p>workspace content</p>
        </ShellFrame>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  // Clear the persistence cookie between cases so one test's toggle cannot
  // be mistaken for another's initial state.
  document.cookie = `${SIDEBAR_COOKIE_NAME}=; path=/; max-age=0`;
  mockPathname = '/app/trades';
});

describe('ShellFrame — landmarks', () => {
  it('renders banner, main and a single navigation landmark', () => {
    renderShell();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
  });

  it('renders page content inside main, not beside it', () => {
    renderShell();
    expect(within(screen.getByRole('main')).getByText('workspace content')).toBeInTheDocument();
  });

  it('keeps navigation, account switching and the profile menu in the header at every width', () => {
    renderShell();
    const banner = screen.getByRole('banner');

    expect(within(banner).getByRole('button', { name: /open navigation menu/i })).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Account menu' })).toBeVisible();
    // Account switching is not a set-once preference — it scopes every figure
    // on screen — so it earns its place in the row on a phone too. This is the
    // application-wide default: every route except the Dashboard relies on it
    // as the ONLY way to change the active Account.
    expect(within(banner).getByRole('button', { name: 'Switch trading account' })).toBeVisible();
  });

  /*
    ONE ACCOUNT SELECTOR PER PAGE.

    The Dashboard's toolbar carries an Account control of its own, beside Date
    Range and Filters, scoping the same figures those two do. With the header
    switcher also present a reader met the same account name twice, sixty
    pixels apart, behind two different switching gestures. The page-level one
    wins there; the header's steps aside — and ONLY there.
  */
  it('stands its switcher down on a route that owns an account control', () => {
    mockPathname = '/app';
    renderShell();
    const banner = screen.getByRole('banner');

    expect(
      within(banner).queryByRole('button', { name: 'Switch trading account' }),
    ).not.toBeInTheDocument();
    // Nothing replaced it, and the profile control is untouched.
    expect(within(banner).getByRole('button', { name: 'Account menu' })).toBeVisible();
    expect(within(banner).getByRole('button', { name: /open navigation menu/i })).toBeVisible();
  });

  it('is an exact route match, so nested routes keep the header switcher', () => {
    // `/app/trades` and `/app/accounts` are not the Dashboard. A prefix test
    // would have taken the control off every page in the product.
    for (const route of ['/app/trades', '/app/accounts', '/app/analytics', '/app/settings']) {
      mockPathname = route;
      const { unmount } = renderShell();
      expect(
        within(screen.getByRole('banner')).getByRole('button', {
          name: 'Switch trading account',
        }),
      ).toBeVisible();
      unmount();
    }
  });

  it('keeps preferences out of the header row entirely', () => {
    // They used to be two standing icon buttons here, shown only above `lg`.
    // Both moved into the account menu, at every width — so the header row
    // now carries identity and account, and nothing a user sets once.
    renderShell();
    const banner = screen.getByRole('banner');

    expect(within(banner).queryByRole('button', { name: /language/i })).not.toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: /change theme/i })).not.toBeInTheDocument();
  });

  it('offers language and theme inside the account menu, at any width', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');

    // Two different shapes, deliberately. Language is a small SET you choose
    // from, so it keeps a segmented radio group. Theme is a BINARY since
    // System was removed, so it is a toggle that IS the menu item.
    expect(
      within(menu).getByRole('group', { name: en.languageSwitcher.label }),
    ).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /change theme/i })).toBeInTheDocument();
  });

  it('leaves no nested menu behind for either preference', async () => {
    // The regression this guards: language and theme were `DropdownMenuSub`s,
    // which cost a second surface and a second dismissal to change a value
    // out of two or three. Nothing in this menu should announce itself as
    // opening another menu any more.
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');

    for (const item of within(menu).getAllByRole('menuitem')) {
      expect(item).not.toHaveAttribute('aria-haspopup', 'menu');
    }
    expect(menu.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();
  });

  it('states the current language and theme as a selection, not as free text', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');

    // `menuitemradio` + `aria-checked` is what makes "English, 1 of 2" the
    // announcement rather than three unrelated buttons.
    const language = within(menu).getByRole('group', { name: en.languageSwitcher.label });
    const english = within(language).getByRole('menuitemradio', { name: en.languageSwitcher.en });
    const thai = within(language).getByRole('menuitemradio', { name: en.languageSwitcher.th });

    expect(english).toHaveAttribute('aria-checked', 'true');
    expect(thai).toHaveAttribute('aria-checked', 'false');
  });

  it('offers no System theme mode anywhere in the menu', async () => {
    // The mode was removed from the product. What must not survive is a
    // control still advertising it, in any shape.
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');

    expect(menu.textContent).not.toMatch(/system/i);
    expect(within(menu).queryByRole('menuitemradio', { name: /system/i })).not.toBeInTheDocument();
    // And nothing offers a THREE-way theme choice any more — the segmented
    // group that used to hold light/dark/system is gone with it.
    expect(
      within(menu).queryByRole('group', { name: en.settings.appearance.theme }),
    ).not.toBeInTheDocument();
  });

  it('changes theme from the menu without dismissing it', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');
    const toggle = within(menu).getByRole('menuitem', { name: /change theme/i });

    // The accessible name states the CURRENT value, because a toggle that does
    // not relabel itself has nowhere else to say it.
    const before = toggle.getAttribute('aria-label');
    await user.click(toggle);

    // Still open — a preference, not a destination.
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(screen.getByRole('menu'))
          .getByRole('menuitem', { name: /change theme/i })
          .getAttribute('aria-label'),
      ).not.toBe(before);
    });
  });

  it('offers Settings and Plan & billing as ordinary destinations', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');

    expect(
      within(menu).getByRole('menuitem', { name: en.appNav.account.planAndBilling }),
    ).toHaveAttribute('href', '/app/plan');
    expect(within(menu).getByRole('menuitem', { name: en.appNav.items.settings })).toHaveAttribute(
      'href',
      '/app/settings',
    );
  });

  it('does not repeat the workspace the account switcher already names', async () => {
    // The switcher stands directly beside this trigger and states the active
    // context; a "WORKSPACE" heading with the same name under it was the same
    // fact twice, a few pixels apart.
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const menu = await screen.findByRole('menu');

    expect(within(menu).queryByText(en.appNav.account.workspace)).not.toBeInTheDocument();
    expect(within(menu).queryByText('Personal workspace')).not.toBeInTheDocument();
  });

  it('omits the account switcher before onboarding creates an account', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ThemeProvider>
          <ShellFrame
            user={USER}
            defaultExpanded
            activeAccount={null}
            switchableAccounts={[]}
            canCreateAccount={false}
            banner={null}
          >
            <p>workspace content</p>
          </ShellFrame>
        </ThemeProvider>
      </NextIntlClientProvider>,
    );

    expect(
      screen.queryByRole('button', { name: 'Switch trading account' }),
    ).not.toBeInTheDocument();
  });
});

describe('ShellFrame — sidebar collapse', () => {
  it('starts from the state the server resolved, without a flash of the other one', () => {
    renderShell(false);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('describes itself as expanded when it is', () => {
    renderShell(true);
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('points at the sidebar it actually controls', () => {
    renderShell();
    const controls = screen
      .getByRole('button', { name: 'Collapse sidebar' })
      .getAttribute('aria-controls');

    expect(controls).toBeTruthy();
    expect(screen.getByRole('complementary')).toHaveAttribute('id', controls!);
  });

  it('toggles, and renames itself so the label always states the next action', async () => {
    const user = userEvent.setup();
    renderShell(true);

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('remembers the choice so the next server render starts at the same width', async () => {
    const user = userEvent.setup();
    renderShell(true);

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE_NAME}=1`);

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE_NAME}=0`);
  });

  it('is reachable and operable by keyboard alone', async () => {
    const user = userEvent.setup();
    renderShell(true);

    screen.getByRole('button', { name: 'Collapse sidebar' }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveFocus();
  });

  it('collapses to the rail alone, keeping every route reachable', async () => {
    const user = userEvent.setup();
    renderShell(true);
    const sidebar = screen.getByRole('complementary');

    expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(sidebar).toHaveClass('w-[var(--shell-nav-open-width)]');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    // Collapsed means RAIL, not gone. jsdom applies no stylesheet, so the
    // state attribute and the width classes are what can be asserted here;
    // the rendered geometry is covered in `e2e/app-shell.spec.ts`.
    expect(sidebar).toHaveAttribute('data-state', 'rail');
    expect(sidebar).toHaveClass('w-[var(--shell-rail-width)]');
    // Still on screen, still focusable, still in the accessibility tree —
    // the whole point of a rail over a hidden panel.
    expect(sidebar).not.toHaveClass('invisible');
    expect(sidebar).not.toHaveClass('pointer-events-none');

    // Still one navigation landmark, and the routes keep their labels — there
    // is no icon-only presentation to fall back to.
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
    const trades = screen.getByRole('link', { name: en.appNav.items.trades });
    expect(trades).toHaveTextContent(en.appNav.items.trades);
    expect(trades).toHaveAttribute('href', '/app/trades');
  });

  it('clips the collapsed panel without creating a horizontal scroll container', () => {
    renderShell(false);

    const sidebar = screen.getByRole('complementary');
    expect(sidebar).toHaveClass('overflow-clip');
    expect(sidebar).not.toHaveClass('overflow-hidden');
  });

  it('moves the panel and the workspace on one shared clock', () => {
    // The gap-tearing regression this guards: the panel and the workspace
    // offset are two halves of ONE movement, and the workspace boundary only
    // stays flush against the sliding panel while both run for the same time
    // with the same easing. Two duration literals that happen to agree today
    // are one careless edit away from disagreeing, so both must read the same
    // token. The rendered flushness itself is asserted frame-by-frame in
    // `e2e/app-shell.spec.ts`.
    renderShell(true);
    const sidebar = screen.getByRole('complementary');
    const workspace = document.querySelector('[class*="shell-workspace-offset"]');

    expect(workspace).not.toBeNull();
    for (const element of [sidebar, workspace!]) {
      expect(element).toHaveClass('duration-[var(--shell-motion-duration)]');
      expect(element).toHaveClass('ease-[var(--shell-motion-easing)]');
    }
    // The panel reveals by widening; the workspace follows by padding.
    expect(sidebar).toHaveClass('transition-[width]');
    expect(workspace).toHaveClass('transition-[padding]');
  });

  it('opens only on a deliberate toggle, never on hover or focus', () => {
    // A previous pass expanded this on pointer proximity. Brushing past the
    // navigation must do nothing at all now — opening is an act, not an
    // accident — so the panel carries no hover/focus width variant.
    renderShell(false);
    const sidebar = screen.getByRole('complementary');

    expect(sidebar.className).not.toMatch(/hover:w-/);
    expect(sidebar.className).not.toMatch(/focus-within:w-/);
  });

  it('moves the workspace boundary with the panel, rather than overlaying it', () => {
    // The secondary panel DISPLACES content. Collapsed, the workspace starts
    // after the rail; expanded, after the rail plus the panel.
    const offsetOf = () =>
      document
        .querySelector<HTMLElement>('[style*="--shell-workspace-offset"]')
        ?.style.getPropertyValue('--shell-workspace-offset');

    const { unmount } = renderShell(false);
    expect(offsetOf()).toBe('var(--shell-rail-width)');
    unmount();

    renderShell(true);
    expect(offsetOf()).toBe('var(--shell-nav-open-width)');
  });

  it('paints the sidebar as a single surface, with no separate rail layer', () => {
    // The icon column is a LAYOUT fact, not a painted one. An earlier version
    // gave it its own shade, which made the sidebar read as two panels bolted
    // together rather than as one component.
    renderShell(false);

    expect(document.querySelector('[data-shell-rail]')).toBeNull();
    expect(screen.getByRole('complementary')).toHaveClass('bg-sidebar');
  });

  it('keeps Settings out of the sidebar entirely', () => {
    // It moved to the account menu. The sidebar is product destinations now —
    // places you go to do the work — and nothing that configures the product.
    renderShell(true);
    const nav = screen.getByRole('navigation', { name: 'Main' });

    expect(
      within(nav).queryByRole('link', { name: en.appNav.items.settings }),
    ).not.toBeInTheDocument();
    // And the second band that existed only to hold it is gone with it.
    expect(within(nav).getAllByRole('list')).toHaveLength(1);
  });

  it('gives the header toggle the same column width the sidebar uses', () => {
    // One token on both sides is what puts the toggle on the collapsed
    // sidebar's centre line; the rendered alignment is asserted for real in
    // `e2e/app-shell.spec.ts`.
    renderShell(false);
    const cell = screen.getByRole('button', { name: 'Expand sidebar' }).parentElement;

    expect(cell).toHaveClass('lg:w-[var(--shell-rail-width)]');
    expect(cell).toHaveClass('justify-center');
  });

  it('never stacks a second wordmark under the header one', async () => {
    // The drawer opens BELOW the global header, which keeps its own wordmark
    // on screen the whole time — so the drawer must not add a second one a few
    // pixels beneath it. (A count across the whole document would not show
    // this: the drawer is a modal dialog, so Radix marks everything outside it
    // `aria-hidden` and the header's copy leaves the accessibility tree while
    // it is open. What is assertable, and what actually matters, is that the
    // drawer contributes none of its own.)
    const user = userEvent.setup();
    renderShell(true);

    expect(screen.getAllByRole('link', { name: 'TradeChemist' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /open navigation menu/i }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryAllByRole('link', { name: 'TradeChemist' })).toHaveLength(0);
  });

  it('keeps the header out of the workspace column, so it cannot move with the sidebar', () => {
    // The regression this guards: nesting the header inside the padded
    // workspace column made every header control slide sideways whenever the
    // sidebar toggled. The header must be a SIBLING of that column.
    renderShell(true);
    const banner = screen.getByRole('banner');
    const offsetColumn = document.querySelector('[class*="shell-workspace-offset"]');

    expect(offsetColumn).not.toBeNull();
    expect(offsetColumn).not.toContainElement(banner);
    expect(banner.className).not.toMatch(/pl-\[var\(--shell-workspace-offset\)\]/);
  });
});
