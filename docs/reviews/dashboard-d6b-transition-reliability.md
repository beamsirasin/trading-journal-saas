# D6B — App Router transition reliability investigation

A focused diagnosis of the intermittent client-transition stall on the
Dashboard. The root cause was isolated to a route. The measurements below are
kept as historical evidence so nobody repeats the falsified investigations;
the product-safe transport workaround is recorded separately at the top.

Nothing was masked: no timeout was lengthened, no assertion weakened, no test
disabled, no `page.reload()` or forced navigation inserted to make a step pass.

## Rejected: client-side shallow routing for the Calendar tabs (2026-08-31)

Proposed as UI audit item §A4: make the Calendar's Actual/System/Gap tabs
client-side (`useSearchParams` + shallow routing) so they stop performing a
full page navigation, while keeping the URL shareable.

**Rejected**, because it re-implements the exact defect this document exists
to record. `mode->system` and `mode->gap` are named in §1's table below: they
failed **1/10 each** before the transport workaround, and they are
same-pathname search-param-only navigations on `/en/app`, which is the one
shape that ever failed. `dashboard:range->30d` — the same transport, the same
route — failed up to **5/10**. After the workaround the stress gate committed
**300/300**.

It is also not a Calendar-local change. `DashboardStateLink` drives the mode
control, the month navigation, every populated day cell, and the whole sticky
toolbar. Converting one control leaves two transports on one page and gives
the reader a Calendar whose tabs are unreliable while its month arrows are
not.

**What was done instead.** The reported symptom was never speed — it was that
the viewport jumped to the top of the page on every tab press, roughly 900px
above the control just used. `DashboardScrollRestoration` carries the scroll
offset across the document navigation: `DashboardStateLink` records
`window.scrollY` at the click, the destination consumes it once on mount and
restores it. That addresses the symptom exactly and leaves the transport, and
its 300/300 evidence, untouched.

**Reopen only when** Next has been upgraded past `16.2.12` AND the isolated
reproduction in `next-dashboard-search-param-navigation-repro.md` no longer
reproduces AND the 20-flow stress gate passes on soft navigation. Until all
three hold, a change here is a regression with a measured failure rate, not a
refactor.

## Stabilization applied

Dashboard same-pathname, search-param-only state controls now use native
document navigation. Canonical Dashboard and Calendar serializers still own
the destination URLs; the workaround changes transport only. Cross-path links
continue to use the locale-aware Next navigation wrapper.

`DashboardStateLink` documents this temporary boundary and restores the locale
prefix before rendering an ordinary `<a href>`. Overlay Escape/close-button
dismissals use the equivalent `window.location.assign` path because their
semantics are buttons, not links.

The retry-click helper was removed from `e2e/dashboard-calendar.spec.ts`.
Both that suite and the opt-in 20-flow gate now perform one gesture per
transition and assert the resulting URL without clicking again.

Final verification on 2026-08-28:

- stress gate: **20/20 full flows**, **300/300 transitions committed**;
- D6B routing suite: **3/3 consecutive clean runs**, each with five applicable
  tests passing across desktop/mobile projects;
- broader Dashboard E2E: desktop and mobile clean;
- app-shell/theme smoke: **196 passed**, one intentional mobile-hover skip;
- full unit suite: **2,516 passed**; D6A PostgreSQL integration: **7 passed**;
- lint, typecheck, format check, production build and `git diff --check`: clean.

The isolated upstream reproduction instructions live in
`docs/reviews/next-dashboard-search-param-navigation-repro.md`.

## 1. Reproduction rate before any change

| Transition                       | Kind                           | Failed                 |
| -------------------------------- | ------------------------------ | ---------------------- |
| `dashboard:range->30d`           | `/en/app`, search-param        | **3/10, 5/10**         |
| `after-reload:trade->open`       | `/en/app`, search-param        | **4/8, 7/8, 4/6, 3/5** |
| `after-reload:escape->close-day` | `/en/app`, search-param        | **3/5**                |
| `mode->system` / `mode->gap`     | `/en/app`, search-param        | 1/10 each              |
| `dashboard:->analytics`          | `/en/app` → pathname change    | **0/10** (≤158ms)      |
| `trades:view->calendar`          | `/en/app/trades`, search-param | **0/10** (≤690ms)      |
| `accounts:->new`                 | `/en/app/accounts`, pathname   | **0/10** (≤580ms)      |

