import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from './theme-provider';
import { ThemeToggle } from './theme-toggle';

/**
 * These tests deliberately do NOT assert which theme is active by default.
 *
 * jsdom's matchMedia is a stub that reports `matches: false` for every query,
 * so `prefers-color-scheme` cannot be exercised meaningfully here. Asserting
 * a default would be asserting the stub. Real precedence — saved choice, then
 * OS preference, then fallback — is covered in e2e, where the browser can
 * actually emulate a preference.
 */

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
  });

  it('exposes an accessible control once mounted', async () => {
    renderToggle();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change theme/i })).toBeEnabled();
    });
  });

  it('offers light, dark and system', async () => {
    const user = userEvent.setup();
    renderToggle();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change theme/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /change theme/i }));

    // "System" must be a distinct option — a two-state switch cannot express
    // "follow my OS", and dropping it would regress anyone who schedules dark
    // mode by time of day.
    expect(await screen.findByRole('menuitem', { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /system/i })).toBeInTheDocument();
  });

  it('persists an explicit choice', async () => {
    const user = userEvent.setup();
    renderToggle();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change theme/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /change theme/i }));
    await user.click(await screen.findByRole('menuitem', { name: /dark/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem('trading-os-theme')).toBe('dark');
    });
  });

  it('applies the chosen theme as a class on the document element', async () => {
    const user = userEvent.setup();
    renderToggle();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change theme/i })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: /change theme/i }));
    await user.click(await screen.findByRole('menuitem', { name: /light/i }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  it('restores a previously saved choice', async () => {
    window.localStorage.setItem('trading-os-theme', 'dark');
    renderToggle();

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });
});
