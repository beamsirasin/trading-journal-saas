# Design System

**Status:** Phase 00b. Tokens, theming, motion conventions and the application shell are implemented. The full component library arrives with the phases that need it.

## 1. Principles

Modern professional SaaS — not an admin template. Restrained gradients, clean layered surfaces, generous spacing, clear hierarchy, consistent radii.

Dark is the primary experience; light is complete rather than an afterthought.

## 2. Tokens

Call sites use **semantic** tokens only. Never a raw hex value, never a palette number. That indirection is what allows a re-theme and what stops light mode rotting.

```
❌ text-[#93a4c0]   ❌ bg-blue-600
✅ text-muted-foreground   ✅ bg-primary
```

The vocabulary follows shadcn/ui's contract so vendored components work untouched, extended with the tokens the trading domain needs. See [ADR 0005](decisions/0005-theme-and-tokens.md).

### shadcn contract

| Token                | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `background`         | Page canvas                                        |
| `foreground`         | Primary text                                       |
| `card`               | Cards and panels                                   |
| `card-foreground`    | Text on cards                                      |
| `popover`            | Menus, dropdowns, sheets                           |
| `primary`            | Brand blue — primary actions                       |
| `primary-foreground` | Text on `primary`                                  |
| `secondary`          | Secondary surfaces                                 |
| `muted`              | Muted **surface**                                  |
| `muted-foreground`   | Secondary **text** and labels                      |
| `accent`             | Subtle hover surface — **not** the identity accent |
| `destructive`        | Destructive actions                                |
| `border` / `input`   | Dividers, card borders, input borders              |
| `ring`               | Focus ring                                         |

### Product tokens

| Token            | Purpose                               |
| ---------------- | ------------------------------------- |
| `brand`          | Cyan identity accent                  |
| `surface-raised` | Elevated elements, inline code, chips |
| `positive`       | Gains, wins                           |
| `negative`       | Losses                                |
| `warning`        | Caution, trial expiry                 |

> **Trap.** `accent` is shadcn's subtle hover surface, not the cyan identity colour — that is `brand`. Mixing them produces components that look fine in isolation and wrong in context.

Radii derive from `--radius` (0.75rem): `rounded-sm` / `md` / `lg` / `xl`.

### Palette

| Token              | Dark      | Light     |
| ------------------ | --------- | --------- |
| `background`       | `#070b14` | `#f6f8fc` |
| `foreground`       | `#e8edf7` | `#0b1220` |
| `card`             | `#0d1424` | `#ffffff` |
| `popover`          | `#141d33` | `#ffffff` |
| `primary`          | `#3b82f6` | `#1d5fd8` |
| `secondary`        | `#141d33` | `#eef2f9` |
| `muted`            | `#141d33` | `#eef2f9` |
| `muted-foreground` | `#93a4c0` | `#55657f` |
| `accent`           | `#1a2540` | `#e8eef8` |
| `destructive`      | `#e11d48` | `#be123c` |
| `border` / `input` | `#1e2a45` | `#dbe3f0` |
| `ring`             | `#38bdf8` | `#1d5fd8` |
| `brand`            | `#22d3ee` | `#0e7490` |
| `positive`         | `#10b981` | `#047857` |
| `negative`         | `#fb7185` | `#be123c` |
| `warning`          | `#f59e0b` | `#b45309` |

`positive` and `negative` are never the only signal for a value's direction — sign, arrow, or label must carry it too, for red-green colour blindness.

## 3. Theming

Precedence, highest priority last:

1. **Explicit user choice** — `localStorage`, applied by next-themes as `.light` / `.dark`
2. **OS preference** — `prefers-color-scheme`, resolved by `enableSystem`
3. **Documented fallback** — dark, from `:root`

Implemented without `!important`: the media-query block is guarded by `:root:not(.dark):not(.light)`, so an explicit class stops it matching. `color-scheme` is set alongside the palette so native controls and scrollbars match.

