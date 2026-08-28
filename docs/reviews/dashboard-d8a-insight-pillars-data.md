# Dashboard D8A Compact Insight Pillars Data Contract

Verified 2026-08-28. D8A adds one server-driven Insight boundary and a pure,
localization-ready DTO. It does not render the three reserved widgets or build
full Analytics views.

## Product semantics

Dashboard insights detect high-level patterns; Analytics remains the place to
diagnose them. D8 composes exactly three pillars: Strategy (including Setup),
Psychology (Emotion and Confidence), and Discipline (Rule Adherence, Rule
Checks, violations, and mistakes). Every relationship is descriptive and
observational. The contract never says that an Emotion, confidence level,
mistake, or checklist outcome caused performance.

Unsupported concepts are explicit: Discipline Score, mistake/emotion cost
attribution, Fear Exit Cost, and Early Exit Cost. The current `early_exit`
mistake tag can define an overlapping observed cohort, but it cannot prove why
the Trade exited or assign causal lost R.

## Selection policy

D8 uses a deliberately simple Dashboard heuristic, not inferential statistics:

- fewer than 5 observations: `insufficient_sample`, never ranked;
- 5–19 observations: eligible only with `limited_sample` disclosure;
- 20 or more: `supported` descriptive sample;
- Psychology requires at least 50% unique-Trade tagging coverage for the
  corresponding dimension before selecting its cohorts;
- an expectancy/baseline or average Execution Gap difference must be at least
  `0.2500R` in absolute value to be material.

Five prevents one-Trade anecdotes from defeating established cohorts. Twenty
keeps a compact Dashboard claim explicitly limited until it has more than a
handful of observations. Fifty-percent coverage requires the recorded
dimension to represent a majority of the scoped eligible Trades. Quarter-R is
a conservative trading-domain display unit; none of these thresholds claims
statistical significance.

## Strategy and Setup

Unfiltered Strategy Performance ranks stable Strategy identities by independent
System expectancy, requiring the sample floor. Actual expectancy, Total R,
Profit Factor, and paired Execution Gap remain supporting context. A material
paired System/Actual divergence has priority over a winner label.

With a Strategy filter, the selected Strategy's health is primary and its
Setups become the breakdown. With a Setup filter, that Setup is the health
subject. There is no separate Setup pillar. Historical labels come from pinned
Strategy/Setup Version snapshots; the DTO uses the latest observed pinned
label for the stable identity and states that label source explicitly.

## Psychology

Confidence is the existing ordinal set `0/25/50/75/100`; D8 does not invent
High/Medium/Low bands. `NULL` means unrecorded while `0` is a real value.
Emotion is multi-select and supports system and workspace taxonomies. One
Trade can belong to multiple Emotion cohorts, so group counts may exceed the
unique tagged count and are explicitly non-additive.

Emotion and Confidence cohorts use Actual R and the paired Execution Gap,
compared descriptively with scoped Actual expectancy. Missing tags are not a
neutral state. Low coverage produces a structured warning before any cohort
claim.

## Discipline

The existing frozen primitives remain distinct:

- Rule Checks Followed = `followed / (followed + violated)` at check level;
- Rule Adherence = compliant fully evaluated Trades / evaluated Trades.

Only required snapshotted checks classify a Trade. Required `not_checked`
makes it incomplete; all required `not_applicable` is resolved but unevaluated;
optional checks remain informational. Compliant/non-compliant Actual expectancy
and Execution Gap are descriptive cohorts.

Violation and mistake groups may expose `associatedExecutionGapR`, but the DTO
marks them observational and non-additive. A Trade may have multiple labels,
so this is never loss attribution or cost accounting.

## Query and filter architecture

One D8 service resolves the canonical authenticated Dashboard scope once, then
runs five bounded bulk projections in parallel:

1. Actual-eligible parent Trades and their optional paired System fields;
2. independently System-eligible parent Trades;
3. Emotion links for the Actual population;
4. snapshotted Rule checks for the Actual population;
5. Mistake links for the Actual population.

The independent Actual/System date axes remain frozen. Separate many-to-many
rowsets avoid multiplying Trade samples in a giant join. There is no query per
Strategy, Setup, Emotion, Rule, Mistake, or Trade; no client fetch; and no full
14-projection Analytics snapshot. Dashboard core remains 5 reads and D7 Risk
remains 1.

Account, 30D/90D/All, Strategy, Setup, and internal Strategy Version filters
apply to all three D8 pillars. Strategy/Setup filters intentionally narrow
Psychology and Discipline to behavior within that system. D7 Risk remains
account-level and is unchanged.

## Visual fixture findings

The canonical read-only fixture returned these projection rows for Visual —
Populated: 66 Actual Trades, 68 System Trades, 74 Emotion links, 132 Rule
checks, and 7 Mistake links. Visual — Empty returned zero rows in all five.

For Populated All:

- Strategy: Elliott Wave was the only supported Strategy; System expectancy
  `+0.5280R`, Actual expectancy `+0.3500R`, paired average Gap `-0.2156R`.
  Wave 2 Reversal was the strongest supported Setup by System expectancy
  (`+0.7217R`) but showed paired average Gap `-0.6886R`.
- Psychology: Emotion coverage was `58/66` (`87.88%`) and Confidence coverage
  `66/66`. Calm-tagged Trades averaged `-0.1281R` versus the scoped `+0.3500R`
  baseline, an observational `-0.4781R` difference over 16 Trades. Confidence
  level 25 was the secondary observed underperformance cohort.
- Discipline: 58 Trades evaluated, 45 compliant, 13 non-compliant, and 8
  incomplete. Rule Checks Followed was `87.72%`; trade-level Rule Adherence was
  `77.59%`. Compliant expectancy exceeded non-compliant expectancy by an
  observed `0.3679R`, without a causal claim.

The 30D population is intentionally limited (17 Actual Trades). It reports
limited samples rather than silently promoting them to supported findings.
Visual — Empty produces three `no_eligible_trades` pillar states, never fake
winners or errors.

The fixture's 10 partial-close Trades have 24 Exit legs but remain 10 parent
Trade samples inside the 66 Actual Trade population.

## Registry

No suitable existing IDs represented the three pillars. D8A reserves only:
`strategy.performance`, `psychology.performance`, and
`discipline.performance`. Their `implementation` stays `later`. Sub-metrics do
not receive widget IDs. A provisional holding section satisfies the registry's
one-layout-record invariant without implementing D8B's final responsive layout.
