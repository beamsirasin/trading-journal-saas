# Phase 14 — Independent Trade Classification

**Depends on:** 08, 09, 13 · **Blocks:** —

**Status:** 14A (read-only audit), 14B (persistence/domain foundation), 14C (customer-facing Independent Journal UX), 14C.1 (Quick Capture Persistence Completion), and 14D (Trading Calendar + Trade Log) are all **complete**. Founder acceptance is **not yet obtained**.

---

## Goal

A trader must be able to record a Trade quickly and complete its different dimensions — Strategy/Setup classification, Actual Execution, System Outcome, Entry Snapshot, Review — at different times, without the product ever implying that an incomplete dimension makes the whole Trade invalid, wrong, or blocked. This is the same non-negotiable independence CLAUDE.md §1 establishes for System vs Trader performance, extended one layer further: classification itself is now also independent of execution.

## 14A — Audit (complete, no code changes)

A read-only audit of the pre-existing Trade lifecycle determined what would need to change to make Strategy/Setup classification optional and late-assignable. Delivered as a published report; no schema or code changes were made in this slice.

## 14B — Persistence and domain foundation (complete)

Migration `0015_independent_trade_classification.sql`:

- `trades.strategy_id`, `strategy_version_id`, `setup_id`, `setup_version_id` become nullable.
- Two new timing columns: `strategy_assigned_at`, `setup_assigned_at` — **first-assignment timing only**, never "last changed at" (deliberately asymmetric with corrigible fields like Emotions; see §8).
- Three CHECK constraints: identity/version pairing for Strategy, identity/version pairing for Setup, and `setup_requires_strategy` (a Setup can never be assigned without a Strategy). Two additional `*_assigned_at` pairing constraints were proposed and explicitly **rejected** as overreach beyond the frozen contract.

`assignTradeClassification` (`src/server/services/trade-management.ts`) is the one late-classification service call. It supports exactly three transitions and rejects everything else with `invalid_classification_request`:

- **A.** unclassified → Strategy only
- **B.** unclassified → Strategy + Setup (same submission)
- **C.** Strategy-only → + Setup

Arbitrary reclassification (changing an already-assigned Strategy or Setup, or removing one) is out of scope and not implemented.

`src/server/dal/trades.ts` reads use `LEFT JOIN` instead of `INNER JOIN` so an unclassified Trade still appears in every list/detail read.

## 14C — Independent Journal UX (complete)

### 1. Product mental model

A Trade is a set of independent areas, each with its own state: **Actual Execution**, **System Outcome**, **Strategy & Setup** (optional), **Entry Snapshot**, **Review**. There is no combined "Trade N% complete" score anywhere in the product — Trade Detail, Trade List, and the Dashboard all present each area's truth on its own terms.

### 2. Quick Capture

The create form's only UI-enforced requirements are Trading Account, Symbol, and Direction — as of 14C.1 (§7), that includes the Plan itself: a Trade may be captured with genuinely no Price and no Money representation. Strategy, Setup, Setup Conditions, Confidence, Emotions, Entry Reason, and Chart are all optional too. Selecting a Strategy never forces a Setup; selecting a Setup requires a Strategy (`setup_requires_strategy` validation, mirroring the DB constraint) but is otherwise blank-tolerant.

### 3. Capture vs Open

A Trade may be saved without enough Actual basis to Open. To Open: Price mode requires Actual Entry + Initial Stop; Money mode requires Initial Risk > 0. Strategy, Setup, Confidence, Emotions, Entry Reason, System Outcome, and Review are never required to Open.

### 4. Late classification

`AssignClassificationDialog` (`src/components/trades/trade-classification-actions.tsx`) is the one UI surface for late classification, embedded directly in Trade Detail's new "Strategy & Setup" card. It renders exactly the sanctioned transition for the Trade's current state — "Add Strategy" (optionally with a Setup in the same submission) when unclassified, "Add Setup" (Strategy picker hidden, Setup options scoped to the already-pinned Strategy) when Strategy-only. It never offers a way to construct a request outside the Phase 14B matrix.

