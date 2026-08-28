# Dashboard D9 — Consolidation Review

A read-and-measure review of the finished Dashboard as one product surface.
Not a feature phase: no new KPI, analytic, chart, widget, filter, preset or
layout mechanism was added, no D1–D8 calculation or selection was touched, and
no migration was written. Exactly one code change was made, and it is copy.

**Verdict: the page holds together.** Order, rhythm and surface treatment are
consistent, nothing overflows at any width from 1920 down to 320, and the
empty state is complete in every band. One real defect was found and fixed;
three further findings are recorded and deliberately left alone.

## How this was judged

`dashboard-d9-consolidation-uat/` holds a committed `capture.ts`, ten
full-page screenshots with matching first-screen crops, and a `metrics.json`
of DOM geometry read from the shipping page on a real production build.

The harness locates the page's top-level bands structurally — the direct
children of the container `RealDashboard` returns — rather than from a list of
selectors, and records each band's height, its distance from the one above,
how much of it is visible at scroll 0, and its own horizontal overflow. It
also runs a computed colour census over every painted element, so §12 is
answered from what the browser actually painted rather than from a class-name
grep.

One Account is shaped so **every band has real content at once** (28 closed
Trades, two Setups, tagged Emotions, canonical confidence levels, followed and
violated rule checks, mistakes, two unclassified Trades); a second Account has
no Trades at all.

## 1. Preflight

|                       |                                                            |
| --------------------- | ---------------------------------------------------------- |
| Branch                | `feature/claude-ui-redesign`                               |
| HEAD at start         | `4c41aac feat(dashboard): add the compact insight pillars` |
| Working tree at start | clean                                                      |
| Migrations            | 17, unchanged                                              |

No reset, stash, revert, checkout, amend, pull or merge.

## 2. Current order, judged whole

Read from the rendered DOM, not from the source:

```
account context → Basic KPIs → Needs Attention
  → System | Trader → Execution Gap
  → Strategy · Psychology · Discipline
  → Recent Trades | Calendar
  → Risk Performance → View full analytics
```

This is the product thesis in order, and it survives the whole-page reading
that each individual phase approval could not give it. "How am I performing?"
is answered by the KPI band before anything interprets it. "Does my System
have edge / how did I execute?" are two equal cards side by side, which is the
one place on the page where visual equality is the argument. "What is the
Execution Gap?" follows the pair it subtracts. "Where should I look?" is the
three pillars. "Which Trades and days?" is the record list and the Calendar.
Risk closes as account-level context.

Nothing needed to move.

## 3. First screen

Measured at scroll 0, as a percentage of each band actually visible:

| Viewport  | Above the fold                                                                       |
| --------- | ------------------------------------------------------------------------------------ |
| 1920×1080 | account bar · KPI band · Needs Attention · **System/Trader 100%** · Execution Gap 3% |
| 1440×900  | account bar · KPI band · Needs Attention · System/Trader 72%                         |
| 1280×800  | account bar · KPI band · Needs Attention · System/Trader 40%                         |
| 768×1024  | account bar · KPI band · Needs Attention · System/Trader 28%                         |
| 390×844   | account bar · KPI band · Needs Attention 3%                                          |

The priority order is right: current performance first, then System vs Trader,
and nothing from D8, D6 or D7 ever competes for the first screen — the three
pillars begin at 1856px, the Trade list at 2338px and Risk at 3032px, so none
of them can be mistaken for the primary thesis.

**The Execution Gap does not reach the first screen at any desktop height**
(3% at 1080px tall, nothing at 900px). It starts at 1059px, and the chrome
above it — a 169px app header and page title, then the account bar, the KPI
band, Needs Attention and a 476px card pair — accounts for all of it. Bringing
it up would mean deleting or restructuring a band, which is exactly the
manufactured work §16 warns against. Recorded as the strongest candidate for a
follow-up phase, not fixed here. See §16 below.

## 4. Page height

