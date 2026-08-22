import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type {
  AnalyticsMetric,
  ConfidenceAnalyticsModel,
  DimensionAxisSummary,
  EmotionGroupModel,
} from '@/lib/analytics/metrics';

import en from '../../../messages/en.json';
import { BehaviorZone } from './analytics-overview-behavior';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable: AnalyticsMetric = { status: 'unavailable', reason: 'no_trades' };

function dimAxis(tradeCount: number, averageR: string | null): DimensionAxisSummary {
  return {
    tradeCount,
    averageR: averageR === null ? unavailable : available(averageR),
    winRate: unavailable,
  };
}

function confidence(
  levels: readonly { level: 0 | 25 | 50 | 75 | 100; tradeCount: number; averageR: string | null }[],
): ConfidenceAnalyticsModel {
  return {
    sampleCount: levels.reduce((sum, l) => sum + l.tradeCount, 0),
    averageConfidence: available('0.5000'),
    levels: levels.map((l) => ({
      level: l.level,
      trader: dimAxis(l.tradeCount, l.averageR),
      system: dimAxis(0, null),
    })),
  };
}

function emotion(
  key: string,
  label: string,
  tradeCount: number,
  averageR: string | null,
): EmotionGroupModel {
  return { key, label, trader: dimAxis(tradeCount, averageR), system: dimAxis(0, null) };
}

function renderZone(
  confidenceModel: ConfidenceAnalyticsModel = confidence([
    { level: 75, tradeCount: 12, averageR: '1.7000' },
  ]),
  emotions: readonly EmotionGroupModel[] = [emotion('focused', 'Focused', 9, '1.4000')],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BehaviorZone
        confidence={confidenceModel}
        emotions={emotions}
        exploreHref="/app/analytics?view=behavior&range=90d"
      />
    </NextIntlClientProvider>,
  );
}

describe('BehaviorZone', () => {
  it('shows the strongest observed Confidence level, not the full bucket table', () => {
    renderZone();
    expect(screen.getByText('Strongest observed confidence')).toBeVisible();
    expect(screen.getByText('75%')).toBeVisible();
    expect(screen.getByText('+1.70R Avg')).toBeVisible();
    expect(screen.getByText('12 Trades')).toBeVisible();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('allows a strongest observed Confidence of exactly 0%, never confusing it with "no data"', () => {
    renderZone(confidence([{ level: 0, tradeCount: 4, averageR: '2.0000' }]));
    expect(screen.getByText('0%')).toBeVisible();
    expect(
      screen.queryByText('No Confidence data recorded for this analysis'),
    ).not.toBeInTheDocument();
  });

  it('shows a calm empty state when no Confidence was recorded', () => {
    renderZone(confidence([]));
    expect(screen.getByText('No Confidence data recorded for this analysis')).toBeVisible();
  });

  it('shows the strongest observed Emotion and a genuine concern with non-causal phrasing', () => {
    renderZone(undefined, [
      emotion('focused', 'Focused', 12, '1.4000'),
      emotion('fearful', 'Fearful', 5, '-0.7000'),
    ]);
    expect(screen.getByText('Strongest observed state')).toBeVisible();
    expect(screen.getByText('Focused')).toBeVisible();
    expect(screen.getByText('+1.40R Avg')).toBeVisible();
    expect(screen.getByText('Worth reviewing')).toBeVisible();
    expect(screen.getByText('Fearful')).toBeVisible();
    expect(screen.getByText('-0.70R Avg')).toBeVisible();
    expect(screen.queryByText(/causes|because of/i)).not.toBeInTheDocument();
  });

  it('omits the concern card when only one Emotion group has data, never fabricating a second', () => {
    renderZone(undefined, [emotion('focused', 'Focused', 12, '1.4000')]);
    expect(screen.getByText('Strongest observed state')).toBeVisible();
    expect(screen.queryByText('Worth reviewing')).not.toBeInTheDocument();
  });

  it('shows a calm empty state when no Emotion was recorded', () => {
    renderZone(undefined, []);
    expect(screen.getByText('No Emotion data recorded for this analysis')).toBeVisible();
  });

  it('links Explore to the Behavior URL view while preserving filters', () => {
    renderZone();
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/en/app/analytics?view=behavior&range=90d',
    );
  });
});
