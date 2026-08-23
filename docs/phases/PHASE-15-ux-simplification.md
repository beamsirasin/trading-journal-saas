# Phase 15 — Product UX Simplification & Information Architecture

> **Status:** 15A–15F and the approved 15G.4 recording-model audit are complete. The 15G.5A
> domain/service foundation, 15G.5B atomic completed-create foundation, 15G.5C retrospective
> analytics truth, and 15G.5D recording UX are implemented in the working tree — see §§59–62. Phase 15G Founder UAT
> remains open and must not be marked complete before Founder acceptance.
> **Preceding state:** Phases 14A–14E (Independent Trade Classification, Trading Calendar +
> Trade Log, Open/Close-Only Trade Flow) are complete and committed; Founder acceptance of 14
> is recorded as not yet obtained but does not block this work.
> **Last updated:** 2026-08-23 (Phase 15G.5D — Founder Recording UX).

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

---

## 55. Phase 15C — Analytics Overview (as built)

The Analytics landing experience now leads with three Overview zones — RESULTS, EDGE, BEHAVIOR
— built entirely from the 15B primitives, consuming ONLY data `composeAnalyticsSnapshot` already
returns. No `lib/calc/`, DAL, or schema file changed. Every pre-existing detailed section
(Performance, Comparison, Equity, Setup Quality, Psychology, Rule Analytics, Most Frequent
Mistakes) remains on the same page, unchanged, directly below the new zones — nothing was
deleted or moved behind a new route; "Explore" is a same-page anchor jump to the existing
section, which is the "temporary existing-detail target" the brief explicitly allows pending
15D's real Explore architecture.

**RESULTS** (`src/components/analytics/analytics-overview-results.tsx`) — two hero cards:
Trader Total R + Win Rate + finalized-Trade count; System Total R + Win Rate + a truthful
"N resolved" count. Every other Performance metric (Expectancy, Profit Factor, Drawdown, Avg
Win/Loss R, Payoff Ratio, both equity curves) intentionally stays off Overview, reachable one
Explore click below — the deliberate "restrained secondary set" the brief asked for, not an
oversight. The System pending count reuses the **already non-date-scoped** existing copy
("N pending System outcome(s)") verbatim — it was already compliant with the brief's §9 warning
before this phase touched it, so no new copy was needed; it appears via `ActionableNotice` only
when `systemPendingCount > 0`, linking to the existing `/app/trades` (no new filter param — 15D/
15F's job per Phase 15A's own slice ordering). The comparison insight
(`selectExecutionGapObservation` in `lib/analytics/overview-selectors.ts`) reads exclusively
`snapshot.comparison` — the already-paired-eligible population — and is `null` (rendering the
truthful "Trader and System results are tracked independently." fallback) whenever
`comparableCount === 0` or the metric is unavailable; it is never derived from the two
independent global totals, so it can never become "System Total R − Actual Total R" mislabeled
as Execution Gap (the exact failure mode the brief prohibits in §6).

