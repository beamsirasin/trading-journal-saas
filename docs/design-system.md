# Design System

**Status:** Phase 01. Tokens, typography, spacing, motion, charts and the component set used by the marketing site and application shell are implemented. Later phases add components when a phase needs them, not before.

## 1. Principles

Modern professional SaaS for financial analytics — not an admin template, not a trading terminal, not a crypto product.

Restrained gradients, clean layered surfaces, generous spacing, clear hierarchy, consistent radii. Density only where the data earns it: a KPI row breathes, a trade table does not.

Dark is the primary experience; light is complete rather than an afterthought.

**What this explicitly is not.** No glassmorphism beyond a single translucent sticky header. No glow. No animated background particles. No candlestick decoration, coin imagery, or ticker tape. No aggressive red-on-green. Nothing under 12px. Restraint is the identity.

## 2. Tokens

Call sites use **semantic** tokens only. Never a raw hex value, never a palette number. Raw colour and RGBA values belong only in the token declarations (plus browser metadata and static asset source files). That indirection is what allows a re-theme and what stops light mode rotting.

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

| Token               | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `brand`             | Cyan identity accent                               |
| `surface`           | Section band, one step off the canvas              |
| `surface-raised`    | Elevated elements, inline code, chips              |
| `positive`          | Gains, wins                                        |
| `negative`          | Losses                                             |
| `warning`           | Caution, trial expiry, demo markers                |
| `info`              | Neutral notices                                    |
| `overlay`           | Dialog and drawer scrim                            |
| `shadow-*`          | Semantic control, card, elevated and popover depth |
| `chart-1`…`chart-4` | Categorical chart series, fixed order — see §9     |
| `system` / `trader` | Semantic aliases of `chart-1` / `chart-2`          |

> **Trap.** `accent` is shadcn's subtle hover surface, not the cyan identity colour — that is `brand`. Mixing them produces components that look fine in isolation and wrong in context.

`surface` moves away from the canvas in whichever direction reads as a distinct band for the theme: lifted in dark, tinted in light. That asymmetry is deliberate — in light mode "raised" is nearly white, which is already `card`.

Radii derive from `--radius` (0.75rem): `rounded-sm` / `md` / `lg` / `xl`.

### Palette

| Token              | Dark      | Light     |
| ------------------ | --------- | --------- |
| `background`       | `#070b14` | `#f6f8fc` |
| `foreground`       | `#e8edf7` | `#0b1220` |
| `card`             | `#0d1424` | `#ffffff` |
| `popover`          | `#141d33` | `#ffffff` |
| `primary`          | `#2563eb` | `#1d5fd8` |
| `secondary`        | `#141d33` | `#eef2f9` |
| `muted`            | `#141d33` | `#eef2f9` |
| `muted-foreground` | `#93a4c0` | `#55657f` |
| `accent`           | `#1a2540` | `#e8eef8` |
| `destructive`      | `#e11d48` | `#be123c` |
| `border` / `input` | `#1e2a45` | `#dbe3f0` |
| `ring`             | `#38bdf8` | `#1d5fd8` |
| `brand`            | `#22d3ee` | `#0e7490` |
| `surface`          | `#0a1020` | `#eaf0f9` |
| `surface-raised`   | `#141d33` | `#ffffff` |
| `positive`         | `#10b981` | `#047857` |
| `negative`         | `#fb7185` | `#be123c` |
| `warning`          | `#f59e0b` | `#92400e` |
| `info`             | `#56b6f7` | `#0369a1` |
| `chart-1`          | `#0f9e8e` | `#0891b2` |
| `chart-2`          | `#3b82f6` | `#1d4ed8` |
| `chart-3`          | `#c2650f` | `#c2570f` |
| `chart-4`          | `#b06ef0` | `#7c3aed` |

`positive` and `negative` are never the only signal for a value's direction — sign, arrow, or label must carry it too, for red-green colour blindness.

Measured text contrast on the surfaces where each token is used, in both themes: every status and text token clears 4.5:1. Dark primary actions and light warning text are explicitly asserted by e2e. The one exception is light-mode `chart-1` at 3.68:1, which is why series colours never carry text (§9).

## 3. Theming

Precedence, highest priority last:

1. **Explicit user choice** — `localStorage`, applied by next-themes as `.light` / `.dark`
2. **OS preference** — `prefers-color-scheme`, resolved by `enableSystem`
3. **Documented fallback** — dark, from `:root`

Implemented without `!important`: the media-query block is guarded by `:root:not(.dark):not(.light)`, so an explicit class stops it matching. `color-scheme` is set alongside the palette so native controls and scrollbars match.

