# Dashboard D8B Compact Performance Insight Pillars

Presentation and server-boundary wiring for the three reserved D8 widgets. No
D8A insight selection, sample threshold, coverage threshold, materiality
threshold, cohort calculation, analytics formula or causality semantic
changed; no migration; no schema change.

## What D8B is

D8A produced a domain contract and one server boundary that nothing rendered.
D8B renders it as three compact cards and does nothing else. Dashboard
detects; Analytics diagnoses.

Each pillar shows **one primary insight, at most one supporting insight, and a
line of sample or coverage context** — never the whole payload D8A supplies.
There is no chart, sparkline, donut, gauge, radar, matrix, ranking table or
breakdown list in the section, and a component test asserts their absence
rather than trusting review.

## Placement

Measured from the rendered DOM (`metrics.json`), the page reads:

```
needs-attention → system → trader → execution-gap
  → insight-strategy → insight-psychology → insight-discipline
  → recent-trades → calendar → risk-performance
```

The pillars sit between the Execution Gap they help explain and the record
list that follows. The Gap says how much edge the execution captured; the
pillars ask where that came from. Registry orders 92/94/96 slot into the gap
the original decade numbering left, so **no D3–D7 order moved** (`execution.gap`
90, `trades.recent` 100, `account.balance` 120 are all unchanged).

## Architecture

```
server  getDashboardInsightData (D8A, unchanged)  1 service · 5 parallel reads
        composeInsightPillarsView                 pure, tested, formats ONCE
React   InsightPillarsDataSection                 async server, streamed
        InsightPillarsSection                     the three-column row
        InsightPillarCard                         one pillar
```

`src/lib/dashboard/insight-presentation.ts` is the only place a D8A figure
becomes text. It re-ranks nothing, re-thresholds nothing, and computes no
expectancy, rate, difference or gap of its own — the sample bands come from
D8A's own published `policy` object rather than a second copy of 5 and 20. It
also deliberately drops most of the payload.

**Copy is chosen by the insight's `type`, never by its value.** That is what
makes §7 structural rather than a convention: with a Strategy filtered, D8A
answers `selected_strategy_health`, and the card has no path to a "best
Strategy" phrasing.

## The three cards

Hierarchy, top to bottom: pillar title → insight statement → subject → **named**
hero figure → up to two labelled comparisons → sample/coverage → Analytics.

| Pillar     | Hero (labelled)                                                                                       | Supporting                                          |
| ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Strategy   | the figure D8A's `basis` selected — System expectancy, Actual expectancy, or paired Avg Execution Gap | the other two, never a repeat of the hero           |
| Psychology | the cohort's own average Actual R                                                                     | scoped baseline, Avg Execution Gap                  |
| Discipline | Trade Rule Adherence, or the associated Gap / adherence difference                                    | Rule Checks Followed, or compliant vs non-compliant |

The hero is **named** because the first capture pass proved an unlabelled one
unreadable: Discipline showed a bare `63.64%` directly above `Rule Checks
Followed 63.64%`, and with one required check per Trade the two rates coincide
numerically. They are different numbers over different denominators, so both
now carry their full name and neither can be read under the other's.

## Language

Descriptive throughout. A cohort's own average sits beside the baseline it is
read against — never a total "cost", never "caused", never "because of", never
"lost". Emotion cohorts carry an explicit sentence that Trades can hold more
than one tag, so nothing on the card can be read as shares of a whole.
Confidence keeps its canonical `0/25/50/75/100`, never a High/Medium/Low band,
and `null` stays distinct from a recorded `0`. Discipline Score, Trader Grade,
and every cost-attribution concept are absent, and a test greps for them.

## Sample and coverage

- fewer than 5 — `insufficient_sample`, nothing ranked, and the card states
  the real policy threshold rather than inventing one.
- 5–19 — one quiet line, `Limited sample · 9 Trades`. Not an error, not a
  warning box, and the observation still reaches the reader.
- 20+ — `Observed over 24 Trades`. No significance or confidence claim anywhere.

Coverage appears only where it changes how the card should be read: while it
is the reason there is no insight, or while a real gap remains between what
was recorded and what was eligible. A fully covered pillar prints nothing
rather than a reassuring 100%. Missing tags are never called calm or neutral.

## States

Every typed D8A reason has its own words; nothing collapses to "No data".
`no_eligible_trades`, `sample_below_policy`, `strategy_attribution_missing`,
`psychology_not_recorded` and `required_checks_not_evaluated` each get a
distinct title and description, and an integrity or service failure is
announced with `role="alert"` and never dressed as an empty state.

## Analytics affordance

No route is invented. Each pillar links through the **existing**
`buildAnalyticsViewHref` contract to the view that actually holds its
material — Strategy → `edge`, Psychology → `behavior`, Discipline → `results` —
carrying the Dashboard's own scope so the destination shows the same
population. Links are named per pillar, not five identical "View Analytics".

## Layout

One three-column section at `xl`, 2 + 1 at `md` (the third card spans the row
rather than dangling), one column below that. Deliberately not three columns
from `md`: 768px divided three ways leaves ~230px per card, where "Trade Rule
Adherence" stops being readable.

## Server boundary

Unchanged from D8A and re-verified: Dashboard core **5**, D7 Risk **1**, D8
Insights **5**. One service call feeds all three cards — no read per pillar,
no client fetch, no N+1 — streamed on its own Suspense boundary.

## Query and timing observation

Measured against the seeded 24-Trade Account on the remote test database:

| Projection                         |              Serial |   Rows |
| ---------------------------------- | ------------------: | -----: |
| actual_trades                      |              85.1ms |     24 |
| system_trades                      |              80.7ms |     24 |
| emotions                           |              78.0ms |     16 |
| rule_checks                        |              78.6ms |     24 |
| mistakes                           |              78.7ms |      8 |
| **serial sum**                     |         **401.1ms** | **96** |
| **parallel, as the DAL runs them** | **88.1ms / 84.8ms** |     96 |

