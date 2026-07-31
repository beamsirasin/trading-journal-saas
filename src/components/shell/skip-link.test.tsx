import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MAIN_CONTENT_ID } from './constants';
import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  it('targets the shared main-content id', () => {
    render(<SkipLink />);
    // A skip link pointing at a missing id fails silently, and only for the
    // users who rely on it. Sharing the constant is what prevents drift.
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });

  it('is visually hidden until focused', () => {
    render(<SkipLink />);
    const link = screen.getByRole('link', { name: /skip to content/i });
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
  });

  it('stays reachable by assistive technology', () => {
    render(<SkipLink />);
    // sr-only hides it visually; it must NOT be removed from the a11y tree.
    expect(screen.getByRole('link', { name: /skip to content/i })).toBeVisible();
  });
});
