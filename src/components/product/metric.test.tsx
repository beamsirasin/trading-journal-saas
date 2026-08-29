import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiCard } from './kpi-card';
import { MetricValue } from './metric';

describe('shared metric typography', () => {
  it.each([
    ['positive', 'text-positive'],
    ['negative', 'text-negative'],
    ['warning', 'text-warning'],
    ['neutral', 'text-foreground'],
  ] as const)('keeps the MetricValue size role with the %s tone', (tone, toneClass) => {
    render(<MetricValue value="+2.50R" tone={tone} />);

    expect(screen.getByText('+2.50R')).toHaveClass('text-metric', toneClass);
  });

  it('allows an explicit MetricValue size to replace the shared size without losing tone', () => {
    render(<MetricValue value="+2.50R" tone="positive" className="text-xl" />);

    expect(screen.getByText('+2.50R')).toHaveClass('text-xl', 'text-positive');
    expect(screen.getByText('+2.50R')).not.toHaveClass('text-metric');
  });

  it('keeps the KpiCard size role with its tone', () => {
    const { container } = render(
      <KpiCard label="Net P&L" value="1,243.50" prefix="$" tone="positive" animate={false} />,
    );

    expect(container.querySelector('[data-kpi="Net P&L"] p')).toHaveClass(
      'text-metric',
      'text-positive',
    );
  });
});