A first 20-iteration run that did **no** history traversal and **no** reload
committed **160/160** transitions. Adding `goBack`/`goForward`/`reload` to the
loop dropped it to 85/92, then 76/89, then 60/68.

## 2. Transitions affected

Every failing transition is a **same-pathname, search-param-only client
navigation on `/en/app`**. Nothing else failed, in any run, ever:

- `goBack`/`goForward` — 0 failures in 40+ (they complete in ≤123ms).
- Pathname navigations from the same page — 0/10.
- Search-param navigations on another route — 0/10.

`day->close` shows failures only in iterations where the preceding
`after-reload:trade->open` had already stalled — a consequence of the wedged
state, not an independent case.

## 3. Evidence from a failed navigation

Two signatures, both with **zero console errors, zero page errors, and nothing
left pending**:

```
step: after-reload:trade->open
from: /en/app?range=all&unit=r&month=2026-08&day=2026-08-10
href: /en/app?range=all&unit=r&month=2026-08&day=2026-08-10&trade=01a0…
rsc:  status 200, startedAt 1787851702429, finishedAt 1787851704081   ← body completed in 1652 ms
to:   /en/app?range=all&unit=r&month=2026-08&day=2026-08-10           ← unchanged after a further 10.4 s
dom:  { bodyPointerEvents: "none", openDialogs: 1, activeElement: <the trade link> }
pending: []
```

```
step: dashboard:range->30d
rsc:  status 200, finishedAt null, failure "net::ERR_ABORTED"
pending: []
```

So: the click lands (the anchor takes focus, so `next/link`'s handler ran and
prevented the default), the server answers 200, and the payload either
**arrives complete and is never committed** (category **B**) or is **aborted by
the client itself** (category **C**) — with no second navigation to supersede
it and nothing else in flight.

## 4. Root cause, as far as it was isolated

**The `/en/app` route's own search-param re-render intermittently fails to
commit, at roughly 20–50%.** The controlled matrix — one run, one session, one
proxy, one browser — separates the route from every other variable:

|                    | same-pathname search-param | pathname change |
| ------------------ | -------------------------- | --------------- |
| `/en/app`          | **5/10 failed**            | 0/10            |
| `/en/app/trades`   | 0/10                       | —               |
| `/en/app/accounts` | —                          | 0/10            |

**This predates D6B.** `dashboard:range->30d` is the D3-era range control: it
carries none of D6B's URL keys, involves no Calendar, no Day Review and no
Quick Preview, and it fails at the same rate. It is the same defect that was
seen during D4.5 and recorded then as "pre-existing"; raising that assertion's
timeout to 15s never fixed it, because the transition is not slow — it never
commits at all.

## 5. Why a direct GET always worked

A direct `GET` of the exact destination URL returned **200 in ~1.6–1.8s on
every one of four measurements**, and the equivalent full page load renders
correctly every time. A direct GET is a document navigation: the browser
discards the current document and the server renders the route from scratch.
It never touches the client router's reconciliation of a same-route
search-param change, which is the step that fails. That is also why the server,
the queries, the Suspense boundaries and the components are all exonerated —
they demonstrably produce a correct tree on demand.

## 6. Fix

**None. I could not identify the mechanism, and I will not ship a speculative
change.** Every hypothesis was tested by changing one variable and re-measuring
the same control:

| Hypothesis                        | Change tested                                              | Before | After                         | Verdict       |
| --------------------------------- | ---------------------------------------------------------- | ------ | ----------------------------- | ------------- |
| Streaming Suspense boundary       | removed the outer `<Suspense>`                             | 3/10   | 2/10                          | **falsified** |
| Prefetch storm (§7)               | `prefetch={false}` on all ~35 same-pathname Calendar links | 3/10   | 2/10                          | **falsified** |
| Recharts/`ResponsiveContainer`    | removed the Execution Gap chart subtree                    | 5/10   | 3/10                          | **falsified** |
| `<Link>` vs `router.push`         | Escape (router.push) vs click (Link)                       | —      | both fail (3/5 vs 3/5)        | **falsified** |
| Portal / dialog interference      | main-tree mode links                                       | —      | also fail (1/10)              | **falsified** |
| Locale proxy / next-intl          | other routes through same proxy                            | —      | 0/10                          | **falsified** |
| Search-param navigation generally | `/en/app/trades?view=`                                     | —      | 0/10                          | **falsified** |
| Server hang / query load          | direct GET, pending-request capture                        | —      | 200 in ~1.7s, nothing pending | **falsified** |

