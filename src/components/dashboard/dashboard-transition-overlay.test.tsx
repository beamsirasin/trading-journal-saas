import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { DASHBOARD_TRANSITION_EVENT, signalDashboardTransition } from './dashboard-state-link';
import { DashboardTransitionOverlay } from './dashboard-transition-overlay';

function renderOverlay() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DashboardTransitionOverlay />
    </NextIntlClientProvider>,
  );
}

function startTransition() {
  act(() => {
    signalDashboardTransition();
  });
}

describe('DashboardTransitionOverlay', () => {
  /**
   * Nothing on the page may pay for a loading state that is not happening.
   * The overlay renders literally no DOM until a transition is announced.
   */
  it('renders nothing before a transition is announced', () => {
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the branded mark and its copy once a transition starts', () => {
    renderOverlay();
    startTransition();
    expect(screen.getByText('Updating dashboard…', { selector: 'p.text-sm' })).toBeVisible();
    expect(screen.getByText('Refreshing your performance data')).toBeVisible();
  });

  /**
   * The transport is a native document navigation, so the overlay cannot be
   * dismissed by anything arriving — the document it lives in is replaced.
   * That makes "never blocks input" a correctness property, not a nicety: a
   * veil that captured clicks and had no way to learn a navigation was
   * cancelled would strand the reader under it.
   */
  it('never intercepts pointer input', () => {
    const { container } = renderOverlay();
    startTransition();
    const layers = container.querySelectorAll('[data-dashboard-transition]');
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.className).toContain('pointer-events-none');
    }
  });

  /** The veil covers content only; the toolbar sits above it at `z-30`. */
  it('layers the veil and mark below the sticky toolbar', () => {
    const { container } = renderOverlay();
    startTransition();
    expect(
      (container.querySelector('[data-dashboard-transition="veil"]') as HTMLElement).className,
    ).toContain('z-10');
    expect(
      (container.querySelector('[data-dashboard-transition="mark"]') as HTMLElement).className,
    ).toContain('z-20');
  });

  it('announces once, politely, and only while pending', () => {
    const { container } = renderOverlay();
    startTransition();
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toBe('Updating dashboard…');
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  /**
   * A cancelled navigation fires no event of its own, so Escape is the
   * reader's own way out of a veil that would otherwise never lift.
   */
  it('clears on Escape', () => {
    const { container } = renderOverlay();
    startTransition();
    expect(container).not.toBeEmptyDOMElement();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container).toBeEmptyDOMElement();
  });

  /** Back into the bfcache restores this very document, overlay and all. */
  it('clears when the document is restored by a back navigation', () => {
    const { container } = renderOverlay();
    startTransition();
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('detaches its listeners on unmount', () => {
    const { unmount } = renderOverlay();
    unmount();
    // Would throw on a setState against an unmounted tree if it did not.
    expect(() => window.dispatchEvent(new Event(DASHBOARD_TRANSITION_EVENT))).not.toThrow();
  });
});