Two controls write the same value: the header `ThemeToggle` (quick change) and the settings `ThemeSelector` (shows what the current setting _is_, which one icon button cannot express). Both offer **Light / Dark / System** — "System" is a distinct choice, not a third state of a switch.

No flash of the wrong theme: next-themes injects a blocking script that sets the class before first paint, which requires `suppressHydrationWarning` on `<html>`. Verified by e2e, including with JavaScript disabled.

> **The dark fallback is not separately observable in a browser.** The CSS spec dropped `prefers-color-scheme: no-preference`, so Chromium reports `light` when the user has expressed nothing. The `:root` dark values therefore apply exactly when no class is set and the OS does not ask for light — indistinguishable from honouring a dark preference. An OS light preference still wins over the dark-first identity: ignoring an accessibility preference to enforce a brand identity is the worse failure, and the toggle gives a one-click persistent override.

## 4. Typography

System font stack with a monospace stack for numbers. **No web font is loaded.** A webfont adds a build-time network dependency and a flash of unstyled text; the system stack costs nothing and renders natively on every target. Revisit only when a brand identity exists that a typeface is actually carrying.

Roles, not sizes. A call site asks for `text-display`, so changing what a role looks like is one edit in `globals.css`.

| Role           | Token                | Value                           | Used for                    |
| -------------- | -------------------- | ------------------------------- | --------------------------- |
| Display        | `text-display`       | clamp 2.125→3.5rem, 600         | Hero headline only          |
| Page title     | `text-page-title`    | clamp 1.625→2rem, 600           | The single `<h1>` on a page |
| Section title  | `text-section-title` | clamp 1.5→1.875rem, 600         | Landing-section `<h2>`      |
| Card title     | `text-card-title`    | 1rem, 600                       | Card and panel headings     |
| Body           | `text-base`          | 1rem                            | Prose                       |
| Muted body     | `text-sm` + token    | 0.875rem, `muted-foreground`    | Supporting copy             |
| Label          | `text-label`         | 0.75rem, 500, 0.06em, uppercase | Metric names, field groups  |
| Table text     | `text-sm`            | 0.875rem                        | Table cells                 |
| Numeric metric | `text-metric`        | clamp 1.5→1.875rem, 600         | KPI figures                 |
| Tabular number | `numeric` utility    | mono + `tabular-nums`           | Any figure in a column      |

The three largest roles are **fluid** (`clamp`), so headings scale continuously between 320px and desktop instead of jumping at breakpoints. The lower bound is chosen to fit 320px without overflow.

**Every financial figure uses `numeric`.** Tabular numerals keep digits on a fixed advance width, so a column of R-multiples aligns on the decimal point and an animating KPI does not jitter as digits change. Prose numerals stay proportional, which is why this is a utility and not a base rule.

## 5. Spacing and layout

| Concern         | Convention                                                        |
| --------------- | ----------------------------------------------------------------- |
| Page width      | `Container` — `default` 72rem, `wide` 100rem, `prose` 48rem       |
| Page gutters    | `px-4` → `sm:px-6` → `lg:px-8`                                    |
| Section spacing | `py-16` → `sm:py-20` → `lg:py-24`                                 |
| Card padding    | `p-4` → `sm:p-5`; `p-5` → `sm:p-6` for prominent panels           |
| Grid gaps       | `gap-4` for cards, `gap-6`–`gap-8` for major regions              |
| Sidebar width   | `--shell-sidebar-width` (15rem), desktop only                     |
| Header height   | `--shell-header-height` (3.5rem), sticky on both shells           |
| Safe area       | `pb-safe` / `px-safe` utilities where content meets a device edge |

The shell's geometry lives in CSS variables rather than repeated `top-14` / `w-60` utilities, so the sticky offset and the sidebar width are each one decision.

## 6. Responsive

Desktop-first for analytics, fully usable on tablet, quick-entry on mobile.

| Breakpoint     | Target                               |
| -------------- | ------------------------------------ |
| 320px          | Minimum supported; must not overflow |
| 640px (`sm`)   | Large phone                          |
| 768px (`md`)   | Tablet — tables appear here          |
| 1024px (`lg`)  | Small laptop — sidebar appears here  |
| 1280px+ (`xl`) | Full analytics                       |

**No horizontal page overflow at any width.** Wide content — tables, charts — scrolls inside its own container. Enforced by e2e across five viewports (320 / 375 / 768 / 1280 / 1920) on every public and application route.

**Wide tables get two presentations, not one squeezed one.** A real `<table>` from `md` up, record cards below it. Both are in the DOM; the inactive one is `display:none`, which removes it from the accessibility tree so a screen reader is offered the trades once. Each carries `data-trades-view` so tests scope to the active one.

