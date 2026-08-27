# Dashboard D6B — Recent Trades, Calendar, Day Review & Quick Trade Preview

Presentation and route wiring. No population, date axis, formula, query
contract, schema or App Shell change. No migration. D1–D6A contracts intact.

## The section

`trades.recent` and `calendar.performance` — the two registry ids D2 reserved,
no new ones — now share one twelve-column section, **7 + 5**:

| Widget                 | Section               | Desktop span | Mobile |
| ---------------------- | --------------------- | ------------ | ------ |
| `trades.recent`        | `recent-and-calendar` | 7 of 12      | full   |
| `calendar.performance` | `recent-and-calendar` | 5 of 12      | full   |

This is the one section on the page whose widgets are genuinely unequal. A
Trade list wants horizontal room for symbol, Strategy and three R figures; a
seven-column grid stops being readable well before it stops fitting. Twelve is
the smallest integer grid that says 7 + 5 honestly — halves would starve the
squares, thirds would starve the rows.

D4.5's section-aware metadata absorbed this without a new mechanism:
`DashboardSectionDefinition.desktopColumns` gained `12` and `desktopSpan`
gained `7`/`12`. **Still not a layout engine** — no persistence, no editor, no
drag/drop, no resize. The section's component spells its own
`lg:grid-cols-12`; the metadata records what it spells, and a test now asserts
every span against **its own section's** column count rather than a fixed
ceiling of five.

The two cards share a top edge and stretch to one bottom edge. §23 forbids
forcing equal height _at the Calendar's expense_, which is a different thing
from letting the shorter card fill its column: the grid's squares are
fixed-height rows inside a `flex-col` card, so stretching only ever adds room
below them, and in practice the Calendar is the taller of the two (656px vs
494px at 1440). The first capture pass shipped `items-start` and left 162px of
ragged column; that read as an accident rather than as density.

## Recent Trades

D2's scope is untouched — same five Trades, same `occurred_at` axis, same
Account/date/Strategy/Setup filters. The shape changed. Through D5 this was a
full-bleed band that gave symbol, Strategy and two R values equal weight and
**left the Execution Gap off the row entirely**, so the one number the product
exists to surface was the one number a reader had to open a Trade to find.

The hierarchy is now: identity, then Actual → System → Gap as a fixed triple
reading in the order the attribution argument is made. Strategy, Setup and the
occurred time are one quiet supporting line. A compact record list — no column
headers, no sorting, no pagination. The Journal owns all three.

**The Gap is the supplied typed state, never `actualR - systemR` in React.**
Available renders a signed R; unresolved renders "Pending" with the reason
behind it; an integrity failure renders "Error". A Trade with a pending System
side keeps its row and says so rather than showing a 0.00R Gap, which would
assert perfect execution on a comparison that has not happened.

## The Calendar

One implementation, three modes. The mode selects which population and which
axis D6A composed the month from — never a second component, never a display
toggle over one dataset. The card states the question it is answering under
its own title, so the grid never implies the three share a Trade universe:

| Mode     | Under the title                                                |
| -------- | -------------------------------------------------------------- |
| `actual` | Closed Trades, by the day you exited.                          |
| `system` | Resolved System outcomes, by the day the System exit resolved. |
| `gap`    | Trades with both sides complete, by the day you exited.        |

**Mode is a link, not a toggle.** Phase 14D kept the axis in a `useState`, so
a refresh reset it and a shared link never carried it. Every dimension — mode,
month, selected day, opened Trade — is a URL parameter, which is what makes
deep linking, Back and refresh work with no history code and keeps the whole
card renderable on the server. It fetches nothing and calculates nothing.

### Cells

Actual/System: date, daily total R, Trade count, and W/BE/L as a secondary
line. Gap: date, Gap R, paired count, and the paired count again as secondary.
The secondary line appears on the **widget's own width** (`@container`), not
the viewport's — this card is five of twelve columns, so 1280px and 1920px give
it very different room. Below the threshold the secondary line is the first
thing dropped; the date and the R value never shrink into an ellipsis.

**Found in the first capture pass and fixed:** at 320px the R value was
truncating to `+2...`, which §24 forbids. Below a 22rem container the card
tightens its own padding, the grid halves its gap, and the cell drops the
trailing `R` — the least informative glyph in the square. `+2.20` fits; the
accessible name still says `+2.20R`, and nothing above 22rem changed at all.

Gap cells are never labelled winning or losing. `calendarDayClassificationKey`
namespaces the wording by mode, and a test asserts a Gap day's accessible name
contains neither word.

