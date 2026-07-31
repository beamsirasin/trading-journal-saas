import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Container } from './container';

describe('Container', () => {
  it('renders children', () => {
    render(<Container>content</Container>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('always applies a horizontal gutter, so content never touches the edge', () => {
    const { container } = render(<Container>content</Container>);
    expect(container.firstElementChild?.className).toContain('px-4');
  });

  it('supports a wider variant for analytics surfaces', () => {
    const { container } = render(<Container width="wide">content</Container>);
    expect(container.firstElementChild?.className).toContain('max-w-[100rem]');
  });

  it('supports a narrower variant for reading', () => {
    const { container } = render(<Container width="prose">content</Container>);
    expect(container.firstElementChild?.className).toContain('max-w-3xl');
  });

  it('can render as a different element', () => {
    render(
      <Container as="section" aria-label="Panel">
        content
      </Container>,
    );
    expect(screen.getByRole('region', { name: 'Panel' })).toBeInTheDocument();
  });

  it('merges caller classes without dropping its own', () => {
    const { container } = render(<Container className="py-8">content</Container>);
    const className = container.firstElementChild?.className ?? '';
    expect(className).toContain('py-8');
    expect(className).toContain('mx-auto');
  });
});
