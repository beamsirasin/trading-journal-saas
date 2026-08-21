import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataReadinessLine, HeroMetric, InsightNote } from './summary-primitives';

describe('HeroMetric', () => {
  it('renders the hero value, supporting line, sample, and one action', () => {
    render(
      <HeroMetric
        label="Trader Total R"
        value="+12.4R"
        supporting="58% Win Rate"
        sample="42 finalized Trades"
        action={<button type="button">Explore</button>}
      />,
    );
    expect(screen.getByText('+12.4R')).toBeInTheDocument();
    expect(screen.getByText('58% Win Rate')).toBeInTheDocument();
    expect(screen.getByText('42 finalized Trades')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore' })).toBeInTheDocument();
  });

  it('omits optional lines entirely rather than rendering empty chrome', () => {
    render(<HeroMetric label="System Total R" value="+26.8R" />);
    expect(screen.getByText('+26.8R')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('InsightNote', () => {
  it('renders the observation and its sample disclosure', () => {
    render(
      <InsightNote
        observation="Trades recorded as Fearful have underperformed your average so far."
        sample="12 Trades"
      />,
    );
    expect(screen.getByText(/Fearful/)).toBeInTheDocument();
    expect(screen.getByText('12 Trades')).toBeInTheDocument();
  });

  it('falls back to "no strong pattern yet" when sample is null, never fabricating an observation', () => {
    render(<InsightNote observation="This should never render" sample={null} />);
    expect(screen.getByText('No strong pattern yet.')).toBeInTheDocument();
    expect(screen.queryByText('This should never render')).not.toBeInTheDocument();
  });
});

describe('DataReadinessLine', () => {
  it('renders a factual sample count with no percentage', () => {
    render(<DataReadinessLine fact="38 resolved · 5 pending" />);
    expect(screen.getByText('38 resolved · 5 pending')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders an optional action alongside the fact', () => {
    render(
      <DataReadinessLine fact="6 unclassified" action={<button type="button">Classify</button>} />,
    );
    expect(screen.getByRole('button', { name: 'Classify' })).toBeInTheDocument();
  });
});
