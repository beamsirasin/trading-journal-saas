import { expect, test } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

// The `motion` describe block below also visits `/en/app`, which Phase 02
// made a real, database-verified page — storageState is harmless for every
// other test in this file (none of them touch /login or /register), and the
// two motion tests skip outright when no database is configured.
test.use({ storageState: authStateFile });

/**
 * Theme precedence — TWO STATES, NO "SYSTEM".
 *
 * The product used to offer a System mode that deferred to
 * `prefers-color-scheme`, and this file's precedence cases were about which
 * of three inputs won. That mode is gone at every layer: no option in the UI,
 * `enableSystem={false}` in the provider, and no `prefers-color-scheme` block
 * in globals.css. So these cases now assert the opposite property — that the
 * OS preference is IGNORED, in both directions, which is exactly the kind of
 * thing that regresses quietly the moment someone re-adds a media query.
 *
 * Each case still emulates a preference explicitly. Not to depend on it, but
 * to prove it changes nothing.
 */

const resolvedColorScheme = () =>
  Promise.resolve(getComputedStyle(document.documentElement).colorScheme);

const STORAGE_KEY = 'trading-os-theme';

test.describe('theme precedence', () => {
  test('2. defaults to DARK when the user has chosen nothing, on a dark OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('2. defaults to DARK when the user has chosen nothing, on a LIGHT OS', async ({ page }) => {
    // The case that changed. This used to assert light — the OS preference
    // winning over the dark-first identity, which is what System mode meant.
    // The product now has one default and the OS does not get a vote.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('light')))
      .toBe(false);
  });

  test('1. an explicitly saved choice beats the OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'dark'],
    );
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('1. a saved light choice beats a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'light'],
    );
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
  });

  test('migrates a legacy saved `system` to the product default', async ({ page }) => {
    // Anyone who chose System has that literal string in storage. Without the
    // pre-paint migration, next-themes with `enableSystem` off applies it
    // verbatim: `<html class="system">`, matching no palette, with no control
    // on the page able to explain or undo it.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'system'],
    );
    await page.goto('/en');

    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('system')))
      .toBe(false);
    // And the stored value itself is rewritten, so the next load needs no
    // migration at all.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
      .toBe('dark');
  });

  test('migrating a legacy `system` does not flash the wrong theme first', async ({ page }) => {
    // The migration runs in a blocking script BEFORE next-themes' own, so the
    // class is correct on the very first painted frame rather than corrected
    // after hydration.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'system'],
    );

    await page.goto('/en', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement?.classList.contains('dark'));
    expect(await page.evaluate(() => document.documentElement.classList.contains('light'))).toBe(
      false,
    );
  });
});

