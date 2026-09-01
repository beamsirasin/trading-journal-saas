/**
 * The id the skip link targets and `<main>` carries. Shared so the two can
 * never drift apart — a skip link pointing at a missing id fails silently,
 * and only for the users who depend on it.
 */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * The desktop sidebar's element id. The header's collapse button points at it
 * with `aria-controls`, which is only truthful if both sides agree on the
 * value — so neither writes the literal.
 */
export const SIDEBAR_ELEMENT_ID = 'app-sidebar';

/**
 * Where the rail/pinned choice is remembered.
 *
 * A cookie rather than `localStorage` because the SERVER has to know the
 * width to render the first paint at the right size; see `ShellFrame`. It
 * stores exactly `'1'` (collapsed to the rail) or `'0'` (pinned open) and is
 * not security-relevant, so it is read with a plain equality check and never
 * trusted for anything else.
 *
 * The NAME still says "collapsed" and the values still mean what they always
 * did — deliberately, so the shell-polish pass did not silently reset the
 * preference of anyone who had already chosen. What changed is only what
 * "collapsed" looks like: a slim icon rail now, rather than nothing at all.
 * The ABSENT case flipped, though: no cookie now resolves to the rail, which
 * is the shell's resting state (see `AppShell`).
 */
export const SIDEBAR_COOKIE_NAME = 'shell_sidebar_collapsed';

/**
 * Routes that own an account selector of their own, and therefore suppress
 * the header's.
 *
 * THE HEADER SWITCHER IS THE APPLICATION-WIDE DEFAULT AND STAYS THAT WAY.
 * Trades, Strategies, Accounts, Analytics, Settings, Plan and Billing all
 * depend on it — it is the only way to change the active Account on any of
 * them — so this is a narrow exception list, never a feature flag and never a
 * step toward removing the control.
 *
 * The Dashboard is the one route with a page-level Account control (the
 * toolbar's, beside Date Range and Filters). Rendering both put the same
 * account name in two places roughly 60 vertical pixels apart, with two
 * different switching gestures behind them, and left a reader to work out
 * whether they meant the same thing. They do. The page-level one wins there
 * because it sits with the other two controls that scope the same figures.
 *
 * Locale-free paths, matched exactly: these are compared against
 * `usePathname` from `@/i18n/navigation`, which strips the locale prefix, so
 * `/en/app` and `/th/app` both arrive here as `/app`. Exact equality rather
 * than a prefix test is deliberate — `/app/trades` and `/app/accounts` are
 * NOT the Dashboard and must keep the header control.
 */
export const ROUTES_WITH_OWN_ACCOUNT_CONTROL: readonly string[] = ['/app'];