| Viewport   | Document | Needs Attn | System/Trader | Execution Gap | Pillars | Recent+Calendar | Risk |
| ---------- | -------: | ---------: | ------------: | ------------: | ------: | --------------: | ---: |
| 1920       |     3756 |         96 |           476 |           769 |     450 |             662 |  632 |
| 1440       |     3756 |         96 |           476 |           769 |     450 |             662 |  632 |
| 1280       |     3828 |        152 |           476 |           786 |     450 |             662 |  632 |
| 768        |     5547 |        155 |           920 |           828 |     893 |            1172 |  752 |
| 390        |     6928 |        242 |          1098 |           860 |    1295 |            1428 |  930 |
| 320        |     7465 |        327 |          1120 |           967 |    1441 |            1447 | 1034 |
| 1440 empty |     2293 |         96 |           352 |           271 |     218 |             329 |  357 |
| 390 empty  |     4477 |        242 |           705 |           478 |     642 |             680 |  655 |

Four desktop screens and about eight mobile screens. Density was not reduced
to hit a number, and no section was hidden on mobile to shorten it.

**The Execution Gap is the tallest band on the page** at 769px — more than the
two baseline cards it subtracts (476px) and more than the Trade list and
Calendar together in their column (662px). That is defensible rather than
accidental: it is the thesis climax and it carries two charts. It is also the
direct cause of the first-screen finding above, and the two should be settled
together, not separately.

**One real dead-space area: Recent Trades carries 190px of empty card**
(662px tall, content ends at 473px — 29% of the card). It is a consequence of
D6B's `items-stretch`, which gives the section one bottom edge; the Calendar
beside it fills 641 of its 662px. D6B considered this and chose a shared
bottom edge over a ragged one. Left as is — see §16.

No repeated padding and no overly tall card anywhere else: the pillars trail
21px, both baseline cards 25px, the Calendar 21px.

## 5. Section rhythm

Measured between consecutive bands at every viewport:

```
20px  account bar   -> KPI band
24px  KPI band      -> Needs Attention
28px  Needs Attn    -> System / Trader
28px  System/Trader -> Execution Gap
28px  Execution Gap -> Insight pillars
32px  Insight pillars -> Recent Trades / Calendar
32px  Recent/Calendar -> Risk Performance
24px  Risk          -> View full analytics
```

This is deliberate and consistent, not the accident four separately-built
phases could easily have produced: the margin steps up with the weight of the
boundary it separates — 20/24 for context and summary, 28 between analytical
sections, 32 before and after the record list — and every viewport reproduces
the same ladder within a pixel. Nothing to change.

## 6. D8 prominence

The three pillars read as one band of supporting signals, not as three
mini-reports. Each is 450px tall against the Execution Gap's 769px; all three
share one bottom edge and one Analytics baseline at every desktop width; every
card title is 16px/600, the same as every other panel on the page, so no
pillar is louder than the Execution Gap's own header. Each carries one hero
figure, at most two labelled comparisons and one line of sample context — no
chart, sparkline, gauge or ranking table. They scan in a few seconds and they
are clearly downstream of the Gap. No hierarchy reduction needed, and D8A's
insight selection was not touched.

## 7. Recent Trades and Calendar

Still discoverable after D8, and still the Detect → Investigate bridge: it is
the widest content band on the page after the Gap (662px), it is the only
section with a 7/12 + 5/12 asymmetry, and both its cards carry a named exit —
"View all Trades" and the Calendar's own day cells. Adding three pillars above
it did not bury it; the pillars are visually lighter and shorter, so the eye
arrives at the Trade rows as the first place on the page where individual
records appear. Row density and Calendar readability are unchanged, and no
Calendar or date semantics were touched.

## 8. Risk placement

**Keep it where it is.** Risk answers the money question the rest of the page
cannot: every band above it is expressed in R over the selected range, and
this is the one place that says where the modeled balance actually stands.
Reading that before the attribution story would invite the balance to be taken
as the verdict. Its position also matches the registry orders the layout
metadata has recorded since D2 (`account.balance` 120, `risk.drawdown` 130).
The screenshots show no hierarchy improvement from moving it, so it was not
moved.

## 9. Redundancy