The selector offers **Light / Dark / System**. "System" is a distinct choice, not a third state of a switch — dropping it would regress anyone who schedules dark mode by time of day.

No flash of the wrong theme: next-themes injects a blocking script that sets the class before first paint, which requires `suppressHydrationWarning` on `<html>`. Verified by e2e, including with JavaScript disabled.

> **The dark fallback is not separately observable in a browser.** The CSS spec dropped `prefers-color-scheme: no-preference`, so Chromium reports `light` when the user has expressed nothing. The `:root` dark values therefore apply exactly when no class is set and the OS does not ask for light — indistinguishable from honouring a dark preference. An OS light preference still wins over the dark-first identity: ignoring an accessibility preference to enforce a brand identity is the worse failure, and the toggle gives a one-click persistent override.

## 4. Motion

Animation must aid comprehension. No motion for decoration.

Sanctioned: page and section transitions, animated drawers and dialogs, skeleton loading, subtle card hover, smooth chart transitions, animated KPI counters.

Avoided: heavy glass effects, glow, parallax, anything that moves while being read.

**`prefers-reduced-motion` is honoured twice.** A global rule in `globals.css` collapses every animation and transition duration — a guard a component cannot forget. Motion components additionally call `useReducedMotion()` so layout animations are skipped outright rather than merely shortened. Enforced by e2e.

The `animate-rise` utility is the standard entrance: 12px upward, fading in, on a decelerating curve.

### Conventions

Durations and easings live in [`src/lib/motion.ts`](../src/lib/motion.ts) so "how long does a thing take" is one decision, not fifty.

| Token     | Seconds | Use                                        |
| --------- | ------- | ------------------------------------------ |
| `instant` | 0.12    | Hover and press feedback                   |
| `fast`    | 0.18    | Small state changes, active indicators     |
| `base`    | 0.24    | Panels, drawers, dialogs                   |
| `slow`    | 0.36    | Large surfaces entering for the first time |

Easing: `standard` `cubic-bezier(0.16, 1, 0.3, 1)` decelerates — fast out of the gate, gentle on arrival, so an element looks like it settled rather than stopped. `LAYOUT_SPRING` is the shared spring for layout transitions.

### Where Motion is actually used

Exactly one place in Phase 00b: a shared `layoutId` on the sidebar's active-section indicator. The indicator travels from the previous item to the new one, communicating the relationship between them — comprehension, not decoration. Everything else is CSS.

The library is not exercised further merely to prove it is installed.

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
- A skip-to-content link is the first focusable element on every page, targeting a shared `MAIN_CONTENT_ID` constant so the link and its target cannot drift apart.

**Known and accepted:** below `lg` the sidebar is `display:none`, which removes it from the accessibility tree — so on mobile there is no `navigation` landmark until the drawer is opened. The trigger sits in the banner, which is the standard discoverable path for a drawer pattern. This is asserted by e2e so it stays deliberate.

## 7b. Vendored components

`src/components/ui/` is **project-owned code**, not a dependency. shadcn components are vendored by `shadcn add` and may be edited freely.

Every deviation from upstream carries a `PROJECT CUSTOMISATION` comment explaining why, so a future re-add can be reconciled deliberately rather than silently reverting a fix.

Current deviations:

- `dropdown-menu.tsx` — `checked` is spread conditionally instead of passed directly, because this project enables `exactOptionalPropertyTypes` and upstream passes an explicit `undefined`.

Only components actually used are installed: `button`, `dropdown-menu`, `sheet`. A large unused component collection is dead code that still has to be maintained, typechecked, and audited.

## 8. Data surfaces

Every surface that displays data ships four states: **loading, empty, error, success.**

Empty states teach the next action. "No data" is not an empty state — "No trades yet. Log your first trade to see how much edge you are capturing." is.

Numbers that cannot be computed render their reason, never `0` — a `0%` win rate for a user with no trades is a false statement. See [calculation-spec.md](calculation-spec.md) §6.