test.describe('theme contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme} action and status tokens meet AA text contrast`, async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key as string, value as string),
        [STORAGE_KEY, theme],
      );
      await page.goto('/en');

      const ratios = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const parse = (name: string) => {
          const value = style.getPropertyValue(name).trim();
          const matched = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
          if (matched === undefined) throw new Error(`${name} must resolve to a hex colour`);
          const hex =
            matched.length === 3 ? [...matched].map((digit) => digit + digit).join('') : matched;
          return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
        };
        const luminance = (rgb: number[]) => {
          const channels = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
        };
        const contrast = (foreground: string, background: string) => {
          const first = luminance(parse(foreground));
          const second = luminance(parse(background));
          return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        };

        /**
         * The pill is an OPAQUE token now, not `--primary` composited at an
         * alpha, so there is nothing left to composite — the surface can be
         * read directly. That simplification is the whole point of the change
         * it is measuring: an active row whose background is a neutral step
         * rather than a wash of the brand colour.
         */
        return {
          primaryAction: contrast('--primary-foreground', '--primary'),
          warningOnSurface: contrast('--warning', '--surface'),
          // The desktop sidebar's active row, in its three parts.
          navActiveLabelOnPill: contrast(
            '--shell-nav-active-foreground',
            '--shell-nav-active-surface',
          ),
          navActiveIconOnPill: contrast('--shell-nav-active-icon', '--shell-nav-active-surface'),
          // Visible mid layout-spring, while the pill is travelling.
          navActiveLabelOnSidebar: contrast('--shell-nav-active-foreground', '--sidebar'),
          navActiveIconOnSidebar: contrast('--shell-nav-active-icon', '--sidebar'),
          navRestOnSidebar: contrast('--shell-nav-rest-foreground', '--sidebar'),
          ringOnBackground: contrast('--ring', '--background'),
          // The mobile drawer's chrome scope, which rebinds all of them.
          chromeNavLabelOnPill: contrast(
            '--shell-chrome-nav-active-foreground',
            '--shell-chrome-nav-active-surface',
          ),
          chromeNavIconOnPill: contrast(
            '--shell-chrome-nav-active-icon',
            '--shell-chrome-nav-active-surface',
          ),
          chromeNavRest: contrast('--shell-chrome-muted', '--shell-chrome'),
          chromeForeground: contrast('--shell-chrome-foreground', '--shell-chrome'),
          chromeRingOnChrome: contrast('--shell-chrome-ring', '--shell-chrome'),
        };
      });

      // Text-weight AA for everything that carries words.
      expect(ratios.primaryAction).toBeGreaterThanOrEqual(4.5);
      expect(ratios.warningOnSurface).toBeGreaterThanOrEqual(4.5);
      expect(ratios.navActiveLabelOnPill).toBeGreaterThanOrEqual(4.5);
      expect(ratios.navActiveLabelOnSidebar).toBeGreaterThanOrEqual(4.5);
      expect(ratios.navRestOnSidebar).toBeGreaterThanOrEqual(4.5);
      expect(ratios.chromeNavLabelOnPill).toBeGreaterThanOrEqual(4.5);
      expect(ratios.chromeNavRest).toBeGreaterThanOrEqual(4.5);
      expect(ratios.chromeForeground).toBeGreaterThanOrEqual(4.5);
      // Non-text UI, so WCAG 1.4.11's 3:1 rather than 4.5:1. The active ICON
      // is the accent now, so it is measured on its own rather than inheriting
      // the label's ratio.
      expect(ratios.navActiveIconOnPill).toBeGreaterThanOrEqual(3);
      expect(ratios.navActiveIconOnSidebar).toBeGreaterThanOrEqual(3);
      expect(ratios.chromeNavIconOnPill).toBeGreaterThanOrEqual(3);
      expect(ratios.ringOnBackground).toBeGreaterThanOrEqual(3);
      expect(ratios.chromeRingOnChrome).toBeGreaterThanOrEqual(3);
    });
  }
});

/**
 * The pre-paint bootstrap, asserted against the DOCUMENT rather than the
 * component tree.
 *
 * The migration only works because of where it sits: a classic inline script
 * in the server-rendered HTML, ahead of the one next-themes injects. Neither
 * half of that is visible from a unit test, and both are easy to break by
 * moving a component — so they are asserted here, on what the browser is
 * actually served.
 */
/**
 * The theme-related inline scripts in a served document, in document order.
 *
 * Matched by BEHAVIOUR rather than by a source literal: next-themes ships
 * minified, so any variable name picked out of its build is one dependency
 * bump away from meaning nothing. The migration is the script that WRITES
 * storage; next-themes' is the one that sets the class.
 */
function themeScripts(html: string) {
  const all = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .map((m) => ({ attrs: m[1] ?? '', body: m[2] ?? '' }))
    .filter((s) => s.body.includes(STORAGE_KEY));

  return {
    migration: all.findIndex((s) => s.body.includes('localStorage.setItem')),
    nextThemes: all.findIndex((s) => s.body.includes('classList')),
    all,
  };
}

