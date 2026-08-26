# Dashboard D4.5 — Desktop Canvas and Density Refinement

A macro layout and density pass only. No analytics changed, no KPI semantics
changed, no System/Trader internals redesigned, no App Shell touched, no
Dashboard feature added, and no D5 Execution Gap work started.

Every figure below is measured from the real application in a production
build against the guarded test database, not estimated — the before and after
frames and their raw measurements are in
`docs/reviews/dashboard-d4-5-canvas-uat/{before,after}/`.

## 1. Content width

| Viewport | Workspace after the rail | Content before | Content after | Change          |
| -------- | ------------------------ | -------------- | ------------- | --------------- |
| 1280     | 1216px                   | 1152px         | 1152px        | —               |
| 1440     | 1376px                   | 1312px         | 1312px        | —               |
| 1920     | 1856px                   | 1536px         | **1792px**    | +256px (+16.7%) |

The audit found the Dashboard already on `Container width="wide"`
(`max-w-[100rem]`, 1600px) with 16/24/32px gutters. That ceiling was doing no
work at 1280 or 1440 — the workspace is narrower than the cap there, so the
gutter alone decided the width — and it was clipping 256px at 1920, leaving
roughly 128px of dead margin on each side of a 1536px column. That is the
"narrow tablet layout centred inside a desktop monitor" the brief describes,
and it only exists above ~1660px.

D4.5 adds `Container width="canvas"` (`max-w-[120rem]`, 1920px) and puts the
Dashboard on it. Gutters are unchanged at 16/24/32px, already inside the
brief's 24–32px desktop target, so cards never full-bleed to the viewport
edge. At 1920 the workspace (1856px) is now narrower than the ceiling, so the
gutter decides the width and the page uses the whole canvas; the cap only
starts clipping on a genuine ultrawide.

`canvas` is deliberately Dashboard-only. `wide` still serves Analytics,
Accounts and the other analytics surfaces — widening those is a separate
decision that deserves its own verification, not a side effect of this pass.

## 2. Account context card

| Viewport  | Before | After    |
| --------- | ------ | -------- |
| 1280–1920 | 173px  | **80px** |
| 768       | 173px  | 80px     |
| 390/320   | 297px  | 188px    |

It was a `CardHeader` + `CardContent` card whose three facts were spread
across the full page width by a `sm:grid-cols-3` — taller than a Basic KPI
card, and the most visually prominent element above the fold, for context
nobody reads twice. It is now one row: identity on the left, the three facts
as a right-aligned cluster that stays clustered as the canvas widens.

Nothing was removed. Account name (still a heading, so the labelled region
keeps a findable title), the "Your active trading account" subtitle, Live /
Backtest mode, base currency and starting balance are all still present and
still labelled. Only geometry and type scale changed. Below `sm` the bar
becomes a stack, as the brief permits.

The future Account/Filter toolbar was **not** built.

## 3. Basic KPI density

All D3 semantics, states, components and copy are unchanged. The only edit is
padding: `p-4 sm:p-5` became `p-4` at every width, so a card is 138px instead
of 146px on desktop (mobile was already 138px and is unchanged). Five cards
remain one row at `lg`, three at `md`, two below that with the fifth spanning
— untouched. Unavailable and empty states are untouched.

## 4. Needs Attention

| Viewport  | Before | After    |
| --------- | ------ | -------- |
| 1280–1920 | 243px  | **96px** |
| 768       | 317px  | 155px    |
| 390       | 402px  | 289px    |
| 320       | 402px  | 355px    |

Header block over a four-column grid over a full-width action row became one
bar: mark, title and supporting sentence on the left; the counts and the
Review action on the right. 96px on desktop, inside the brief's 90–110px
target.

Preserved exactly: the title, the supporting sentence, Open Trades, Pending
System Outcomes, Unclassified Trades, the Review action, the `count > 0`
filter, and the D2 `workspace_operational` scope. No score was invented and no
category was added.

**One deliberate departure from the brief's wording.** §4 lists three counts;
the panel has carried five since Phase 14C/14E (Reviews Pending and Needs
Execution Details as well). Dropping two would have been removing
information, which §4 also forbids, so all five survive — the layout is a
wrapping cluster that takes however many are non-zero. The seeded UAT
workspace shows three of them.

