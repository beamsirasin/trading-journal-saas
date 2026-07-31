# Design System

**Status:** Phase 00. Tokens, theming, and motion rules are implemented in [`src/app/globals.css`](../src/app/globals.css). Component library and app shell are planned.

## 1. Principles

Modern professional SaaS — not an admin template. Restrained gradients, clean layered surfaces, generous spacing, clear hierarchy, consistent radii.

Dark is the primary experience; light is complete rather than an afterthought.

## 2. Tokens

Call sites use **semantic** tokens only. Never a raw hex value, never a palette number. That indirection is what allows a re-theme and what stops light mode rotting.

```
❌ text-[#93a4c0]   ❌ bg-blue-600
✅ text-muted       ✅ bg-primary
```

| Token                | Purpose                               |
| -------------------- | ------------------------------------- |
| `background`         | Page canvas                           |
| `surface`            | Cards, panels                         |
| `surface-raised`     | Elevated elements, inline code, chips |
| `border-subtle`      | Dividers and card borders             |
| `foreground`         | Primary text                          |
| `muted`              | Secondary text and labels             |
| `primary`            | Brand blue — primary actions          |
| `primary-foreground` | Text on `primary`                     |
| `accent`             | Cyan — highlights and emphasis        |
| `positive`           | Gains, wins, success                  |
| `negative`           | Losses, errors, destructive           |
| `warning`            | Caution, trial expiry                 |
| `ring`               | Focus ring                            |

Radii: `rounded-card` (0.875rem) for panels, `rounded-control` (0.5rem) for inputs and buttons.

### Palette

| Token            | Dark      | Light     |
| ---------------- | --------- | --------- |
| `background`     | `#070b14` | `#f6f8fc` |
| `surface`        | `#0d1424` | `#ffffff` |
| `surface-raised` | `#141d33` | `#ffffff` |
| `border-subtle`  | `#1e2a45` | `#dbe3f0` |
| `foreground`     | `#e8edf7` | `#0b1220` |
| `muted`          | `#93a4c0` | `#55657f` |
| `primary`        | `#3b82f6` | `#1d5fd8` |
| `accent`         | `#22d3ee` | `#0e7490` |
| `positive`       | `#10b981` | `#047857` |
| `negative`       | `#fb7185` | `#be123c` |
| `warning`        | `#f59e0b` | `#b45309` |

`positive` and `negative` are never the only signal for a value's direction — sign, arrow, or label must carry it too, for red-green colour blindness.

## 3. Theming

Resolution order, highest priority last:

1. **Dark** — the default in `:root`.
2. **OS preference** — `prefers-color-scheme: light` switches to the light palette.
3. **Explicit `[data-theme]`** — set by the theme switcher (later phase), overrides both.

`color-scheme` is set alongside the palette so native form controls and scrollbars match.

> **Decision worth revisiting.** Browsers cannot distinguish "no preference" from "prefers light" — Chromium reports `light` when the user has set nothing. So honouring the OS preference means users with no explicit setting see light mode, despite dark being the product's primary experience. Honouring it was chosen because ignoring an accessibility preference to enforce a brand identity is the worse failure. The alternative — dark always, light only via the in-app toggle — is a one-block CSS change if that trade-off is judged wrong.

## 4. Motion

Animation must aid comprehension. No motion for decoration.

Sanctioned: page and section transitions, animated drawers and dialogs, skeleton loading, subtle card hover, smooth chart transitions, animated KPI counters.

Avoided: heavy glass effects, glow, parallax, anything that moves while being read.

**`prefers-reduced-motion` is honoured globally** by a rule in `globals.css` that collapses all animation and transition durations. This is enforced by an e2e test, not left to per-component discipline — a global guard that a component cannot forget is worth more than a convention it can.

The `animate-rise` utility is the standard entrance: 12px upward, fading in, on a decelerating curve.

## 5. Typography

System font stack (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI', …`) with a monospace stack for numbers.

No web font is loaded. A webfont adds a build-time network dependency and a flash of unstyled text for zero benefit at this phase. Revisit when the marketing site ships, where brand typography earns its cost.

**All numeric data uses the monospace stack** so figures align in columns and digits do not jitter as values animate.

## 6. Responsive

Desktop-first for analytics, fully usable on tablet, quick-entry on mobile.

| Breakpoint     | Target                               |
| -------------- | ------------------------------------ |
| 320px          | Minimum supported; must not overflow |
| 640px (`sm`)   | Large phone                          |
| 768px (`md`)   | Tablet                               |
| 1024px (`lg`)  | Small laptop                         |
| 1280px+ (`xl`) | Full analytics                       |

**No horizontal page overflow at any width.** Wide content — tables, charts — scrolls inside its own container. Enforced by an e2e test at desktop and mobile viewports.

Touch targets ≥ 44px. Numeric inputs use numeric keyboards.

## 7. Accessibility

- WCAG AA contrast minimum, in both themes, including chart colours.
- Visible focus everywhere — a 2px `ring` outline with 2px offset, never removed.
- Full keyboard operation, including charts and dialogs.
- Semantic landmarks and correct heading order.
- Form controls labelled; errors programmatically associated with their input.
- Decorative elements marked `aria-hidden`.

## 8. Data surfaces

Every surface that displays data ships four states: **loading, empty, error, success.**

Empty states teach the next action. "No data" is not an empty state — "No trades yet. Log your first trade to see how much edge you are capturing." is.

Numbers that cannot be computed render their reason, never `0` — a `0%` win rate for a user with no trades is a false statement. See [calculation-spec.md](calculation-spec.md) §6.