**EDGE** (`analytics-overview-edge.tsx`) — Setup Adherence only. Strategy/Setup ranking ("Best
Strategy"/"Best Setup") is explicitly out of scope: no component in the codebase compares Trades
across multiple Strategies/Setups today, so summarizing one would require new DAL/composition
work reserved for Phase 15D. The card relocates exactly the two headline figures
`composeSetupAdherenceAnalytics` already computes (`averageAdherence`, `sampleCount`) with zero
new formula; the existing `setupAdherence.sampleCount` translation string ("N Trade(s) with
recorded, applicable Setup Conditions") is reused verbatim as the factual support line rather
than inventing a second, looser phrasing of the same fact.

**BEHAVIOR** (`analytics-overview-behavior.tsx`) — one Confidence card (strongest observed
level) and one Emotion card (strongest observed state, plus a "Potential concern" card only when
a second, genuinely negative-averaging group exists). Both use Trader-side data only — **Option
C** of the brief's §19 choice: the full independent Trader/System comparison for every
Confidence level and every Emotion group remains completely intact in the existing Psychology
section below, reachable via the same Explore anchor; Overview surfaces only the single
Trader-side headline both dimensions already treat as primary (matching Phase 13H's own
established convention that Confidence's/Setup Adherence's own headline KPI is Trader-only).
Level `0` can legitimately be "strongest observed" and is never confused with "no data" (tested
explicitly). No causal sentence is generated for either card — the numbers alone (percentage/
label → R → sample count) carry no causal claim, so the brief's non-causal-language guidance
applies to the RESULTS insight sentence, where a sentence is actually written.

**Selectors** (`src/lib/analytics/overview-selectors.ts`) — `selectStrongestConfidenceLevel`,
`selectStrongestEmotion`, `selectEmotionConcern`, `selectExecutionGapObservation`: pure functions
over already-composed snapshot arrays, using `decimal.js` for the R comparisons (never a raw
`Number()` parse of a financial value, consistent with CLAUDE.md §5's general discipline even
though this is presentation-layer selection, not the calc engine itself). `selectEmotionConcern`
never manufactures a concern from "the worse of two positives" — it returns `null` unless the
second-best group's average R is genuinely negative, and unless a second, distinct group with
data exists at all.

**Filter dominance** (§23) — `analytics-filters.tsx`'s outer wrapper changed from a heavy
bordered card (`border-border bg-card rounded-lg border p-4 sm:p-5`) to a plain bottom-border
band (`border-border border-b pb-5`) — filter semantics, URL contract, and behavior are
completely unchanged; only its visual weight relative to the new Overview zones was reduced.

**Calibrating** (§25) — deliberately **not used** in 15C. The brief simultaneously requires (a)
never inventing an arbitrary numerical readiness threshold and (b) never hiding the actual
sample count behind the word "Calibrating." With no non-arbitrary trigger condition available
(no validated statistical methodology exists anywhere in `lib/calc/`), any use of the word this
phase would necessarily either be decorative (always shown, adding noise) or threshold-gated
(violating (a)). Deferred until the product defines a genuine, non-arbitrary basis for it.

**Empty states** — new dedicated Overview copy, distinct from the existing detailed-panel empty
strings (which stay unchanged and still appear in the panels below): "No completed Trades yet",
"No System Outcomes resolved yet", "No Setup Checklist data recorded at entry", "No Confidence
data recorded for this analysis", "No Emotion data recorded for this analysis" — all calm,
factual, never framed as an error.

**Terminology added** — new `analytics.real.overview.*` EN/TH strings (zone descriptions, hero
labels, empty states, insight sentences) plus reuse of the Phase 15B `zones.*` namespace
(Results/Edge/Behavior labels) for the zone headings themselves — no duplicate zone-label keys
were created.

**Responsive** — Overview zones use the same `sm:grid-cols-2` two-card pattern already
established by the existing detailed panels; at 320–390px they stack to one column per the
brief's density target, verified by the existing mobile e2e's page-width overflow assertion
(unchanged assertion, now also covering the three new zones' rendered height).

**Server/DAL/schema impact:** none. Every changed or new file is a component, a presentation-layer
selector module, an i18n string file, or a test. `git diff --stat` touches exactly: `analytics-page.tsx`,
`analytics-filters.tsx`, `analytics-page.test.tsx`, `messages/{en,th}.json`, `e2e/analytics.spec.ts`,
plus the seven new `analytics-overview-*`/`overview-selectors*` files. Migrations remain
`0000`–`0016`, confirmed by `drizzle-kit check`.

**Founder-UAT questions carried forward:** (1) whether the RESULTS zone's single-stat restraint
(Win Rate only, omitting Expectancy/Profit Factor from Overview) reads as "enough" or as
under-informative before the Founder has used it manually; (2) whether the Emotion "Potential
concern" framing reads as intended or as unintentionally alarming; (3) whether omitting
"Calibrating" entirely (§25 above) undersells the product's health-app-like framing the Founder
liked in the original brief, versus the conservative choice made here.

---

## 56. Phase 15D — Analytics Explore, Strategy/Setup Edge & Context breakdowns (as built)

**Explore IA and routing.** One page, everything server-rendered — no conditional hiding. Three
new `ZoneSection`s (`results`/`edge`/`behavior`) sit below the existing Overview zones and a new
`AnalyticsExploreNav`, reusing the exact `?view=` deep-link mechanism 15B proved for
`TradeSectionNav`: read client-side only via `useSearchParams` (never reaches the server, zero
authorization surface), scrolls to the matching zone's existing anchor id, degrades to a no-op
for an invalid/absent value, and is reload-/back-forward-safe because it's plain URL state over a
fully-rendered page. The three Explore zones keep the **exact same DOM ids** 15C's Overview
"Explore" links already point at (`analytics-performance-heading`/`analytics-setup-quality-heading`/
`analytics-psychology-heading`) — every 15C CTA lands correctly with zero changes.

**Strategy/Setup Performance — net-new composition, zero new queries.** `selectTraderAnalyticsRecords`/
`selectSystemAnalyticsRecords` (`server/dal/analytics.ts`) already selected `strategyId`/`setupId`
on every Trader-/System-eligible row (Phase 14B never gated eligibility on classification) — Phase
15D adds no new DAL query for this, only two new pure composers in `lib/analytics/metrics.ts`
(`composeStrategyPerformance`/`composeSetupPerformance`) that group the SAME already-fetched
arrays by identity. Grouping is by **Strategy/Setup identity across Versions**, not exact Version
— not an invented rule: it mirrors `getAnalyticsFilterOptions`'s own existing Strategy/Setup
filter-dropdown query, which already resolves one label per `strategyId`/`setupId` regardless of
Version (`currentLabel ?? pinnedLabel`), confirmed against real seeded multi-Version e2e data
(Breakout Momentum v1 + v2 collapse into one group). Unclassified Trades are excluded from
grouping but counted in `classifiedTraderCount`/`unclassifiedTraderCount` (and the System-axis
equivalents) — never an "Unknown Strategy" bucket. Ranking metric: **Trader average R
descending**, tie-broken by Trader Trade count descending, then id ascending — deterministic,
documented, never DB row order. "Best observed" (never "Best Strategy"/"Best Setup") is simply
the first (already-sorted) entry, guarded to `null` when it has zero Trader Trades (a System-only
top entry never gets falsely labeled "best observed").

**Context breakdowns — Trader-only (documented decision).** `TraderAnalyticsRecord` was widened
with `symbol`/`direction`/`session`/`timeframe` (the DAL's existing Trader-eligible query, same
WHERE clause, four more `SELECT` columns — not a new query). One generic
`composeContextBreakdown` composer serves all four dimensions; System-side context was evaluated
and deliberately deferred (the brief frames it as optional: "if System-side context is added"),
not silently dropped. Sort order is Trade count descending, then value ascending — a
coverage-first order that never itself implies a performance ranking (avoiding the brief's
"XAUUSD is your best market" trap). `session`/`timeframe` being `null` counts into
`missingCount`, never a fabricated group.

**Setup Adherence vs. Setup Performance.** Kept explicitly distinct per the brief's frozen
distinction — Setup Performance (new) answers "how did this Setup perform"; Setup Adherence
(unchanged since Phase 13H, `SetupAdherencePanel`/`ConditionPerformance`) answers "how closely
did entries match the configured checklist." Both now live in Edge Explore as sibling
sub-sections, never merged. The existing adherence bucket boundaries (`SETUP_ADHERENCE_BUCKETS`,
0–24/25–49/50–74/75–99/100) were already product-defined in Phase 13H — no new "Performance by
Adherence" bucket set was invented for 15D; the existing bucket panel already answers this.

**Trade Management relocation.** `RuleSummary` + `MistakeFrequency` moved from two separately
top-level-titled sections ("Rule Analytics" / "Most Frequent Mistakes") into one "Trade
Management" sub-section under Trader Performance in Results Explore — identical underlying data,
one consolidated heading, matching the exact precedent Phase 15B already set in Trade Detail.

**Results Explore hierarchy.** Trader Performance (core `PerformancePanel`, equity chart, the
"timelines are not synchronized" disclaimer preserved verbatim, Trade Management, Context) →
System Performance (core, equity) → Comparison (paired-only `AnalyticsComparisonPanel`,
unchanged). Removed one redundant heading layer: `PerformancePanel` already renders its own
"Trader/System Performance" `CardTitle`, so the wrapping wasn't given a second, duplicate
`SectionHeader` — sections use `aria-label` instead, avoiding two identical heading nodes.

**Execution Gap.** Untouched — `AnalyticsComparisonPanel` still reads only
`snapshot.comparison` (the already-paired-eligible population); no call site anywhere sums the
two independent global totals.

**Behavior Explore.** `ConfidencePerformance`/`EmotionPerformance` relocated verbatim (full
independent Trader/System detail, unchanged since Phase 13H) — no simplification to Trader-only
occurred here; that stayed correctly scoped to the Overview cards only (15C).

**Domain invariants preserved.** No file under `lib/calc/` changed. No existing formula,
eligibility rule, or date-axis semantics changed — confirmed by `git diff --stat` (§ below): every
touched file is a DAL query widening (additive columns only), a new pure composer, a component, an
i18n string, or a test.

**Query/composition architecture and performance.** Zero new queries were added for Strategy/Setup
grouping (reuses the existing Trader/System eligible reads); Context breakdowns add four columns
to one existing query. No N+1 pattern exists — every composer operates in-memory over one
already-fetched array per population, same shape as the Phase 13H Confidence/Emotion/Condition
composers this phase's additions directly mirror. No index need was identified; none is expected
given no new WHERE/JOIN predicate was introduced (the widened `SELECT` reads existing indexed
columns already covered by `selectTraderAnalyticsRecords`' existing query plan).

**Schema/migration impact:** none. Migrations remain `0000`–`0016`, confirmed by `drizzle-kit
check`. No table, column, or index was added — only additional `SELECT`-list columns on an
existing query.

**Testing.** Pure composer unit tests (`metrics.test.ts`): Strategy/Setup grouping, exclusion vs.
coverage disclosure, ranking/tie-break determinism, empty/single-group states, independent
Trader/System populations, Context breakdown grouping/coverage/sort. Presentation-selector tests
(`overview-selectors.test.ts`): `selectBestObservedStrategy`/`selectBestObservedSetup`, including
the System-only-top-entry guard. Component tests for `StrategyPerformancePanel`/
`SetupPerformancePanel`/`ContextBreakdownPanel`/`AnalyticsExploreNav`/updated `EdgeZone`/updated
`RealAnalyticsPage`. Integration tests added to `analytics.integration.test.ts` (DAL: widened
Trader record carries Symbol/Direction/Session/Timeframe, Session/Timeframe correctly `null`) and
`analytics.integration.test.ts` (service: Strategy/Setup coverage end-to-end reusing the existing
Phase 14B unclassified-Trades fixture, plus a new Context-breakdown fixture) — **could not be
executed in this environment** (`TEST_DATABASE_URL` unset; the safety script hard-fails rather
than skipping, same as every other integration test in this repo) — confirmed to compile cleanly
via `tsc --noEmit` and must run for real in CI, per this repo's own established pattern for every
prior phase's integration suite. E2E (`e2e/analytics.spec.ts`) extended in-place (same seeded
fixture, no new provisioning cost): Edge Explore Strategy/Setup Performance assertions
(proving Version-collapse against real seeded multi-Version data), Context breakdown assertions,
and an Explore-nav navigation assertion, for both the desktop and the existing 320px mobile
journey — also currently un-executable here (no test DB) and confirmed to compile/skip cleanly.

---

## 57. Phase 15E — Trade Detail Step-Based Journal Experience (as built)

**IA delivered exactly as §30 specified**, with one deliberate refinement to §35's Entry Snapshot
grouping (below): Trade Overview (identity, Actual/System hero, paired Execution Gap only when
both sides are truthfully final, quiet Trade-level actions) followed by `TradeSectionNav` — now a
genuine **switcher**, not a scroll-to-anchor proof — showing exactly one of the five conceptual
sections at a time: **Actual → System → Strategy & Setup → Entry Snapshot → Review**. `actual` is
the default landing section (`DEFAULT_TRADE_DETAIL_SECTION`, `lib/trades/section.ts`) — the
natural first question about any Trade, never a forced sequence: every nav item stays reachable
from every other, none is ever disabled.

**Switcher architecture.** `TradeSectionNav` (`components/trades/trade-section-nav.tsx`) now takes
a `sections: Record<TradeDetailSection, ReactNode>` prop — five already-rendered Server Component
subtrees passed down from `TradeDetail` — and renders only `sections[activeSection]`, where
`activeSection` is derived client-side from `?section=` (`useSearchParams`, never reaching the
server — zero authorization surface, unchanged from 15B). Switching sections is therefore a pure
client re-render with no re-fetch; each section's own data was already fetched once by the page's
Server Component tree. Screen-reader focus moves to the newly-selected panel on every switch
(`panelRef.current?.focus()`), since a sighted-only content swap would otherwise strand
assistive-tech focus on now-hidden controls. `deriveTradeSectionStatuses()` (15B) needed **no
logic changes** — its existing heuristics already matched this phase's refined semantics exactly;
only section-specific status **wording** overrides were added (`sectionStatusLabel()`): Strategy's
`complete` reads "Recorded" (never "Complete"), `partial` reads "Strategy assigned"; Review's
`complete`/`not_recorded` read "Reviewed"/"Not reviewed"; Actual's legacy `planned` row reads
"Needs execution details," never exposing "Planned Trade" as a customer concept.

**Action colocation (brief §12/§15/§29, load-bearing).** Every mutation trigger now lives beside
the data it changes, and the old generic `trade-lifecycle-actions.tsx` "Lifecycle Actions" card
(§4's central finding) is **deleted** — grep-confirmed zero remaining references before removal:

- **Actual** (`trade-actual-section.tsx`): `AddExitDialog` (partial/full close), `AddExitDialog`
  with `closeRemaining`, `ExecutionCorrectionDialog`, and the legacy-planned `OpenTradeDialog`
  ("Add execution details & Open") — shown only for a `planned` row.
- **System** (`trade-system-section.tsx`): `ResolveSystemDialog`, `MarkSystemNoTradeDialog`,
  `CorrectSystemDialog` — genuinely independent of Actual's state (a Trade may read Actual Closed
  alongside System Pending, or vice versa; neither implies the other is blocked).
- **Strategy & Setup** (`trade-strategy-section.tsx`): `AssignClassificationDialog` — unchanged
  position, already correctly colocated before this phase.
- **Entry Snapshot** (`trade-entry-section.tsx`): `TradeEmotionsEditor`, `PlanCorrectionDialog`.
- **Review** (`trade-review-section.tsx`): `TradeRulesEditor`, `TradeMistakesEditor`,
  `TradeReviewNotesEditor`.
- **Trade Overview** (`trade-overview-header.tsx`): `IdentityCorrectionDialog`, the legacy
  `CancelTradeControl` (only for a `planned` row), and `DeleteTradeControl` — small, quietly
  positioned controls below the hero row, deliberately never a hero CTA (brief §35/§36).
  Archive/Restore do not apply to Trades at all (CLAUDE.md A7: Trades soft-delete via
  `deleted_at`, the app's one deliberate exception to its `is_archived` convention) — no such
  control exists or was added.

**Compact-summary vs. full-detail split (brief §22, refined during build).** Entry Snapshot leads
with a scan-friendly `<dl>` — Setup Checklist count, Confidence "75% · High", Emotion summary,
Entry Reason/Chart presence — then a native `<details>/<summary>` ("Show full details") holding
the full Setup Checklist breakdown, the Emotions editor, the full Entry Reason text, and Plan
reference data. **One deviation from a literal reading of §38 "Plan is data, not status":** Planned
Entry/Stop/Target, Planned Risk/Reward, and **Planned R** — the single figure CLAUDE.md §1 frames
as what the whole product measures against — were promoted into the always-visible compact
summary rather than left behind the disclosure, once build-time review showed hiding it behind an
extra tap contradicted that same load-bearing status; Position Size/Timeframe/Session/TradingView
URL/Notes/chart and the `PlanCorrectionDialog` trigger remain in the full-detail disclosure. No
dedicated "Plan" step exists or was considered — Plan data lives exclusively inside Entry
Snapshot, addressable on its own via `SubSection`'s new optional `id` (`getByLabel('Plan')`
resolves to this sub-group, the same accessible-name contract `SectionTitle`'s top-level sections
already offered).

**Legacy `planned` row.** Unchanged customer-facing contract from Phase 14E: the Actual section
shows "This Trade was saved before execution information was recorded." plus the
`OpenTradeDialog` trigger; a `canceled` row shows the distinct "This Trade has not been opened. No
actual execution has been recorded." — the two are never conflated, and "Planned Trade" is never
exposed as a normal, ongoing customer concept.

**Regression found and fixed during the rebuild — Actual/System dl completeness.** Rebuilding the
Actual and System sections from scratch (rather than moving the existing JSX verbatim) initially
dropped three previously-always-present facts: an unconditional **Actual R** row (truthfully "Not
available" for any Open Trade, even with zero Exits — CLAUDE.md §6's "never a blank, never a
silent 0"), the paired **Trader Outcome** row, and the **Closed %/Remaining %** rows once a Trade
reaches `closed` (previously shown for any Trade with recorded Exits, closed or not). All three
were restored, and the compact "result-first" hero (brief §11) now carries its own explicit label
(`Actual R`/`Realized R to date`/`System R`) beside the number, rather than an unlabeled numeral —
both for assistive tech and so the figure reads unambiguously in isolation. Every restored row was
independently confirmed against the Phase 15D-era `trade-detail.tsx` (git history) rather than
guessed.

**Accessibility regression found and fixed — Trade Detail's own name.** The rebuilt `<article>`
initially lost the `aria-labelledby="trade-detail-heading"` wiring the pre-15E component carried
(pointing at the Symbol `<h2>`), silently breaking every `getByRole('article', { name: <symbol> })`
query — including this phase's own new e2e assertions. Restored on both the `<article>`
(`trade-detail.tsx`) and the `<h2 id="trade-detail-heading">` (`trade-overview-header.tsx`);
confirmed via a real Playwright run against the canonical test database, not merely inferred.

**Terminology (EN/TH).** New keys added under `trades.detail.overview` (`actual`/`system`/
`remainingPercent`/`logged`/`checklistCount`/`viewEntrySnapshot`/`showDetails`) and
`trades.detail.nav.status` (the six section-specific status-wording overrides above), plus
`trades.lifecycle.reflection.recorded` ("Recorded" — the compact Entry Snapshot summary's word for
a non-empty Entry Reason/Chart). Thai equivalents added alongside every EN key, following this
repo's existing natural-Thai-phrasing convention (`localization-glossary.md`) rather than a literal
word-for-word gloss.

**Desktop/mobile.** Section nav wraps to a full-width vertical stack of tap targets below
`sm:`(desktop keeps a horizontal row); every nav link and the "Show full details" disclosure summary
carry `min-h-11` for touch-target compliance. No horizontal page overflow at 390px was introduced —
confirmed via the existing responsive e2e coverage plus manual review of every new component's
Tailwind classes (all `flex-wrap`/`grid`/`min-w-0`, matching this repo's established pattern; no
fixed-width element was added).

**Testing.** `lib/trades/section.test.ts`: `DEFAULT_TRADE_DETAIL_SECTION` membership/value: `actual`.
`trade-section-nav.test.tsx`: fully rewritten for switcher behavior — only the active section's
body renders, default-section fallback for an absent/invalid `?section=`, href-building preserves
existing query params, `aria-current` on the active item only, per-section status-label overrides.
`trade-detail.test.tsx`: fully rewritten (every case now navigates to the section under test via
the `?section=` mock, since only one section renders per pass) — 24 tests, including a new `action
colocation` describe block confirming Actual/System/Strategy actions render only on their own
section and never leak into another's, and that Trade-level Identity/Delete/Cancel controls render
on Trade Overview regardless of the active section. Full project suite: **2002 passed, 0 failed,
0 skipped** (`npx vitest run`, 140 files) — no regression in any other feature area.
`npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`, `npx drizzle-kit check` (`Everything's
fine`), and `npx next build` all pass clean; `git status`/`git diff --check` confirm no migration
was touched and no whitespace errors.

E2E (`e2e/trades.spec.ts`, 22 tests) updated throughout for one-section-at-a-time navigation
(`openTradeSection`/`expandEntrySnapshotDetails` helpers added) and run five times against the
canonical test PostgreSQL database (chromium project) while iterating to a clean pass, plus once
against `mobile-chrome` (390px). Failures found and their classification:

- **Phase 15E regression (fixed):** the rebuilt `<article>` lost its `aria-labelledby` wiring to
  the Symbol `<h2>` (documented above) — broke every `getByRole('article', { name: <symbol> })`
  query across ~10 of this file's own tests. Fixed in `trade-detail.tsx`/`trade-overview-header.tsx`.
- **Phase 15E regression (fixed):** several R-values and outcome badges now legitimately render
  twice per page — once in Trade Overview's always-visible hero, once in the active section's own
  compact hero or full-detail row (an intentional summary/full-detail split, not a bug) — causing
  Playwright strict-mode "resolved to 2 elements" failures on assertions written when the page had
  only one copy of each fact. Every such assertion was updated to `.first()`/`.last()`, each with an
  inline comment naming the two legitimate locations.
- **Pre-existing test defect (fixed, not a 15E regression):** a "Close Remaining" button's text
  contains the substring "Remaining", colliding with the `Remaining` field label — confirmed via
  `git show` that this exact collision existed in the pre-15E component too; the assertion was
  fixed to `.last()`, the DOM-order-later of the two.
- **Pre-existing test defect (fixed, not a 15E regression):** the "confirms unmet Conditions..."
  and "Phase 14C/14E — minimal New Trade..." tests asserted a heading named "Setup Conditions" that
  never matched the real, unchanged-since-before-15E heading text "Setup Checklist" — confirmed via
  `git show` on the pre-15E component. Fixed to the correct text.
- **Pre-existing/genuine regression found and fixed in application code, not the test:** rebuilding
  Actual/System from scratch (§ above) initially dropped the always-present "Actual R"/"Trader
  outcome"/Closed-%/Remaining-% facts for an Open Trade — restored in `trade-actual-section.tsx`.
- **Environment/infrastructure flake (not a regression, did not reproduce on re-run):** one run
  saw the "walks one Trade through create..." test fail with the New Trade form not redirecting
  after submission — re-ran in isolation twice and it passed both times once the genuine
  strict-mode issue above (in the same test) was fixed; not reproducible. One run of the unrelated
  Confidence-pill-drag suite (New Trade form, untouched by this phase) saw one pointer-simulation
  test fail once and pass on every other run — a known category of flake for synthetic
  mouse-drag gestures in headless Chromium, unrelated to Trade Detail.

**Final confirmed state:** chromium project — **19 passed, 0 failed, 4 skipped** (the 4 being
`mobile-chrome`-gated tests, correctly skipped on desktop). `mobile-chrome` project (390px) — **5
passed, 0 failed, 18 skipped** (the 18 being `chromium`-gated tests, correctly skipped on mobile).
320px was not separately re-verified in this phase (no new fixed-width elements were introduced;
existing 390px coverage plus the desktop responsive sweep's Tailwind-class review stand in for it,
consistent with this phase's "no horizontal overflow" review method above).

**Trade Log / Calendar:** untouched, as instructed — no file under `components/trades/trade-log*`,
`trading-calendar*`, or the Trade Log/Calendar route was modified. **Analytics:** untouched — no
calculation, DAL, or Analytics UI file was modified. **Migrations:** none created; schema
unchanged (`drizzle-kit check` confirms `0000`–`0016` only).

**Founder-UAT open question carried forward:** whether Planned R's promotion into Entry Snapshot's
always-visible summary (rather than the disclosure) is the right call, or whether a future
Founder-UAT pass prefers it surfaced even higher (e.g., a fourth Trade Overview hero metric) —
recorded here as a build-time judgment call, not a locked decision.

---

## 58. Phase 15F — Trade Log Simplification & Deep Action Workflow (as built)

**Scope and baseline.** Phase 15F changes only the Trade Log presentation, its Calendar/Log visual
boundary, localized row copy, tests, and this documentation. HEAD at preflight was `38406d9`
(`feat(journal): redesign trade detail as step workspace`) on
`feature/trade-plan-ux-uat`, with a clean worktree. Migrations remain exactly `0000`–`0016`; no
`0017`, schema, server action, DAL, calculation, Analytics, Trading Calendar semantics, or Trade
Detail architecture is changed.

**Final first-layer contract.** Each Trade is one semantic compact record, not separate desktop
and mobile copies. The scan order is Symbol + explicit Direction, one journal timestamp + quiet
Trading Account, Actual state/result, System state/result, Strategy, then at most one attention
message/action. Open uses the shared blue `active` vocabulary; Closed and Resolved use shared
`complete`; pending/legacy actionable work uses shared amber `needs_attention`; No Trade,
Canceled, and Not assigned remain neutral. Positive/negative R uses performance colors, with
negative using the `negative` token rather than the error/destructive token.

Actual presentation is truthful by lifecycle: Closed shows final Actual R; Open with no Exit shows
only Open; partial Open remains backend `open` and shows Remaining % plus Realized R to date;
legacy `planned` reads “Needs execution details”; Canceled is neutral. Planned R is never used as a
first-layer fallback. System independently shows Pending, Resolved + System R, or No Trade. Outcome
words are Detail-only because R is the more useful first-layer result.

**Classification/account/date decisions.** Strategy name stays first-layer and optional absence is
neutral “Not assigned.” Setup is Detail-only: showing Strategy + Setup/version/checklist in every
record was the largest classification-density source, and long EN/TH names need room to wrap.
Setup history and archived state remain intact in Trade Detail. Trading Account stays as receded
metadata because this page has no selected-account filter that otherwise establishes context;
archived Account and Strategy labels remain disclosed. Exactly one canonical journal timestamp
(`coalesce(exited_at, entered_at, created_at)`) is shown; full lifecycle timestamps stay in Detail.

**Attention priority and actions.** The deterministic writable priority is (1) legacy execution
details → `section=actual`, (2) pending System outcome → `section=system`, (3) unassigned Strategy
→ `section=strategy`. Review is not surfaced. If no attention exists, the footer offers the
general Open Trade navigation and defaults to Actual by omitting `section`. The Symbol link is
also a general Open action. Read-only/over-limit users get non-mutating View Actual/View System
deep links for load-bearing legacy/pending states, never mutation wording; unassigned Strategy
remains neutral. URLs only navigate and never mutate. Existing server actions remain the write
boundary.

All links reuse the Phase 15B/15E `trade=<id>&section=<canonical-section>` contract, preserve the
localized pathname and existing month/date/cursor query parameters, and remain reload/back/forward
safe. General navigation clears a stale `section`; pagination preserves Calendar queries while
clearing selected Trade/section. There are no nested interactive elements: a semantic `article`
and labelled `listitem` contains separate keyboard-focusable Symbol and action links.

**Calendar, filtering, and responsive composition.** A border, whitespace, “Trade Log” heading,
and selected-day explanation create a clear boundary below the unchanged Calendar card. Calendar
axis semantics and selected-day journal chronology remain independent. No filters were added;
existing month/date selection, cursor pagination, ordering, and limits remain unchanged. A single
responsive record replaces the duplicated table/mobile DOM: three summary columns on wider
screens and a compact stacked layout below `sm`, with `min-w-0`, wrapping, and no fixed row width.
The mobile e2e covers 390px English and an explicit 320px Thai overflow/action smoke.

### 58.1 Complete field relocation map

| Previously rendered Log field                               | Phase 15F placement                               |
| ----------------------------------------------------------- | ------------------------------------------------- |
| Symbol                                                      | First layer, primary identity/general Detail link |
| Direction                                                   | First layer, explicit text (not color-only)       |
| Journal date/time                                           | First layer, one canonical chronology timestamp   |
| Trading Account name + archived                             | Secondary first-layer metadata                    |
| Actual lifecycle status                                     | First layer                                       |
| Final Actual R                                              | First layer for Closed only                       |
| Remaining % + Realized R                                    | First layer for partial Open only                 |
| Planned R fallback                                          | Removed from Log; Entry Snapshot Detail-only      |
| Trader Win/Loss/Break even                                  | Detail-only                                       |
| System status                                               | First layer                                       |
| System R                                                    | First layer for Resolved only                     |
| System Win/Loss/Break even                                  | Detail-only                                       |
| Strategy name + archived                                    | First layer; neutral Not assigned when absent     |
| Setup name + archived                                       | Detail-only, Strategy & Setup / Entry Snapshot    |
| Strategy version number                                     | Detail-only                                       |
| Setup Checklist met/total                                   | Detail-only, Entry Snapshot                       |
| Confidence, Emotions, Entry Reason/Chart, Plan prices/money | Already Detail-only; explicitly absent from Log   |
| Rules, Mistakes, Review notes/completeness                  | Already Detail-only, Review → Trade Management    |

No data is deleted; “removed” above means removed from the Log display only.

### 58.2 Complete action relocation map

| Action                              | Phase 15F destination                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Symbol/general Open Trade           | Detail default Actual (no `section`)                                          |
| Legacy Add execution details & Open | Detail `section=actual`; navigation performs no mutation                      |
| Update pending System outcome       | Detail `section=system`                                                       |
| Add Strategy                        | Detail `section=strategy`                                                     |
| Review                              | Not surfaced in Log; Detail `section=review` remains available in section nav |
| Duplicate whole-row anchor          | Removed to avoid nested link/button invalidity                                |
| Previous/Next pagination            | Preserved; next keeps month/date and removes selected Trade state             |

**Testing contract.** Component coverage enumerates Closed, Open, partial Open, Pending, Resolved,
No Trade, legacy planned, unassigned Strategy, Strategy-only first-layer behavior, archived
Account/Strategy, writable, read-only/over-limit-shaped presentation, performance colors,
attention priority, canonical deep links/query preservation, pagination, and the absence of Setup,
version, checklist, outcomes, Planned R, Confidence, Emotion, Entry Reason, Rules, and Mistakes.
The real-DB Trade E2E now drives Calendar → selected-day Log → Add Strategy/System Update direct
links, proves the selected section, completes and saves a System resolution, reloads it, and uses
browser Back naturally. Mobile drives the System deep action at 390px and checks English 390px plus
Thai 320px page overflow.

Final verification on 2026-08-22: focused Trade Log/Calendar/section navigation **25 passed**;
full Vitest **140 files, 2002 passed**; ESLint, TypeScript, Prettier check, `drizzle-kit check`,
production `next build`, and `git diff --check` pass. Guarded disposable-PostgreSQL desktop direct
workflow **2/2 passed** and mobile 390/320 workflow **2/2 passed** (each count includes the auth
setup). The final parallel full Trades run reported **22 passed, 22 intentionally project-gated
skipped, 1 failed**: the pre-existing full-journey New Trade redirect flake already documented in
§57 reproduced under 10 workers. Its isolated real-DB rerun passed together with the other updated
desktop regression (**3/3 passed**). No server/DAL/domain file changed, so a new PG integration
regression beyond the real-DB Trades journeys is not applicable.

**Performance/server impact.** Query count and network behavior are unchanged: the same single
`listWorkspaceTrades` composition and its existing batched Exit/Setup-Condition reads are used;
there is no per-record request and no new derived query. Some already-fetched values are simply no
longer rendered. Cursor pagination remains capped at the existing 25/default and 50/maximum.

### 58.3 Founder UAT questions and Phase 15G plan

Founder UAT should use real representative data at desktop 1440px, mobile 390px, and narrow 320px
in both EN/TH where useful:

1. Can the Founder answer symbol/direction, Open vs Closed, Actual R, System state/R, Strategy, and
   the one next action without reading every line?
2. Is Setup correctly Detail-only, or is it essential enough in the Founder’s routine to justify
   more row density?
3. Is the quiet Account line sufficient for multi-account use, including archived history?
4. Does legacy → Actual, pending System → System, and Add Strategy → Strategy feel like one-click
   work, with Back returning naturally to the same selected Calendar day?
5. Are open records easy enough to find without making Closed history too faint?
6. Do long Thai labels, long symbols, and long Strategy names remain scannable at 320/390px?
7. Does the Calendar/Trade Log boundary solve the “one giant scroll” concern without needing a new
   route?

Phase 15G must be UAT only: provision representative rows for every Phase 15F state, run the seven
questions above with the Founder, record pass/fail and requested copy/density adjustments, fix only
accepted UAT defects without changing domain semantics, rerun focused/full regression in proportion
to any fixes, and mark Phase 15G complete only after explicit Founder acceptance. Do not infer
acceptance from test results.

## 59. Phase 15G.5A — Recording Model Domain & Service Foundation (as built)

This slice changes the server contract only. It does not build the At Entry / After Trade UI,
completed-Trade creation, Trade Detail relocation, or Analytics redesign, and it adds no migration.
The migration ledger remains `0000`–`0016`.

**Recording timing.** Canonical create input now carries `recordingTiming: 'at_entry' |
'after_trade'`. The existing create service accepts only `at_entry`; `after_trade` returns the typed,
public-safe `completed_trade_path_required` result and never creates an intermediate Open row. The
later completed-create service must reuse the internal `createTradeInTx` primitive inside one outer
transaction rather than chaining public mutations.

**System Plan authority.** Canonical new writes with Plan data carry `systemPlanBasis: 'price' |
'money'`; the value is not persisted. Price authority persists only `planned_entry`, `planned_stop`,
optional `planned_target`, and optional `planned_position_size`. Money authority persists only
`planned_risk_minor` and optional `planned_reward_minor`. Cross-basis fields and dual input are
rejected, never silently discarded. `planned_r` is composed only from the one surviving
representation; a missing Price Target or Money Reward truthfully leaves it null.

Historical rows containing both representations remain readable and unchanged. System resolution
retains its historical Price precedence whenever complete Price Entry/Stop geometry exists. This is
legacy compatibility only: canonical create and correction paths cannot produce a new dual row.

**At Entry opening basis.** If the caller omits an Advanced Actual override, a Price Plan explicitly
defaults Actual to Price with `actual_entry = planned_entry` and `actual_initial_stop = planned_stop`;
a Money Plan defaults Actual to Money with `actual_initial_risk_minor = planned_risk_minor`. These
are copies into physically separate Actual columns. A caller may explicitly choose the other Actual
basis, so Price/Price, Price/Money, Money/Money, and Money/Price are all supported. Creation remains
Open with System Pending and no final Actual R, Trader Outcome, exit time, System R, or Execution
Gap. Existing Actual formulas, derived outcome tolerance, and mode immutability after the first Exit
are unchanged.

**Plan correction.** Editing within the current canonical basis may omit `systemPlanBasis`.
Switching basis requires it explicitly: Price → Money clears all Price Plan columns (including
position size) in the same mutation; Money → Price clears both Money columns. Plan correction never
changes Actual execution fields, and Actual correction never changes Plan fields. A historical dual
row can still follow the compatibility correction path; supplying an explicit basis canonicalizes
it deliberately.

**Temporal contract for 15G.5B.** The reusable validator accepts
`enteredAt <= exitedAt <= serviceClock`; equality is valid. The derived retrospective marker is
`createdAt.getTime() > exitedAt.getTime()` for finalized Trades. JavaScript `Date` and the strict
input parser expose milliseconds while PostgreSQL can retain finer timestamp precision, so equality
is conservatively **not provably retrospective**. Only a created time at least one observable
millisecond later returns true. This is a Trade-level timing signal, not per-field provenance;
future After Trade entry-context data may be stored and labeled retrospective but must not be
treated as genuinely captured at entry.

Authorization, workspace scoping, membership, `ordinary_write` entitlement behavior, account and
classification/version constraints, mutation-key replay ordering, snapshots, audit logging, Actual
R, System R, Execution Gap, and derived outcomes are unchanged. After Trade creation and Founder
UAT acceptance are explicitly not implemented by 15G.5A.

## 60. Phase 15G.5B — Atomic Completed-Trade Creation Foundation (as built)

This server-only slice adds the strict `createCompletedTradeAction` and dedicated
`createCompletedTrade` service. It adds no UI, Analytics work, or database migration; the migration
ledger remains `0000`–`0016`.

**One atomic lifecycle.** A completed write carries `recordingTiming: 'after_trade'`, one explicit
System Plan basis, one independent Actual Result basis, `enteredAt`, `exitedAt`, and one or more
Actual Exit legs whose coverage totals exactly 10,000 bps. The service reuses `createTradeInTx`, the
canonical Exit aggregation primitive, and the canonical System resolution primitive beneath one
outer transaction. The temporary Open state is transaction-internal only: success exposes a Closed
Trade with final Actual R and Trader Outcome; any later validation, Exit, System, Setup snapshot,
authorization, or database failure rolls the whole graph back.

Price and Money remain independent authorities. All Price/Price, Price/Money, Money/Price, and
Money/Money Plan/Actual combinations are supported without copying Plan facts into Actual facts.
Price Actual requires Entry, Initial Stop, and priced Exit legs. Money Actual requires Initial Risk
and realized-P&L Exit legs. Partial exits use the same exact 10,000-bps coverage and existing
weighted aggregation/close formulas as ordinary execution mutations. Zero-duration Trades are
valid; all completion times must be no later than the service clock. The final persisted
`exited_at` is the supplied chronological completion time, and retrospective recording is still
derived by the 15G.5A millisecond rule rather than a new column.

**System and replay.** Omitting `systemResult` leaves System Pending. A completed write may instead
atomically resolve the canonical Price or Money target/stop/break-even/custom outcome, or mark
System `no_trade`; no special Execution Gap path exists. One caller-owned mutation key identifies
the entire operation, while Exit mutation keys are generated internally. Exact replay returns the
already-finalized Trade without duplicating Trade, Exit, snapshot, emotion, System, or audit rows;
a collision with a non-finalized lifecycle returns `completed_trade_replay_conflict`.

**Context and audit truthfulness.** Strategy remains optional and Setup still requires Strategy.
Setup Conditions, confidence, emotions, notes, confirmation context, and chart attachment retain
their existing storage and validation semantics. Because this is retrospective input, none is
described as captured at entry. The operation emits one top-level `trade.created` event only after
the full graph succeeds, with structural `recordingTiming`, final Trader/System status, and Exit
count metadata; it deliberately suppresses misleading intermediate `exit_added`, `open`, `closed`,
and System lifecycle events.

Review notes, Rule-check edits, and Mistake attachment are deliberately deferred from the atomic
completed-create contract. Their current public services own separate transactions, and extracting
them would enlarge this foundation beyond its required creation graph. Existing At Entry behavior
is unchanged.

## 61. Phase 15G.5C — Retrospective Behavioral Analytics Truth (as built)

This slice aligns behavioral analytics with the frozen recording model. It adds no new At Entry or
After Trade UI, no Analytics surface redesign, no formula changes, and no database migration. The
migration ledger remains `0000`–`0016`; Phase 15G Founder UAT remains open.

**Frozen temporal rule.** A finalized Trade is proven retrospective only when `created_at >
exited_at` at JavaScript millisecond precision. Equality is not retrospective, a timestamp that is
later only in PostgreSQL microseconds is not provably retrospective, and an Open Trade with null
`exited_at` is not retrospective. The reusable application helper compares `Date#getTime()`; the
DAL predicate uses `date_trunc('milliseconds', ...)` to implement the same conservative rule before
aggregation. This remains one Trade-level marker and does not claim per-field provenance.

**Behavioral population boundary.** Proven retrospective Trades are excluded before aggregation
from exactly four entry-context dimensions, on both the Trader and System projections: Setup
Adherence, condition-level performance, Confidence Performance, and Emotion Performance. Their
stored checklist answers, confidence (including zero), selected emotions, explicit-empty emotion
marker, and never-recorded state are not deleted or rewritten and remain available in Journal
detail. Counts and sample sizes now describe only the eligible population; when no eligible sample
exists, the existing unavailable/not-recorded presentation is used rather than a fabricated zero.

**Intentionally unchanged axes.** Strategy Performance and Setup Performance continue to include
retrospective Trades because classification remains meaningful. Trader Performance remains based
on Actual completion (`exited_at`); System Performance remains based on System resolution
(`system_exited_at`); paired Execution Gap remains paired on its existing lifecycle truth. Trade
Management Rule and Mistake analytics remain unchanged. Entry Reason, chart attachment, notes, and
other Journal context still do not become analytics dimensions. No financial or outcome formula
was changed.

**Read-model disclosure.** Trade Detail now exposes `recordedRetrospectively`, derived from durable
timestamps, and shows one quiet Entry Snapshot section label when true: “Recorded retrospectively”
in English and “บันทึกย้อนหลัง” in Thai. The label is neutral, is not repeated beside individual
fields, and does not imply that every field has known provenance.

Coverage includes the pure boundary (before/equal/one millisecond after/Open), the PostgreSQL
microsecond-to-millisecond equality case, canonical At Entry and After Trade records, Resolved,
Pending, and No Trade System states, late classification, confidence zero, selected versus
explicit-empty versus never-recorded emotions, zero eligible samples, all eight affected raw
projections, the unchanged financial/classification/Trade Management populations, durable context
retention, and the Trade Detail marker/copy. No Founder acceptance or After Trade UI completion is
claimed by this section.

## 62. Phase 15G.5D — Founder Recording UX: At Entry / After Trade (as built)

The customer New Trade route now begins with the explicit, mutually exclusive “When are you
journaling?” choice and defaults to At Entry. At Entry and After Trade share Account, Symbol,
Direction, the authoritative System Plan, optional Setup classification/checklist, and optional
entry context. Each timing renders one compact panel at a time; the save CTA remains reachable from
every optional panel, and neither path is a forced wizard. English and Thai use the frozen customer
terms. Founder acceptance remains pending.

**At Entry.** The first panel is a short Trade ticket: identity, Entered At, and exactly one System
Plan basis selected by Price or Money. Switching basis clears the other representation. The normal
surface has no Actual-result selector or duplicated Actual inputs; omission of an override lets the
15G.5A service copy the selected Plan opening into Actual opening. A collapsed Advanced disclosure
retains explicit same-basis and cross-basis Actual opening overrides. Setup and Entry Context remain
optional and do not block direct Open Trade submission through the existing canonical create action.

**After Trade.** Trade captures identity, Entered/Exited timestamps, and the same exclusive System
Plan. Result separately selects the independent Actual Result basis. The simple Price path maps one
Exit Price to one 100% canonical Price Exit; the simple Money path maps Realized P&L to one 100%
canonical Money Exit without weighting the total twice. Partial exits are secondary and must total
100%. Shared calculators preview derived Actual R and Win/Loss/Break Even; the customer never
selects Trader Outcome.

System Outcome defaults to Review later, which omits `systemResult` and leaves System Pending.
Target, Stop, Break even, Custom, and No Trade map to the existing canonical completed-create
resolution shapes; Target is unavailable without the selected Plan basis's target/reward. The
browser calls `createCompletedTradeAction` exactly once and navigates directly to the resulting
Trade Detail selector. It never chains Open, Exit/Close, or Resolve mutations.

**Draft safety and retrospective truth.** Timing switches preserve shared draft data but clear
After Trade Actual/System fields. Plan and Actual basis switches clear the prior basis's fields, so
hidden stale representations are never submitted. Setup and Entry Context show one quiet
“Recorded retrospectively” / “บันทึกย้อนหลัง” section label in After Trade. The 15G.5C analytics
boundary remains authoritative; no client-side provenance inference was added.

This slice adds no schema or migration, changes no financial formula, and does not redesign Trade
Log, Analytics, or Trade Detail Plan placement. The migration ledger remains `0000`–`0016`.