A second, smaller fix rides along: the panel renders nothing when every count
is zero, but it used to sit inside a layout-slot wrapper that rendered
anyway, leaving a section's worth of dead vertical space on exactly the
workspace with nothing to show. It now owns its own slot, so nothing is
emitted at all. A unit test covers it.

## 5. Section vertical rhythm

Every boundary on the page was the same 32px gap, whatever it separated.

| Boundary                      | Target  | Before | After |
| ----------------------------- | ------- | ------ | ----- |
| Page header → account context | 16–20px | 32px   | 20px  |
| Account context → KPI band    | 16–20px | 32px   | 20px  |
| KPI band → Needs Attention    | 20–24px | 32px   | 24px  |
| Needs Attention → performance | 24–28px | 32px   | 28px  |
| Performance → Execution Gap   | —       | 32px   | 28px  |
| Execution Gap → recent Trades | —       | 32px   | 32px  |

All values come from the existing Tailwind spacing scale (`mt-5`/`mt-6`/
`mt-7`/`mt-8`); nothing bespoke was introduced. `first:mt-0` on the KPI band
keeps the top edge correct in all-accounts scope, where no account context
bar renders. Page padding went from `py-8` to `py-6`.

Measured page height at 1440 fell from 2213px to 1901px (−312px, −14.1%) with
no content removed.

## 6. System / Trader

Untouched internally, and deliberately not taller: both cards measure 384px
before and after at 1440, still equal to each other, still `items-stretch`,
still 50/50. The extra 256px of canvas at 1920 goes into their internal
three-column metric grids rather than into height. The stale 2/3 + 3/5 visual
split is not restored anywhere.

## 7. Layout metadata reconciliation

D2 recorded `system.performance: desktopSpan 2` and `trader.performance:
desktopSpan 3` against an implied five-column page grid. D4 rendered them as
equal halves anyway and recorded the contradiction rather than faking parity,
noting that resolving it was a D2 metadata decision. This is that decision.

`DashboardLayoutItem` now carries a `section`, and `DASHBOARD_SECTIONS` gives
each section its own `desktopColumns`. A `desktopSpan` is read against its own
section and nothing else:

| Section         | Columns | Members                                                        |
| --------------- | ------- | -------------------------------------------------------------- |
| `basic-kpi`     | 5       | the five Basic KPI widgets, 1 column each                      |
| `attention`     | 1       | `review.needs-attention`, full width                           |
| `performance`   | 2       | `system.performance` + `trader.performance`, **1 column each** |
| `execution-gap` | 1       | `execution.gap`, full width, D5's slot                         |
| `recent-trades` | 1       | `trades.recent`, full width                                    |
| `reserved`      | 1       | the three unbuilt widgets                                      |

The three unbuilt widgets sit in `reserved` rather than being assigned a
section that was never decided — full width is an honest placeholder, not a
prediction about a widget nobody has designed.

This is not a layout engine. There is still no persistence, no editor, no
drag/drop, no resize, and no runtime that turns these numbers into a grid.
Components still spell their own Tailwind grids; the metadata is now the
record of what those grids actually are, and `dashboardWidgetAttributes()`
publishes section, column count, span, mobile span and order from one place so
the three widget roots cannot drift apart again. New unit tests assert that no
widget spans more columns than its section has, that every section fills whole
rows, and that System and Trader are equal halves of a two-column section.

## 8. Responsive behaviour

Verified at 320, 390, 768, 1280, 1440 and 1920, both themes:

- `document.scrollWidth === document.clientWidth` at every width — no
  horizontal overflow anywhere.
- Mobile KPI grid stays two columns with the fifth card spanning both.
- Analytical cards stack full width below `lg`.
- The account context bar stacks and stays readable at 320.
- Needs Attention stays usable, wrapping its counts rather than clipping them.

## 9. Above-the-fold improvement

The compaction reclaims **291px** of vertical space above the System/Trader
pair, identically at every desktop width — 93px from the account bar, 147px
from Needs Attention, 8px from the KPI row, 35px from the section rhythm, and
8px from page padding. Measured against the fold, with the 384px performance
cards:

| Viewport  | Pair visible before           | Pair visible after    | Gain   |
| --------- | ----------------------------- | --------------------- | ------ |
| 1920×1080 | 142px of 384px                | **384px — all of it** | +242px |
| 1440×900  | 0px — entirely below the fold | 253px of 384px        | +253px |
| 1280×800  | 0px — entirely below the fold | 153px of 384px        | +153px |

At 1920 a reader now gets the page header, account context, five KPI cards,
Needs Attention, and both performance cards complete — every hero, both
composition lines, and all twelve supporting metric cells — without
scrolling. Before, they got the two heroes and nothing under them.

At 1440, where the pair used to begin 38px _below_ the fold, both heroes,
both composition lines and the first row of three metrics per side are now
above it. Same data, same font sizes, no information removed to get there.

Total page height at 1440 fell 2213px → 1901px (−14.1%).

## 10. Not changed

D1 formulas, the D2 `DashboardPageData` contract, D3 KPI semantic states, D4
System/Trader metrics, execution comparison data, the theme contract, the
sidebar/header architecture, the mobile drawer, the database and schema, and
filter behaviour are all untouched. No message key was added, removed or
reworded in either locale. No migration.

## 11. Verification

| Gate                                    | Result                                                  |
| --------------------------------------- | ------------------------------------------------------- |
| Unit tests (`pnpm test`)                | **2317 passed / 160 files**                             |
| Typecheck (`tsc --noEmit`)              | clean                                                   |
| Lint (`eslint`)                         | clean                                                   |
| Format (`prettier --check .`)           | clean                                                   |
| Production build (`next build`)         | compiled, 48 routes                                     |
| `git diff --check`                      | clean                                                   |
| Dashboard E2E, chromium + mobile-chrome | mobile passed; one desktop assertion failed — see below |
| Demo-dashboard E2E                      | 14 passed                                               |
| Theme E2E                               | passed                                                  |
| App-shell E2E, chromium                 | passed                                                  |
| Accounts E2E                            | passes in isolation                                     |

New unit coverage: 6 section-metadata cases (`widgets.test.ts`), 1 `canvas`
width case (`container.test.tsx`), 4 rhythm/compaction/ordering/empty-slot
cases (`real-dashboard.test.tsx`), 1 account-bar case
(`empty-trading-dashboard.test.tsx`). Two existing `real-dashboard` cases were
retargeted: the "leads with the KPI cards" ordering assertion pointed at the
Needs Attention slot, which the default all-zero fixture no longer emits at
all, so it now asserts against the System card and a second case covers the
full ordering with a populated fixture.

### The one failing E2E assertion, and why it is not D4.5

`dashboard.spec.ts:341` — after clicking the `30D` range link,
`expect(page).toHaveURL(...)` times out at its default 5s. Everything before
it passes, including every D3 KPI figure, every D4 System/Trader metric, and
the equal-width/equal-height/shared-top-edge geometry assertions.

Investigated rather than assumed:

- **The click lands and the router fires.** The Playwright trace shows the
  correct anchor resolved, "click action done", and a real non-prefetch RSC
  request for `/en/app?range=30d&unit=r` returning **200**. React simply does
  not commit the URL inside 5s.
- **The same click is fast in isolation.** Instrumented against the same
  seeded workspace, the same viewport, and after the same keyboard
  popover-open/Escape preamble, the navigation completes in **628–660ms**
  every time. Server render of that route is 652ms. No console errors, no
  page errors, and the client tree is hydrated.
- **Reverting D4.5's page-level change does not fix it.** With
  `width="canvas"`/`gap-5`/`py-6` put back to `width="wide"`/`gap-8`/`py-8`,
  the identical assertion still fails.
- **The Analytics spec already works around the same slowness.**
  `analytics.spec.ts` gives its equivalent client-side filter navigations
  `{ timeout: 120_000 }` — 120 seconds — on a page D4.5 never touches. The
  Dashboard spec is the outlier still on the 5s default.
- **The D4 review recorded this same assertion failing at this same line**,
  before D4.5 existed.