| Repeated                                  |                                                     Times | Classification                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------- |
| Account name ("Dashboard — Populated")    | 4 (shell chip, account bar, D4 heading, Risk description) | acceptable repetition — each states the scope of what follows it                                                  |
| "Avg Execution Gap"                       |                              4 (Gap band + three pillars) | necessary context — the pillars are read against it                                                               |
| "Actual R" / "System R"                   |                                                     6 / 5 | necessary context — the Trade rows label every column                                                             |
| "Trades", "Profit Factor", "Max Drawdown" |                                                 4 / 3 / 3 | necessary — System and Trader deliberately mirror each other                                                      |
| "View Analytics"                          |                                                         3 | acceptable — each is uniquely named for screen readers                                                            |
| Account mode · base currency              |            2 (shell chip and account bar) at desktop only | acceptable — at 390 the shell chip collapses to an icon and the bar is the only place the active Account is named |
| "No closed Trades yet"                    |             2 on an empty Account (Strategy pillar, Risk) | acceptable — each explains itself differently underneath                                                          |

No visual noise found that was worth removing. The account context bar is the
closest call: it duplicates three of its four facts within 100px of the shell
chip on desktop. It is kept because on mobile the chip collapses and this bar
becomes the only statement of which Account the page is about — removing it
would trade a desktop tidy-up for a mobile ambiguity.

## 10. Surface consistency

Read from computed style on all ten panels:

- radius `12px` — identical on all ten
- border `1px solid` the same token — identical on all ten
- background — identical on all ten
- padding `20px` on eight; `24px` on System and Trader alone, which is the
  deliberate weighting of the page's two hero cards
- every panel title `16px / 600`, `h2` for a section-owning panel and `h3`
  for a panel inside a titled section

D3–D8 were built in separate phases and now read as one design system. No
change made, and the Shell and theme were not touched.

## 11. Colour

Computed over every painted element, populated Account at 1440:

| Case             | Red text | Green text | Blue text | Coloured backgrounds |
| ---------------- | -------: | ---------: | --------: | -------------------: |
| Dark, populated  |       22 |         23 |         6 |                    5 |
| Light, populated |       22 |         23 |       132 |                    6 |
| Dark, empty      |        0 |          0 |         6 |                    2 |

Restrained. Signed colour appears only on signed figures — Trade rows,
Calendar day cells, R values — and blue resolves to the product accent
(`rgb(37,99,235)` dark, `rgb(29,78,216)` light) exactly six times, on links
and the neutral header icon chips. No pillar colour was introduced, no chart
uses green for a balance, and the empty Account paints zero red and zero
green. A raw hue count reports 132 "blue" elements in light mode; every one is
`rgb(85,101,127)`, the blue-tinted neutral `--muted-foreground`, so that is a
measurement artifact of hue bucketing rather than blue decoration.

## 12. Desktop, mobile, light and dark

**Zero horizontal overflow at 1920, 1440, 1280, 768, 390 and 320**, populated
and empty, both themes — `scrollWidth === clientWidth` in all ten cases.

Mobile stacks in the same order it reads in on desktop, with no repetitive
card rhythm: the KPI band goes two-up, the pillars go one-up, the Trade list
and Calendar stack, and both charts stay legible. Nothing is hidden to shorten
the page.

Light mode is complete and identical in structure; all three charts paint,
with the balance line in the product blue and the Actual comparison line in
the light foreground. No token change was needed.

## 13. The one change made

**Needs Attention did not say that it counts a different population from the
rest of the page.**

`getWorkspaceTradeAttentionCounts` counts every Trade in the workspace with no
Account filter and no date filter, while the KPI band, both baselines, the
Execution Gap, the three pillars, the Trade list, the Calendar and Risk are
all scoped to one Account and one range. On the consolidated page that
produces two readings a trader cannot reconcile, both captured from the
shipping build:

|                         | Net P&L card         | Needs Attention                         |
| ----------------------- | -------------------- | --------------------------------------- |
| Empty Account, All time | "No Trades yet"      | Unclassified 2 · **Reviews Pending 28** |
| Populated Account, 30D  | "+… · **14 Trades**" | Unclassified 2 · **Reviews Pending 28** |

