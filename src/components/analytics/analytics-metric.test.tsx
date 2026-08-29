import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../messages/en.json';
import { AnalyticsMetricDisplay } from './analytics-metric';

function renderMetric(prominent = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <dl>
        <AnalyticsMetricDisplay
          label="Total R"
          metric={{ status: 'available', value: '2.5000' }}
          style="r"
          prominent={prominent}
        />
      </dl>
    </NextIntlClientProvider>,
  );
}

describe('AnalyticsMetricDisplay typography', () => {
  it('replaces the shared metric size with the standard analytics size and keeps tone', () => {
    renderMetric();

    expect(screen.getByText('+2.50R')).toHaveClass('text-xl', 'text-positive');
    expect(screen.getByText('+2.50R')).not.toHaveClass('text-metric');
  });

  it('keeps the prominent analytics size distinct from the shared metric role', () => {
    renderMetric(true);

    expect(screen.getByText('+2.50R')).toHaveClass('text-3xl', 'text-positive');
    expect(screen.getByText('+2.50R')).not.toHaveClass('text-metric');
  });
});
