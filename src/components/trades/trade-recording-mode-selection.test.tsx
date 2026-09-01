import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { TradeRecordingModeSelection } from './trade-recording-mode-selection';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderSelection(locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <TradeRecordingModeSelection />
    </NextIntlClientProvider>,
  );
}

function card(name: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(name) });
}

describe('the recording-mode choice', () => {
  it('asks the question once, with a helper for a beginner', () => {
    renderSelection();
    expect(
      screen.getByRole('heading', { name: 'When are you recording this trade?' }),
    ).toBeVisible();
    expect(
      screen.getByText('Choose the option that matches where you are in the trade.'),
    ).toBeVisible();
  });

  it('offers exactly two choices and no confirmation step', () => {
    renderSelection();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    // With two choices, a second click confirms nothing.
    expect(screen.queryByRole('button', { name: /continue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('describes At Entry as the trade whose outcome is not known yet', () => {
    renderSelection();
    const atEntry = card('At Entry');
    expect(within(atEntry).getByText('At Entry')).toBeVisible();
    expect(
      within(atEntry).getByText('Record the trade before the outcome is known.'),
    ).toBeVisible();
    expect(within(atEntry).getByText('Plan · Risk · Confidence')).toBeVisible();
  });

  it('describes After Trade as the trade that is already over', () => {
    renderSelection();
    const afterTrade = card('After Trade');
    expect(within(afterTrade).getByText('After Trade')).toBeVisible();
    expect(within(afterTrade).getByText('Record a trade that has already finished.')).toBeVisible();
    expect(within(afterTrade).getByText('Plan · Result · Review')).toBeVisible();
  });
});

describe('the recording-mode choice — interaction and semantics', () => {
  it('makes the card itself the action, addressed by URL', () => {
    renderSelection();
    expect(card('At Entry')).toHaveAttribute('href', '/app/trades/new?timing=at_entry');
    expect(card('After Trade')).toHaveAttribute('href', '/app/trades/new?timing=after_trade');
  });

  it('uses real link semantics, so keyboard activation and focus come for free', () => {
    renderSelection();
    for (const link of screen.getAllByRole('link')) {
      // Not a clickable div: a real anchor with a real href is reachable by
      // Tab, activated by Enter, and announced as a link.
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href');
      expect(link.className).toContain('focus-visible:ring-2');
    }
  });

  it('gives each card an accessible description a screen reader can tell apart', () => {
    const { container } = renderSelection();
    for (const timing of ['at_entry', 'after_trade']) {
      const link = container.querySelector(`[data-recording-mode="${timing}"]`);
      expect(link).not.toBeNull();
      const describedBy = link?.getAttribute('aria-describedby');
      expect(describedBy).toBe(`recording-mode-${timing}-description`);
      expect(document.getElementById(describedBy as string)).not.toBeNull();
    }
  });

  it('stacks on a phone and sits side by side from sm up', () => {
    const { container } = renderSelection();
    const grid = container.querySelector('ul');
    expect(grid?.className).toContain('gap-4');
    expect(grid?.className).toContain('sm:grid-cols-2');
    // No fixed column count below `sm`, so the two cards stack.
    expect(grid?.className).not.toContain('grid-cols-2 ');
  });

  it('keeps its motion restrained and drops it under prefers-reduced-motion', () => {
    renderSelection();
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('duration-150');
      expect(link.className).toContain('active:scale-[0.99]');
      expect(link.className).toContain('motion-reduce:transition-none');
      expect(link.className).toContain('motion-reduce:active:scale-100');
    }
  });

  it('translates', () => {
    renderSelection('th');
    expect(screen.getByRole('heading', { name: 'คุณกำลังบันทึกเทรดนี้เมื่อไร?' })).toBeVisible();
    expect(screen.getByText('บันทึกออเดอร์ก่อนที่จะรู้ผลลัพธ์')).toBeVisible();
    expect(screen.getByText('บันทึกออเดอร์ที่จบไปแล้ว')).toBeVisible();
  });
});
