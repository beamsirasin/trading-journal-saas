# UI Review Checklist

Run this against any phase that ships a user-facing surface. It is a review aid, not a substitute for the automated checks — anything on this list that _can_ be a test should become one, and several already have.

Conventions live in [design-system.md](design-system.md). This file is what you walk through before saying a screen is done.

## Automated first

Nothing below is worth reviewing by hand until these pass. Failures here are cheaper to read than to rediscover in a browser.

```
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm scan:client && pnpm test:e2e
```

## Structure and semantics

- [ ] Exactly **one `<h1>`** on the page, and it describes the page.
- [ ] Heading order descends without skipping (`h1` → `h2` → `h3`).
- [ ] Landmarks present and unambiguous: one `main`, a `banner`, `navigation` where relevant, `contentinfo`.
- [ ] No two landmarks share an accessible name. A scroll region inside a section named the same thing is a real defect, not a nitpick.
- [ ] Skip link is the first focusable element and moves focus to `main`.
- [ ] Lists are lists, tables are tables. A grid of divs with ARIA is not a table.

## Keyboard and focus

- [ ] Every interactive element is reachable by Tab, in a sensible order.
- [ ] Focus is visible on every focusable element, in both themes.
- [ ] Dialogs and drawers trap focus, close on Escape, and **restore focus to their trigger**.
- [ ] A drawer closes after navigating, rather than sitting over the destination.
- [ ] Disabled controls are genuinely unavailable; anything merely "not yet built" explains itself in text, not only by being greyed out.
- [ ] Custom controls built on visually-hidden inputs still work by keyboard (focus + Space/Enter/arrows).

## Screen reader and non-visual

- [ ] Icon-only buttons have `aria-label`.
- [ ] Decorative graphics are `aria-hidden`.
- [ ] Status messages live in an `aria-live` region that is **already in the DOM** before the message appears.
- [ ] Charts have a caption saying what to take from them, plus a hidden data table.
- [ ] Animating values are not announced repeatedly — the settled value is exposed once.
- [ ] Duplicate responsive presentations expose their content **once**, not twice.

## Colour and contrast

- [ ] AA contrast on all text, in **both** themes.
- [ ] No information conveyed by colour alone — direction carries a sign, arrow or word; series carry a shape or line style.
- [ ] Series colours are used for marks only, never for text.
- [ ] Any new categorical palette has been **run through the validator**, in both modes, and the output recorded in the phase document. Eyeballing a palette is not review.
- [ ] Charts re-checked if placed on a surface other than `card`.

## Responsive

- [ ] No horizontal page overflow at **320 / 375 / 768 / 1280 / 1920**.
- [ ] Wide content scrolls inside its own labelled, focusable container.
- [ ] Touch targets ≥ 44px in both dimensions, including inputs and drawer links.
- [ ] Tables are not merely shrunk on mobile — they become record cards or scroll deliberately.
- [ ] Forms use mobile-appropriate controls (`inputMode`, native `<select>`).
- [ ] Content near a device edge respects the safe area.

## Motion

- [ ] `prefers-reduced-motion` honoured: no layout animation scheduled, values render immediately.
- [ ] Both branches of any conditional motion are exercised by a test.
- [ ] No animation delays access to content.
- [ ] No permanent looping decoration, no stagger beyond ~120ms.
- [ ] Nothing moves while it is being read.

## Data surfaces

- [ ] All four states exist: loading, empty, error, success.
- [ ] The empty state names the **next action**, not just the absence of data.
- [ ] Uncomputable numbers show their reason — never `0`, never `NaN`, never `Infinity`.
- [ ] Figures use `numeric` so columns align and animating values do not jitter.
- [ ] Money is formatted from minor units; no float has touched it.
- [ ] Timestamps display in a stated timezone, never the server's or browser's implicitly.

## Honesty

The checks that stop the product claiming something it cannot do. Treat a failure here as a defect of the same severity as a crash.

- [ ] Demo or sample data carries a **visible** marker on every surface that renders it.
- [ ] No invented prices, dates, company details, or contact information.
- [ ] No control implies a working integration that does not exist (payments, OAuth, broker import).
- [ ] A submit that does nothing says so, in an announced message — it does not appear to succeed.
- [ ] No unbuilt route is linked as though it works; "coming soon" is text, not a 404.
- [ ] Marketing copy matches the actual MVP scope in [product-spec.md](product-spec.md) §4–5.

## Before committing

- [ ] `robots` policy still appropriate for the deployment stage.
- [ ] No secrets in client assets (`pnpm scan:client`).
- [ ] Build succeeds with **no `DATABASE_URL`** set.
- [ ] Documentation updated to match what actually shipped, including risks that remain open.
