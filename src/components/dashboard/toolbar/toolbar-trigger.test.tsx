import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolbarTrigger } from './toolbar-trigger';

function renderTrigger(props: Partial<React.ComponentProps<typeof ToolbarTrigger>> = {}) {
  return render(
    <ToolbarTrigger icon={<span data-testid="icon" />} {...props}>
      {props.children ?? 'Date range'}
    </ToolbarTrigger>,
  );
}

/**
 * The motion contract of the one shape all three toolbar controls wear.
 *
 * These assert CLASSES rather than computed animation, because jsdom applies
 * no stylesheet: the claim under test is that the trigger declares the right
 * behaviour and the right reduced-motion escape, which is exactly what the
 * class list is. The rendered result is a browser concern.
 */
describe('ToolbarTrigger motion', () => {
  it('acknowledges a press with a transform, so no neighbour in the row moves', () => {
    renderTrigger();
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(trigger).toHaveClass('active:scale-[0.98]');
    // A transform, never a width/height/padding change — the button holds its
    // box in the toolbar's flex row at every point in the gesture.
    expect(trigger.className).not.toMatch(/active:(w-|h-|p-|px-|py-|m-)/);
  });

  it('puts colour and transform on one restrained clock, never `transition-all`', () => {
    renderTrigger();
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(trigger).toHaveClass(
      'transition-[color,background-color,border-color,transform]',
      'duration-150',
    );
    // `transition-all` would drag the focus ring and the box metrics along
    // with it, which is how a control ends up lagging its own outline.
    expect(trigger.className).not.toContain('transition-all');
  });

  it('drops the travel under reduced motion while keeping every state legible', () => {
    renderTrigger();
    const trigger = screen.getByRole('button', { name: /date range/i });
    // The press deflection is suppressed outright, and the colour change
    // becomes instant rather than being removed — hover and open still read.
    expect(trigger).toHaveClass('motion-reduce:transition-none', 'motion-reduce:active:scale-100');
    expect(trigger).toHaveClass('hover:bg-accent', 'data-[state=open]:bg-accent');
  });

  /*
    The chevron reads the BUTTON's own Radix `data-state` through a named
    group, so open/closed has exactly one source of truth. Named rather than
    a bare `group`, because these triggers render inside toolbars and panels
    that may own groups of their own.
  */
  it('rotates the chevron from the trigger state through a named group', () => {
    const { container } = renderTrigger();
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(trigger).toHaveClass('group/toolbar-trigger');

    const chevron = container.querySelector('svg:last-of-type');
    expect(chevron).toHaveClass('group-data-[state=open]/toolbar-trigger:rotate-180');
    expect(chevron).toHaveClass('transition-transform', 'motion-reduce:transition-none');
    // Decorative: the direction it points restates the button's own
    // `aria-expanded`, so it must not be announced a second time.
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the frozen geometry — the motion pass moved no box', () => {
    renderTrigger();
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(trigger).toHaveClass('h-11', 'min-w-11', 'rounded-lg', 'px-3', 'gap-2');
  });

  it('still forwards its props so Radix `asChild` lands on the real button', () => {
    renderTrigger({ 'aria-expanded': true, 'data-state': 'open' } as never);
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('type', 'button');
  });
});