### Colour

A tint, a border and an emphasised value — never a saturated block. A
profitable month must not read as a wall of green. **The sign is always in the
text** (`+2.20R` / `-1.15R`) and in the cell's accessible sentence, so colour
reinforces direction and never carries it alone.

### Empty dates vs 0R days

The distinction D6A's sparse days exist to preserve, kept visible:

- a date with **nothing eligible** is a quiet, unclickable cell showing only
  its number, hidden from assistive tech behind the grid's one-sentence
  summary;
- an **eligible day that totalled 0.00R** is populated, clickable, neutral,
  and shows its zero, its Trade count and its `0W 1BE 0L`.

The fixture has a real example of the second on 2026-08-12. Both are pinned by
tests.

## Day Review

A dialog **over** the Dashboard. Phase 14D navigated to `view=log`, destroying
the calendar the reader had just been reading; here the Calendar, the month,
the mode and every filter stay behind it and closing returns to exactly that
state.

The headline is the **clicked square's own numbers**, passed through from
D6A — not a re-summation. The failure this prevents is a cell reading `+2.40R`
and the panel it opens reading `+2.41R` from a second aggregation that rounded
differently.

| Mode              | Headline                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `actual`/`system` | Total R, eligible/resolved count, Won / Break even / Lost                                      |
| `gap`             | Total Execution Gap, paired count, System R, Actual R, Underperformed / Matched / Outperformed |

Gap mode carries no W/BE/L and no win-or-loss verdict. Rows expose symbol,
side, Strategy/Setup, this mode's own timestamp, Actual R, System R and the
same three-state Gap, and each links to its Quick Preview.

One component, two geometries: a near-full-height bottom sheet on a phone, a
centred dialog from `sm` up — large enough for the headline and the rows,
deliberately not large enough to be mistaken for the Journal.

## Quick Trade Preview

A right-hand sheet (full width on a phone) over the Day Review. **A reader,
not a second Journal editor**: no form, no save, one link into the Journal for
anything that needs changing.

Every value comes from the canonical `getWorkspaceTradeDetail` the Journal
already uses, projected once by `composeTradeQuickPreview`. The Execution Gap
on the Overview is **the calc engine's own derived figure**, not
`actualR - systemR` computed again at the presentation boundary.

**Tabs are derived from the Trade, never fixed.** Overview always; Strategy
only with a pinned Strategy or Setup; Review only with rules, mistakes or
emotions; Executions only with exit legs; Chart only with a TradingView link or
an attachment; Notes only with a note. Six tabs of which three say "nothing
recorded" is a promise the data did not keep. The tablist is a real one —
arrow keys, Home/End, roving tabindex — and the active tab is deliberately
**not** in the URL, because which tab was open is not a fact about the Trade.

Execution legs are the one place a partially closed position stops being one
row: the Calendar and the Day Review count positions, by construction.

## URL and overlay behaviour

```
/app?range&account&strategy&setup&unit   ← Dashboard filters (filters.ts)
     &mode&month&day&trade               ← Calendar navigation (calendar-navigation.ts)
```

Both parsers run on every Dashboard render and **both still fail closed**; an
unknown key is an error in either. Every href is built by
`serializeCalendarState`, whose filter half comes from the filters module
itself, so changing mode, paging the month, opening a day or opening a Trade
cannot drop Account, Strategy, Setup or range.

| Action                 | Result                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| click a populated date | `day=` added; Day Review opens over the Calendar                            |
| click a Trade          | `trade=` added; Quick Preview opens over the Day Review                     |
| close the Trade        | `trade=` removed; **the Day Review stays open**                             |
| close the Day Review   | `day=` removed; same month, same mode, same filters                         |
| change mode            | day and trade cleared — a day selected in Actual may hold nothing in System |
| refresh / deep link    | reconstructs whatever the URL describes                                     |
| Back / Forward         | traverses the selection states                                              |

Nothing lives in React memory. One extra guard was needed for deep links:
`resolveCalendarMonth` resolves the grid to the month **containing the selected
day** when `month` is absent, because `parseCalendarNavigation` only rejects a
`day` outside an _explicitly requested_ month — without it a `day`-only link
would render a grid that does not contain the day whose review is open.

A `day` that carries nothing in this month's projection is treated as a stale
link: the Calendar renders without a Day Review rather than asserting a day
that does not exist.

## Query and data boundaries