test.describe('theme bootstrap placement', () => {
  test('ships the migration ahead of next-themes, both parser-blocking', async ({ request }) => {
    const html = await (await request.get('/en')).text();
    const { migration, nextThemes, all } = themeScripts(html);

    expect(migration, 'migration script missing from the served HTML').toBeGreaterThan(-1);
    expect(nextThemes, "next-themes' script missing from the served HTML").toBeGreaterThan(-1);
    // Document order IS execution order for classic inline scripts. This is
    // the whole contract: the legacy value is normalised before next-themes
    // reads it.
    expect(migration).toBeLessThan(nextThemes);

    // And it must not be deferred out of the parse. `async`, `defer` or `src`
    // would each let the parser run on and paint first — which is the one
    // property being server-rendered was for.
    const tag = all[migration]!.attrs;
    expect(tag).not.toMatch(/\basync\b/);
    expect(tag).not.toMatch(/\bdefer\b/);
    expect(tag).not.toMatch(/\bsrc=/);
  });

  test('ships it on the /admin document root too', async ({ request }) => {
    // `/admin` is a second, independent `<html>`/`<body>` with its own
    // ThemeProvider. A bootstrap wired into only one root would leave admin
    // visitors on a legacy value.
    //
    // The status is deliberately not asserted: unauthenticated `/admin` is
    // allowed to 404 or redirect, and the point here is that whatever document
    // it does serve still comes from `admin/layout.tsx` — which is precisely
    // why that layout is written to always succeed.
    //
    // Only the bootstrap's PRESENCE is checked, not its ordering against
    // next-themes: the rejected-admin document does not always mount the full
    // client tree, so next-themes' script legitimately may not be there at
    // all. Ordering is a property of the shared markup and is asserted once,
    // on `/en`, above.
    const html = await (await request.get('/admin')).text();
    const { migration } = themeScripts(html);

    expect(migration, 'migration script missing from the /admin document').toBeGreaterThan(-1);
  });

  test('runs before paint, not after hydration', async ({ page }) => {
    // A `useEffect` migration would also end up with the right class
    // eventually — the difference is WHEN. Committing at `domcontentloaded`
    // and reading immediately catches anything that waits for React.
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'system'],
    );
    await page.goto('/en', { waitUntil: 'commit' });

    // The storage value is already rewritten while the document is still
    // parsing — no React involved.
    await page.waitForFunction((key) => window.localStorage.getItem(key) === 'dark', STORAGE_KEY, {
      timeout: 5_000,
    });
    expect(await page.evaluate(() => document.documentElement.classList.contains('system'))).toBe(
      false,
    );
  });
});

/**
 * The CSS-only path, with JavaScript disabled. next-themes cannot run, so no
 * class is set and the stylesheet alone decides — which is what a user sees
 * before hydration, and what a no-JS user sees permanently.
 *
 * With System mode removed there is no `prefers-color-scheme` block left in
 * globals.css, so this path is now simple: no class, no media query, `:root`
 * — dark, whatever the OS says. That is the same answer every other layer
 * gives, which is the point of removing the block rather than leaving it to
 * contradict them.
 */
test.describe('theme without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the dark palette from CSS alone when the OS prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en');
    expect(await page.evaluate(resolvedColorScheme)).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.className)).not.toContain('dark');
  });

  test('renders the dark palette from CSS alone even when the OS prefers LIGHT', async ({
    page,
  }) => {
    // This used to assert light, from the `prefers-color-scheme` block in
    // globals.css. That block is gone with System mode: without JavaScript
    // there is no control on the page that could take a user back out of a
    // light theme the product no longer offers them, so the CSS-only fallback
    // is the product default like every other layer.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    expect(await page.evaluate(resolvedColorScheme)).toBe('dark');
  });

  test('still paints a complete theme rather than unstyled content', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // The dark canvas, #0d0d0d — a neutral near-black from the visual
    // foundation pass. What this case actually guards is unchanged: with no
    // JavaScript at all, the page still paints a real theme rather than
    // unstyled content, so the literal is asserted rather than derived.
    expect(background).toBe('rgb(13, 13, 13)');
  });
});