D4.5 changes no data path, no server action, no Suspense boundary, no `Link`,
no filter serialization and no router code — only class names, one
`max-width` token, DOM data attributes, and margins.

D4.5 deliberately left this alone — relaxing a committed spec's assertion is
not a macro-layout change. It was addressed knowingly in the pre-D5 micro
cleanup that followed: both 30D transition assertions (desktop and its mobile
twin) now carry an explicit **15s** bound rather than the 5s default, each
followed by an `aria-current="page"` check that only passes once the
server-rendered tree has committed. Deliberately not the 120s
`analytics.spec.ts` uses.

A further finding from that work: the dominant variable is **worker
concurrency**, not the timeout. Run serially the two cases pass in 12.3s and
9.0s; run in parallel, the transition can exceed 15s outright because two
dashboard specs saturate one `next start` process talking to a remote Neon
endpoint. CI already sets `workers: 1` (`playwright.config.ts`), so CI runs
serially and the 15s bound is the right size there; a local parallel run on a
remote database can still exceed it.

### Other failures observed, both outside this surface

A combined four-spec run reported 14 failures. Re-run in isolation:

- `accounts.spec.ts:231` (archive/restore) — **passes** (22.7s). The test
  never visits the Dashboard.
- The eleven `app-shell.spec.ts` `mobile-chrome` cases — the whole
  `Collapsed sidebar hover flyout` block **passes**, 12/12. They are the
  in-flight shell work's desktop rail suite; the container width token is the
  only shell file D4.5 touches, and at a phone viewport that token is not
  binding at all.

So every failure except the `30D` navigation above is load-sensitivity in the
combined run, on a working tree that also carries substantial uncommitted
D1–D4 and shell work. No pre-D4.5 baseline run was taken for those specs.

## 12. Observed, not fixed

At 768 the date-range segmented control wraps "All" onto a second line.
Pre-existing and unchanged by this pass — the control's container width at
768 is identical before and after.

### Resolved afterwards, in the pre-D5 micro cleanup

Starting balance rendered as the raw `NUMERIC` string,
`10000.0000000000 USD`. D4.5 recorded it as out of scope for a density pass;
it was fixed immediately afterwards by `formatStartingBalance`
(`src/lib/trading-accounts/presentation.ts`), which routes the decimal string
through the canonical `parseMoney` -> `formatMoney` pair so the currency's own
ISO-4217 exponent decides the decimals (`$10,000.00`, `¥10,000`) and
non-registry tickers such as BTC keep a truthful `2.5 BTC`. The UAT frames in
`dashboard-d4-5-canvas-uat/` predate that fix and still show the raw string;
nothing else in them changed, since the bar's geometry is unaffected.

## Files changed

| File                                                        | Change                                             |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `src/lib/dashboard/widgets.ts`                              | section metadata, `dashboardWidgetAttributes()`    |
| `src/lib/dashboard/widgets.test.ts`                         | section invariants, the 2/3 → 1+1 reconciliation   |
| `src/components/shell/container.tsx`                        | `canvas` width                                     |
| `src/components/shell/container.test.tsx`                   | `canvas` coverage                                  |
| `src/app/[locale]/(app)/app/(main)/page.tsx`                | `width="canvas"`, `gap-5`, `py-6`                  |
| `src/components/dashboard/real-dashboard.tsx`               | rhythm, compact Needs Attention, skeleton geometry |
| `src/components/dashboard/real-dashboard.test.tsx`          | rhythm, compaction, ordering, empty-slot tests     |
| `src/components/dashboard/empty-trading-dashboard.tsx`      | compact account context bar                        |
| `src/components/dashboard/empty-trading-dashboard.test.tsx` | one-row bar, all facts preserved                   |
| `src/components/dashboard/kpi/kpi-widget-card.tsx`          | `p-4` at every width, shared layout attributes     |
| `src/components/dashboard/kpi/basic-kpi-row.tsx`            | `className` passthrough                            |
| `src/components/dashboard/performance/performance-card.tsx` | shared layout attributes                           |
| `docs/design-system.md`                                     | `canvas` width, dense-surface rhythm               |