| Surface        | Reads                                      |
| -------------- | ------------------------------------------ |
| Dashboard core | **5, unchanged**                           |
| Calendar month | 1, in its own Suspense boundary            |
| Day Review     | 1 (rows) — the month is already in hand    |
| Quick Preview  | 1 — the existing `getWorkspaceTradeDetail` |

No `useEffect`, no client fetch, no query per cell, no query per row. The
Calendar stays out of `DashboardPageData` exactly as D6A decided, and streams
in its own boundary so its read never holds the five core reads off the screen.

**What that costs per interaction, stated because it is not free.** The
overlays are URL-backed, and a search-param change re-renders the route
segment — so every one of them re-runs the page's server work, not just the
part that changed:

| Interaction                           | Reads |
| ------------------------------------- | ----- |
| load / filter change / page the month | 6     |
| open a day                            | 7     |
| open a Trade                          | 8     |

The five core reads in each of those totals are the same five D2 froze, and
`DashboardPageData` is untouched — but they are re-issued because the App
Router re-renders the segment, not because D6B added anything to the bundle.
Scoping an overlay's re-render to its own subtree needs parallel or
intercepting routes, which is a routing-architecture decision well outside a
presentation phase. It is the dominant cost of an overlay against a remote
database, and it is the most likely explanation for the E2E timing sensitivity
recorded below.

**One deliberate deviation from §22, stated rather than hidden.** D6A's Day
Review costs two reads — the day's rows plus the month projection its headline
comes from. On this route the Calendar grid has _already fetched that exact
month_, and re-issuing it would run the identical bounded query twice in one
render. `getDashboardDayReviewInMonth` takes the month in hand and spends one
read instead.

This does not weaken the guarantee §22 exists to protect — it strengthens it.
The headline stops being an equal aggregation over the same rows and becomes
**literally the same `CalendarDay` object the cell rendered**. The prohibition
D6A actually wrote down — never re-sum the rows in the presentation layer to
save the read — is untouched: nothing sums anything, and the standalone
two-read `getDashboardDayReview` remains, unchanged and still tested, for any
caller without a month in hand.

## Dashboard navigation transport stabilization

The local investigation isolated the residual failure to same-pathname,
search-param-only Next client navigation on `/[locale]/app`; direct document
GETs of the same destination remained reliable. Dashboard state controls now
use ordinary locale-aware anchors, while overlay dismissals use document
navigation from their button-semantic close path. URL generation, filter
preservation, deep links, Back/Forward and refresh remain unchanged.

Cross-path links such as Quick Preview → Journal, View all Trades and View
full analytics continue through the locale-aware Next navigation wrapper.
The routing suite contains no retry-click helper: every asserted transition
comes from one user gesture.

## Accessibility

- Every populated date is a link whose accessible name is a full sentence:
  the date, the R value, the counts, and the day's own classification.
- Blank dates are `aria-hidden`; one sr-only sentence says how many of the
  month's dates carry eligible Trades, instead of announcing twenty bare
  numbers ahead of the days that matter.
- The selected day carries `aria-current="page"`; so does the active mode.
- Both overlays are real dialogs with a title and a description relationship;
  Escape closes, focus is trapped and restored by Radix.
- The Quick Preview's tablist is keyboard-operable.
- No `+`/`−` is conveyed by colour alone, anywhere.

## Fixture validation

`pnpm validate:visual-dashboard-d6` — read-only, no INSERT/UPDATE/DELETE/DDL.
Against **Visual — Populated**:

| Month   | Actual                       | System                      | Gap                         |
| ------- | ---------------------------- | --------------------------- | --------------------------- |
| 2026-08 | 14 days / 14 / **+12.6000R** | 16 days / 16 / **+6.8500R** | 12 days / 12 / **+5.1000R** |
| 2026-07 | 24 / 24 / −0.1000R           | 24 / 24 / +8.9000R          | 24 / 24 / −9.0000R          |
| 2026-06 | 24 / 24 / +11.7500R          | 24 / 24 / +17.5000R         | 24 / 24 / −5.7500R          |
| 2026-05 | 4 / 4 / −1.1500R             | 4 / 4 / +3.0000R            | 4 / 4 / −4.1500R            |

August day counts by sign: Actual 8 / 1 / 5, System 6 / 2 / 8, Gap 5 / 1 / 6.
**Actual and System populate a different number of days in the same month**
(14 vs 16) — the axes are genuinely different, exactly as D1 froze them.

UAT targets found in the real data, not asserted in advance:

| Case                  | Date                                |
| --------------------- | ----------------------------------- |
| positive Actual day   | 2026-08-02 (+2.2000R, 1W 0BE 0L)    |
| negative Actual day   | 2026-08-04 (−1.1500R, 0W 0BE 1L)    |
| break-even Actual day | 2026-08-12 (0.0000R, 0W **1BE** 0L) |
| positive Gap day      | 2026-08-02 (+3.1000R)               |
| negative Gap day      | 2026-08-04 (−0.2500R)               |
| matched Gap day       | 2026-08-12 (0.0000R)                |

10 multi-leg positions exist in the fixture, so the Quick Preview's Executions
tab is exercised on real scale-outs. **Visual — Empty** returns
`empty`/`no_eligible_trades` in all three modes — never `error`.

No fixture record was mutated for the captures.

## UAT artifacts

`docs/reviews/dashboard-d6b-calendar-uat/` — 15 cases with `metrics.json`,
captured from the real Dashboard against **Visual — Populated** and
**Visual — Empty**. Measured, not asserted:

| Case            | Recent               | Calendar            | Overflow |
| --------------- | -------------------- | ------------------- | -------- |
| 1440 dark/light | x=96, w=759, h=656   | x=871, w=537, h=656 | **0**    |
| 1440 System     | w=759, h=681         | w=537, h=681        | **0**    |
| 1920            | w=1039, h=656        | w=737, h=656        | **0**    |
| 390 / 320       | w=358 / 288, stacked | w=358 / 288         | **0**    |
| Empty (1440)    | h=329                | h=329               | **0**    |

- **7 + 5 confirmed**: 759 / 537 at 1440, 1039 / 737 at 1920 — and both cards
  share a top _and_ a bottom edge in every populated case.
- **No horizontal overflow at any width**, 1920 down to 320.
- **The cell value never truncates**: `+2.20R / 1W 0BE 0L` at 1440 and 1920,
  `+2.20` at 390 and 320 — the recorded `firstCellText`, not a judgement.
- **Mode changes the population, not the styling**: 14 populated days in
  Actual, 16 in System, 12 in Gap, on the same month.
- Quick Preview on the partially closed position: **2 legs**, tabs
  `Overview · Strategy · Review · Executions · Notes` — no Chart tab, because
  that Trade has no chart.

**Two things that look like defects in the captures and are not.** Every
Recent Trades row shows a Pending Gap: the five most recent Trades by
`occurred_at` in this fixture are open or awaiting details, so an unresolved
Gap is the truthful state, and §3 is exactly what makes it visible instead of
a fabricated 0.00R. And in the mobile `-section.png` element captures the
sticky app header floats over the card — a Playwright element-capture artifact
of a `position: fixed` header, not a layout collision; the `-page.png` frames
at the same viewport show the real stacking.

## Files changed

| File                                                                           | Change                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------ |
| `src/lib/dashboard/calendar-grid.ts` (+test)                                   | **new** — month grid, month resolution     |
| `src/lib/dashboard/calendar-presentation.ts` (+test)                           | **new** — tone/vocabulary split            |
| `src/lib/dashboard/trade-preview.ts` (+test)                                   | **new** — Quick Preview projection         |
| `src/lib/dashboard/widgets.ts`                                                 | 12-column section; calendar → `current`    |
| `src/components/dashboard/calendar/dashboard-calendar-card.tsx` (+test)        | **new** — the widget                       |
| `src/components/dashboard/calendar/dashboard-calendar-section.tsx`             | **new** — the server boundary              |
| `src/components/dashboard/recent-trades/recent-trades-card.tsx` (+test)        | **new** — extracted and restyled           |
| `src/components/dashboard/day-review/day-review-dialog.tsx` (+test)            | **new** — the Day Review                   |
| `src/components/dashboard/trade-preview/trade-quick-preview-sheet.tsx` (+test) | **new** — the Quick Preview                |
| `src/components/dashboard/real-dashboard.tsx`                                  | the 7 + 5 section, calendar slot, skeleton |
| `src/components/dashboard/kpi/kpi-widget-card.tsx`                             | span map kept exhaustive                   |
| `src/app/[locale]/(app)/app/(main)/page.tsx`                                   | calendar navigation parsed and wired       |
| `src/server/services/dashboard-calendar.ts`                                    | `getDashboardDayReviewInMonth`             |
| `messages/en.json`, `messages/th.json`                                         | `calendar`, `dayReview`, `tradePreview`    |
| `scripts/validate-visual-dashboard-d6.ts`                                      | **new** — read-only fixture validation     |
| `e2e/dashboard-calendar.spec.ts`                                               | **new** — the routing suite                |