Timing is disclosed truthfully via `ClassificationTiming`: comparing `strategy_assigned_at`/`setup_assigned_at` against `entered_at` yields "Captured at entry" or "Added after entry" — never a raw timestamp.

### 5. No retrospective Condition snapshots

Adding a Setup after entry never fabricates a Condition snapshot. If the Setup has Conditions configured but this Trade recorded none (because none were selected at creation, or because it had no Setup at creation), the Entry Snapshot's Setup Conditions sub-section reads "Not recorded" — never `0/5`, never "all unmet". This reuses the existing `setupConditionState` states from Phase 13; 14C added no new state.

### 6. Actual Execution / System Outcome independence (unchanged, reconfirmed)

Both cards already read from fully independent columns/services (Phase 13 result). 14C's contribution here is UI-level: a new `field.executionGap` row on Trade Detail's System Outcome section, rendered **only when both** `actualR` and `systemR` resolve to a final value (`executionGapR` returns non-null) — never a fake `0.00R` while one side is still pending or partial.

## 14C.1 — Quick Capture Persistence Completion (complete)

14C's audit identified one genuine blocker to the frozen Quick Capture contract ("only Account, Symbol, Direction"): `trades_plan_minimum_check` (a migration-0010 constraint, untouched by migration 0015) required at least one complete Plan representation — a Price pair (Entry + Stop) or a Money representation (Risk > 0) — at creation. 14C stopped and reported this rather than silently working around it (per the migration policy), and it was resolved in 14C.1.

**Migration `0016_optional_trade_plan.sql`** drops exactly this one constraint — a single `ALTER TABLE "trades" DROP CONSTRAINT "trades_plan_minimum_check"` statement, no column/table/data change. Nothing else needed to change:

- `trades_planned_price_shape_check` and `trades_planned_money_check` already tolerated an absent representation and still reject a malformed partial one — no edit.
- `trades_system_status_consistency_check` already requires each System resolution kind's own truthful Plan inputs independently (`price_exit` still requires `planned_entry`/`planned_stop`; the `money_*` kinds still require `planned_risk_minor`) — a System resolution attempted on a no-Plan Trade is still correctly rejected, with a friendly code (`system_requires_price_plan` for Price, `invalid_planned_risk`/`missing_input` calc reasons for Money), never fabricated.
- `trades_status_consistency_check` (Open/Close) already depended only on `actual_*` fields, never `planned_*` — Open and Close needed no change and never silently reintroduced a Plan requirement.
- `composePlannedR` already handled an entirely-absent Plan gracefully (`plannedR: null`, `source: 'none'`, `ok: true`) — no calc-engine change.
- `correctTradeIdentity` already relied on `composePlannedR`'s graceful handling and had no explicit minimum-presence check of its own.

Three enforcement layers were removed to match: the database CHECK, `CreateTradeSchema`'s Zod refine, and `createTrade`'s own defense-in-depth pre-check. `updateTradePlan`'s own, separate, narrower floor — a Trade already under active Plan correction must not be edited down to zero representations — was deliberately left untouched; it was never expressible as a pure Zod shape rule and remains a distinct business decision from Quick Capture's own contract.

### 8. Entry-time truth audit (§21)

Audited every editable Entry Snapshot field for whether a later edit can silently erase what was true at entry:

| Field                    | Editable after entry?                                                                                      | Temporal-truth risk                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup Conditions         | No — insert-once, DB-rejected on UPDATE/DELETE (proven by `setup-condition-snapshots.integration.test.ts`) | None. Fully immutable.                                                                                                                                                                                                                                             |
| Confidence, Entry Reason | Yes, via `updateTradePlan` at any lifecycle stage (CLAUDE.md A7)                                           | **Pre-existing gap, not introduced by 14C:** no timestamp distinguishes "set at entry" from "edited later" — the UI shows only the current value.                                                                                                                  |
| Emotions                 | Yes, via `replaceTradeEmotions`                                                                            | `emotions_recorded_at` is overwritten on every correction (unlike `strategy_assigned_at`/`setup_assigned_at`, which record first-assignment only), so it cannot distinguish original entry-time recording from a later correction — only "ever recorded" vs never. |