Touch targets ≥ 44px, including inputs — `Input` is `h-11` rather than shadcn's `h-9` for exactly this reason. Numeric inputs use numeric keyboards. Native `<select>` is preferred over a custom listbox on forms, because it opens the platform picker on a phone.

**Mobile navigation is a drawer, not a bottom bar.** The Phase 00b drawer is focus-trapping, Escape-handling and tested; five sections fit it comfortably. Replacing hardened, tested behaviour needs a better reason than fashion.

## 7. Motion

Animation must aid comprehension. No motion for decoration.

Sanctioned and in use: hero entrance, sidebar and segmented-control active indicators, drawer and dialog entrance, skeleton loading, subtle card hover, settled KPI opacity feedback, chart entrance.

Avoided: heavy glass, glow, parallax, permanent looping decoration, long stagger sequences, and anything that gates access to content.

**`prefers-reduced-motion` is honoured twice.** A global rule in `globals.css` collapses every animation and transition duration — a guard a component cannot forget. Motion components additionally use the SSR-safe `usePrefersReducedMotion()` hook so layout animations are skipped outright rather than merely shortened. Enforced by e2e against the real animated elements, and against both the sidebar and segmented-control branches.

The `animate-rise` utility is the standard entrance: 12px upward, fading in, on a decelerating curve. Entrance stagger never exceeds 120ms.

### Conventions

Durations and easings live in [`src/lib/motion.ts`](../src/lib/motion.ts) so "how long does a thing take" is one decision, not fifty.

| Token     | Seconds | Use                                    |
| --------- | ------- | -------------------------------------- |
| `instant` | 0.12    | Hover and press feedback               |
| `fast`    | 0.18    | Small state changes, active indicators |
| `base`    | 0.24    | Panels, drawers, dialogs               |
| `slow`    | 0.36    | Large surfaces entering                |

Easing: `standard` `cubic-bezier(0.16, 1, 0.3, 1)` decelerates — fast out of the gate, gentle on arrival, so an element looks like it settled rather than stopped. `LAYOUT_SPRING` is the shared spring for layout transitions.

### Where Motion (the library) is used

Three places, each a shared `layoutId` or restrained feedback that communicates something a hard cut cannot:

1. The sidebar's active-section indicator, travelling between items.
2. The segmented control's indicator, same pattern.
3. `AnimatedNumber`, fading an already-settled KPI value into its changed state.

`AnimatedNumber` always renders characters identical to its already-rounded input and animates opacity only. A count-up temporarily presents invented financial values and delays access to the selected result; opacity changes neither the value nor layout. Under reduced motion it renders a plain span with no animation scheduled.

Everything else is CSS.

## 8. Data surfaces

Every surface that displays data ships four states: **loading, empty, error, success.**

Empty states teach the next action. "No data" is not an empty state — the `EmptyState` component makes `action` a required prop so the next step cannot be forgotten.

Numbers that cannot be computed render their reason, never `0` — a `0%` win rate for a user with no trades is a false statement. See [calculation-spec.md](calculation-spec.md) §6.

Skeletons are `aria-hidden` and grouped under a single `role="status"`, so a screen reader hears one "Loading" rather than a dozen meaningless boxes.

## 9. Charts

Full reasoning in [ADR 0006](decisions/0006-design-system-and-demo-data.md).

**Series colours are computed and validated, never chosen.** The shipped four-slot palette passes all six checks in both themes — lightness band, chroma floor, CVD separation, normal-vision floor, contrast, documented provenance. Worst adjacent pair: ΔE 18.8 CVD / 19.6 normal (dark), 17.0 / 19.6 (light).

This is not ceremony. The first candidate palette put blue next to violet, which measures **ΔE 0.3 under deuteranopia** — one line, not two — and looks perfectly fine to a reviewer with typical colour vision.

Rules that follow from it:

- **Slots are assigned in fixed order and never cycled.** A fifth series folds into "Other" or becomes small multiples; it is never a newly invented hue.
- **`system` and `trader` are semantic aliases** of slots 1 and 2, so reordering the generic ramp cannot repaint the product's central comparison.
- **Series colours never carry text.** Light-mode `chart-1` is 3.68:1 — legal for a mark, illegal for small text. Labels use text tokens beside a coloured swatch.
- **Colour is never the only encoding.** The system series is dashed because it is hypothetical; the actual series is solid because it happened. That survives greyscale, print and any colour vision.
- **One axis.** Never two y-scales. Both series are already normalised to R, which is what makes them comparable.
- **No truncated axes.** Zero is drawn as an explicit reference line on cumulative R.
- **Magnitude on one nominal dimension takes one hue.** Mistake-cost bars are all `chart-3`; colouring each differently would spend the identity channel re-encoding what bar length already shows.

