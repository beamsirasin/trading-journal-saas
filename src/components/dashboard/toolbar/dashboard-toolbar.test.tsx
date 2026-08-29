import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardToolbar, DashboardToolbarControlsSkeleton } from './dashboard-toolbar';

function renderToolbar(controls: React.ReactNode = <button type="button">Date range</button>) {
  return render(<DashboardToolbar title="Dashboard" controls={controls} />);
}

describe('DashboardToolbar', () => {
  it('owns the page heading, so the Dashboard identifies itself in the persistent bar', () => {
    renderToolbar();
    const heading = screen.getByRole('heading', { level: 1, name: 'Dashboard' });
    expect(heading).toBeVisible();
    expect(document.querySelector('[data-dashboard-toolbar]')).toContainElement(heading);
  });

  it('sticks beneath the global header, tracking the header height at each breakpoint', () => {
    const { container } = renderToolbar();
    const bar = container.querySelector('[data-dashboard-toolbar]');
    expect(bar).toHaveClass('sticky');
    // The header is `sticky top-0 z-40`; this sits directly under it and below
    // it in the stack, and switches offsets at exactly `lg`, where the header
    // itself changes height.
    expect(bar).toHaveClass('top-[var(--shell-header-height-mobile)]');
    expect(bar).toHaveClass('lg:top-[var(--shell-header-height)]');
    expect(bar).toHaveClass('z-30');
  });

  it('carries a permanent border and an opaque fill rather than a scroll-triggered shadow', () => {
    const { container } = renderToolbar();
    const bar = container.querySelector('[data-dashboard-toolbar]');
    // A border that is always present cannot cause the reflow that a
    // scroll-listener-driven one does.
    expect(bar).toHaveClass('border-b');
    expect(bar).toHaveClass('bg-background');
    expect(bar?.className).not.toContain('shadow');
  });

  it('places the controls it is given beside the heading', () => {
    renderToolbar(<button type="button">Filters</button>);
    expect(screen.getByRole('button', { name: 'Filters' })).toBeVisible();
  });

  it('renders the bar and its heading even when there are no controls to show', () => {
    renderToolbar(null);
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

describe('DashboardToolbarControlsSkeleton', () => {
  it('reserves three control-height blocks so the sticky bar does not resize on arrival', () => {
    const { container } = render(<DashboardToolbarControlsSkeleton />);
    const blocks = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block).toHaveClass('h-11');
    // Decoration only: it must never be announced or reachable.
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
