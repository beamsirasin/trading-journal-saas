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