No code change was made for this finding — CLAUDE.md's own guidance ("don't overbuild event sourcing") and this phase's scope both counsel against adding new correction-history columns speculatively. Recorded here as an explicit, carried-forward risk for a future phase to decide on, not a silent gap.

### 9. Needs Attention (Dashboard)

`NeedsAttentionPanel` (`src/components/dashboard/real-dashboard.tsx`) is a compact, purely informational widget — never a forced task list, never a completeness score. Renders nothing when every count is zero. Four counts, each with one explicit, tested definition (`getWorkspaceTradeAttentionCounts`, `src/server/dal/trades.ts`):

- **Open Trades** — `status = 'open'`
- **Pending System Outcomes** — `system_status = 'pending'`
- **Unclassified Trades** — `strategy_id IS NULL`
- **Reviews Pending** — `status = 'closed' AND review_notes IS NULL`

"Reviews Pending" specifically: Execution Rules and Mistakes are multi-row with no natural single "reviewed" bit, so `review_notes` (a field a trader deliberately writes once) is the one explicit, testable proxy. This is a deliberate simplification, not a claim that Rules/Mistakes review status is tracked.

### 10. Analytics completeness disclosure (§19)

`getSystemPendingCount` (`src/server/dal/analytics.ts`) is deliberately **not** date-bounded — it answers "how many pending in this Account/Strategy/Setup scope," not "how many within this date range," because a pending Trade has no `system_exited_at` to bound it by. It respects the Account/Strategy/Setup filters every other analytics projection does. The System `PerformancePanel` renders a compact `"N resolved · M pending System outcomes [Review pending]"` disclosure whenever `pendingCount > 0`. No existing formula, denominator, or eligibility rule changed — this is presentation-only.

### 11. No-Strategy analytics (§20)

