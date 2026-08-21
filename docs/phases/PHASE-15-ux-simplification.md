# Phase 15 — Product UX Simplification & Information Architecture

> **Status:** 15A (audit + contract) is complete and committed. 15B (UX design primitives,
> status semantics, and the deep-action navigation foundation) is implemented — see §46 below
> for the as-built decisions. Analytics Overview/Explore, the full Trade Detail step redesign,
> and Trade Log simplification are **not** implemented — 15C–15G remain proposed, not started.
> **Preceding state:** Phases 14A–14E (Independent Trade Classification, Trading Calendar +
> Trade Log, Open/Close-Only Trade Flow) are complete and committed; Founder acceptance of 14
> is recorded as not yet obtained but does not block this work.
> **Last updated:** 2026-08-21 (Phase 15B — design primitives, status semantics, deep-action
> navigation foundation).

---

## 1. Preflight

| Check                  | Result                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                 | `feature/trade-plan-ux-uat`                                                                                                                                                                                                                          |
| HEAD                   | `65e6ef0` — "feat(journal): simplify trade flow to open and close" (2026-08-21)                                                                                                                                                                      |
| Working tree           | Clean, up to date with `origin/feature/trade-plan-ux-uat`                                                                                                                                                                                            |
| Migration range        | `0000_init_auth_tenancy.sql` → `0016_optional_trade_plan.sql` (17 migrations, forward-only, none pending)                                                                                                                                            |
| Phase 14 status        | `docs/phases/PHASE-14-independent-classification.md`: 14A, 14B, 14C, 14C.1, 14D, 14E all recorded **complete**. Founder acceptance **not yet obtained** (not a blocker per this phase's brief — only an unfinished/uncommitted 14E would have been). |
| Phase 14E specifically | Confirmed complete and committed (§"14E — Open/Close-Only Trade Flow (complete)", `PHASE-14-independent-classification.md` line 138+). HEAD commit is exactly this work.                                                                             |

**Conclusion: clean baseline confirmed. Proceeding with Phase 15A.**

---

## 2. Current UX problem summary

Three surfaces were audited in detail (Analytics, Trade Detail, Trade Log/Calendar). All three
independently exhibit the same pattern: **the domain model is already well-segmented (discrete
sections, discrete DAL records, discrete calc outputs), but the presentation flattens every
segment into one continuous scroll with no hierarchy of attention.** This is a presentation
problem, not a data-model problem — every phase doc audited (13, 14) explicitly declines to
mandate a tabbed/stepped layout, so the flat stacking seen today is an implementation choice,
not a locked constraint. That is good news: 15B onward can restructure presentation without
touching `lib/calc/`, the DAL, or the schema.

Concretely:

- Analytics (`/app/analytics`) is one page, 7 stacked full-width sections, no tabs, no
  collapse, no sticky nav, one generic non-actionable link in the entire page.
- Trade Detail (embedded in `/app/trades?trade=`) is one continuous scroll of 9 stacked
  sections/cards, with nearly all mutation actions concentrated in one "Lifecycle Actions" card
  that sits physically far from the section each action affects.
- Trade Log (`/app/trades`) is a 6-column table showing every field for every row
  simultaneously, with no filters, sort, search, or grouping, and no per-row deep actions.

---

## 3. Analytics information-density audit

`src/app/[locale]/(app)/app/(main)/analytics/page.tsx` → `RealAnalyticsPage`
(`src/components/analytics/analytics-page.tsx`), single route, no sub-routes.

Order top-to-bottom, all in one scroll, `flex flex-col gap-8`, no tabs:

1. `AnalyticsFilters` — date preset + 4 dropdown selects, always fully expanded
2. Scope summary line
3. **System and Trader Performance** — 2-col grid, 8 metrics per card × 2 cards = 16 numbers before the user reaches anything else
4. **System vs Trader Comparison** — 6 more numbers (`AnalyticsComparisonPanel`)
5. **Independent Equity Curves** — 2 charts
6. **Setup Quality** — `SetupAdherencePanel` (avg adherence + 5 buckets × 2 axes) + `ConditionPerformance` (per-condition × 2 axes)
7. **Psychology** — `ConfidencePerformance` (5 levels × 2 axes) + `EmotionPerformance` (N emotions × 2 axes)
8. Unlabeled bottom grid — `RuleSummary` + `MistakeFrequency`

**Density finding:** by the time a user reaches the bottom of section 3 alone they have seen 16
individual metric values with no ranking of which one matters most. There is no "answer first" —
every value has equal visual weight. The only actionable link in the entire page is one generic
"Review pending" → `/app/trades` (no trade IDs, no filter). Sample-size disclosure exists
(`sampleCount` badges) but "insufficient data" framing described in Phase 13 §15 was never
implemented as literal UI copy — raw counts are shown instead, with no low-sample softening.

---

## 4. Trade Detail information-density audit

`src/components/trades/trade-detail.tsx`, single continuous scroll, 9 stacked sections:

`Header → Lifecycle Actions card → Overview → Classification → Plan → Entry Snapshot (4 sub-sections) → Execution → System → Discipline (3 sub-sections)`

**Density findings:**

- **Actions are separated from their subject.** Nearly every mutation (Open/Partial Close/Close/Correct, Resolve System/Mark No Trade/Correct, Edit Plan, Edit Identity, Delete) lives in one "Lifecycle Actions" card positioned right after the header — before the user has even seen the Execution or System sections those actions modify. A user must scroll back up to act. The only actions that _are_ positioned inline (Assign Strategy/Setup, Correct exit, Save emotions/review) are the exceptions, not the rule.
- **No section boundary is visually strong** — `Section` is a bordered card, but `SubSection` (used inside Entry Snapshot and Discipline) is just an `h4`, so those two areas internally read as one long block each (Entry Snapshot: Conditions/Confidence/Emotions/Entry Reason all run together; Discipline: Rules/Mistakes/Review all run together).
- **Execution Gap has no dedicated comparison view** — it is a single row buried inside the System section, easy to miss, despite being (per CLAUDE.md §6) one of the two most important attribution numbers in the product.
- **7 distinct concerns compete for the same scroll**: identity, plan, entry-time psychology, actual execution, system counterfactual, rule/mistake discipline, and free-text review — exactly the "too many conceptual sections in one scroll" problem named in this phase's brief.
- Missing-data treatment is already good and should be preserved as-is (see §46) — "Not recorded" vs "Not set" vs "Not configured" are already correctly distinguished; this is a layout problem, not a copy problem.

---

## 5. Trade Log information-density audit

`src/components/trades/trade-list.tsx`, 6-column table (Trade / Strategy / Account / Execution / Trader / System), every column always visible for every row.

**Density findings:**

- Every row shows: symbol, direction, date/time, strategy name + archived badge, setup name + version + archived badge, conditions-met fraction, account name + archived badge, execution status badge, trader R/outcome or realized-to-date or planned R, system status badge + R + outcome — **10+ discrete facts per row**, all at equal weight, with no summarized "first layer."
- No filters, sort, or search exist on the page itself (only the Calendar's day-select narrows the list). No grouping by date or status.
- No per-row deep action exists in the list (e.g., no inline "Update System Outcome" or "Add Strategy" button) — every action requires opening the row into Detail first, which then requires locating the right Lifecycle Actions button (see §4).
- Pagination is cursor-based and functional but "Previous" uses browser history (`router.back()`) rather than a true reverse cursor — a pre-existing minor inconsistency, not in scope to fix here.

---

## 6. Proposed global UX principles

Adopting the ten frozen principles from this phase's brief verbatim as the standing rules for
15B onward, each tied to what §3–5 found:

1. **Show the answer first** — directly answers Analytics' "16 equally-weighted numbers" problem.
2. **One thing at a time** — directly answers Trade Detail's 9-stacked-sections and Trade Log's 10-facts-per-row problems.
3. **Reveal detail only when requested** — Explore/Detail levels absorb what Overview currently front-loads.
4. **Missing data obvious, not punishing** — already mostly true (§4); extend the same restraint to Analytics' unimplemented "insufficient data" softening.
5. **Every actionable warning leads to the fix** — directly answers the "Review pending" link's lack of specificity (§3) and the Trade Log's lack of per-row deep actions (§5).
6. **Never make users read a report** — the core diagnosis.
7. **Preserve analytical depth without exposing all of it at once** — no metric currently rendered may be deleted (see §45–47), only relocated.
8. **Color establishes hierarchy/zones, not decoration** — see §40.
9. **Red is for genuine errors only** — audit found no current red misuse, but the new zone-color system (§40) must not introduce any.
10. **No fake completeness scores** — already true today (confirmed: no Trade% or Discipline Score exists anywhere in the audited code); must remain true through the redesign.

---

## 7. Three-level information hierarchy

| Level               | Definition                                      | Current state                                                                                            | Target                              |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1 — Summary         | Answer in 5–10s                                 | Does not exist on any surface — Analytics/Detail/Log all start at Level 3 density immediately            | New Overview state per surface      |
| 2 — Insight/Explore | Why/where the result came from                  | Partially exists (e.g., per-condition/per-emotion breakdowns) but mixed in with Level 3 on the same page | Becomes the "Explore" destination   |
| 3 — Detail          | Full metrics/breakdowns/records/filters/history | This is what all three surfaces currently show, unconditionally, to everyone, immediately                | Remains available, one click deeper |

---

## 8. Final Analytics top-level IA

```
Analytics Overview
├── RESULTS
│   ├── Trader Performance
│   └── System Performance
├── EDGE
│   ├── Strategy Performance
│   └── Setup Performance
│       └── Setup Adherence
└── BEHAVIOR
    ├── Confidence Performance
    └── Emotion Performance
```

No top-level zone is created for Rules, Mistakes, Discipline, Symbol, Session, Direction, or
Timeframe — each nests under the appropriate zone's Explore per §9–19, §29.

---

## 9. Results zone contract

**Question:** What happened?
**Contains:** Trader Performance, System Performance (§12, §14).
**Overview role:** the two hero totals (Actual Total R, System Total R) plus one comparison
sentence ("System appears ahead of your execution") plus the one actionable pending-System
count. This directly replaces current Analytics sections 3–5 (Performance ×2, Comparison,
Equity ×2) as the _first_ thing shown — those sections' full metric sets move to Explore, not
away.

---

## 10. Edge zone contract

**Question:** What seems to produce better trading opportunities?
**Contains:** Strategy Performance, Setup Performance (incl. Setup Adherence).
**Important audit finding:** **no current component answers "which Strategy/Setup performs
best" today.** The existing Strategy/Setup _filters_ narrow the whole page to one Strategy or
Setup at a time; there is no cross-Strategy or cross-Setup comparison/ranking view anywhere in
the codebase. "Best observed Strategy" / "Best observed Setup" as specified in §5/§10 of the
brief is **net-new composition**, not a relocation of an existing component. It needs no new
schema (grouping by the existing `strategy_id`/`setup_id` foreign keys the same way
`ConfidencePerformance`/`EmotionPerformance` already group by confidence/emotion), but it is new
`lib/analytics`/DAL code, not just new UI. Flagged for 15D, not 15C.

---

## 11. Behavior zone contract

**Question:** How does my state at entry relate to performance?
**Contains:** Confidence Performance, Emotion Performance — direct relocation of
`ConfidencePerformance`/`EmotionPerformance` (§18, §19), no new composition needed; only the
Overview-vs-Explore split (hero "strongest observed" line vs. the existing full bucket table) is
new.

---

## 12. Trader Performance placement

- **Overview hero:** Actual/Trader Total R (currently buried as one of 8 equally-weighted metrics in `PerformancePanel series="trader"`).
- **Overview secondary:** Win Rate only, one line.
- **Explore:** the remaining 7 current metrics (Avg R, Expectancy, Profit Factor, Max Drawdown, Avg Win R, Avg Loss R, Payoff Ratio) + the Equity Curve (`EquityChart series="trader"`) — direct relocation, no new code.
- **Explore sub-area — Trade Management:** relocation of `RuleSummary` + `MistakeFrequency` (currently an unlabeled bottom grid) into a named Trade Management sub-section under Trader Performance Explore, per §13.
- **Explore sub-area — context breakdowns:** By Symbol / By Session / By Direction / By Timeframe (§29) — **net-new**, no such breakdown exists today for any of these four dimensions (confirmed absent by search). Schema fields already exist (`symbol` is core, `session`/`timeframe` are existing Plan fields); this is new aggregation code only.

---

## 13. Trade Management placement

Nested under **Trader Performance → Explore** (Analytics), distinct from Setup Adherence
(§16). Direct relocation of `RuleSummary` (Rule Adherence rate + Followed/Violated/Not
Checked/Not Applicable counts) and `MistakeFrequency` (ranked mistake list) — same
`composeRuleAnalytics`/`composeMistakeAnalytics` outputs, new placement only. Customer-facing
rename from "Rule Analytics"/"Most Frequent Mistakes" section labels to a single "Trade
Management" heading (§51).

---

## 14. System Performance placement

Mirrors §12 exactly for the System axis: hero = System Total R, Overview secondary = System Win
Rate, Explore = remaining `PerformancePanel series="system"` metrics + `EquityChart
series="system"`. The existing pending-count banner and "Review pending" link (§3, §23) move to
the Overview card as the one actionable line, upgraded to a specific deep link (§25) rather than
the current generic `/app/trades`.

---

## 15. Strategy Performance placement

Under **EDGE**. Overview: "Best observed Strategy" hero (name, avg R, sample count) — net-new
per §10. Explore ("Strategy Analysis"): Trader performance by Strategy, System performance by
Strategy, sample count, deeper metrics — a strategy-grouped analogue of the existing
`ConfidencePerformance`/`EmotionPerformance` pattern (group by `strategy_id`, reuse
`averageR`/`winRate` from `lib/calc/aggregate.ts`), net-new composition.

---

## 16. Setup Performance placement

Under **EDGE**, sibling to Strategy Performance. Overview: "Best observed Setup" hero — net-new,
same reasoning as §15 (group by `setup_id`). Explore ("Setup Analysis"): Actual/System Avg R,
Actual/System Win Rate, sample count, breakdowns.

---

## 17. Setup Adherence placement

Stays a **distinct sub-concept under Setup Performance**, never merged with Trade Management
(§13) — the brief is explicit that these answer different questions ("did I pick a matching
opportunity" vs. "did I manage it well"). Direct relocation of `SetupAdherencePanel` (avg
adherence, conditions-met rate, 5 buckets) and `ConditionPerformance` (per-condition Met/Not-Met)
— currently the "Setup Quality" section — into Setup Performance → Explore, with the Overview
card showing only the single "Setup Adherence NN%" headline number, which the existing
`averageSetupAdherence` output already directly provides (`src/lib/calc/setup-adherence.ts`). No
new composition needed, only extraction of the one headline figure.

---

## 18. Confidence placement

Under **BEHAVIOR**. Overview hero: "Strongest observed confidence range" + avg R + sample count
— derivable from the existing per-level (`0/25/50/75/100`) grouped output already computed by
`composeConfidenceAnalytics`; Overview just needs to pick the best-performing level, no new calc.
Explore: full `ConfidencePerformance` bucket table, direct relocation. Confidence `0` must
continue to render as valid recorded data (`=== null` check preserved, per §4 finding); `null`
stays "not recorded."

---

## 19. Emotion placement

Under **BEHAVIOR**, sibling to Confidence. Overview: "Strongest observed state" + "Potential
concern" (best/worst average-R emotion groups) with mandatory sample-size disclosure and
non-causal phrasing per §18/§27 of the brief — derivable by sorting the existing
`composeEmotionAnalytics` per-emotion groups, no new calc. Explore: full `EmotionPerformance`
list, direct relocation.

---

## 20. Data Readiness model

Adopting the brief's per-domain sample-fact model verbatim (§12 of the brief) rather than one
universal completion percentage — this matches existing engineering discipline already visible
in the codebase (e.g., `setupConditionState: 'recorded' | 'not_recorded' | 'not_configured'` is
already a three-value enum, not a percentage). Recommended mapping onto **existing** DAL
counters (no new queries needed, all these counts are either already computed or trivially
derivable from existing eligibility filters already used by `composeTraderAnalytics`/
`composeSystemAnalytics`):

| Domain          | Readiness fact                         | Source                                                                                           |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Trader          | "N finalized trades"                   | existing `selectTraderEligible` count                                                            |
| System          | "N resolved · M pending"               | existing `pendingCount`/`resolvedCount` (already computed, currently only shown on System panel) |
| Strategy/Setup  | "N classified · M unclassified"        | existing `strategyId === null` filter, currently unused for this purpose                         |
| Setup Checklist | "N recorded at entry · M not recorded" | existing `setupConditionState` enum, currently only shown per-Trade in Detail, not aggregated    |
| Confidence      | "N recorded · M not recorded"          | existing `confidence === null` filter                                                            |
| Emotion         | "N recorded · M not recorded"          | existing `emotionsRecordedAt === null` filter                                                    |

---

## 21. Calibrating terminology

Adopt the brief's health-app metaphor exactly: "Calibrating your System insights" / "Your
Confidence insight is still calibrating" as product-feel copy layered _on top of_ the factual
counts in §20, never replacing them. Must not imply AI training, statistical certainty, or
medical validation (brief §14) — copy review checklist for 15C/15D: no occurrence of "confidence
interval," "statistically significant," "validated," or "trained" anywhere in new copy.

---

## 22. Sample-size semantics

No arbitrary threshold (e.g., "10 trades = Ready") is introduced, matching brief §13 — no
validated statistical methodology exists in `lib/calc/` today (confirmed: no significance testing
anywhere in the calc engine), so this phase does not invent one. Vocabulary adopted verbatim:
**Ready** (usable analysis exists) / **Calibrating / Limited sample** (some data, small sample) /
**Needs data** (specific data can truthfully be supplied) / **Not recorded at entry** (entry-time
evidence doesn't exist) / **Not configured** (feature had no configured data) — the last two
already exist as literal enum values in the codebase (`setupConditionState`), so this is
largely a copy/vocabulary extension, not new logic.

---

## 23. Actionable missing data model

Every "N pending" fact in the new Overview must resolve to an actual filtered list of Trade IDs,
not a generic link — this is the single largest functional gap found in the current Analytics
audit (§3, §5: only one non-specific link exists today). Requires: a `?system=pending` (or
similar) filter param on `/app/trades` that the existing `listWorkspaceTrades` DAL call can
already accept in principle (it already accepts `tradingAccountId`; a `systemStatus` filter is an
additive, same-shape extension, not a new query engine). This is new server code (a query
parameter and a WHERE clause), not new schema.

---

## 24. Non-actionable entry-time missing data model

Setup Checklist, Confidence, Emotions, Entry Reason, and the entry/before chart must never offer
a "[Complete missing data]" action once the Trade has passed the entry moment — the current UI
already gets this right for Setup Conditions and Emotions (`not_recorded` vs `not_configured`
distinct copy, §4 finding) and this contract simply preserves and extends that same discipline to
Confidence, Entry Reason, and chart attachment, which currently show plain "Not set" without an
explicit "excluded from this analysis" framing. Recommended copy: _"Not recorded at entry.
Excluded from this analysis. [View trades]"_ — the `[View trades]` action is allowed (navigates
to a filtered list) but never implies the value can be truthfully backfilled.

---

## 25. Pending System workflow

Deep-link target for "N System Outcomes pending [Review]": a filtered Trade Log
(`/app/trades?systemStatus=pending`, new filter per §23) rather than a new standalone
queue/drawer for V1. The brief's optional batch workflow (§32, "Trade 1 of 5 [Target][Stop][BE]
[Custom][No Trade][Save & Next]") is **recommended for deferral past V1** — it would require new
batch-transition UI and sequencing state that doesn't exist anywhere in the current mutation
surface (every existing mutation, e.g. `resolveSystemTrade`, is single-Trade), and the brief
itself flags this as an open question ("audit whether appropriate for V1"). Recommendation:
filtered-list-then-open-each is sufficient for 15D/15F; revisit batch mode only if Founder UAT
shows the filtered-list flow is still too slow.

---

## 26. Strategy/Setup classification workflow

Same pattern as §25: "N Trades not classified [Classify trades]" deep-links to a filtered Trade
Log (`?strategy=unassigned`), then each row opens Trade Detail's Strategy & Setup step (§34) where
`AssignClassificationDialog` already exists and already works exactly as needed — no new
mutation logic required, only the new filter param and the deep link wiring.

---

## 27. Insight model

Adopting the brief's associative, non-causal, sample-disclosed insight copy model verbatim
(§18 of the brief). This is **new copy-generation logic**, not present anywhere today — current
Analytics is purely descriptive tables/numbers with zero generated sentences (confirmed: no
"insight" string composition exists in `src/lib/analytics/metrics.ts` or the components). Each
insight sentence must cite its own sample count inline and must degrade to "No strong pattern
yet." when no defensible comparison exists — this is a new, small, rule-based
(not statistical-inference) copy function per zone, best scoped into 15D alongside the zone
Explore work it summarizes.

---

## 28. Trend recommendation

No previous-period comparison exists anywhere in current Analytics today (confirmed: `range`
filter is 30D/90D/All, single-period only, no prior-period diff computed anywhere). Recommend
adding trend only to the highest-value, lowest-ambiguity pair: **Trader Avg R vs. previous
period** and **Setup Adherence vs. previous period** — both are simple re-runs of an existing
pure function (`composeTraderAnalytics`, `averageSetupAdherence`) against a shifted date range,
no new methodology. Do not add trend arrows to every metric (brief §19) — in particular, avoid
trend on System Total R or Execution Gap, where a shifted small sample can trivially flip sign
and mislead. This is a 15D-or-later nice-to-have, not required for the first slice.

---

## 29. Context breakdown placement

Symbol / Session / Direction / Timeframe move under **Explore Trader Performance** (not their
own zones, per brief §20 explicit prohibition) as sub-tabs: "By Symbol," "By Session," "By
Direction," "By Timeframe." Confirmed net-new (§3: no such breakdown exists in the codebase
today for any of the four). `direction` and `symbol` are core Trade fields; `session`/
`timeframe` are existing optional Plan fields (`src/server/dal/trades.ts`) — grouping requires no
schema change, only new aggregation composition (same shape as the Confidence/Emotion grouping
pattern already proven in `metrics.ts`).

---

## 30. Final Trade Detail IA

```
Trade Overview (hero: Actual R · System R · Gap, + step status row)
├── 1. Actual
├── 2. System
├── 3. Strategy & Setup
├── 4. Entry Snapshot
└── 5. Review (incl. Trade Management)
```

One step visible at a time; the user may open any step directly (not a forced wizard, per brief
§22). This directly resolves §4's finding that 9 stacked sections currently compete in one
scroll — every current Section maps cleanly onto one of these 5 steps (mapping table: §46).

---

## 31. Step status semantics

Adopt the restrained model from the brief exactly: ✓ Complete / ! Needs attention / ◐ Partially
recorded / ○ Optional or not recorded, not forced as literal glyphs if clearer copy exists.
Color: green = complete, blue = active/open, amber = actionable attention, neutral = optional/
missing, red = genuine error only. Applying this to the audited current states:

| Step             | ✓ Complete                   | ! Needs attention                            | ◐ Partial                        | ○ Optional/not recorded                                |
| ---------------- | ---------------------------- | -------------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| Actual           | `status='closed'`            | —                                            | `status='open'` w/ partial exits | `status='canceled'`/`'planned'` (legacy)               |
| System           | `systemStatus='resolved'`    | `systemStatus='pending'` (amber, actionable) | —                                | `systemStatus='no_trade'` (neutral, not an error)      |
| Strategy & Setup | Strategy+Setup both assigned | —                                            | Strategy only                    | neither assigned                                       |
| Entry Snapshot   | all 4 recorded               | —                                            | some recorded                    | none recorded (never amber/red — entry-time data, §24) |
| Review           | rules+review present         | —                                            | some rules checked               | none present                                           |

No cell here is ever red — the current codebase has no scenario that constitutes a genuine
error at this level (confirmed: no data-integrity/error state surfaces at the Trade level today
outside the generic `data_integrity_error` Analytics metric-unavailable reason, which is
unrelated to per-Trade status).

---

## 32. Actual step

Contains exactly today's **Execution** section content (§4 mapping): Actual Result Mode, Actual
Entry/Initial Stop/Position Size, Initial Risk, Exit, Gross/Net P&L, Commission/Fees/Swap,
**Actual R**, Trader Outcome badge, entered/exited timestamps, the exit/partial-close list with
inline "Correct exit," and the Closed%/Remaining%/Realized-R-to-date summary. Actions
(`AddExitDialog` partial/full close, `ExecutionCorrectionDialog`) move from the Lifecycle Actions
card into this step, directly beside the data they act on — resolving §4's "actions separated
from subject" finding. `OpenTradeDialog` (legacy planned→open path) also lives here, shown only
when `status='planned'`.

---

## 33. System step

Contains exactly today's **System** section content: System Resolution Kind, System Exit
Price/Gross R input, System Exited At/Reason, System Cost R, **System R**, System Outcome badge,
System Resolved At. `ResolveSystemDialog`/`MarkSystemNoTradeDialog`/`CorrectSystemDialog` move
here from Lifecycle Actions. **Execution Gap** gets promoted from a single buried row (§4
finding) to a visible comparison callout on this step _when both Actual and System are final_ —
same underlying `executionGapR` value and same non-null-only display rule, just given the visual
prominence CLAUDE.md §6 implies it deserves. A Trade with System pending is never described as
"the whole Trade is pending" (brief §25) — the Overview step-status row (§30) already makes this
false framing structurally impossible, since Actual and System get independent status icons.

---

## 34. Strategy & Setup step

Contains exactly today's **Classification** section: Strategy name/version/archived-badge,
Setup name/archived-badge, `ClassificationTiming` ("Captured at entry"/"Added after entry") for
each, and the existing `AssignClassificationDialog` for whichever is unassigned. Setup Checklist
display truthfully shows "Not recorded at entry" (never "0%") when Setup was added after entry —
already correct today (`setupConditionState`), preserved verbatim.

---

## 35. Entry Snapshot step

Contains exactly today's four Entry Snapshot sub-sections, made properly scannable (brief §27)
rather than the current run-together `SubSection` stack: Setup Checklist (rename, §51) "4/5",
Confidence "75%", Emotion "Focused · Calm", Entry Reason "Recorded"/"Not set", Chart
"Recorded"/"Not recorded" — one compact row per field, full detail (the checklist itself, the
emotion pills, the entry-reason text, the chart image) revealed on expand/tap, not by default.

---

## 36. Review / Trade Management step

Customer-facing structure per brief §28–29: this step's primary content is renamed **Trade
Management** (Rules followed %, Common mistakes list) — direct relocation of today's
`TradeRulesEditor`/`TradeMistakesEditor` (currently nested under "Discipline") — plus a
**Post-Trade Review** sub-area (today's `TradeReviewNotesEditor`) kept visually distinct from
Trade Management, and Entry Reason remains attached to the Entry Snapshot step (§35), not moved
here. No combined Discipline Score is introduced (already true today, must remain true — brief
§28 and CLAUDE.md §6 agree).

---

## 37. Final Trade Log IA

First visual layer per row (replacing today's 10-facts-at-once table, §5): Symbol + Direction +
date/time (hero identity, always shown) → Actual state (one compact line: "Closed −0.50R" /
"Open · 50% remaining, +1.00R realized" / "Planned R x.xx") → System state (one compact line:
"Pending" / "+5.00R" / "No trade") → Strategy label or a direct "[Add Strategy]" action when
unassigned. Everything else currently in the table (account name, archived badges, setup name +
version, conditions-met fraction, outcome badge styling detail) moves to row-expand or to Trade
Detail — none of it is deleted (full mapping: §47).

---

## 38. Deep Action Navigation

Adopted as the one shared pattern across all three surfaces, using the same mechanism
end-to-end: a specific, filtered list link (never a bare `/app/trades`) → the Trade Log,
pre-filtered → a specific Trade row → Trade Detail opened directly to the relevant step via a
query param, e.g. `?trade=<id>&section=system` (extending the URL contract already established
by `?trade=`/`?cursor=`/`?month=`/`?date=` in the current Calendar+Log implementation, §5 —
purely additive, no breaking change to existing params). This is the mechanism underlying §23,
§25, §26.

---

## 39. Calendar relationship

No change to the Trading Calendar's core independent Actual/System date-axis semantics (per
brief §33 and this phase's own instruction not to touch load-bearing 14D behavior). Only
consistency changes: the `DaySummaryPanel`'s Open/PendingSystem/Unclassified counts should use
the same deep-link pattern as §38 (currently they are static counts with no click-through — a
gap worth closing in the same slice that builds §23/§25/§26's filtered-list links, since it's the
same underlying mechanism). Each surface keeps one clear job: Calendar = navigate by date,
Trade Log = scan records, Trade Detail = work one Trade, Analytics = understand patterns.

---

## 40. Premium color-zone system

Three zone identities, used only for zone headers/subtle background tint/accent border/icon/
selected state/chart accent — never full-card saturated fills:

| Zone     | Family      | Where applied                                                                                                       |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| RESULTS  | Blue        | Section header accent, Trader/System icons (existing `text-trader`/`text-system` CSS vars are reused, not replaced) |
| EDGE     | Teal        | Strategy/Setup Explore header accents                                                                               |
| BEHAVIOR | Violet/Plum | Confidence/Emotion header accents                                                                                   |

Status colors (§31) are a separate, orthogonal system from zone colors and must not collide —
e.g., an amber "needs attention" badge inside a Blue-zone card stays amber, not blue.

---

## 41. Typography/text-density recommendations

Audit finding: current Analytics/Detail copy is already fairly terse at the field level (no long
paragraphs found in `messages/en.json`'s analytics namespace) — the density problem is
_structural_ (too many fields shown at once), not _verbal_ (no field's individual label/value is
overly wordy). Recommendation is therefore mostly about hiding fields behind Explore (§9–19,
§30) rather than rewriting copy. The one exception: methodology/definition text (e.g., what
"Execution Gap" means, what a "buckets" grouping represents) should move into a tooltip/info
popover rather than inline body text — no such popovers exist today; all definitional context is
either absent or implicit in a metric's label.

---

## 42. Mobile behavior

Existing `lg:` breakpoint behavior in `trades-journal.tsx` (List/Detail become two full-width
"pages" below `lg`, with a Back button) is a reasonable existing foundation — the new step
navigation (§30) replaces the current flat scroll within the Detail "page" with the vertical
accordion/selector pattern the brief recommends (§36), reusing the same mobile breakpoint
already in place. Analytics mobile: RESULTS → EDGE → BEHAVIOR stacked vertically, each zone's
Overview card shown before its Explore is reachable — no new breakpoint infrastructure needed,
only re-ordering content within the existing responsive grid classes already used
(`sm:grid-cols-2`, `xl:grid-cols-4`, etc.).

---

## 43. Accessibility

Current baseline is good and must be preserved: `Section`/`SubSection` already use proper
`id`/`aria-labelledby`; Calendar cells already have full a11y label phrases
(`a11yCountTrader`/`a11yCountSystem`); `EquityChart` already ships an accessible `<table>`
fallback alongside the Recharts chart. New requirements introduced by this redesign: step
navigation (§30) must be a proper tablist/tab pattern (keyboard arrow navigation, `aria-selected`)
rather than plain links; status icons (§31) must never rely on color alone — each needs a text
equivalent (already true of the Calendar's pattern, must be replicated for the new step-status
row); any new expand/collapse control (§35, §37) must use a real disclosure widget
(`aria-expanded`), not a bare onClick div.

---

## 44. Filter simplification

Current `AnalyticsFilters` (§3) is one always-expanded panel with 5 controls in a 4-column grid
— functionally complete but visually the first thing competing for attention on the page.
Recommendation: keep exactly the same filter set and URL-param contract (`?range=&account=&
strategy=&setup=&version=`, `src/lib/analytics/url-filters.ts` — zero changes needed there),
only make the panel collapsible/compact by default (a persistent bar showing the current scope
as text, expandable to the full control set) so it recedes once a choice is made. No new filters
are added in this phase.

---

## 45. Complete existing-Analytics component/metric mapping

| Current component/metric                                        | New home                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnalyticsFilters`                                              | Compact persistent filter bar (§44), same params                                                                                                        |
| `PerformancePanel series="trader"` (8 metrics)                  | Trader Performance: Total R + Win Rate → Overview hero/secondary (§12); remaining 6 → Explore                                                           |
| `PerformancePanel series="system"` (8 metrics + pending banner) | System Performance: Total R + Win Rate → Overview (§14); remaining 6 → Explore; pending banner → Overview actionable line with specific deep link (§25) |
| `AnalyticsComparisonPanel` (6 metrics)                          | Results zone Overview comparison sentence (top figure) + full panel in Trader Performance Explore (or a shared Results Explore)                         |
| `EquityChart` ×2                                                | Trader/System Performance Explore, one chart each                                                                                                       |
| `SetupAdherencePanel`                                           | Headline % → Setup Performance Overview (§17); full buckets → Setup Adherence Explore                                                                   |
| `ConditionPerformance`                                          | Setup Adherence Explore, alongside `SetupAdherencePanel`                                                                                                |
| `ConfidencePerformance`                                         | Best-level hero → Behavior Overview (§18); full table → Confidence Explore                                                                              |
| `EmotionPerformance`                                            | Best/worst hero → Behavior Overview (§19); full list → Emotion Explore                                                                                  |
| `RuleSummary`                                                   | Trade Management, under Trader Performance Explore (§13)                                                                                                |
| `MistakeFrequency`                                              | Trade Management, under Trader Performance Explore (§13)                                                                                                |
| Scope summary line                                              | Retained as the compact filter bar's collapsed-state label                                                                                              |
| — (no current equivalent)                                       | Strategy Performance, Setup Performance "best observed" — **net-new** (§10, §15, §16)                                                                   |
| — (no current equivalent)                                       | Symbol/Session/Direction/Timeframe breakdowns — **net-new** (§29)                                                                                       |
| — (no current equivalent)                                       | Insight sentences — **net-new** (§27)                                                                                                                   |
| — (no current equivalent)                                       | Trend vs. previous period (limited scope) — **net-new** (§28)                                                                                           |

No metric is deleted. Every current component has an explicit destination.

---

## 46. Complete existing-Trade-Detail mapping

| Current section/field                                                                                  | New home                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header (symbol/direction/status badges)                                                                | Trade Overview hero (§30)                                                                                                                                                                                                                                                                                                                  |
| Lifecycle Actions — Execution group                                                                    | Actual step (§32)                                                                                                                                                                                                                                                                                                                          |
| Lifecycle Actions — System group                                                                       | System step (§33)                                                                                                                                                                                                                                                                                                                          |
| Lifecycle Actions — Corrections (Edit Plan)                                                            | Split: Plan-related fields → Strategy & Setup / Entry Snapshot steps as appropriate (Edit Plan currently edits both Plan and Entry Snapshot fields in one dialog — recommend splitting the dialog along step boundaries in 15E, or keeping one dialog reachable from both steps; flagged as an implementation decision, not resolved here) |
| Lifecycle Actions — Corrections (Edit Identity)                                                        | Trade Overview hero (identity is cross-cutting, not step-specific)                                                                                                                                                                                                                                                                         |
| Lifecycle Actions — Delete                                                                             | Trade Overview hero, kept clearly separated (destructive)                                                                                                                                                                                                                                                                                  |
| Overview section (account, statuses, timestamps)                                                       | Merges into Trade Overview hero + relevant step headers                                                                                                                                                                                                                                                                                    |
| Classification section                                                                                 | Strategy & Setup step (§34), verbatim                                                                                                                                                                                                                                                                                                      |
| Plan section (entry/stop/target, risk/reward, size, timeframe, session, TradingView URL, chart, notes) | Split: pricing/size/risk fields stay visible where relevant to Actual/System comparison context; timeframe/session/TradingView URL/chart/notes → Entry Snapshot step (§35)                                                                                                                                                                 |
| Entry Snapshot — Conditions                                                                            | Entry Snapshot step, renamed Setup Checklist (§51)                                                                                                                                                                                                                                                                                         |
| Entry Snapshot — Confidence                                                                            | Entry Snapshot step                                                                                                                                                                                                                                                                                                                        |
| Entry Snapshot — Emotions                                                                              | Entry Snapshot step                                                                                                                                                                                                                                                                                                                        |
| Entry Snapshot — Entry Reason                                                                          | Entry Snapshot step                                                                                                                                                                                                                                                                                                                        |
| Execution section                                                                                      | Actual step (§32), verbatim                                                                                                                                                                                                                                                                                                                |
| System section incl. Execution Gap row                                                                 | System step (§33); Execution Gap promoted to a visible callout                                                                                                                                                                                                                                                                             |
| Discipline — Rules                                                                                     | Review step, Trade Management sub-area (§36)                                                                                                                                                                                                                                                                                               |
| Discipline — Mistakes                                                                                  | Review step, Trade Management sub-area (§36)                                                                                                                                                                                                                                                                                               |
| Discipline — Post-trade Review                                                                         | Review step, kept visually distinct from Trade Management (§36)                                                                                                                                                                                                                                                                            |
| Mobile Back button                                                                                     | Preserved (§42)                                                                                                                                                                                                                                                                                                                            |
| `CloseTradeDialog` (dead code, unused)                                                                 | Not part of this redesign's scope; flagged for a future cleanup PR, not deleted here (out of scope for an audit-only phase)                                                                                                                                                                                                                |

No field disappears. Every current section has an explicit step destination.

---

## 47. Complete existing-Trade-Log mapping

| Current row field/badge                     | New home                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Symbol + direction + date/time              | First-layer row (§37), unchanged                                                                                  |
| Strategy name + archived badge              | First-layer row when assigned; "[Add Strategy]" direct action when not (§26, §38)                                 |
| Setup name + version + archived badge       | Detail-only (Strategy & Setup step) — first layer keeps Strategy only, per brief's "one thing at a time" for rows |
| Conditions-met fraction                     | Detail-only (Entry Snapshot step)                                                                                 |
| Account name + archived badge               | Secondary row state (small, muted) — retained but visually receded                                                |
| Execution status badge                      | First-layer row, folded into the compact Actual-state line (§37)                                                  |
| Trader R/outcome/realized-to-date/planned-R | First-layer row, compact Actual-state line                                                                        |
| System status badge + R + outcome           | First-layer row, compact System-state line                                                                        |
| Row-as-link click target                    | Preserved, unchanged                                                                                              |
| Pagination (cursor Prev/Next)               | Preserved, unchanged (existing `router.back()` Prev inconsistency noted but out of scope)                         |

No field is deleted; archived badges and setup detail recede to row-expand/Detail rather than
disappearing.

---

## 48. Domain invariants preserved

Confirmed unchanged by this audit and not to be touched by any implementation slice: Actual R,
System R, Execution Gap (`executionGapR`/`pairedExecutionGapR`/`averageExecutionGapR`), Setup
Adherence formulas (`lib/calc/setup-adherence.ts`), Confidence semantics (`0` valid vs. `null`
not recorded), Emotion semantics (empty array vs. never-recorded), Trader/System eligibility
rules (Phase 13 §15), Strategy/Setup versioning, independent Actual/System date axes (Phase 14D),
partial-close semantics (`closedBps`/`remainingBps`). No calculation-engine file
(`src/lib/calc/**`) needs to change to implement any recommendation in this document — every
recommendation is either a relocation of an existing computed value or a new _composition_
(grouping/aggregation using existing primitives), never a new formula.

---

## 49. Schema/migration impact

**No migration is required or recommended.** Every new capability identified in this audit
resolves to one of: (a) new URL/query-string state (`?section=`, `?systemStatus=`,
`?strategy=unassigned`, deep-link params) — client/routing state, not persistence; (b) new
server-side composition functions over existing columns (Strategy/Setup grouping, Symbol/
Session/Direction/Timeframe grouping, trend-vs-previous-period) — reads only, no new tables or
columns; (c) new copy/vocabulary (Calibrating, readiness terms, insight sentences) — no
persistence at all. Per the brief's §43 policy, no schema was recommended merely for
convenience.

---

## 50. Risks

- **Strategy/Setup/Symbol/Session/Direction/Timeframe breakdowns are net-new server code**, not pure relocation — they carry normal new-code risk (edge cases in grouping null/unassigned buckets) even though no schema changes. Should be scoped and tested like any new feature, not treated as free "just move it" work.
- **Edit Plan dialog spans two proposed Trade Detail steps** (§46) — the cleanest split isn't yet decided; if 15E ships without resolving this, either the dialog needs duplicated entry points or one step needs to launch a dialog that also edits fields it doesn't otherwise display. Recommend deciding this explicitly at the start of 15E, not mid-implementation.
- **Deep-link `?systemStatus=`/`?strategy=unassigned` filters on `/app/trades`** are new query semantics on an existing route; must be validated with the same Zod-at-boundary discipline as the existing `?trade=`/`?month=`/`?date=` params (CLAUDE.md §10) to avoid becoming an unvalidated client-trusted filter.
- **Insight-sentence generation (§27) is new user-facing copy logic** with no existing test pattern to follow in this codebase — needs its own "no strong pattern yet" fallback tested explicitly, since it's the one new surface most likely to accidentally overstate a pattern (CLAUDE.md's general caution against unearned certainty applies here directly).
- **Founder acceptance of Phase 14 is still pending** (§1) — this redesign builds directly on 14's Trade Detail/Log/Calendar data model; if 14 UAT surfaces a data-model change, it would ripple into the step mapping in §46 before 15E starts.

---

## 51. Explicit deprecated/renamed customer terminology

| Old customer-facing label                                         | New customer-facing label                                    | Scope                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Execution Rules" (section concept)                               | **Trade Management**                                         | Analytics (§13) + Trade Detail Review step (§36)                                                                                                    |
| "Setup Conditions"                                                | **Setup Checklist**                                          | Trade Detail Entry Snapshot (§35) + Strategy & Setup (§34); "Setup Condition" as an individual item may become "Setup Checklist item" where natural |
| "Setup Quality" (Analytics section label)                         | **Setup Performance** (with Setup Adherence nested inside)   | Analytics IA (§8, §16, §17)                                                                                                                         |
| "Psychology" (Analytics section label)                            | **Behavior**                                                 | Analytics IA (§8, §11)                                                                                                                              |
| "Rule Analytics" / "Most Frequent Mistakes" (two separate labels) | **Trade Management** (one label)                             | Analytics (§13)                                                                                                                                     |
| "Discipline" (Trade Detail section label)                         | **Review** (containing Trade Management + Post-Trade Review) | Trade Detail (§36)                                                                                                                                  |

Internal/domain names (`setupConditions`, `strategy_rules`, `mistake_catalog`, DB columns,
DAL/service function names) are **not** renamed by this audit, per this phase's explicit
instruction (§7 of the brief) — only customer-facing copy changes.

---

## 52. Recommended implementation slices

```
15B → 15C → 15D → 15E → 15F → 15G
        ↘             ↗
         (15D can start once 15C's Overview/Explore
          primitive exists; 15E is independent of 15C/D)
```

- **15B — Design primitives + common UX status/deep-action foundation.** Zone color tokens
  (§40), step-status icon/color system (§31), the shared Overview-card / Explore-drill-through
  primitive, the `?section=`/deep-link URL convention (§38). Everything else consumes this, so
  it must come first.
- **15C — Analytics Overview redesign.** Build the RESULTS/EDGE/BEHAVIOR Overview using only
  direct relocations (§45's non-net-new rows) — Trader/System hero, Setup Adherence headline,
  Confidence/Emotion hero. Depends on 15B only.
- **15D — Analytics Explore / detail restructuring + net-new composition.** Strategy/Setup
  Performance "best observed," context breakdowns (Symbol/Session/Direction/Timeframe), insight
  sentences, trend. This is where all genuinely new server logic (§50's first risk) lives, kept
  separate from 15C's low-risk relocation work so a review can focus scrutiny there.
  Depends on 15C's Overview shell existing to drill into.
- **15E — Trade Detail step navigation.** The 5-step IA (§30–36), including resolving the Edit
  Plan dialog split (§50's second risk) as an explicit decision at kickoff. Independent of
  15C/15D — may run in parallel with them if resourcing allows, since it touches a disjoint set
  of files (`trade-detail.tsx` and friends vs. `analytics/*`).
- **15F — Trade Log simplification + deep actions.** Row redesign (§37, §47) and the new
  `?systemStatus=`/`?strategy=unassigned` filters (§25, §26, §50's third risk) that both 15D's
  and 15E's deep links need as their landing target — depends on those filters existing, so
  should follow or pair tightly with 15E.
- **15G — Cross-surface UX regression + Founder UAT.** Full click-through of every deep link
  built in 15C–15F, accessibility pass (§43), mobile pass (§42), and Founder acceptance —
  necessarily last.

---

## 53. Which slice should be implemented first

**15B.** Every other slice depends on its color tokens, status semantics, or deep-link URL
convention; starting anywhere else risks each subsequent slice inventing its own ad hoc version
of these shared primitives and having to be reconciled later. 15B is also the lowest-risk slice
— it is pure design-system scaffolding with no new server logic and no domain surface area,
making it safe to build and review quickly before committing to the larger 15C/15D/15E work.

---

## 54. Phase 15B — Implemented foundation (as built)

Everything below is committed-ready code, not a proposal — 15C onward consumes these primitives
rather than re-deciding them. Analytics Overview/Explore, the full Trade Detail step redesign,
and Trade Log simplification remain unimplemented; only the shared foundation exists.

**Zone tokens** (`src/app/globals.css`, inside the existing `@theme inline` block) — three new
chrome-only aliases, deliberately reusing already-validated tokens rather than inventing new
hex values or a new chart-series slot:

| Zone     | Token                   | Aliases          | Rationale                                                                                                              |
| -------- | ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Results  | `--color-zone-results`  | `var(--primary)` | Existing generic action blue; Results already contains the Trader/System dual-axis panels                              |
| Edge     | `--color-zone-edge`     | `var(--brand)`   | Existing cyan identity accent, already used to mark a selected Strategy card                                           |
| Behavior | `--color-zone-behavior` | `var(--chart-4)` | The one categorical chart slot never assigned to a live series — reused for chrome only, never for encoding chart data |

Used only as a header accent/left rule/icon tint (`ZoneSection`, §5 below) — never a saturated
card fill, per the brief's restraint.

**Status vocabulary** (`src/lib/status/status-kind.ts`) — the eight-state `StatusKind` union
(`complete` / `active` / `needs_attention` / `partial` / `not_recorded` /
`not_recorded_at_entry` / `not_configured` / `error`), each mapped to exactly one `Badge`
variant and one distinct icon so status is never colour-only:

| Kind                    | Colour                          | Icon            |
| ----------------------- | ------------------------------- | --------------- |
| `complete`              | green (`positive`)              | `CheckCircle2`  |
| `active`                | blue (new `info` Badge variant) | `CircleDot`     |
| `needs_attention`       | amber (`warning`)               | `AlertCircle`   |
| `partial`               | neutral                         | `CircleDashed`  |
| `not_recorded`          | neutral                         | `Circle`        |
| `not_recorded_at_entry` | neutral                         | `History`       |
| `not_configured`        | neutral                         | `MinusCircle`   |
| `error`                 | red (`negative`)                | `AlertTriangle` |

`Badge` (`src/components/ui/badge.tsx`) gained exactly one new variant, `info` (blue, the
existing `--info` token — previously declared but unused in the app), for the `active` state;
no other Badge variant changed. `StatusBadge` (`src/components/status/status-badge.tsx`) is the
one render surface for this vocabulary, with an optional `label` override for a more specific
reading (e.g. "Open" instead of the generic "Active") that never changes the underlying colour.

**Deep-link contract** (`src/lib/trades/section.ts`) — `TRADE_DETAIL_SECTIONS = ['actual',
'system', 'strategy', 'entry', 'review']`, a `TradeDetailSectionSchema` Zod enum,
`parseTradeDetailSection` (invalid/absent → `null`, never throws), and `TRADE_SECTION_DOM_ID`
mapping each section onto trade-detail.tsx's **existing** `Section` ids (`trade-execution`,
`trade-system`, `trade-classification`, `trade-entry-snapshot`, `trade-discipline`) — proving the
contract against today's flat layout without restructuring it. The URL shape is
`/app/trades?trade=<id>&section=<key>`, purely additive to the existing `?trade=`/`?month=`/
`?date=`/`?cursor=` params. `section` is read **only** client-side (`useSearchParams` inside
`TradeSectionNav`) — it never reaches the server, so it carries zero authorization surface;
`trade` continues to go through the existing `TradeIdSchema` + `getWorkspaceTradeDetail`
authorization path, completely unchanged.

**Section-status derivation** (`deriveTradeSectionStatuses` in the same file) — a pure
presence/count function over fields the DAL already returns (no new calculation, no new
persisted field, no numeric completeness score): Actual derives from `status`, System from
`systemStatus`, Strategy & Setup from `strategyId`/`setupId` presence, Entry Snapshot from a
4-signal count (Setup Checklist/Confidence/Emotions/Entry Reason — `not_configured` counts as
addressed, not missing, matching the Entry Snapshot's existing truthful-state convention), and
Review from Rules-addressed + Review-notes-present (an empty Rule snapshot is excluded from the
denominator entirely rather than vacuously "passing", so a Trade with no Rules and no Review
notes correctly reads `not_recorded`, never a misleading `partial`).

**Trade section navigation** (`src/components/trades/trade-section-nav.tsx`) — `TradeSectionNav`,
wired into `trade-detail.tsx` directly below the header (above the Lifecycle Actions card). One
component, CSS-responsive (stacked list on mobile, row of pills on desktop — the same
responsive-split pattern already used by `trade-list.tsx`'s table/card views), not two. On
mount/URL change it resolves `?section=`, and for a valid value scrolls the matching existing
Section heading into view (`prefers-reduced-motion`-aware: `smooth` vs `auto`) and moves
assistive-tech focus there (`tabindex="-1"` + `.focus()`), never just the sighted viewport. An
unrecognized section value is a no-op — no scroll, no crash. No section is ever disabled; this
is deliberately not a wizard.

**Summary/Insight/Readiness primitives** (`src/components/product/summary-primitives.tsx`) —
`HeroMetric` (one hero value + receding supporting line + sample + at most one action),
`InsightNote` (an observation with mandatory sample disclosure; `sample: null` renders "No
strong pattern yet." instead of a fabricated pattern), `DataReadinessLine` (a factual coverage
sentence + optional action — no percentage, no threshold). None are wired into a real page yet
(Analytics Overview is 15C's job) — they exist as tested, reusable shapes.

**Actionable vs. entry-time missing data** (`src/components/product/actionable-notice.tsx`) —
`ActionableNotice` (fact + a specific filtered deep link, never a bare list link, coloured
`needs_attention`/amber, never `error`) and `EntryTimeNotice` (truthful "not recorded at entry"
copy with only an optional `View` link — structurally has no "complete now"-style CTA slot at
all, so this distinction can't be violated by a future call site passing the wrong props).

**Zone section heading** (`src/components/product/zone-section.tsx`) — `ZoneSection`, a thin
reuse of the existing `SectionHeader` (`components/product/page-header.tsx`) adding a zone
accent (coloured left rule, icon, optional light tint) — not a parallel heading component.

**Terminology** — customer-facing only, no domain/DB identifier renamed:

| Surface                             | Old                                                        | New                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trade Detail Entry Snapshot heading | "Setup Conditions"                                         | "Setup Checklist"                                                                                                                                                 |
| New Trade form section heading      | "Setup Conditions"                                         | "Setup Checklist"                                                                                                                                                 |
| Trade Detail Discipline sub-heading | "Execution Rules" (own heading) + "Mistakes" (own heading) | One "Trade Management" heading containing "Rules followed" and "Common mistakes" as inline labels; Post-Trade Review stays its own sibling sub-section, untouched |

New EN/TH namespaces added: top-level `status` (the 8-state vocabulary) and `zones` (Results/
Edge/Behavior labels — prepared for 15C, not yet rendered anywhere) plus `trades.detail.nav`
(the 5 short section-nav labels) and `trades.tradeManagement` (the new grouping's strings). Thai
wording was chosen for natural reading over literal translation — e.g. "Setup Checklist" as the
idiomatic transliteration "เช็กลิสต์เซ็ตอัพ" rather than a literal "list of conditions", and "Edge"
as "ความได้เปรียบ" (advantage) rather than a literal "edge".

**Explicitly not done in 15B** (reserved for later slices): Analytics is untouched — no zone is
rendered anywhere yet, `ZoneSection`/`HeroMetric`/`InsightNote`/`DataReadinessLine`/
`ActionableNotice` have zero production call sites outside their own tests. Trade Detail's
layout is unchanged beyond the new nav strip and the Rules/Mistakes heading consolidation — no
section is hidden, no wizard exists, Execution Gap has not been promoted to its own callout.
Trade Log is untouched. No `?systemStatus=`/`?strategy=unassigned` filter exists yet on
`/app/trades` — `ActionableNotice`/`EntryTimeNotice` are tested in isolation only, not wired to
a real pending-System or unclassified-Trades workflow. No migration was created; migrations
remain exactly `0000`–`0016`, confirmed by `drizzle-kit check`.
