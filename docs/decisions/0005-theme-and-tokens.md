# ADR 0005 — Theme precedence and token vocabulary

- **Status:** Accepted — supersedes the `[data-theme]` scheme from Phase 00
- **Date:** 2026-07-31
- **Phase:** 00b — Core primitives

## Context

Phase 00 shipped a token set with product-specific names (`surface`, `muted` as text, `border-subtle`) and a `[data-theme]` attribute for theming. Phase 00b introduces shadcn/ui, which expects a specific token vocabulary and, with next-themes, a `.light` / `.dark` class.

Running two vocabularies side by side would mean every vendored component needed editing, and every future `shadcn add` would need the same treatment.

## Decision

### Adopt shadcn's token vocabulary, extended with product tokens

Canonical set: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`.

Product additions: `surface-raised`, `brand`, `positive`, `negative`, `warning`.

**The trap this creates, documented at the top of `globals.css`:** shadcn's `accent` is a _subtle hover surface_, not an accent colour. The cyan identity colour is `brand`. Mixing them produces components that look fine in isolation and wrong in context.

Two renames were required, and are the reason Phase 00's components changed:

| Phase 00              | Phase 00b          | Note                             |
| --------------------- | ------------------ | -------------------------------- |
| `muted` (text colour) | `muted-foreground` | `muted` is now a _surface_       |
| `surface`             | `card`             |                                  |
| `border-subtle`       | `border`           |                                  |
| `accent` (cyan)       | `brand`            | `accent` now means hover surface |

Doing this now cost three component edits. Deferring it would have cost dozens.

### Theme precedence

Highest priority last:

1. **Explicit user choice** — `localStorage`, applied by next-themes as `.light` / `.dark`
2. **OS preference** — `prefers-color-scheme`, resolved by `enableSystem`
3. **Documented fallback** — dark, from `:root`

Implemented without `!important` by guarding the media query with `:root:not(.dark):not(.light)`. When an explicit class exists, the OS block stops matching entirely.

### The fallback is not separately observable

Worth stating plainly, because it looks like a gap in the tests.

The CSS spec dropped `prefers-color-scheme: no-preference`. Chromium reports `light` when the user has expressed nothing, and the `light` media query matches. So the `:root` dark values apply exactly when no class is set **and** the OS does not ask for light — which is indistinguishable from honouring a dark preference.

An e2e test asserting a distinct "no preference → dark" case would be asserting the emulator, not the product. The CSS-only path is tested instead, with JavaScript disabled.

### OS light preference still wins over the dark-first identity

Carried forward from Phase 00 (assumption A8) and reaffirmed. Ignoring an accessibility preference to enforce a brand identity is the worse failure. The theme toggle gives anyone who wants dark a one-click, persistent override.

### Three theme options, not a switch

`Light` / `Dark` / `System`. A two-state switch cannot express "follow my OS", and dropping that regresses anyone who schedules dark mode by time of day.

### No flash of wrong theme

next-themes injects a blocking script that sets the class before first paint. That requires `suppressHydrationWarning` on `<html>` — the script mutates the element before React hydrates, and without it React reports a mismatch it cannot reconcile. Verified by e2e.

The toggle renders an inert placeholder until hydrated, using `useSyncExternalStore` rather than the usual `useState` + `useEffect` mount flag — the effect version triggers a cascading render and is flagged by the React Compiler's `set-state-in-effect` rule.

## Consequences

**Positive**

- `shadcn add` produces components that work with no edits.
- One vocabulary; no translation layer.
- Precedence is tested at every level, including with JavaScript disabled.

**Negative / accepted**

- Breaking rename of Phase 00 tokens. Cheap now, expensive later — hence now.
- `accent` meaning a hover surface is genuinely counterintuitive, and is mitigated only by documentation.
- Palettes are duplicated three times in `globals.css` (`:root`, media query, `.light`/`.dark`). CSS offers no way to alias a whole block; the duplication is mechanical and any drift shows up immediately in both themes.

## Customisation boundary for vendored components

`src/components/ui/` is **project-owned code**, not a dependency. Components are vendored by `shadcn add` and may be edited freely — but every deviation from upstream carries a `PROJECT CUSTOMISATION` comment explaining why, so a future re-add can be reconciled deliberately.

Current deviations:

- `dropdown-menu.tsx` — `checked` is spread conditionally rather than passed directly, because this project enables `exactOptionalPropertyTypes` and upstream passes an explicit `undefined`.