test.describe('theme toggle', () => {
  test('persists a choice across a reload', async ({ page }) => {
    // No seeding: an `addInitScript` would re-run on the reload and write the
    // value straight back, which would make this pass no matter what
    // persistence actually did. The starting point is the product default.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en');
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');

    // A toggle, not a picker: one press flips it.
    await page.getByRole('button', { name: /change theme/i }).click();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');

    await page.reload();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
  });

  test('opens no menu — two values do not need a surface to choose between', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('button', { name: /change theme/i }).click();

    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('offers no System option anywhere', async ({ page }) => {
    await page.goto('/en');
    const control = page.getByRole('button', { name: /change theme/i });

    await expect(control).toHaveCount(1);
    expect(await control.getAttribute('aria-label')).not.toMatch(/system/i);
  });

  test('flips back and forth, and says which state it is in', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'dark'],
    );
    await page.goto('/en');

    const control = page.getByRole('button', { name: /change theme/i });
    // The accessible name states the CURRENT value, which is the only place a
    // toggle with no visible label can say it.
    await expect(control).toHaveAccessibleName(/dark/i);

    await control.click();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('light');
    await expect(control).toHaveAccessibleName(/light/i);

    await control.click();
    await expect.poll(() => page.evaluate(resolvedColorScheme)).toBe('dark');
    await expect(control).toHaveAccessibleName(/dark/i);
  });

  test('does not flash the wrong theme before hydration', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, 'dark'],
    );

    await page.goto('/en', { waitUntil: 'commit' });
    // The blocking script next-themes injects runs before first paint, so the
    // class is present as soon as documentElement exists — no light flash.
    await page.waitForFunction(() => document.documentElement?.classList.contains('dark'));
    expect(await page.evaluate(resolvedColorScheme)).toBe('dark');
  });
});

test.describe('motion', () => {
  test('keeps functional feedback while removing spatial and decorative reduced motion', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en');

    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true);

    const publicMotion = await page.evaluate(() => {
      const entranceStyle = getComputedStyle(document.querySelector('.animate-rise')!);
      const ctaStyle = getComputedStyle(document.querySelector('a[href$="/register"]')!);
      const pulseProbe = document.createElement('div');
      pulseProbe.className = 'animate-pulse';
      document.body.append(pulseProbe);
      const pulseName = getComputedStyle(pulseProbe).animationName;
      pulseProbe.remove();
      return {
        entranceName: entranceStyle.animationName,
        feedbackDuration: Number.parseFloat(ctaStyle.transitionDuration),
        pulseName,
      };
    });
    expect(publicMotion.entranceName).toBe('none');
    expect(publicMotion.pulseName).toBe('none');
    expect(publicMotion.feedbackDuration).toBeGreaterThanOrEqual(0.08);
    expect(publicMotion.feedbackDuration).toBeLessThanOrEqual(0.12);

    await page.goto('/en/app');
    // The mobile project keeps the desktop sidebar in the DOM but hidden until
    // its drawer opens, so assert branch selection rather than visibility.
    await expect(page.locator('[data-active-indicator="static"]')).toHaveCount(1);
    await expect(page.locator('[data-active-indicator="animated"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Account menu' }).click();
    const menuMotion = await page.locator('[data-slot="dropdown-menu-content"]').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        duration: Number.parseFloat(style.animationDuration),
        transform: style.transform,
      };
    });
    expect(menuMotion.name).toContain('reduced-fade-in');
    expect(menuMotion.duration).toBeGreaterThanOrEqual(0.08);
    expect(menuMotion.duration).toBeLessThanOrEqual(0.12);
    expect(menuMotion.transform).toBe('none');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const sheetMotion = await page.getByRole('dialog').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        duration: Number.parseFloat(style.animationDuration),
        transform: style.transform,
      };
    });
    expect(sheetMotion.name).toContain('reduced-fade-in');
    expect(sheetMotion.duration).toBeGreaterThanOrEqual(0.1);
    expect(sheetMotion.duration).toBeLessThanOrEqual(0.14);
    expect(sheetMotion.transform).toBe('none');
  });

  test('animates the drawer when reduced motion is not requested', async ({ page }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');
    await page.getByRole('button', { name: /open navigation menu/i }).click();

    const animationName = await page
      .getByRole('dialog')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toContain('sheet-content-in');
  });
});
