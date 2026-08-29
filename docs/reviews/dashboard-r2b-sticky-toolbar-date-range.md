# Dashboard R2B — Sticky Toolbar & Date Range UI

**Status:** Implemented.
**Baseline:** Next.js `16.2.12` (unchanged), React `19.2.4`, migrations `0000`–`0016` (unchanged).
**Predecessor:** [`dashboard-global-controls-date-range-foundation.md`](./dashboard-global-controls-date-range-foundation.md) — the
frozen state/date/draft contract this release renders. Nothing in that contract changed.

---

## 1. What this release is

The Global Controls contract had no visible owner. R2B builds it: a sticky Dashboard toolbar
carrying the page identity and the three global controls, a desktop dual-calendar Date Range
popover, a near-full-height mobile Date Range sheet, and the removal of the section-local
30D/90D/All control that had been a second visible owner of a global range.

No analytics semantics, eligibility rule, formula, or D1–D8 behaviour changed.

---

## 2. Architecture

```
src/lib/dashboard/
  date-range-presentation.ts   preset order, applied/draft description, locale date formatting
  date-range-calendar.ts       pure month-grid builder + opening month pair
  date-range-draft.ts          (unchanged) the frozen draft reducers

src/components/dashboard/toolbar/
  dashboard-toolbar.tsx            server — sticky band, <h1>, controls slot, skeleton
  dashboard-toolbar-controls.tsx   server — one Promise.all for the controls' data
  toolbar-disclosure.tsx           client — popover above md, sheet below
  toolbar-trigger.tsx              client — the one control shape
  date-range-control.tsx           client — draft state, presets, Clear/Apply
  date-range-month-grid.tsx        client — one month of squares
  filters-control.tsx              client — Strategy/Setup draft + Apply
  account-control.tsx              client — persisted active account / all-accounts scope

src/hooks/use-is-desktop-viewport.ts   SSR-safe (min-width: 48rem)
```

Two server components and five client ones. The toolbar band and its `<h1>` are server-rendered
and paint in the first byte of HTML; only the three interactive controls carry a client boundary,
and they stream in behind their own Suspense boundary.

### The one behaviour-preserving refactor

`resolveAnalyticsDateBounds` (`src/lib/analytics/filters.ts`) had the preset arithmetic inline.
It is now `resolveLocalDatePresetRange(preset, localToday)`, called by the bounds resolver and by
the picker's draft summary. This is **extraction, not redefinition** — the existing
`filters.test.ts` suite passes unchanged, and a new test asserts the picker's displayed dates
against `resolveAnalyticsDateBounds` itself rather than against literals. CLAUDE.md §6 forbids a
second copy of a definition living in the UI; this is what keeps there being one.

---

## 3. Sticky behaviour

| Layer                 | Position                                                                   | z   |
| --------------------- | -------------------------------------------------------------------------- | --- |
| Global app header     | `sticky top-0`                                                             | 40  |
| **Dashboard toolbar** | `sticky top-[--shell-header-height-mobile] lg:top-[--shell-header-height]` | 30  |
| Analytical content    | scrolls underneath                                                         | —   |

The offset switches at `lg` because that is exactly where `ShellFrame` changes the header's own
height token. The bar is full-bleed with its content in a `canvas` `Container`, so the border runs
edge to edge while the title and controls stay in register with the cards below.

**No scroll listener, no state-dependent shadow.** The border and the opaque `bg-background` fill
are permanent, so engaging sticky causes no reflow and no repaint of the bar's own geometry — the
jump that every "add a shadow once detached" implementation produces cannot happen here. This is
the "restrained border/surface distinction, no giant shadow" instruction taken literally.

---

## 4. Date Range button

Applied state only, locale-aware, never a raw URL value:

| Applied URL                                   | Button (en-GB)       |
| --------------------------------------------- | -------------------- |
| `?range=30d`                                  | Last 30 days         |
| `?range=90d`                                  | Last 90 days         |
| `?range=ytd`                                  | YTD                  |
| `?range=all`                                  | All time             |
| `?range=custom&from=2026-07-10&to=2026-08-12` | 10 Jul – 12 Aug 2026 |

Custom labels use `Intl.DateTimeFormat.formatRange`, which collapses whatever the locale considers
redundant across the endpoints — a hand-rolled "same year? drop one" rule is wrong in every locale
that orders the parts differently. Calendar dates are formatted at UTC noon **in UTC**: formatting
`2026-07-10` through the viewer's own zone would render it as the 9th west of Greenwich.

