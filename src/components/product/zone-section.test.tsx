import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ZONE_KEYS, ZoneSection } from './zone-section';

describe('ZoneSection', () => {
  it.each(ZONE_KEYS)('renders the %s zone heading and its own aria-labelledby id', (zone) => {
    render(<ZoneSection zone={zone} title={`${zone} title`} id={`zone-${zone}`} />);
    const heading = screen.getByRole('heading', { name: `${zone} title` });
    expect(heading).toHaveAttribute('id', `zone-${zone}`);
  });

  it('renders optional description text', () => {
    render(<ZoneSection zone="results" title="Results" description="What happened" />);
    expect(screen.getByText('What happened')).toBeInTheDocument();
  });

  it('renders children content passed through', () => {
    render(
      <ZoneSection zone="edge" title="Edge">
        <p>Best observed Strategy</p>
      </ZoneSection>,
    );
    expect(screen.getByText('Best observed Strategy')).toBeInTheDocument();
  });
});