The five run under one `Promise.all`, so D8 costs roughly **one network round
trip (~85ms)**, not five — the serial sum is dominated by a ~78ms baseline
latency to Neon. Whole-document settle time was 820–1550ms warm and ~2.2s on
the first cold request, across every captured viewport. No regression; nothing
optimized prematurely, and the D8 reads were not folded into Analytics.

## Fixture verification

`validate:visual-dashboard-d8` against the canonical fixture confirms §31's
expectation for Populated All — Strategy `available`, Psychology
`limited_sample`, Discipline `available` — and the actual selected insights
were read from the DTO before any copy was judged:

| Range | Strategy                                                   | Psychology                                                 | Discipline                                                        |
| ----- | ---------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| All   | `strongest_observed_strategy` + `strongest_observed_setup` | `emotion_underperformance` + `confidence_underperformance` | `required_checks_incomplete` + `adherence_performance_difference` |
| 90D   | `system_actual_divergence` + `strongest_observed_setup`    | same                                                       | same                                                              |
| 30D   | `system_actual_divergence` (limited)                       | `confidence_outperformance`                                | `required_checks_incomplete` (limited)                            |
| Empty | `no_eligible_trades`                                       | `no_eligible_trades`                                       | `no_eligible_trades`                                              |

No fixture metric was altered.

## Registry

`strategy.performance`, `psychology.performance` and `discipline.performance`
are now `implementation: 'current'` in one three-column `insight-pillars`
section, 1 + 1 + 1. D8A's provisional `reserved` holding section is retired
with the last unbuilt widget. No sub-metric — Emotion, Confidence, checklist,
mistakes — receives a widget ID.

## Files changed

| File                                                                 | Change                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/lib/dashboard/insight-presentation.ts`                          | new — the pure view model                             |
| `src/lib/dashboard/insight-presentation.test.ts`                     | new — 21 tests                                        |
| `src/components/dashboard/insights/insight-pillars-data-section.tsx` | new — the server boundary                             |
| `src/components/dashboard/insights/insight-pillars-row.tsx`          | new — the three-column section                        |
| `src/components/dashboard/insights/insight-pillar-card.tsx`          | new — one pillar                                      |
| `src/components/dashboard/insights/insight-pillars.test.tsx`         | new — 18 component tests, EN + TH                     |
| `src/lib/dashboard/widgets.ts`                                       | three widgets `current`, new section, orders 92/94/96 |
| `src/lib/dashboard/widgets.test.ts`                                  | replaces the reserved-section assertions              |
| `src/components/dashboard/real-dashboard.tsx`                        | `insightSlot` between D5 and D6                       |
| `src/components/dashboard/real-dashboard.test.tsx`                   | slot stub                                             |
| `src/app/[locale]/(app)/app/(main)/page.tsx`                         | Suspense boundary + skeleton                          |
| `messages/en.json`, `messages/th.json`                               | `dashboard.insights`                                  |
| `e2e/dashboard.spec.ts`                                              | three D8 E2E cases with their own seed                |

No migration. `drizzle-kit check` clean, 17 migrations.

## UAT artifacts

`docs/reviews/dashboard-d8b-insight-uat/` — 12 cases with `metrics.json` and a
committed `capture.ts`, from the shipping section on a real production build.
Four Accounts in one workspace reach all six focused states by switching
Account, so no canonical fixture metric was touched.

| Case              | Strategy            | Psychology                              | Discipline                                             |
| ----------------- | ------------------- | --------------------------------------- | ------------------------------------------------------ |
| rich              | available           | limited_sample                          | available                                              |
| sparse (3 Trades) | insufficient_sample | insufficient_sample                     | limited_sample                                         |
| untagged          | available           | unevaluated · `psychology_not_recorded` | unevaluated                                            |
| empty             | no_eligible_trades  | no_eligible_trades                      | no_eligible_trades                                     |
| rich 30D          | limited_sample      | limited_sample                          | `issue_associated_execution_gap` −10.20R, non-additive |

Measured, not asserted:

| Viewport | Card widths     | Heights         | Page overflow |
| -------- | --------------- | --------------- | ------------: |
| 1920     | 587 / 587 / 587 | 450 / 450 / 450 |         **0** |
| 1440     | 427 / 427 / 427 | 450 / 450 / 450 |         **0** |
| 768      | 352 / 352 / 720 | 470 / 470 / 387 |         **0** |
| 390      | 358 / 358 / 358 | stacked         |         **0** |
| 320      | 288 / 288 / 288 | stacked         |         **0** |

- **Equal heights confirmed** at every desktop width, so the three Analytics
  links sit on one baseline.
- **2 + 1 confirmed at 768**, and one column at 390/320.
- **No horizontal overflow at any width**, 1920 down to 320.

### Two defects the captures found, both fixed

1. **The three cards did not share a bottom edge.** An extra wrapper div broke
   the `h-full` chain, so `items-stretch` stretched the grid item while the
   card inside kept its content height and the three "View Analytics" links
   landed on three different baselines.
2. **The hero figure was unlabelled.** Discipline rendered a bare `63.64%`
   above `Rule Checks Followed 63.64%` with nothing saying the hero was Trade
   Rule Adherence — the exact ambiguity the two rate definitions must never
   fall into. Every hero is now named, and the supporting row no longer
   repeats the hero.

### One observation, not changed

On an empty Account the Strategy pillar and D7's Risk section both open with
"No closed Trades yet" — each true, each explained differently underneath, and
that Strategy wording is what §25 specifies. The E2E names which section it
asserts rather than the copy being changed to dodge the collision.