Every label is reconstructed from the URL on the server, so refresh and deep links are correct by
construction and there is no client-only source of truth.

---

## 5. Desktop picker

A floating popover, `43rem` wide, capped at the available viewport height with its own internal
scroll region and a pinned Clear/Apply footer.

```
┌───────────────────────────────────────────────────────┐
│ START DATE   →   END DATE                             │
├──────────────────────────┬────────────────────────────┤
│ ‹                      › │  Today                     │
│ July 2026 │ August 2026  │  This week                 │
│  calendar │  calendar    │  This month                │
│           │              │  Last 30 days              │
│           │              │  Last 90 days              │
│           │              │  This quarter              │
│           │              │  YTD                       │
│           │              │  All time                  │
├──────────────────────────┴────────────────────────────┤
│ Clear                                          Apply  │
└───────────────────────────────────────────────────────┘
```

**Cell treatment.** Endpoints are the accent (`bg-primary`) with an inverted numeral; the days
between are a restrained surface band (`bg-secondary` — #262626 dark) with the band squared off
where the selection continues and rounded where it ends. The whole range is deliberately _not_
painted saturated: on a 90-day custom range the accent would become the largest coloured area on
the page and swallow the two dates the reader is actually adjusting.

**Today is a dot under the numeral**, not a colour — so it stays legible on the accent circle, on
the band and on the bare surface alike, and never competes with the selection for the same channel.

**Outside-month dates are blanks, not muted duplicates.** With two adjacent months on screen, the
left month's trailing days and the right month's leading days are the _same dates_; rendering both
would show each twice. This is a deliberate departure from the brief's §8 wording, and it matches
the frozen Dashboard Calendar widget's own grid.

**Future dates are disabled.** Every canonical preset is period-to-date and no Trade can be
recorded in the future, so a future ceiling is stated truthfully in the control rather than
accepted and then silently returning nothing. Recorded as an assumption (§14).

**Sunday-first**, reusing the Dashboard Calendar widget's own `CALENDAR_WEEKDAY_KEYS` and labels.
Two seven-column grids on one page that disagreed about which column is Sunday would be a defect.
This is unrelated to the `week` _preset_, which stays Monday-anchored in
`resolveLocalDatePresetRange`.

---

## 6. Mobile sheet

Below `48rem` the same panel body opens as a bottom sheet at `92dvh` — **taller than the popover,
never a shrunk copy of it**:

- header: "Date range" + close
- draft start → end summary
- presets as a wrapping chip row (compact, but all eight canonical presets)
- two months **stacked vertically**
- one internal scroll region
- sticky footer: Clear · Apply

`dvh`, not `vh`: on a phone the collapsing browser chrome makes `vh` taller than the visible
viewport, which would push Apply under the URL bar exactly when a reader reaches for it. The
footer's bottom padding respects `env(safe-area-inset-bottom)`.

At 320px the seven-column grid is 288px of content — 41px squares, comfortably above the touch
minimum, with no horizontal panning. Two stacked months exceed a phone's height and scroll
internally, which the frozen contract explicitly accepts.

---

## 7. Presets

All eight canonical bounded presets plus All: Today · This week · This month · Last 30 days ·
Last 90 days · This quarter · YTD · All time. `custom` is deliberately **not** a preset row —
Custom is established by touching the calendar, and a "Custom" button would either be inert or
would have to invent a range on the reader's behalf.

Selecting a preset edits the draft and nothing else. It carries `aria-pressed`, not
`aria-current`: nothing has navigated, and announcing "current page" for a range the Dashboard has
not adopted would tell a screen reader user the opposite of what Apply is for.

---

## 8. Custom range interaction

Exactly the frozen reducers in `date-range-draft.ts` — the picker adds no rules of its own:

1. first click sets start, end empty
2. second click on/after start completes the range
3. an earlier second click is ordered (clicked date becomes start)
4. a click after a complete range starts again
5. a preset replaces the draft
6. Clear sets the draft to All

The summary spells out the resolved dates **for presets too**, not just for custom ranges: "Last 90
days" is a claim about two specific dates, and a picker that will not say which two is asking to be
trusted rather than read. Those dates come from `resolveLocalDatePresetRange`, so they are the same
two the server bounds the query with.

An incomplete custom draft shows "Select an end date" plus a `role="status"` explanation, and Apply
is disabled — the same fact said twice, in words and in state.

---

## 9. Clear and Apply

| Action            | Dashboard transitions |
| ----------------- | --------------------- |
| Open the picker   | 0                     |
| Select any preset | 0                     |
| Click any date    | 0                     |
| Page the months   | 0                     |
| Clear             | 0                     |
| Escape / dismiss  | 0                     |
| **Apply**         | **exactly 1**         |

Opening copies applied → draft; closing simply discards it. Re-seeding on _open_ rather than on
close is what makes Escape, outside-click and the sheet's close button all cancel for free, with no
separate cancel path that could drift.

Apply builds the href with `buildDashboardHref` — the canonical serializer — and hands it to
`useDashboardStateNavigation`. Account, Strategy, Setup, Version and `unit` ride along untouched.

---

## 10. Filters control

Strategy and Setup, on the same Draft/Apply terms. A badge on the trigger counts the applied
dimensions.

The Analytics filter bar navigates on every `change`, which it can afford because it uses soft
routing. The Dashboard's applied transition is currently a full document navigation, so
navigate-on-change would cost two whole page loads to pick a Strategy and then a Setup. One Apply,
one transition — and the shape stays right when the transport becomes soft again.

**Dependency is enforced in the draft, not only in the option list.** Changing Strategy clears
Setup _and_ Version outright; filtering the visible options alone would leave a stale,
now-incompatible id in state and ship it in the URL. And because the contract requires Setup and
Version to resolve to the same Strategy _even when Strategy is omitted_, the Setup list is narrowed
by a pinned Version's Strategy as well — so a link carrying `version` with no `strategy` cannot be
walked into an invalid combination.

Strategy Version is **reported, never edited**: it appears as one sentence only when a URL actually
carries an override, so the common case is a two-field panel and the reader of a shared analytical
link can still see why their numbers are narrower than expected. This is not a filter builder.

The authenticated DAL still verifies every identifier against the active workspace. Everything here
is usability layered on that enforcement, never a replacement for it.

---

## 11. Account control

Two genuinely different kinds of choice:

| Choice          | Mechanism                                                               | URL                  |
| --------------- | ----------------------------------------------------------------------- | -------------------- |
| A named Account | `setActiveTradingAccountAction` (its own membership/entitlement checks) | **no `account` key** |
| All accounts    | explicit analytical scope override                                      | `account=all`        |

**No Account UUID is ever written into the Dashboard URL by this control** — the frozen finding.
An omitted key means the trusted persisted active Account, so the choice survives every other page
and every share of the link. Selecting a named Account therefore _clears_ any explicit
`account=<uuid>` a deep link had carried in, rather than rewriting it. Selecting the same account
that is already applied does nothing at all: a no-op full document navigation is not nothing.

The navigation happens only after the preference write resolves, so the page that loads reads the
account the reader chose rather than racing the write. A refused action navigates nowhere.
Entitlement logic is untouched.

---

## 12. Local range control removal

`DashboardRangeControl` is deleted from `real-dashboard.tsx`, along with `RANGE_ORDER`,
`RANGE_KEY`, and the now-unused `DashboardStateLink`/`buildDashboardHref` imports. The System vs
Trader heading row is now heading-and-description only.

There is exactly one visible Date Range owner. `dashboard.real.range30/90/rangeAll/dateRangeLabel`
message keys are left in place — they are still used by the demo Dashboard's own fixture control.

---

## 13. Responsive behaviour

| Width      | Toolbar                                                               |
| ---------- | --------------------------------------------------------------------- |
| ≥ 768 (md) | one 64px row: `<h1>` left, Date Range · Filters · Account right       |
| 640–767    | two rows; Filters and Account keep their labels                       |
| < 640 (sm) | two rows; Filters and Account drop to icon-only, still 44px targets   |
| 320        | Date Range flexes and truncates; three full-size targets, no overflow |

Below `sm` the **label** is dropped, never the target. That is what keeps the mobile row three real
controls rather than four cramped ones. Priority order is Date Range → Filters → Account, as
instructed.

---

## 14. Light and dark

Every surface uses semantic tokens; no new hardcoded values were introduced.

One real defect was found and fixed during implementation: `--surface-raised` is `#262626` in dark
(the frozen foundation's raised/selected value) but **`#ffffff` in light** — and the picker paints
its range band _inside_ a white popover, where it would have been invisible. All selected/raised
states inside the panels now use `secondary` (#262626 dark / #e9edf7 light) and all hover states
use `accent` (#262626 dark / #dfe6f4 light). The `ToolbarTrigger`'s hover had the same latent bug
(`bg-card` and `surface-raised` are both `#ffffff` in light) and was moved to `accent` too.

Endpoint contrast: `#f6f6f6` on `#2877a2` = **4.57:1** (dark), `#ffffff` on `#1d4ed8` (light) —
both AA for normal text.

No navy surfaces were introduced. No font family changed; Noto Sans Thai is untouched.

---

## 15. Accessibility

- Every date is a real `<button>` named with its full locale-formatted date **plus its selection
  state** — "10 Aug 2026, range start", "11 Aug 2026, in selected range", "12 Aug 2026, range end".
  Range membership is never conveyed by colour alone.
- Today is announced ("29 Aug 2026, today") as well as marked.
- Disabled dates are `disabled` and say "unavailable".
- Presets use `aria-pressed`; account options use `aria-current`.
- Apply is `disabled` for an incomplete custom draft, and a `role="status"` line says why.
- Escape closes both surfaces; focus is trapped in the sheet and restored to the trigger on close —
  all from the Radix primitives, hand-rolled nowhere.
- Focus rings are visible on every cell, preset, option and trigger. The cell ring carries no offset
  (an offset ring on a 40px square is clipped by its neighbours) and lifts on `z-10` instead.
- The `<h1>` is in the toolbar; heading order below it is unchanged.

---

## 16. Navigation abstraction

No `window.location`, no `router.push`, no raw `<a>`, no History API and no bespoke fetching exists
anywhere in `src/components/dashboard/toolbar/`. Every applied change goes:

```
buildDashboardHref(state)  →  useDashboardStateNavigation()  →  (today) document navigation
```

When a patched Next release makes soft navigation safe, the transport swap happens inside that one
hook. The picker, the serializers, the draft model and the toolbar composition need no redesign —
which is exactly what the frozen migration plan requires.

---

## 17. Current hard-navigation limitation, stated honestly

Apply still performs a full document navigation, because Next `16.2.12` can fail to commit
client-side search-param-only navigations on `/[locale]/app`
(`dashboard-d6b-transition-reliability.md`). **Nothing was added to disguise that**: no artificial
delay, no reload overlay, no fake SPA state, no duplicated analytics fetching, no "Updating
dashboard…" animation.

What R2B _does_ guarantee is that draft interaction is instant and local: opening, drafting, paging
months and clearing never reload anything. The toolbar is structured so that content-only loading
can be added later without rewriting it — the bar is already a separate server component from the
analytics beneath it, with its own data boundary.

Next was not upgraded. Navigation transport was not replaced.

---

## 18. Assumptions recorded

| #   | Assumption                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Future dates are not selectable in the picker.** Every canonical preset is period-to-date and no Trade can exist in the future. The ceiling lives in the pure builder (`maxDate`), not hardcoded, so it can be relaxed. A URL carrying a future custom range is still parsed and honoured — only the _control_ declines to build one. |
| R2  | **Outside-month dates are rendered as blanks**, not as muted duplicates, because two adjacent months would show the same dates twice. Departs from the brief's §8 wording; matches the frozen Calendar widget.                                                                                                                          |
| R3  | **The page `<h1>` moved into the sticky toolbar** and the Dashboard description became the first line of scrolling content. The toolbar contract's composition is identity-plus-controls on one line; `PageHeader` is no longer used on this route.                                                                                     |
| R4  | **Strategy Version is displayed, not editable.** The contract permits exposing it "only if current UX already has a sensible way"; a read-only report honours the dependency rules without turning R2B into a filter builder.                                                                                                           |
| R5  | **Filters use Draft/Apply rather than navigate-on-change**, unlike the Analytics filter bar, because the Dashboard's transport is currently a document navigation. Not a contract change — the contract is silent on Filters' commit model.                                                                                             |

---

## 19. Files changed

**New — library (pure, tested)**

- `src/lib/dashboard/date-range-presentation.ts` (+ `.test.ts`)
- `src/lib/dashboard/date-range-calendar.ts` (+ `.test.ts`)
- `src/hooks/use-is-desktop-viewport.ts`

**New — components**

- `src/components/dashboard/toolbar/dashboard-toolbar.tsx` (+ `.test.tsx`)
- `src/components/dashboard/toolbar/dashboard-toolbar-controls.tsx`
- `src/components/dashboard/toolbar/toolbar-disclosure.tsx`
- `src/components/dashboard/toolbar/toolbar-trigger.tsx`
- `src/components/dashboard/toolbar/date-range-control.tsx` (+ `.test.tsx`)
- `src/components/dashboard/toolbar/date-range-month-grid.tsx`
- `src/components/dashboard/toolbar/filters-control.tsx` (+ `.test.tsx`)
- `src/components/dashboard/toolbar/account-control.tsx` (+ `.test.tsx`)
- `e2e/support/dashboard-toolbar.ts`

**Modified**

- `src/lib/analytics/filters.ts` — extracted `resolveLocalDatePresetRange` (behaviour-preserving)
- `src/app/[locale]/(app)/app/(main)/page.tsx` — sticky toolbar; `PageHeader` removed
- `src/components/dashboard/real-dashboard.tsx` — local range control removed
- `src/components/dashboard/real-dashboard.test.tsx` — the two range-link tests replaced
- `messages/en.json`, `messages/th.json` — `dashboard.toolbar.*`
- `e2e/dashboard.spec.ts`, `e2e/dashboard-calendar.spec.ts`, `e2e/dashboard-calendar-stress.spec.ts`

**No migration.** Schema untouched; `drizzle/` unchanged at `0000`–`0016`.

---

## 20. Verification

| Gate                 | Result                                     |
| -------------------- | ------------------------------------------ |
| `prettier --check .` | pass                                       |
| `eslint .`           | pass, no warnings                          |
| `tsc --noEmit`       | pass                                       |
| `vitest run`         | **190 files / 2 779 tests pass**           |
| `next build`         | pass                                       |
| `scan:client`        | pass — 66 client assets, no server secrets |

New tests: 62 across five files — pure grid/presentation, the Date Range control (desktop popover
_and_ mobile sheet), Filters, Account, and the toolbar band. EN and TH copy are asserted in each
component suite. The draft/Apply transition count is asserted directly: draft edits call the
navigation abstraction zero times, Apply calls it exactly once.

Every existing date-domain test is preserved unchanged.

---

## 21. E2E

Run for real against the project's designated disposable Neon test database
(`TEST_DATABASE_URL` / `TEST_DATABASE_ACK` from `.env.local`), chromium and mobile-chrome,
against a production build.

`e2e/dashboard.spec.ts` and `e2e/dashboard-calendar.spec.ts` cover: the toolbar rendering, the
Date Range control applying a preset, the absence of the section-local control, the global range
moving the Dashboard, Calendar month-∩-range intersection, Risk semantics, Strategy/Setup filters,
Account switching, the mobile sheet, and zero horizontal overflow at 320/390.

Three specs were updated to drive the toolbar instead of the retired links, through one shared
helper (`e2e/support/dashboard-toolbar.ts`):

- `dashboard.spec.ts` — desktop applies a preset through the toolbar; mobile opens the sheet,
  asserts **two stacked months**, drafts a preset, asserts the URL has **not** moved, then applies.
- `dashboard-calendar.spec.ts` — the three range transitions now go through the picker.
- `dashboard-calendar-stress.spec.ts` — `step()` gained an optional `prepare` callback that runs
  **before the clock starts**, so the reliability harness times the Apply (the real transition) and
  not the popover opening. Timing a draft edit would report a popover animation as routing latency.

### One pre-existing flaky assertion, found and fixed

The first full run failed one test — `dashboard-calendar.spec.ts` "mobile: the Day Review and
Quick Preview are sheets", asserting the Day Review is ≥374px wide at a 390px viewport but
measuring **370.5px**.

The Day Review is untouched by R2B. The cause is a race in the assertion itself: the Day Review is
a `dialog-content`, whose open animation (`menu-content-in`) starts at `transform: scale(0.95)`,
and `390 × 0.95 = 370.5` exactly. `toBeVisible()` resolves at animation frame zero, so a single
`boundingBox()` can measure the animation rather than the layout. It passes in isolation and failed
only under a loaded 10-worker run — the worst way for a geometry assertion to fail.

Fixed by polling for the **settled** geometry (`expect.poll`) rather than by lowering the
threshold. The assertion still means exactly what it meant: a full-bleed mobile sheet.
