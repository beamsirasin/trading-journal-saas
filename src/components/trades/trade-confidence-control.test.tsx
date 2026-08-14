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

function slider() {
  return screen.getByRole('slider', { name: 'Confidence' });
}

describe('TradeConfidenceControl', () => {
  it('renders unset with "Not set" and a neutral aria-valuetext', () => {
    renderControl(null);
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
    expect(slider()).toHaveAttribute('aria-valuetext', 'Not set');
  });

  it('exposes the full 0-100 ARIA range', () => {
    renderControl(42);
    const el = slider();
    expect(el).toHaveAttribute('aria-valuemin', '0');
    expect(el).toHaveAttribute('aria-valuemax', '100');
    expect(el).toHaveAttribute('aria-valuenow', '42');
  });

  it('maps every qualitative boundary correctly', () => {
    renderControl(0);
    expect(screen.getByText('0/100 · Very Low')).toBeInTheDocument();
    renderControl(20);
    expect(screen.getByText('20/100 · Very Low')).toBeInTheDocument();
    renderControl(21);
    expect(screen.getByText('21/100 · Low')).toBeInTheDocument();
    renderControl(50);
    expect(screen.getByText('50/100 · Neutral')).toBeInTheDocument();
    renderControl(61);
    expect(screen.getByText('61/100 · High')).toBeInTheDocument();
    renderControl(100);
    expect(screen.getByText('100/100 · Very High')).toBeInTheDocument();
  });

  it('moves by keyboard (ArrowRight/ArrowLeft, step 1) and clamps at the lower boundary', () => {
    renderControl(0);
    const el = slider();
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    expect(screen.getByText('0/100 · Very Low')).toBeInTheDocument();

    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(screen.getByText('1/100 · Very Low')).toBeInTheDocument();
  });

  it('clamps at the upper boundary', () => {
    renderControl(100);
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(screen.getByText('100/100 · Very High')).toBeInTheDocument();
  });

  it('PageUp/PageDown step by 10', () => {
    renderControl(50);
    const el = slider();
    fireEvent.keyDown(el, { key: 'PageUp' });
    expect(screen.getByText('60/100 · Neutral')).toBeInTheDocument();
    fireEvent.keyDown(el, { key: 'PageDown' });
    fireEvent.keyDown(el, { key: 'PageDown' });
    expect(screen.getByText('40/100 · Low')).toBeInTheDocument();
  });

  it('Home jumps to 0 and End jumps to 100', () => {
    renderControl(50);
    const el = slider();
    fireEvent.keyDown(el, { key: 'End' });
    expect(screen.getByText('100/100 · Very High')).toBeInTheDocument();
    fireEvent.keyDown(el, { key: 'Home' });
    expect(screen.getByText('0/100 · Very Low')).toBeInTheDocument();
  });

  it('arrow keys from unset start at the neutral midpoint (50)', () => {
    renderControl(null);
    const el = slider();
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(screen.getByText('51/100 · Neutral')).toBeInTheDocument();
  });

  it('clears back to unset via the Clear control', () => {
    renderControl(75);
    fireEvent.click(screen.getByRole('button', { name: 'Clear confidence' }));
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
  });

  it('is keyboard-focusable via a single tab stop', () => {
    renderControl(30);
    expect(slider()).toHaveAttribute('tabIndex', '0');
  });
});
