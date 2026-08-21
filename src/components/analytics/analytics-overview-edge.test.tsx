import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric, SetupAdherenceAnalyticsModel } from '@/lib/analytics/metrics';

import en from '../../../messages/en.json';
import { EdgeZone } from './analytics-overview-edge';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

function adherence(
  overrides: Partial<SetupAdherenceAnalyticsModel> = {},
): SetupAdherenceAnalyticsModel {
  return {
    sampleCount: 20,
    averageAdherence: available('0.8200'),
    conditionsMetRate: available('0.9000'),
    buckets: [],
    ...overrides,
  };
}

function renderZone(model = adherence()) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EdgeZone setupAdherence={model} />
    </NextIntlClientProvider>,
  );
}

describe('EdgeZone', () => {
  it('leads with Setup Adherence as the hero, with its existing factual sample support', () => {
    renderZone();
    expect(screen.getByText('82.00%')).toBeVisible();
    expect(screen.getByText('Average Setup Adherence')).toBeVisible();
    expect(screen.getByText('20 Trades with recorded, applicable Setup Conditions')).toBeVisible();
  });

  it('never invents a Strategy/Setup ranking placeholder — Phase 15D scope, not 15C', () => {
    renderZone();
    expect(screen.queryByText(/Best Strategy|Best Setup|Coming soon/i)).not.toBeInTheDocument();
  });

  it('shows a calm empty state when no Setup Checklist data was recorded at entry', () => {
    renderZone(
      adherence({
        sampleCount: 0,
        averageAdherence: { status: 'unavailable', reason: 'no_conditions_applicable' },
      }),
    );
    expect(screen.getByText('No Setup Checklist data recorded at entry')).toBeVisible();
  });

  it('links Explore to the existing detailed Setup Quality section', () => {
    renderZone();
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '#analytics-setup-quality-heading',
    );
  });
});