The counts are correct — D2 scoped them to the workspace on purpose. The
silence about which population they came from was the defect, and the page
already has a convention for exactly this: the section below it opens "Active
account: … Each side uses its own eligible Trade population."

Fixed in copy only, EN and TH:

> _before_ — "A few things worth a look — not a task list."
> _after_ — "Every Account in this workspace, whatever date range is selected — worth a look, not a task list."

No query, scope, count, threshold or component logic changed. A regression
test in `real-dashboard.test.tsx` asserts the panel states both scope facts.
Cost: 0px at 1920/1440, +56px at 1280, +19px at 390, +38px at 320 — and the
panel renders only when there is something to show.

## 14. Findings deliberately not implemented

| Finding                                                           | Class         | Why not                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution Gap never reaches the first screen                      | A, structural | The only fixes are deleting a band or restructuring the top of the page. Both are redesigns, and §15/§16 forbid manufacturing them inside a review. Best candidate for the next phase.                         |
| Recent Trades carries 190px of trailing dead space                | B             | D6B weighed this and chose one bottom edge over a ragged one. `items-start` would trade a known compromise for a worse one, and spreading five rows over 662px is worse still.                                 |
| Account context bar duplicates the shell chip on desktop          | B             | It is the only place the active Account is named at 390, where the chip collapses to an icon.                                                                                                                  |
| A `?account=` URL filter does not update the shell's account chip | C             | Reachable only by hand-editing a URL; the product's own switcher writes the preference and refreshes. A D1 filter-contract question, not a D9 hierarchy one. Surfaced by the harness, then designed out of it. |

## 15. Tests and gates

|                                                                  |                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Prettier `format:check`                                          | clean                                                             |
| ESLint                                                           | clean                                                             |
| `tsc --noEmit`                                                   | clean                                                             |
| Unit                                                             | **2659 passed / 183 files** (2658 before, +1 new regression test) |
| Production build                                                 | clean                                                             |
| `scan:client`                                                    | 66 assets, no server secrets                                      |
| `git diff --check`                                               | clean                                                             |
| `drizzle-kit check`                                              | "Everything's fine", **17 migrations, no migration written**      |
| E2E — dashboard, dashboard-calendar, theme, app-shell, analytics | **202 passed, 17 skipped, 0 failed**                              |

The E2E skips are the per-project guards that hold desktop-only cases out of
the mobile project and vice versa.

Three intermediate E2E runs reported failures — an app-shell menu navigation,
two theme-contrast cases, an analytics case, and two Calendar geometry cases.
All were the same cause and none was a regression: a web server left running
on port 3100 from an earlier run was reused after I rebuilt, so pages were
served referencing stylesheet hashes the running server no longer had, and the
failure screenshot shows completely unstyled content. Every one of those tests
passes in isolation, and all five suites pass together once the stale server
is killed. The number above is from that clean run.

## 16. Recommendation for the next phase

One question is worth a phase, and it is the one this review could not answer
from inside its own remit:

**Should the Execution Gap reach the first screen, and what pays for it?**
The band is 769px, the tallest on the page, and 1059px of content sits above
it. The candidates are a compact Gap summary strip promoted beside or above
the two baseline cards with the two charts staying where they are; a shorter
first chart; or reclaiming the ~100px the account context bar spends on
desktop. Each is a genuine design decision with a measurable before and after,
and each needs the whole-page screenshots this review has now committed as its
baseline.

The Recent Trades dead space belongs in the same phase, since both are
questions about how much vertical budget a band deserves.

## 17. Files

| File                                                | Change                                                     |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `messages/en.json`, `messages/th.json`              | `dashboard.real.needsAttention.description` — scope stated |
| `src/components/dashboard/real-dashboard.test.tsx`  | new regression test for that scope statement               |
| `docs/reviews/dashboard-d9-consolidation-review.md` | this review                                                |
| `docs/reviews/dashboard-d9-consolidation-uat/`      | `capture.ts`, `metrics.json`, 20 screenshots               |

No product component, service, DAL, query, schema or migration changed.

**Not pushed.**
