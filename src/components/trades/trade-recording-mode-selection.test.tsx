import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  return screen.getByRole('radio', { name });
}

function commit(): HTMLElement {
  // One control, two elements: a disabled button until a mode is chosen, the
  // real link afterwards. Either way there is exactly one "Continue".
  return screen.getByRole('button', { name: 'Continue' });
}

describe('the recording-mode choice', () => {
  it('describes At Entry as the trade whose outcome is not known yet', () => {
    renderSelection();
    const atEntry = card('At Entry');
    expect(within(atEntry).getByText('At Entry')).toBeVisible();
    expect(
      within(atEntry).getByText('Record the trade before the outcome is known.'),
    ).toBeVisible();
    // The single "Plan · Risk · Confidence" line is now three chips.
    expect(within(atEntry).getByText('Plan')).toBeVisible();
    expect(within(atEntry).getByText('Risk')).toBeVisible();
    expect(within(atEntry).getByText('Confidence')).toBeVisible();
  });

  it('describes After Trade as the trade that is already over', () => {
    renderSelection();
    const afterTrade = card('After Trade');
    expect(within(afterTrade).getByText('After Trade')).toBeVisible();
    expect(within(afterTrade).getByText('Record a trade that has already finished.')).toBeVisible();
    expect(within(afterTrade).getByText('Plan')).toBeVisible();
    expect(within(afterTrade).getByText('Result')).toBeVisible();
    expect(within(afterTrade).getByText('Review')).toBeVisible();
  });

  it('gives each card an accessible description a screen reader can tell apart', () => {
    const { container } = renderSelection();
    for (const timing of ['at_entry', 'after_trade']) {
      const option = container.querySelector(`[data-recording-mode="${timing}"]`);
      expect(option).not.toBeNull();

      // The name is the title alone, so the announcement is "At Entry, radio
      // button" rather than the whole card read out as one run-on name.
      expect(option?.getAttribute('aria-labelledby')).toBe(`recording-mode-${timing}-title`);
      const describedBy = option?.getAttribute('aria-describedby');
      expect(describedBy).toBe(`recording-mode-${timing}-description`);
      expect(document.getElementById(describedBy as string)).not.toBeNull();
    }
  });

  it('offers exactly two answers to one question, with one commit', () => {
    renderSelection();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    // The question itself is the page heading, rendered by the wizard shell —
    // here it is the group's accessible name.
    expect(
      screen.getByRole('radiogroup', { name: 'When are you recording this trade?' }),
    ).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('translates', () => {
    renderSelection('th');
    expect(screen.getByRole('radio', { name: 'ตอนเข้าเทรด' })).toBeVisible();
    expect(screen.getByText('บันทึกออเดอร์ก่อนที่จะรู้ผลลัพธ์')).toBeVisible();
    expect(screen.getByText('บันทึกออเดอร์ที่จบไปแล้ว')).toBeVisible();
    expect(within(card('ตอนเข้าเทรด')).getByText('ความมั่นใจ')).toBeVisible();
    expect(within(card('หลังจบเทรด')).getByText('ผลลัพธ์')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ถัดไป' })).toBeVisible();
  });
});

describe('the recording-mode choice — choosing, then committing', () => {
  it('starts with nothing chosen and nowhere to go', () => {
    renderSelection();
    for (const option of screen.getAllByRole('radio')) {
      expect(option).toHaveAttribute('aria-checked', 'false');
    }
    // Not merely a disabled-looking button: there is no link at all, because
    // there is no destination until the reader picks a situation.
    expect(commit()).toBeDisabled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('selects on click and turns the commit into a real link', async () => {
    const user = userEvent.setup();
    renderSelection();

    await user.click(card('At Entry'));
    expect(card('At Entry')).toHaveAttribute('aria-checked', 'true');
    expect(card('After Trade')).toHaveAttribute('aria-checked', 'false');

    // A real anchor with a real href — which is what keeps prefetch, middle
    // click and open-in-new-tab working, and what a click handler would lose.
    const link = screen.getByRole('link', { name: 'Continue' });
    expect(link.tagName).toBe('A');
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it("commits to the chosen mode's own URL, for both modes", async () => {
    const user = userEvent.setup();
    renderSelection();

    await user.click(card('At Entry'));
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/app/trades/new?timing=at_entry',
    );

    await user.click(card('After Trade'));
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/app/trades/new?timing=after_trade',
    );
  });
});

describe('the recording-mode choice — keyboard', () => {
  it('keeps exactly one card tabbable, so Tab enters and leaves the group once', async () => {
    const user = userEvent.setup();
    renderSelection();

    // Nothing chosen: the first card is the way in. The group must never be
    // unreachable just because it has no value yet.
    expect(card('At Entry')).toHaveAttribute('tabindex', '0');
    expect(card('After Trade')).toHaveAttribute('tabindex', '-1');

    await user.click(card('After Trade'));
    expect(card('After Trade')).toHaveAttribute('tabindex', '0');
    expect(card('At Entry')).toHaveAttribute('tabindex', '-1');
  });

  it('moves the selection with the arrow keys, and wraps at both ends', async () => {
    const user = userEvent.setup();
    renderSelection();
    card('At Entry').focus();

    await user.keyboard('{ArrowRight}');
    expect(card('After Trade')).toHaveAttribute('aria-checked', 'true');
    expect(card('After Trade')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(card('At Entry')).toHaveAttribute('aria-checked', 'true');

    // Down and Up are the same movement in a two-column group.
    await user.keyboard('{ArrowDown}');
    expect(card('After Trade')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowUp}');
    expect(card('At Entry')).toHaveAttribute('aria-checked', 'true');

    // Wrapping: past the first is the last, past the last is the first.
    await user.keyboard('{ArrowLeft}');
    expect(card('After Trade')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(card('At Entry')).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{End}');
    expect(card('After Trade')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Home}');
    expect(card('At Entry')).toHaveAttribute('aria-checked', 'true');
  });

  it('selects with Space and with Enter', async () => {
    const user = userEvent.setup();
    renderSelection();

    card('After Trade').focus();
    await user.keyboard(' ');
    expect(card('After Trade')).toHaveAttribute('aria-checked', 'true');

    card('At Entry').focus();
    await user.keyboard('{Enter}');
    expect(card('At Entry')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('the recording-mode choice — presentation', () => {
  it('stacks on a phone and sits side by side from md up', () => {
    renderSelection();
    const group = screen.getByRole('radiogroup');
    expect(group.className).toContain('gap-4');
    expect(group.className).toContain('md:grid-cols-2');
    // No fixed column count below `md`, so the two cards stack.
    expect(group.className).not.toContain('grid-cols-2 ');
  });

  /*
    THIS TEST IS DELIBERATELY COUPLED TO CLASS NAMES. jsdom computes no styles,
    so the selected state cannot be asserted by what it looks like. If the way
    this component expresses style changes, change these strings — a failure
    here is a stale test, not broken behaviour. The behaviour that must not
    regress (`aria-checked`) is asserted elsewhere, by role.
  */
  it('marks the chosen card with the brand edge, and only that card', async () => {
    const user = userEvent.setup();
    renderSelection();

    await user.click(card('At Entry'));
    expect(card('At Entry').className).toContain('border-brand');
    expect(card('At Entry').className).toContain('ring-brand/30');
    expect(card('After Trade').className).toContain('border-border');
    expect(card('After Trade').className).not.toContain('border-brand');
  });

  it('keeps its motion restrained and drops it under prefers-reduced-motion', () => {
    renderSelection();
    for (const option of screen.getAllByRole('radio')) {
      expect(option.className).toContain('duration-150');
      expect(option.className).toContain('hover:-translate-y-0.5');
      expect(option.className).toContain('motion-reduce:transition-none');
      expect(option.className).toContain('motion-reduce:hover:translate-y-0');
      expect(option.className).toContain('focus-visible:ring-2');
    }
  });
});
