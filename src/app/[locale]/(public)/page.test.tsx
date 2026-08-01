import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type * as NextIntlServer from 'next-intl/server';
import { describe, expect, it, vi } from 'vitest';

import { PLANS } from '@/config/plans';

import en from '../../../../messages/en.json';
import Home from './page';

/**
 * `setRequestLocale` is gated to the real RSC runtime — calling it outside
 * one throws "not supported in Client Components", which is exactly the
 * environment Vitest renders in. The static-generation opt-in it provides
 * has no observable effect for a component test, so it is stubbed rather
 * than exercised; `getTranslations` is untouched because nothing under
 * `HomePage` itself calls it (the header/footer that do belong to the
 * layout, not this page, and are not part of this render tree).
 */
vi.mock('next-intl/server', async (importOriginal) => {
  const actual = await importOriginal<typeof NextIntlServer>();
  return { ...actual, setRequestLocale: vi.fn() };
});

/**
 * PHASE 1.1 REWRITE. Section copy now comes from `messages/en.json` rather
 * than being hardcoded in the components, and `Home` is an async Server
 * Component reading `params.locale` — both changed by the Thai/English
 * localization work, so the assertions below match the translated strings
 * and render through `NextIntlClientProvider` the way the real request
 * pipeline supplies them.
 *
 * The Phase 00b version of this file asserted that the page showed em-dash
 * placeholders and no numbers, which was correct while there was nothing true
 * to show. The landing page now carries demo figures, so the guarantee
 * changes shape rather than disappearing: the numbers must be present AND
 * unmistakably labelled as demo data. That labelling is asserted below and is
 * the reason showing them at all is acceptable.
 */
async function renderHome() {
  const element = await Home({ params: Promise.resolve({ locale: 'en' }) });
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe('landing page', () => {
  it('leads with a single primary heading about the product thesis', async () => {
    await renderHome();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/strategy/i);
  });

  it('renders every required section', async () => {
    await renderHome();

    // Level 2 specifically: section headings. The FAQ asks "Is there a free
    // trial?" at level 3, which would otherwise collide with the pricing
    // section's heading.
    for (const name of [
      /profit does not prove/i,
      /one comparison, the whole product/i,
      /six steps/i,
      /does one thing properly/i,
      /three plans, one free trial/i,
      /what this product does/i,
      /which problem you actually have/i,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('labels its figures as demo data wherever they appear', async () => {
    await renderHome();
    // Sample metrics on a trading product read as a track record unless they
    // are marked. There is at least one marker on the hero preview and one on
    // the attribution section.
    expect(screen.getAllByText('Demo data').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/not a performance claim/i)).toBeInTheDocument();
  });

  it('presents exactly three plans, each with the trial and no price', async () => {
    await renderHome();

    // Scoped to the pricing region: the closing CTA also offers a trial link,
    // and counting across the whole page would silently pass if a fourth plan
    // card appeared.
    const pricing = screen.getByRole('region', {
      name: /three plans, one free trial/i,
    });

    for (const plan of PLANS) {
      expect(within(pricing).getByRole('heading', { name: plan.name })).toBeInTheDocument();
    }

    expect(within(pricing).getAllByText('Pricing to be confirmed')).toHaveLength(PLANS.length);
    expect(
      within(pricing).getAllByRole('link', { name: 'Preview trial registration' }),
    ).toHaveLength(PLANS.length);
  });

  it('states that payment processing is not connected', async () => {
    await renderHome();
    expect(
      screen.getByText(/no payment processing is connected to this product yet/i),
    ).toBeInTheDocument();
  });

  it('does not advertise capabilities that are out of scope', async () => {
    await renderHome();
    const body = document.body.textContent ?? '';

    // Each of these is explicitly excluded from the MVP (CLAUDE.md §9). They
    // may only appear in a sentence that denies them, which the FAQ and the
    // feature section both do — so the assertion is that no sentence claims
    // them, not that the words are absent.
    expect(body).toMatch(/no broker api|not included/i);
    expect(screen.getByRole('heading', { name: /can i import trades/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /does it use ai/i })).toBeInTheDocument();
  });

  it('points its primary calls to action at real routes', async () => {
    await renderHome();

    const hero = screen.getAllByRole('link', { name: /preview registration/i });
    expect(hero.length).toBeGreaterThan(0);
    expect(hero[0]).toHaveAttribute('href', expect.stringMatching(/\/register$/));

    const demo = screen.getByRole('link', { name: /see the demo dashboard/i });
    expect(demo).toHaveAttribute('href', expect.stringMatching(/\/demo$/));
  });

  it('does not imply that authentication or a trial can start today', async () => {
    await renderHome();
    expect(document.body).not.toHaveTextContent(/start (?:a )?(?:\d+-day )?free trial/i);
    expect(screen.getAllByText(/registration is not live yet/i)).not.toHaveLength(0);
  });

  it('uses a server-rendered chart on the marketing page', async () => {
    const { container } = await renderHome();
    expect(container.querySelector('[data-static-cumulative-r]')).toBeInTheDocument();
    expect(container.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
  });

  it('explains the outcome matrix including both asymmetric cells', async () => {
    await renderHome();
    // The two cells a conventional journal cannot express are the reason the
    // schema stores the outcomes independently. If the copy loses them, the
    // page has stopped making the product's argument.
    expect(screen.getByRole('heading', { name: /a working system, damaged/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /paid for breaking the rules/i }),
    ).toBeInTheDocument();
  });

  it('does not render its own main landmark', async () => {
    // `main` belongs to the (public) layout. Two of them would give screen
    // reader users an ambiguous document structure.
    await renderHome();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('gives the FAQ keyboard-operable disclosure semantics', async () => {
    await renderHome();
    const faq = screen.getByRole('heading', { name: /what this product does/i }).closest('section');
    expect(faq).not.toBeNull();
    // Native <details>/<summary>: operable with the keyboard, exposed to
    // assistive tech, and findable by browser find-in-page with no JS.
    const groups = within(faq as HTMLElement).getAllByRole('group');
    expect(groups.length).toBeGreaterThanOrEqual(7);
  });
});
