# Phase 11 — Landing & Marketing Site

**Depends on:** 03 (final pricing), 08 (product screenshots) · **Blocks:** 12

## Goal

A modern SaaS landing page that communicates the one thing that makes this product different: it tells you whether the strategy or the trader is the problem.

## Positioning

Most trading journals show P&L. This one attributes it. The page leads with that distinction — the system-vs-trader comparison — not with a feature list. A feature list is what competitors have; the attribution claim is what this product is.

## Scope

### Sections (`/`)

1. **Hero** — headline stating the attribution promise, subhead, primary CTA "Start 7-day free trial", secondary "See how it works". Product visual showing the dual equity curve.
2. **Problem** — you have a journal, you know your P&L, you still cannot tell whether to fix the strategy or fix yourself.
3. **Core concept** — the system vs trader comparison, illustrated with the real dashboard visual. The most important section on the page.
4. **The four quadrants** — the 2×2 matrix, explaining why "system win / trader loss" is the finding that matters.
5. **Features** — strategy versioning, mistake tracking, R-multiple analytics, discipline scoring. Brief; the concept sections do the persuading.
6. **Pricing** — three plans from `src/config/plans.ts` (**single source of truth** — never hardcode prices in markup), trial framing, no card required.
7. **FAQ** — trial, data ownership, export, broker sync (honest: not yet), cancellation.
8. **Final CTA** + footer with legal links.

### Legal & compliance

- Privacy policy, terms of service, cookie notice
- **Risk disclaimer** — this is a journaling and analytics tool, not financial advice, and past performance does not indicate future results. Present in the footer and near any performance visual.
- Placeholder legal copy is acceptable for MVP but must be clearly marked as requiring review before public launch. Do not ship unreviewed legal text silently.

### Technical

- Static/ISR rendered, no client-side data fetching
- Lighthouse ≥ 95 across performance, accessibility, best practices, SEO
- Metadata, Open Graph, Twitter cards, `sitemap.xml`, `robots.txt`, JSON-LD `SoftwareApplication`
- Self-hosted fonts, `next/image`, no layout shift
- Scroll-triggered reveals — subtle, `prefers-reduced-motion` honored
- Mobile-first for this route specifically (unlike the desktop-first app)
- Signed-in visitors see "Go to dashboard" instead of the trial CTA

## Out of scope

Blog, CMS, docs site, changelog, testimonials (none exist yet — do not fabricate any), live chat, A/B testing, analytics vendor integration.

## Deliverables

```
src/app/(marketing)/{page,pricing,privacy,terms}.tsx
src/components/marketing/**
public/og/**   public/sitemap.xml   public/robots.txt
```

## Definition of Done

- [ ] Pricing renders from `src/config/plans.ts`, not duplicated markup
- [ ] Lighthouse ≥ 95 on all four categories, mobile and desktop
- [ ] No horizontal overflow at 320px
- [ ] Dark and light both complete
- [ ] Reduced-motion honored for every reveal
- [ ] Risk disclaimer present; legal placeholders clearly marked for review
- [ ] No fabricated testimonials, logos, or metrics
- [ ] Signed-in state shows the correct CTA
- [ ] Typecheck, lint, build pass

## Risks

- **Fabricated social proof.** No customers exist yet. Inventing testimonials or "trusted by" logos would be dishonest and is prohibited — leave those sections out.
- **Screenshot drift.** Product visuals go stale as the UI changes. Generate them from the real app late in the phase.
- **Pricing duplication.** If prices appear in two places they will disagree. One source of truth.