Every chart renders inside `ChartContainer`, which supplies three things structurally so they cannot be forgotten per-chart: a real `<figure>` with a `<figcaption>` stating what to take from it, a **visually-hidden data table** carrying the same numbers, and a legend pairing each swatch with its name and line style. An SVG decorated with ARIA is announced but not explorable; a table is.

Charts are theme-aware for free — both the server-rendered marketing SVG and interactive Recharts charts receive `var(--chart-1)` etc. as SVG attributes, so a theme switch repaints without re-rendering. Recharts is restricted to demo and application routes; the static landing route neither imports nor prefetches it. Interactive chart animation is disabled under reduced motion via `isAnimationActive`.

Chart data conversion (fixture strings → JS numbers) happens once, at the plotting boundary, on values already rounded for display. It never feeds back into a calculation.

## 10. Vendored and project-authored components

`src/components/ui/` is **project-owned code**, not a dependency.

- **Vendored** by `shadcn add`: `button`, `dropdown-menu`, `sheet`, `card`, `badge`. Every deviation from upstream carries a `PROJECT CUSTOMISATION` comment.
- **Project-authored**, marked as such in their header: `input`, `label`, `table`, `segmented-control`.

Current vendored deviations:

- `dropdown-menu.tsx` — `checked` is spread conditionally instead of passed directly, because this project enables `exactOptionalPropertyTypes` and upstream passes an explicit `undefined`.
- `dropdown-menu.tsx` and `sheet.tsx` — state animations live in `globals.css`, avoiding an otherwise unused animation-plugin dependency while keeping the global reduced-motion guard authoritative.
- `button.tsx`, `card.tsx`, `dropdown-menu.tsx` and `sheet.tsx` — the shared 44px target minimum and semantic elevation tokens replace upstream size and raw shadow defaults.

Only components actually used are installed. Where a native element does the job — `<details>` for the FAQ, `<select>` for the account picker, `<label htmlFor>` for form labels — the native element wins: it is keyboard correct, screen-reader correct, and works with JavaScript disabled, none of which a reimplementation gets for free.

**`exactOptionalPropertyTypes` note.** A component whose optional props are forwarded from another component's optional props must declare them `?: T | undefined`, not `?: T`. Otherwise the caller passing an explicit `undefined` fails to typecheck.

## 11. Demo-data policy

Everything in `src/lib/demo/` is static, fictional presentation data.

**Two rules, both enforced by tests:**

1. **No formulas.** Every metric is a literal. The real formulas arrive with the calculation engine; one written here to make a demo move would be a second, untested implementation of the product's defining logic.
2. **Every surface rendering a fixture carries a visible marker.** `DemoBadge` for a component, `DemoDataNotice` for a page. These are trading figures, and an unlabelled screenshot of a rising equity curve functions as a performance claim regardless of intent.

Fixture internal consistency is asserted in `fixtures.test.ts` — edge leakage equals system minus actual total R, mistake costs sum exactly to it, curves end at the reported totals, and all four outcome-matrix cells appear. Comparisons use fixed-point integers, not `parseFloat`.

Nothing may imply a capability that does not exist: no fake OAuth, no submit that appears to succeed, no purchase path, no invented price.

## 12. Accessibility

- WCAG AA contrast minimum, in both themes, including chart colours.
- Visible focus everywhere — a 2px `ring` outline with 2px offset, never removed.
- Full keyboard operation, including charts, dialogs and filters.
- Semantic landmarks and correct heading order; exactly one `<h1>` per page, owned by `PageHeader`.
- Form controls labelled; errors programmatically associated; status messages in an `aria-live` region that is always present in the DOM (a region inserted at the same moment its text appears is frequently missed).
- Icon-only buttons carry `aria-label`; decorative elements are `aria-hidden`.
- Charts ship a caption and a hidden data table.
- Tables use real table semantics; scroll regions are labelled, `tabIndex={0}`, and named distinctly from their enclosing section so two landmarks do not share a name.
- A skip-to-content link is the first focusable element on every page, targeting a shared `MAIN_CONTENT_ID` constant.

**Known and accepted:** below `lg` the sidebar is `display:none`, which removes it from the accessibility tree — so on mobile there is no `navigation` landmark until the drawer is opened. The trigger sits in the banner, which is the standard discoverable path for a drawer pattern. This is asserted by e2e so it stays deliberate.
