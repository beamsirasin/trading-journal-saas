import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { ThemeBootstrap } from './theme-bootstrap';
import { DEFAULT_THEME, LEGACY_SYSTEM_MIGRATION, THEME_STORAGE_KEY } from './theme-contract';
import { ThemeProvider } from './theme-provider';
import { ThemeToggle } from './theme-toggle';

/**
 * The theme contract is TWO STATES, defaulting to Dark. There is no System
 * mode and no `prefers-color-scheme` involvement at any layer, so unlike the
 * previous version of this file there is no longer anything here that jsdom's
 * matchMedia stub could misreport — the default is a constant, and asserting
 * it is asserting the product.
 *
 * What still belongs in e2e rather than here: no-flash-before-hydration, which
 * needs a real blocking script and a real first paint.
 */

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const control = () => screen.getByRole('button', { name: /change theme/i });

async function mounted() {
  await waitFor(() => expect(control()).toBeEnabled());
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
  });

  it('exposes an accessible control once mounted', async () => {
    renderToggle();
    await mounted();
    expect(control()).toBeEnabled();
  });

  it('is a toggle, not a picker — it opens no menu', async () => {
    // Two values do not need a surface to choose between them. The control
    // used to open a three-item menu; activating it now simply flips.
    const user = userEvent.setup();
    renderToggle();
    await mounted();

    await user.click(control());

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('offers no System option anywhere in its accessible name', async () => {
    renderToggle();
    await mounted();
    expect(control().getAttribute('aria-label')).not.toMatch(/system/i);
  });

  it('states the current theme in its accessible name, since it has no visible label', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    await mounted();

    expect(control()).toHaveAccessibleName(
      en.settings.appearance.toggleLabelWithTheme.replace('{theme}', en.settings.appearance.light),
    );
  });

  it('flips dark to light, and persists it', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderToggle();
    await mounted();

    await user.click(control());

    await waitFor(() => {
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('flips light back to dark', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderToggle();
    await mounted();

    await user.click(control());

    await waitFor(() => {
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('restores a previously saved choice', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderToggle();

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });

  it('defaults to dark when nothing has ever been chosen', async () => {
    renderToggle();

    await waitFor(() => {
      expect(document.documentElement.classList.contains(DEFAULT_THEME)).toBe(true);
    });
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('still resolves to a real theme if a legacy `system` value survives', async () => {
    // The migration script (asserted below) normally means this cannot
    // happen. This is the second line of defence: a tab left open across the
    // change, where the script already ran with the old value present. The
    // CONTROL must still describe a real theme rather than announcing a mode
    // the product no longer has.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    renderToggle();
    await mounted();

    expect(control().getAttribute('aria-label')).not.toMatch(/system/i);
    expect(control()).toHaveAccessibleName(
      en.settings.appearance.toggleLabelWithTheme.replace(
        '{theme}',
        en.settings.appearance[DEFAULT_THEME],
      ),
    );
  });
});

/**
 * The pre-paint migration, run as the real artefact.
 *
 * It ships as a string inside `dangerouslySetInnerHTML`, so a test that
 * re-implemented its logic would prove nothing about what actually executes in
 * the browser. This evaluates the exported constant itself.
 */
describe('legacy `system` migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const run = () => {
    // Deliberately executing the SHIPPED script, not a re-implementation of it.
    (0, eval)(LEGACY_SYSTEM_MIGRATION);
  };

  it('rewrites a stored `system` to the product default', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    run();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(DEFAULT_THEME);
  });

  it('leaves an explicit light choice alone', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('leaves an explicit dark choice alone', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('writes nothing at all when no choice was ever made', () => {
    // A first-time visitor must stay "no stored preference", not be given one
    // — otherwise the default could never change again without a second
    // migration.
    run();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('rewrites any other unrecognised value too', () => {
    // Not a `system`-specific patch: anything outside the theme list would
    // otherwise be applied verbatim as a class.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    run();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(DEFAULT_THEME);
  });
});

/**
 * The regression this file exists to prevent recurring.
 *
 * The migration script was briefly rendered by `ThemeProvider`, which is a
 * CLIENT component. React 19 warns about that — "Encountered a script tag
 * while rendering React component. Scripts inside React components are never
 * executed when rendering on the client" — and the warning is not pedantry:
 * a `<script>` node that React creates on the client never runs its content,
 * so the migration would have silently stopped working the moment anything
 * caused the provider to render client-side rather than hydrate.
 */
describe('pre-paint bootstrap placement', () => {
  it('ThemeProvider contributes no migration script of its own', () => {
    // Asserted on the rendered DOM rather than by reading the source, so it
    // still holds if the script comes back through a child component.
    const { container } = render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );

    for (const el of container.querySelectorAll('script')) {
      expect(el.textContent ?? '').not.toContain(LEGACY_SYSTEM_MIGRATION);
    }
  });

  it('leaves next-themes its OWN script, which is the library-owned one', () => {
    // Not a contradiction of the case above: next-themes renders its
    // class-setting script from inside the provider too, and guards it with
    // `React.memo` so the client never re-creates it. That one is expected,
    // and it is what prevents the flash of the wrong theme — the migration is
    // what had to move out, because it was neither memoized nor the library's
    // to reason about.
    const { container } = render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );

    expect(container.querySelectorAll('script')).toHaveLength(1);
  });

  it('ThemeBootstrap is the thing that carries the script', () => {
    // Server-rendered to static markup, which is exactly how it reaches the
    // browser: as part of the parsed document, not as a node React builds.
    const html = renderToStaticMarkup(<ThemeBootstrap />);

    expect(html).toContain('<script');
    expect(html).toContain(THEME_STORAGE_KEY);
    expect(html).toContain(DEFAULT_THEME);
  });

  it('emits a classic blocking script — no async, no defer, no src', () => {
    // Any of the three would let the parser continue past it, which is the
    // one property "pre-paint" depends on.
    const html = renderToStaticMarkup(<ThemeBootstrap />);

    expect(html).not.toMatch(/<script[^>]*\basync\b/);
    expect(html).not.toMatch(/<script[^>]*\bdefer\b/);
    expect(html).not.toMatch(/<script[^>]*\bsrc=/);
  });

  it('carries the exact migration the contract declares, not a copy of it', () => {
    expect(renderToStaticMarkup(<ThemeBootstrap />)).toContain(LEGACY_SYSTEM_MIGRATION);
  });
});
