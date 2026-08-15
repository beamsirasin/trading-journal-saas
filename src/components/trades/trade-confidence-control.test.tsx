import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { TradeConfidenceControl } from './trade-confidence-control';

function Harness({ initial }: { initial: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <TradeConfidenceControl id="confidence" label="Confidence" value={value} onChange={setValue} />
  );
}

function renderControl(initial: number | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Harness initial={initial} />
    </NextIntlClientProvider>,
  );
}

function radio(name: string) {
  return screen.getByRole('radio', { name });
}

const OPTION_NAME: Record<0 | 25 | 50 | 75 | 100, string> = {
  0: '0% · Very Low',
  25: '25% · Low',
  50: '50% · Neutral',
  75: '75% · High',
  100: '100% · Very High',
};

describe('TradeConfidenceControl', () => {
  it('renders unset with "Not set", no step checked, and no reset affordance', () => {
    renderControl(null);
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
    for (const step of [0, 25, 50, 75, 100] as const) {
      expect(radio(OPTION_NAME[step])).not.toBeChecked();
    }
    expect(screen.queryByRole('button', { name: 'Clear confidence' })).not.toBeInTheDocument();
  });

  it('exposes an accessible group name of "Confidence"', () => {
    renderControl(null);
    expect(screen.getByRole('group', { name: 'Confidence' })).toBeInTheDocument();
  });

  it.each([0, 25, 50, 75, 100] as const)('selects %i%% by clicking its segment', (step) => {
    renderControl(null);
    fireEvent.click(radio(OPTION_NAME[step]));
    expect(radio(OPTION_NAME[step])).toBeChecked();
    expect(screen.getByText(OPTION_NAME[step])).toBeInTheDocument();
  });

  it('changes selection from one step to another', () => {
    renderControl(25);
    expect(radio(OPTION_NAME[25])).toBeChecked();
    fireEvent.click(radio(OPTION_NAME[75]));
    expect(radio(OPTION_NAME[75])).toBeChecked();
    expect(radio(OPTION_NAME[25])).not.toBeChecked();
  });

  it('clears back to unset via the reset affordance, shown only when a value is selected', () => {
    renderControl(50);
    const resetButton = screen.getByRole('button', { name: 'Clear confidence' });
    fireEvent.click(resetButton);
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
    expect(radio(OPTION_NAME[50])).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Clear confidence' })).not.toBeInTheDocument();
  });

  it('ArrowRight moves forward one discrete step at a time and clamps at 100', () => {
    renderControl(75);
    const group = screen.getByRole('group', { name: 'Confidence' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(radio(OPTION_NAME[100])).toBeChecked();
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(radio(OPTION_NAME[100])).toBeChecked();
  });

  it('ArrowLeft moves backward one discrete step at a time and clamps at 0', () => {
    renderControl(25);
    const group = screen.getByRole('group', { name: 'Confidence' });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(radio(OPTION_NAME[0])).toBeChecked();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(radio(OPTION_NAME[0])).toBeChecked();
  });

  it('ArrowRight from unset lands on the first step (0%)', () => {
    renderControl(null);
    const group = screen.getByRole('group', { name: 'Confidence' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(radio(OPTION_NAME[0])).toBeChecked();
  });

  it('Home jumps straight to 0% from any step', () => {
    renderControl(75);
    const group = screen.getByRole('group', { name: 'Confidence' });
    fireEvent.keyDown(group, { key: 'Home' });
    expect(radio(OPTION_NAME[0])).toBeChecked();
  });

  it('End jumps straight to 100% from any step', () => {
    renderControl(25);
    const group = screen.getByRole('group', { name: 'Confidence' });
    fireEvent.keyDown(group, { key: 'End' });
    expect(radio(OPTION_NAME[100])).toBeChecked();
  });

  it('never produces a value between the five allowed steps, no matter how many arrow presses', () => {
    renderControl(0);
    const group = screen.getByRole('group', { name: 'Confidence' });
    for (let i = 0; i < 12; i += 1) {
      fireEvent.keyDown(group, { key: 'ArrowRight' });
    }
    // Clamped at 100, never overshoots or lands off-step.
    expect(radio(OPTION_NAME[100])).toBeChecked();
  });

  // Framer Motion's drag gesture relies on real pointer-capture and layout
  // geometry that jsdom does not provide, so genuine drag-and-snap behavior
  // is proven by the Playwright coverage in e2e/trades.spec.ts, not here.
  // These tests cover what RTL *can* prove: the drag surface's structural
  // contract stays correct alongside the unchanged click/keyboard paths.
  describe('drag surface (structural contract)', () => {
    it('renders no draggable pill when unset', () => {
      const { container } = renderControl(null);
      expect(container.querySelector('[data-slot="confidence-pill"]')).not.toBeInTheDocument();
    });

    it('renders exactly one draggable pill once a step is selected', () => {
      const { container } = renderControl(50);
      const pills = container.querySelectorAll('[data-slot="confidence-pill"]');
      expect(pills).toHaveLength(1);
      expect(pills[0]).toHaveAttribute('aria-hidden', 'true');
    });

    it('the pill is aria-hidden and every step keeps its own accessible name from the radio, not the decorative overlay text', () => {
      renderControl(50);
      for (const step of [0, 25, 50, 75, 100] as const) {
        expect(radio(OPTION_NAME[step])).toBeInTheDocument();
      }
    });

    it('dispatching pointer events at the pill without a recognized Framer drag gesture never calls onChange with an off-step value', () => {
      renderControl(25);
      const pill = document.querySelector('[data-slot="confidence-pill"]');
      expect(pill).not.toBeNull();
      // jsdom has no real layout, so this cannot exercise Framer's drag
      // state machine — it only proves that firing raw pointer events at
      // the pill can't sneak an intermediate value into the committed
      // radio state.
      fireEvent.pointerDown(pill as Element, { clientX: 10 });
      fireEvent.pointerMove(pill as Element, { clientX: 43 });
      fireEvent.pointerUp(pill as Element, { clientX: 43 });
      expect(radio(OPTION_NAME[25])).toBeChecked();
      for (const step of [0, 50, 75, 100] as const) {
        expect(radio(OPTION_NAME[step])).not.toBeChecked();
      }
    });
  });
});
