import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';

const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/hooks/use-is-desktop-viewport', () => ({
  useIsDesktopViewport: () => viewport.desktop,
}));

afterEach(() => {
  viewport.desktop = false;
});

function sheet(size: 'wide' | 'focused' | 'compact') {
  render(
    <TradeAdaptiveOverlay
      open
      onOpenChange={() => {}}
      title="Direction"
      description="Which way did you trade?"
      closeLabel="Close"
      size={size}
    >
      <p>Long or Short</p>
    </TradeAdaptiveOverlay>,
  );
  return screen.getByRole('dialog');
}

/*
  THE PHONE SHEET'S HEIGHT BY SIZE. \`focused\` keeps its floor — just under half
  the screen however little it holds; \`compact\` is as tall as its content, for
  a simple selection; all of them keep the same ceiling.
*/
describe('TradeAdaptiveOverlay sizes on a phone', () => {
  it('focused keeps its floor', () => {
    const dialog = sheet('focused');
    expect(dialog).toHaveAttribute('data-sheet-size', 'focused');
    expect(dialog.className).toContain('min-h-[45dvh]');
    expect(dialog.className).toContain('max-h-[92dvh]');
  });

  it('compact follows its content, with the same ceiling', () => {
    const dialog = sheet('compact');
    expect(dialog).toHaveAttribute('data-sheet-size', 'compact');
    expect(dialog.className).not.toContain('min-h-[45dvh]');
    expect(dialog.className).toContain('max-h-[92dvh]');
  });

  it('wide never had a floor', () => {
    expect(sheet('wide').className).not.toContain('min-h-[45dvh]');
  });

  it('focused and compact read the title with its line, with no grab handle — and wide keeps its own', () => {
    for (const size of ['focused', 'compact'] as const) {
      const dialog = sheet(size);
      expect(dialog.querySelector('[data-sheet-handle]')).toBeNull();
      // The description reads with the title, above the body, not inside it.
      const body = dialog.querySelector('[data-sheet-body]')!;
      expect(body.contains(screen.getByText('Which way did you trade?'))).toBe(false);
      cleanup();
    }
    const wide = sheet('wide');
    expect(
      wide
        .querySelector('[data-sheet-body]')!
        .contains(screen.getByText('Which way did you trade?')),
    ).toBe(true);
  });

  it('hides a description it is told to from sight, never from assistive technology', () => {
    render(
      <TradeAdaptiveOverlay
        open
        onOpenChange={() => {}}
        title="Outcome"
        description="How you judge this trade"
        closeLabel="Close"
        size="compact"
        hideDescription
      >
        <p>Win, BE or Loss</p>
      </TradeAdaptiveOverlay>,
    );
    const description = screen.getByText('How you judge this trade');
    expect(description.className.split(' ')).toContain('sr-only');
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('How you judge this trade');
  });

  it('compact is the focused dialog on a desktop', () => {
    viewport.desktop = true;
    const compact = sheet('compact');
    expect(compact.className).toContain('max-w-[35rem]');
  });
});