An unclassified Trade remains fully eligible for global Trader/System/paired Execution Gap metrics (these were already independent of classification since Phase 13) but contributes to no Strategy/Setup breakdown row until classified. After late classification, global metrics are unchanged (same Trade, same values) and the relevant breakdown row gains it. Verified at the DAL/integration level; not independently re-verified via a dedicated E2E breakdown assertion (see §12's E2E note).

### 12. Testing

- **Unit/component:** `trade-plan-validation.test.ts`, `trade-create-form.test.tsx`, `trade-classification-actions.test.tsx` (new), `trade-detail.test.tsx`, `real-dashboard.test.tsx`, `analytics-page.test.tsx`, `metrics.test.ts`, `schemas.test.ts`.
- **DAL/service integration (real Postgres):** `trades.integration.test.ts` (`getWorkspaceTradeAttentionCounts`), `analytics.integration.test.ts` (`getSystemPendingCount`), `trade-management.integration.test.ts` (no-Plan `createTrade`/Open/Close/System-resolution-rejection, 14C.1), `trade-domain.integration.test.ts` (DB-level no-Plan acceptance), `trades.integration.test.ts` action-level (14C.1), `optional-trade-plan-migration.integration.test.ts` (new — migration 0016's own integrity, mirroring migration 0010's own test file's structure), `trade-plan-price-money-confidence-migration.integration.test.ts` (updated — the live-database constraint-existence assertion now correctly expects `trades_plan_minimum_check` absent).
- **E2E (production build, `e2e/trades.spec.ts`):** one desktop Chromium journey combining Quick Capture (genuinely no Plan and no Strategy/Setup, 14C.1) → List/Detail truthfulness → Actual-first Open (with its own Actual Entry/Stop, since there is no Plan to fall back to) and close with System left Pending → Analytics pending disclosure → late classification (Strategy + Setup together) → "Added after entry" disclosure → "Not recorded" Conditions (no retrospective fabrication); one mobile-chrome (390px) journey covering the same no-Plan Quick Capture, late-classification dialog, and the Needs Attention widget with no horizontal overflow. The existing "walks one Trade through create, open, partial close, independent System resolve..." journey already covers the System-first ordering (Open → Partial Close → System resolves → Actual still partial) end to end, so it was not duplicated.

### 13. Out of scope (unchanged from the working brief)

Arbitrary/unrestricted reclassification. Discipline Score or any combined completeness/discipline metric. Analytics architecture redesign.

## 14D — Trading Calendar + Trade Log (complete)

`/app/trades` is now **Trading Calendar + Trade Log**, in that order, on the one existing route — no separate `/trades/calendar` page. The Calendar is a **Journal navigation surface**, not another Analytics page: it deliberately omits Expectancy, Profit Factor, Max Drawdown, and every other Analytics KPI (`src/components/trades/trading-calendar.tsx`'s own doc comment states this explicitly).

**Independent Trader/System date axes (the load-bearing rule):** the Calendar's `[Trader] [System]` toggle changes which axis's day buckets the grid displays — Trader sums finalized `actual_r` grouped by the LOCAL calendar day of `exited_at`; System sums resolved `system_r` grouped by the local day of `system_exited_at` — mirroring `src/server/dal/analytics.ts`'s `dateConditions` precedent exactly (never the same column for both, never forced intersection). A Trade whose Actual finalizes one day and whose System resolves a different day appears on BOTH days independently, never collapsed onto one (`getWorkspaceTradeCalendarMonth`, `src/server/dal/trade-calendar.ts`, integration-tested directly for this). A day with no finalized result on the selected axis shows no R at all — never a fabricated `0R`.

**Trade Log filtering is deliberately axis-independent:** selecting a Calendar day filters the Log by the SAME journal-chronology date every other Trade List view already uses — `coalesce(exited_at, entered_at, created_at)` (`occurredAtExpr`, exported from `src/server/dal/trades.ts`, reused by `trade-calendar.ts` rather than duplicated). Toggling Trader/System never changes which Trades the Log shows for a selected day — only which R value the Calendar cell above displays.

**Selected-day summary** (`getWorkspaceTradeDaySummary`) shows Actual R and System R independently (each computed from its own axis's date, so a System result resolved on a different day never counts toward the selected day's System R line) plus `trades`/`open`/`pendingSystem`/`unclassified` counts, all computed over the SAME journal-chronology population the Log itself shows — one consistent story, not four different populations. Daily Execution Gap was **deliberately omitted**: the brief's own instruction ("if semantics become ambiguous, OMIT daily Gap rather than lying") applied directly once Trade C's cross-date case is possible — a single day's paired population is frequently empty or ill-defined when Actual/System dates differ.

**Month bounds** use a new `monthRangeIn` primitive (`src/lib/time/convert.ts`) composed from the existing `startOfDayIn` exactly the way `dayRangeIn` already does — Analytics had no month primitive of its own (only relative day-count presets), so this was net-new, not a repurposed existing helper. Verified against real DST transitions and the Asia/Bangkok midnight boundary specifically (23:59 vs 00:01 local bucket into different days despite an identical UTC calendar date).

**URL state:** `?month=YYYY-MM&date=YYYY-MM-DD` on the existing `/app/trades` route, composing with the pre-existing `?trade=`/`?cursor=` params. An invalid or out-of-range `month`/`date` value falls back to the current local month / no selection, never a crash.

**No migration was needed** — every field the Calendar reads (`exited_at`, `system_exited_at`, `actual_r`, `system_r`, `status`, `system_status`, `strategy_id`) already existed from Phase 07/13/14B. Migrations remain exactly `0000`–`0016`.

### 15. Founder acceptance

Not obtained. This document records engineering completion of the scoped work, not product sign-off.