All three experimental changes were **reverted**; none of them are in the tree.

Recommended next step, which is outside a presentation phase's remit: reproduce
against a minimal Next.js 16.2.12 repro (one dynamic route, searchParams, no
Radix, no Recharts) and take it upstream. The narrowing above should make that
cheap.

## 7. URL parser / serializer audit

Audited `serializeCalendarState`, `buildCalendarHref`,
`serializeDashboardFilterState` and the four transition helpers.

- **Filters preserved exactly once.** The filter half of every calendar href is
  produced by `serializeDashboardFilterState`, so no key can be written twice
  or dropped. No duplicate params are emitted.
- **Ordering is deterministic**: `range`, `unit`, `account`, `strategy`,
  `setup`, `version`, `mode`, `month`, `day`, `trade` — a fixed sequence, so no
  ordering churn between renders.
- **Round-trips.** `parseCalendarNavigation(serializeCalendarState(x)) === x`,
  covered by an existing test; defaults are omitted rather than written.
- **Parent-state changes clear children correctly**: `selectModeNavigation`
  clears day and trade; `clearDayNavigation` clears trade; `selectDayNavigation`
  clears trade.
- **One benign no-op**: the _currently active_ mode's link resolves to the
  current URL. Clicking the active mode therefore does nothing, which is
  correct behaviour for a selected control. It is not on any failing path.
- **No navigation loops**: no builder produces a URL that would re-trigger a
  different navigation on arrival.

No serialization defect was found, and none of the failures correlate with URL
content — the same href succeeds and fails across iterations.

## 8. Link / router audit

- Each overlay reaches the router two ways: a `<Link>` (the visible "Back to…"
  control) and `onOpenChange(false) → router.push` (the X button and Escape).
  They are alternative user gestures, never both fired for one interaction, and
  **both were measured failing at the same rate** — so the duplication is not
  the cause, though it is worth knowing it exists.
- No nested interactive elements: each Trade row is a single `<Link>` wrapping
  non-interactive content.
- No `preventDefault`/`stopPropagation` of our own anywhere in the D6B tree.
- No state change replaces the URL after a push.
- Prefetch: the Dashboard does render ~35 same-pathname `<Link>`s (31 day
  cells, 3 modes, month nav, rows). That is a lot, and it was the most
  plausible §7 candidate — but disabling it changed nothing (3/10 → 2/10), so
  per §7's "prove before/after" requirement the change was **not kept**.

## 9. Suspense / server audit

- The Dashboard is the only one of the three app pages that uses `<Suspense>`
  (accounts and trades have none, and both are clean) — which made streaming
  the leading hypothesis. Removing the outer boundary did not help.
- No promise is created without being awaited; `DashboardCalendarSection`
  awaits its month first, then `Promise.all`s the two conditional reads.
- `searchParams` are read once, at the route, and passed down as plain props —
  no component reads them inconsistently.
- Direct GET and client navigation resolve the same tree: verified by GETting
  the exact stalled URL and receiving a correct 200 render.

## 10. Prefetch finding

Measured, not assumed: disabling prefetch on every same-pathname Calendar
control moved the failure rate from 3/10 to 2/10 — inside the noise band of a
signal that ranges 2–5/10 untouched. **Not proven, so not kept**, and prefetch
was never disabled globally.

## 11. Query-count confirmation

Unchanged from D6B, and no duplicate server execution occurs during a single
navigation (each stalled transition issued exactly one RSC request):

| Surface                                 | Reads |
| --------------------------------------- | ----- |
| Dashboard core                          | 5     |
| Calendar month                          | 1     |
| Day Review rows (month already in hand) | 1     |
| Quick Preview                           | 1     |

## 12. What this means for D6B

The Calendar, Day Review and Quick Preview behave correctly. In the clean
20-iteration loop — mode changes, month paging, day selection, Trade open,
Trade close, day close, Back, Forward — **160 of 160 transitions committed**.
The defect is a pre-existing property of the Dashboard route that D6B's suite
surfaces because it performs far more navigations per run than any suite before
it.
