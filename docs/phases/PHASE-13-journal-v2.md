# Phase 13 — Journal V2

**Depends on:** 08, 09 · **Blocks:** 13B–13I

**Status:** 13A–13D are **complete**. Migration `0011_setup_conditions_domain.sql` implements Setup Conditions; 13C replaced the retired wizard with the single-page Journal Entry; migration `0012_emotions_and_review.sql` implements canonical Emotions, atomic Entry capture/correction, and the distinct Post-Trade Review field. 13E–13I have not started.

This document supersedes the exploratory _Journal V2 Gap Audit_ (2026-08-15, unpublished research artifact) wherever the two disagree. The audit is accepted as research; several of its recommendations are corrected below after Founder review. Every correction is called out explicitly, with the reason, so implementers don't silently reintroduce the audit's original (superseded) framing.

---

## Goal

Let a trader capture a complete trading idea — Setup quality, Confidence, Emotion, execution, and result — as naturally as writing a journal entry, without corrupting the product's one non-negotiable invariant: **System performance and Trader performance are independent, separately-eligible populations, and neither may be inferred from the other** (CLAUDE.md §1, §4, §6). Every schema and formula decision below is subordinate to that invariant.

## Scope of 13A

13A freezes the contract that 13B–13I implement against. It resolves, with source-verified evidence, exactly what the current codebase does, what must change, and what the smallest correct change is — so implementation phases can proceed without re-litigating product decisions mid-slice.

---

## 1. Execution Gap — corrected sign

**Locked formula:** `Execution Gap = Actual R − System R`.

- System +5R, Actual −0.5R → Execution Gap = **−5.5R**.
- Negative = the trader captured less than the System. Positive = the trader outperformed the System.

This is the **opposite sign** of the current `edgeLeakageR = systemR − actualR` runtime (`src/lib/calc/attribution.ts:60-71`, whose doc comment says positive means the Trader captured less R). Before this freeze, that legacy convention also appeared in `CLAUDE.md` §6; 13A resolves the authority conflict there with an explicit supersession/runtime note. The old runtime convention is not preserved as the product contract merely because it exists — the implementation sign flips in 13H.

### Exact future runtime impact audit (source-verified)

No DB migration is needed for the Gap itself — confirmed by inspection: `edgeLeakageR`/`pairedEdgeLeakageR` are pure functions computed at read time from already-persisted `actual_r`/`system_r` columns (`metrics.ts:234-238` passes already-fetched record values in); nothing about a sign flip touches storage.

| Layer                    | File                                                                                                                                                                                        | Change required                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calc                     | `src/lib/calc/attribution.ts`                                                                                                                                                               | `edgeLeakageR`/`pairedEdgeLeakageR` bodies negate (`actual − system` instead of `system − actual`); doc comments rewritten                                                                                                                                                                                  |
| Calc tests               | `src/lib/calc/attribution.test.ts`                                                                                                                                                          | Every sign-specific assertion flips                                                                                                                                                                                                                                                                         |
| Analytics composition    | `src/lib/analytics/metrics.ts:207,228,237`                                                                                                                                                  | Field carries the new sign through unchanged code — **rename is recommended, see below**                                                                                                                                                                                                                    |
| Analytics tests          | `src/lib/analytics/metrics.test.ts`                                                                                                                                                         | Sign-specific assertions flip                                                                                                                                                                                                                                                                               |
| Integration tests        | `src/server/services/analytics.integration.test.ts`                                                                                                                                         | Sign-specific assertions flip                                                                                                                                                                                                                                                                               |
| UI — analytics           | `src/components/analytics/comparison-panel.tsx`                                                                                                                                             | Consumes the value under `forceNeutral` styling; label + help text rewritten                                                                                                                                                                                                                                |
| UI — dashboard           | `src/components/dashboard/real-dashboard.tsx`                                                                                                                                               | Same `forceNeutral` pattern, `DashboardMetric`                                                                                                                                                                                                                                                              |
| UI — dashboard           | `src/components/dashboard/mistake-summary.tsx`                                                                                                                                              | Caption interpolation (`t('caption', { edgeLeakage })`) — wording depends on sign, review                                                                                                                                                                                                                   |
| UI — marketing           | `src/components/marketing/product-preview.tsx`                                                                                                                                              | Static `KpiCard` with `tone="warning"` and a static hint string — both assume the old sign's "positive is the normal/bad case" framing                                                                                                                                                                      |
| UI — marketing           | `src/components/marketing/attribution-section.tsx`                                                                                                                                          | Conceptual copy about the metric — review for sign-dependent wording                                                                                                                                                                                                                                        |
| Demo fixtures            | `src/lib/demo/fixtures.ts`                                                                                                                                                                  | Doc comment invariant `edgeLeakageR === systemTotalR − actualTotalR` (line 16) must flip; the three seeded values (`'27.9'`, `'19.3'`, `'8.4'`, all currently positive under system-outperformed-actual scenarios) become **negative** under the new sign, since these fixtures encode "system beat actual" |
| Demo fixtures            | `src/lib/demo/types.ts`                                                                                                                                                                     | Type/comment reference                                                                                                                                                                                                                                                                                      |
| Demo tests               | `src/lib/demo/fixtures.test.ts`, `src/components/dashboard/demo-dashboard.test.tsx`, `src/components/dashboard/real-dashboard.test.tsx`, `src/components/analytics/analytics-page.test.tsx` | Sign-specific assertions                                                                                                                                                                                                                                                                                    |
| E2E                      | `e2e/demo-dashboard.spec.ts`                                                                                                                                                                | Asserts on rendered demo copy that references the value/sign                                                                                                                                                                                                                                                |
| i18n                     | `messages/en.json:132,361,421,1023`                                                                                                                                                         | Copy explicitly describes the **old** sign ("Positive means less System R was captured; negative means execution exceeded the System result") — must be rewritten to describe the new sign                                                                                                                  |
| i18n                     | `messages/th.json`                                                                                                                                                                          | Same strings, Thai locale — parallel rewrite                                                                                                                                                                                                                                                                |
| **Product constitution** | **`CLAUDE.md` §6**                                                                                                                                                                          | Updated in 13A with the authoritative `executionGapR = actualTotalR − systemTotalR` contract and an explicit note that the runtime remains on the legacy sign until the coordinated 13H correction.                                                                                                         |

**Naming recommendation:** rename the internal calculator/field from `edgeLeakageR` to `executionGapR` at the same time the sign flips, rather than keeping the old name with an inverted meaning. Same name + opposite meaning is a strictly worse hazard for future readers/diffs than a deliberate, visible rename — a stale caller using the old sign convention would compile and silently produce inverted numbers. This is a correction to the prior audit's recommendation ("keep the internal name unchanged, only rename the customer-facing term"), made _because_ the sign itself is now changing, not merely the label.

**Secondary UX opportunity (not required for 13A, flag for 13H):** `forceNeutral` styling exists on every current display site specifically because the old sign was unintuitive (positive = bad). Under the new sign, positive = good and negative = bad — the normal convention — so `forceNeutral` could be replaced with standard sign-coloring in the Analytics extension phase. Not part of this freeze; noted so 13H doesn't miss it.

---

## 2. Money-only System Performance

**Corrected finding:** the prior audit's acceptance of "Money-only cannot produce System Performance" as a permanent limitation is wrong. Journal V2 must support System resolution with no Price plan.

### Exactly what blocks it today (source-verified)

- `systemGrossR` (`src/lib/calc/trade.ts:158-187`) computes reward via `resolvePlannedRiskContext(direction, entry, stop)`, which **requires** `plannedEntry`/`plannedStop` to build `riskPerUnit` — hard dependency on the Price plan.
- `ResolveSystemTradeSchema` (`src/lib/trades/schemas.ts:476-485`) declares `systemExitPrice: decimalField()` as a **required, non-optional** field — the Zod boundary itself cannot accept a resolution request without a price.
- The DB CHECK (`trades_system_status_consistency_check`, `drizzle/0008_trade_domain_and_discipline.sql:77-95`) does **not** reference `planned_entry`/`planned_stop` at all in its `resolved` branch — the database schema does not structurally forbid a Money-only resolution; the blocker is entirely in the calc function and the Zod boundary above it.
- `moneyPlannedR(plannedRiskMinor, plannedRewardMinor)` (`trade.ts:87-...`) already exists and already computes a Money-plan R-multiple for the **Planned** side — the missing piece is only the System-resolution path, not the underlying money-R arithmetic, which is proven and reusable.

### Locked System-R contract (both modes)

```
System Target Hit  → gross System R = +plannedR   (moneyPlannedR when no Price plan, else price-geometry plannedR)
System Stop Hit    → gross System R = −1R           (risk is 1R by definition)
System Break Even  → gross System R =  0R
Custom System Exit → gross System R = explicit user input (required, captured directly)

System R = gross System R − systemCostR   (unchanged formula, unchanged systemCostR semantics)
```

`No Trade` remains fully independent of both modes, unchanged.

### Smallest correct schema/service delta

1. **New nullable column** on `trades`: `system_gross_r_input NUMERIC(12,4)` — the direct gross-System-R value used whenever a Price plan is not being used as the resolution basis (Target Hit/Stop Hit/Break Even presets synthesize this value from the Money plan; Custom System Exit requires it as explicit trader input in _either_ mode).
2. **CHECK constraint extension** — the `resolved` branch of `trades_system_status_consistency_check` gains an OR-shape exactly mirroring the existing `trades_plan_minimum_check` precedent (Price pair OR Money risk, `0010`):
   ```
   (planned_entry IS NOT NULL AND planned_stop IS NOT NULL AND system_exit_price IS NOT NULL)
   OR
   (system_gross_r_input IS NOT NULL)
   ```
3. **Calc**: new `resolveSystemGrossR` entry point that branches — Price plan present → unchanged `systemGrossRDecimal` path (never touched); Price plan absent → returns `system_gross_r_input` directly. `systemR = grossR − systemCostR` stays the single downstream formula regardless of which branch produced `grossR`.
4. **Zod**: `ResolveSystemTradeSchema` becomes a discriminated union (`mode: 'price' | 'gross_r'`), each branch requiring its own fields; server-side refinement rejects `mode: 'price'` when the trade has no Price plan and rejects `mode: 'gross_r'` when a Price plan exists and the canonical path (below) is being bypassed without cause.

### Canonical path when both Price and Money plans exist

**Price plan wins.** When both are present, resolution always uses the existing price-geometry path (`systemGrossRDecimal`), never `system_gross_r_input`. Reason: price geometry is a strictly more precise, direction-verified measurement (it already enforces `riskPerUnit > 0` and direction-consistent stop/target placement at the CHECK-constraint level); a coarse Money-plan R projection is a fallback for when no such precise measurement exists, not an alternative source of truth to choose between. This also means **zero behavior change for any existing or newly-created Price-plan trade** — the delta is additive, gated strictly to the Money-only case.

---

## 3. Actual Result — two genuinely independent modes

**Locked formulas:**

```
PRICE MODE:  legR = direction-aware price geometry (actual entry, exit price, actual initial stop)
             Actual R = SUM(closedFraction × legR)

MONEY MODE:  Actual R = SUM(realizedPnlMinor) / actualInitialRiskMinor
```

### Price mode — authoritative contract

Price mode requires **no monetary initial-risk input and no monetary P&L input**. The Trade requires `direction`, `actual_entry`, and `actual_initial_stop`; the Entry/Stop pair must define strictly positive direction-aware risk. Every Exit requires `closed_bps`, `exit_price`, and `exited_at` (plus optional `exit_reason`).

For each Exit, using Decimal throughout:

```
Long leg R  = (exitPrice − actualEntry) / (actualEntry − actualInitialStop)
Short leg R = (actualEntry − exitPrice) / (actualInitialStop − actualEntry)

closedFraction = closed_bps / 10000
Actual R       = SUM(closedFraction × legR)
```

The products are summed at full Decimal precision and rounded **once**, at the existing canonical four-decimal boundary, for the persisted `actual_r` final snapshot. No per-leg R is persisted. In particular, the service must **not** derive or persist `realized_pnl_minor` or `net_pnl_minor` from price geometry. A Price-mode trader can therefore record a truthful Actual result without supplying `actual_initial_risk_minor`.

Example: 50% at +2R, 25% at +4R, and 25% at +6R produces `0.50×2 + 0.25×4 + 0.25×6 = +3.5000R`.

### Money mode — authoritative contract

Money mode requires `actual_initial_risk_minor > 0`. Every Exit requires `closed_bps`, `realized_pnl_minor`, and `exited_at` (plus optional `exit_reason`); `exit_price` is optional truthful execution context.

```
Actual R = SUM(each Exit's realized_pnl_minor) / actual_initial_risk_minor
```

`realized_pnl_minor` is the complete realized monetary result attributable to that Exit leg. It is summed exactly as stored as `bigint`; it is **not multiplied by `closedFraction` again**. The single division uses Decimal and is rounded once to the canonical four-decimal `actual_r` snapshot.

### When both Price and Money representations exist

**Money-derived Actual R is authoritative for Trader Performance.** This path can represent the actual net realized result, including commissions, fees, slippage, financing, or other real-world execution effects. `actual_entry`, `actual_initial_stop`, and Exit `exit_price` values remain truthful execution context and may support a gross price-geometry view, but they do not override the Money result.

There is deliberately **no equality or mismatch invariant** between the two representations. Legitimate costs and execution effects can make them diverge. A later UI may show an optional diagnostic only when complete Price context exists, for example `money-derived Actual R − price-derived Actual R`, clearly labeled as a comparison between net realized performance and gross price geometry. That diagnostic must be derived on read, must not be persisted as a second Actual-R authority, and must never block saving, correcting, or closing a Trade.

### Persisted mode — adopted

Add a Trade-level `actual_result_mode = 'price' | 'money'` in migration slice 13E. This is preferred over inferring mode from nullable fields because it:

- gives the status and execution-shape CHECKs a stable discriminator;
- makes correction and full-recompute semantics deterministic;
- preserves the historical meaning of a result even when optional context is added later;
- lets services validate every Exit against one mode instead of guessing from whichever nullable value happens to be present.

`actual_result_mode` is null while `status='planned'` and required once a Trade is opened. Price mode requires Price inputs and forbids monetary-result authority; Money mode requires monetary inputs and may also carry optional Price context. If both complete representations are supplied, the persisted mode is `money`. The mode becomes immutable once the first Exit exists; any future mode-conversion operation would need to be an explicit audited correction that validates and recomputes the complete Exit set, and no such conversion operation is approved for Journal V2.

---

## 4. Partial Close — child model

**`trade_exits`** (new table, migration slice 13E):

| Column                           | Type                      | Notes                                                                                                                                     |
| -------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `workspace_id`, `trade_id` | uuid                      | identity/tenancy, `workspace_id` denormalized directly on the row (not join-only), matching the `trade_mistakes` tenant-scoping precedent |
| `sequence`                       | smallint                  | explicit ordering, avoids off-by-one ambiguity in UI                                                                                      |
| `closed_bps`                     | integer                   | **authoritative**, `1–10000`, `10000 = 100%`                                                                                              |
| `exit_price`                     | numeric(20,10), nullable  | required and authoritative in Price mode; optional truthful context in Money mode                                                         |
| `realized_pnl_minor`             | bigint, nullable          | required and authoritative in Money mode; null in Price mode — never fabricated from geometry                                             |
| `exit_reason`                    | text, nullable            | free-text or small enum, context only                                                                                                     |
| `exited_at`                      | timestamptz, **required** |                                                                                                                                           |
| `created_at`, `updated_at`       | timestamptz               |                                                                                                                                           |

Use a positive `sequence` with a unique `(trade_id, sequence)` constraint. Keep the same-workspace parent integrity used by existing child tables. Every row must carry at least one result representation: `exit_price` or `realized_pnl_minor`; the Trade's persisted mode decides which one is required. No stored per-leg R column is justified — the Price-mode weighted sum or Money-mode aggregate is derived with Decimal under §3.

**Invariant enforcement (implemented in 13E):** `SUM(closed_bps)` per Trade is `≤ 10000`. Every service mutation serializes through the parent Trade row and validates the complete Exit set. PostgreSQL additionally locks the parent in a row guard, rejects a cumulative over-close, validates mode/scope/immutable identity, and uses deferred constraint triggers to require `<10000` for Open and exactly `10000` for Closed. Remaining position = `10000 − SUM(closed_bps)`.

**Trade status:** a partially-exited Trade **remains `status = 'open'`** — no new persisted enum value (see §14 for the full state machine). Display surfaces realized R to date, closed %, remaining %, computed live from `trade_exits`.

**Finalization gate:** Trader outcome is not finalized, and the Trade does not enter finalized Trader-performance populations, until `SUM(closed_bps) = 10000` exactly. System outcome remains independently eligible if resolved, regardless of Actual closed fraction (§15).

### Trade-level aggregate-field semantics after V2

| Existing field              | Journal V2 semantics                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actual_entry`              | authoritative Price input in Price mode; optional truthful execution context in Money mode. When present, it must be paired with `actual_initial_stop`.                                                                                                        |
| `actual_initial_stop`       | authoritative Price denominator input in Price mode; optional truthful execution context in Money mode. It remains the stop **as first placed**, never a moved-stop value.                                                                                     |
| `actual_initial_risk_minor` | authoritative input in Money mode and strictly positive; null/not required in Price mode. Never price-derived.                                                                                                                                                 |
| `actual_exit`               | compatibility/final-close cache, not an R input: on a newly finalized Trade it mirrors the chronologically final Exit (`MAX(exited_at)`, then sequence/id tie-break) when that leg has `exit_price`; otherwise null. Historical values are preserved verbatim. |
| `net_pnl_minor`             | derived final cache of `SUM(trade_exits.realized_pnl_minor)` in Money mode; null in Price mode. Never synthesized from price geometry.                                                                                                                         |
| `actual_r`                  | mode-derived, persisted final snapshot rounded to four decimals; never client-supplied. Null until full close.                                                                                                                                                 |
| `trader_outcome`            | derived final snapshot classified from `actual_r` with the existing break-even tolerance; null until full close.                                                                                                                                               |
| `exited_at`                 | final-close lifecycle snapshot: `MAX(trade_exits.exited_at)`; null while partially open. Historical values are preserved verbatim.                                                                                                                             |

Partial-progress R, closed percentage, remaining percentage, and (for Money mode) realized P&L to date are derived from `trade_exits` on read while the Trade remains open; the terminal trade-level caches are not populated early.

### Status and DB invariants (implemented by migration 0013)

The current `trades_status_consistency_check` cannot survive unchanged because its `open` and `closed` branches require Price and Money execution simultaneously. Journal V2 needs this conceptual shape:

- **Planned:** `actual_result_mode` and every Actual execution/terminal field remain null, as today.
- **Open:** `entered_at` and `actual_result_mode` are present; terminal caches `actual_exit`, `net_pnl_minor`, `exited_at`, `actual_r`, and `trader_outcome` remain null; cumulative `closed_bps` is from 0 through 9999; and the row has either (mode `price` + a direction-valid `actual_entry`/`actual_initial_stop` pair + null `actual_initial_risk_minor`) or (mode `money` + `actual_initial_risk_minor > 0` + an optional all-or-nothing direction-valid Price pair). Any existing Exit rows must already satisfy the selected mode's leg shape.
- **Closed:** cumulative `closed_bps = 10000`; `entered_at`, `actual_result_mode`, `actual_r`, `trader_outcome`, and `exited_at` are present; and one of the following mode shapes is valid:
  - **Price shape:** mode is `price`; `actual_entry` and `actual_initial_stop` are present and direction-valid; `actual_initial_risk_minor` and `net_pnl_minor` are null; every Exit has `exit_price` and no fabricated `realized_pnl_minor`; `actual_exit` mirrors the final closing leg's price.
  - **Money shape:** mode is `money`; `actual_initial_risk_minor > 0`; every Exit has `realized_pnl_minor`; `net_pnl_minor` equals their exact sum; Price context is optional, but `actual_entry`/`actual_initial_stop` must be both absent or a complete direction-valid pair. `actual_exit` is nullable when the final closing leg has no price.
- **Canceled:** keep the existing compatibility posture; the service still permits only `planned → canceled`, and the DB branch is not tightened in this freeze.

Migration 0013 implements the mode enum and row-local nullability/pairing, positivity, and direction CHECKs. Exit uniqueness, scope, mode shape, immutable identity, cumulative bps, mode immutability after the first Exit, and status/Exit-total consistency are database-backed; services still recompute all read/final aggregates under the parent lock.

---

## 5. Setup Conditions — simplified to two tables

**Corrected finding:** the three-table model in the prior audit (`setup_conditions` identity + `setup_condition_versions` + `trade_setup_condition_checks`) is unnecessary complexity. `strategy_rules` already proves a two-table pattern works — it is not split into a rule-identity table and a rule-version table; it is **one** table where `rule_key` is the stable identity that reappears across rows when a locked version is copied forward (copy-on-write), and `strategy_version_id` anchors each row to its immutable version snapshot.

**Adopted 2-table model:**

**`setup_conditions`** (new table, migration slice 13B) — direct sibling of `strategy_rules`, scoped to Setup Version:

| Column                     | Type                                              | Notes                                                                                                                                          |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `workspace_id`       | uuid                                              |                                                                                                                                                |
| `setup_id`                 | uuid FK                                           |                                                                                                                                                |
| `setup_version_id`         | uuid FK → `strategy_setup_versions`, **NOT NULL** | anchors this row to one immutable Setup Version snapshot                                                                                       |
| `condition_key`            | text                                              | **stable identity across copy-on-write** — the same key reappears in a new row under a new `setup_version_id` when the Setup is edited forward |
| `label`                    | text                                              | the historical text for this exact version — immutable once the parent `strategy_version.locked_at` is set                                     |
| `sort_order`               | integer                                           |                                                                                                                                                |
| `created_at`, `updated_at` | timestamptz                                       |                                                                                                                                                |

Protected by the exact same lock-immutability trigger pattern already proven three times in `drizzle/0007_strategies_and_setups.sql` (rejects UPDATE/DELETE once the parent Strategy Version is locked).

**`trade_setup_condition_checks`** — direct sibling of `trade_rule_checks`, content-snapshotted at Trade creation:

| Column                              | Type        | Notes                                                                                 |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `id`, `workspace_id`, `trade_id`    | uuid        |                                                                                       |
| `setup_condition_id`                | uuid FK     | precise reference                                                                     |
| `setup_version_id`, `condition_key` | uuid, text  | carried for cross-version identity continuity, mirroring `trade_rule_checks.rule_key` |
| `label`                             | text        | **snapshotted** at trade creation, never re-read live                                 |
| `check_status`                      | text        | `met` \| `not_met` — **two values only**, see §6                                      |
| `sort_order`                        | integer     |                                                                                       |
| `created_at`, `updated_at`          | timestamptz |                                                                                       |

### Proof the 2-table model is sufficient

- **Copy-on-write:** editing a locked Setup inserts new `setup_conditions` rows with the same `condition_key` under the new `setup_version_id` — identical mechanism to `strategy_rules`, already proven correct.
- **Historical text:** each version's row carries its own immutable `label` — no separate version table needed because the row itself _is_ the version snapshot.
- **Analytics across Setup Versions:** group by `condition_key` (stable) to compare the "same" condition across versions, or by `setup_condition_id` (exact) to isolate one version's wording — both queryable directly, no join to a third table required.
- **Rename:** the next version's row for the same `condition_key` simply carries a new `label`; old trades' snapshots are untouched.
- **Removal:** the next version's copy-forward simply does not re-insert that `condition_key`; older versions still have their row.
- **Stable identity:** `condition_key`, exactly like `strategy_rules.rule_key`.

No concrete invariant was found that requires a separate identity table — the simpler model is adopted.

---

## 6. Condition status — binary, no silent `not_checked`

**Locked persisted contract, corrected from the prior audit's 3-state recommendation:**

For a **saved** Trade Entry Snapshot: `checked = met`, `unchecked = not_met`. `check_status` on `trade_setup_condition_checks` is a **two-value** enum (`met` / `not_met`) — no `not_checked`, no `not_applicable`. This is a deliberate simplification from the prior audit's 3-state proposal, made because the Founder's explicit save-time contract removes the ambiguity a third state existed to capture: every applicable condition on a saved Trade resolves to exactly one of two states, never a hidden third bucket that analytics could silently exclude.

**UI requirement (not optional):** before save, the entry flow must show an explicit summary, e.g.:

> "3 of 5 conditions met. 2 unchecked conditions will be recorded as Not Met."

The Trade may still save with unmet/unchecked conditions — this is a disclosure requirement, not a save-blocking one.

**Zero-configured-Conditions Setup:** produces **`Setup Adherence = N/A / Not configured`**, never `0%`. This must be a distinct, explicit UI/analytics state (matching the existing `calcErr('...')`-with-reason doctrine, CLAUDE.md §6) — not a coerced zero that would misrepresent an unconfigured Setup as a badly-adhered-to one.

---

## 7. Setup Adherence — two distinct, separately-named metrics

**Corrected finding:** the prior audit collapsed these into one `SUM/SUM` formula, matching the existing `ruleAdherenceRate` precedent. The Founder correction is explicit that these are two different meanings and both must ship, clearly labeled:

**Per Trade** (unchanged from the prior audit):

```
setupAdherence = met / applicable
```

**Primary period-level metric — Average Setup Adherence:**

```
Average Setup Adherence = AVG(per-Trade setupAdherence)
```

Weights **each Trade equally**, regardless of how many Conditions its Setup has.

**Optional secondary metric — Conditions Met Rate:**

```
Conditions Met Rate = SUM(met) / SUM(applicable)
```

Weights **each individual Condition equally**, so Setups with more Conditions carry proportionally more weight in this number. This is the formula the prior audit proposed as the _only_ aggregate — it remains available, but demoted to secondary and must never be labeled interchangeably with Average Setup Adherence.

Both are computed only over Trades where `setupAdherence` is defined (i.e., `applicable > 0`) — a zero-Condition Setup's Trades are excluded from both aggregates, consistent with §6's `N/A` contract, never coerced to `0` inside the aggregate either.

**Performance-by-adherence buckets** (100% / 75–99% / 50–74% / <50%) operate on **each Trade's own `setupAdherence` value** — i.e., buckets are inherently per-Trade, which is why they naturally pair with the Average (equal-per-Trade) framing rather than the Conditions-Met-Rate framing.

---

## 8. Entry vs. Review notes

**Locked:**

- `confirmation_notes` (existing column, unchanged) → **Entry Reason**. Reused as-is.
- `notes` (existing column) → **retained as legacy/general notes**. Historical data is never silently reinterpreted as either Entry Reason or Review. New Trades may still populate it as general context if the UI chooses to keep it visible, but it is no longer the Review surface.
- `review_notes` → **new column**, dedicated Post-Trade Review field. Ships in **migration slice 13D** (Emotions + Review Note — see §16), because it is purely additive, has zero dependency on Setup Conditions or Partial Close, and pairs naturally with the other Review-surface work in that slice.

---

## 9. Condition counts — start normalized

**Corrected finding:** the prior audit recommended denormalized `conditions_met_count`/`conditions_applicable_count` cache columns on `trades` for list-query performance. **Rejected for the initial implementation** per Founder instruction — do not add write-path-maintained cache columns merely for anticipated list performance before profiling proves a need.

**Recommended instead:** one **batched child query keyed by the page's returned Trade IDs** — after the list query returns its page of Trade rows (unchanged, still the existing single-join, no-N+1 query), issue one additional query: `SELECT trade_id, check_status, COUNT(*) FROM trade_setup_condition_checks WHERE trade_id = ANY($ids) GROUP BY trade_id, check_status`, then fold met/applicable counts onto each row in application code. This mirrors the exact pattern Trade Detail already uses for its fixed additional queries (rule checks, mistakes) and keeps the list query itself unchanged. A correlated-subquery/`LATERAL` aggregation-in-the-list-query is the fallback alternative if the extra round trip is later shown to matter — cached columns are a last resort, only after profiling.

---

## 10. Historical closed-Trade backfill

**Corrected finding:** the prior audit recommended leaving legacy closed Trades with zero `trade_exits` rows indefinitely (a permanent dual-read path). Re-evaluated per Founder instruction: **backfill is adopted.**

A historical closed Trade's `actual_exit` / `net_pnl_minor` / `exited_at` semantically **are** one Full Close — nothing is invented by expressing that as one `trade_exits` row:

```
closed_bps    = 10000
exit_price    = trades.actual_exit        (verbatim)
realized_pnl_minor = trades.net_pnl_minor (verbatim)
exited_at     = trades.exited_at          (verbatim)
exit_reason   = NULL                      (the old model never captured one — never fabricated)
sequence      = 1
```

Legacy closed Trades satisfy the old all-fields-required CHECK and their persisted `actual_r` was computed from `net_pnl_minor / actual_initial_risk_minor`. Therefore the truthful migration policy is to set `actual_result_mode = 'money'` for those rows — **not** to infer Price mode merely because `actual_exit`, `actual_entry`, and `actual_initial_stop` are also populated. Their Price values remain truthful diagnostic context; their established Money-derived result remains authoritative. No Price-versus-Money equality guard is introduced during backfill.

**Where it runs:** as a single, idempotent backfill step (`WHERE status = 'closed' AND net_pnl_minor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trade_exits WHERE trade_id = trades.id)`) in **migration slice 13E**, immediately after the `trade_exits` DDL — not deferred to an unspecified later date. A preflight must fail visibly on any legacy closed row that does not satisfy the expected money authority (`actual_initial_risk_minor > 0`, `net_pnl_minor`, `actual_r`, and `exited_at` present) rather than guessing a different mode. The operation is mechanical, values-preserving, and re-runnable; paying this small, well-understood cost once is strictly better than every future service/query/export carrying a permanent "zero exit rows means legacy" branch forever. The legacy `trades.actual_exit`/`net_pnl_minor`/`exited_at` columns are kept as the compatibility/final caches specified in §4, and no available historical value is rewritten.

---

## 11. Exit corrections

**Locked V1 contract:**

- No silent hard-delete of an Exit leg.
- Corrections are an explicit operation (`correctTradeExit`), following the existing `correctTradeExecution`/`correctSystemResolution` narrow-function pattern.
- A correction recomputes the **complete** Trade aggregate from the full corrected leg set, never incrementally: Price mode recomputes `actual_r` from weighted price geometry and keeps monetary caches null; Money mode recomputes `net_pnl_minor` and `actual_r` from realized monetary legs.
- All `bps` invariants are revalidated across every leg after the edit, not just the edited one.
- If the Trade is already `closed` (`SUM(bps) = 10000`), it must **remain** `SUM(bps) = 10000` after the correction — the service redistributes/rejects rather than silently leaving the Trade in an inconsistent closed-but-not-100%-accounted state.
- Every correction writes a `trade.corrected`-pattern audit-log entry, matching the four existing correction functions.

**Corrected finding — any leg, not just the latest:** the prior audit artificially restricted corrections to the most recently added leg. Re-examined: neither mode has a sequential dependency between legs beyond their `bps` sum; both require a full-population revalidation and full-aggregate recompute on every correction. **Any leg may be corrected**, under the same row-locked, mode-aware, full-recompute transaction. The only real constraint is the closed-Trade "must remain 10000" rule above — a UX/consistency concern, not a reason to fabricate a latest-leg-only arithmetic restriction.

---

## 12. Emotions

**Locked canonical V1 list (no custom Emotions in V1):**

```
calm · focused · fearful · fomo · greedy · hesitant · revenge · excited · tired · frustrated
```

"revenge" (**Emotion** — an urge/mental state, self-reported) is explicitly distinct from `revenge_trade` (**Mistake** — the actual post-entry behavior). A trader may feel Revenge without exhibiting `revenge_trade`, or vice versa; the product's causal-attribution mission depends on keeping these grammatically and structurally distinct (Emotions phrased as felt states, Mistakes as judged actions).

### Persistence — corrected to match the repository's actual localization architecture

The prior audit proposed `label_en`/`label_th` columns on a new `emotion_types` table. **Corrected**, based on reading `mistake_types`' actual schema (`src/server/db/schema/mistake-types.ts`) rather than assuming: the proven precedent stores **one** `label` column (a canonical, non-localized string) plus a `key`, and resolves the real bilingual EN/TH display strings through `messages/en.json`/`messages/th.json`, keyed off `key` — **not** through per-locale DB columns. `emotion_types` must follow the same pattern:

**`emotion_types`** (new table, migration slice 13D):

| Column                     | Type           | Notes                                                                                                                                                                                                                                       |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid           |                                                                                                                                                                                                                                             |
| `workspace_id`             | uuid, nullable | nullable-for-system-rows shape, mirroring `mistake_types` exactly — even though V1 seeds only system rows and ships no custom-Emotion authoring UI, keeping the shape consistent costs nothing and matches the proven tenancy-check pattern |
| `key`                      | text           | stable identity, used as the `messages/*.json` lookup key                                                                                                                                                                                   |
| `label`                    | text           | canonical English fallback (export/admin contexts), **not** the UI display string                                                                                                                                                           |
| `is_system`                | boolean        |                                                                                                                                                                                                                                             |
| `is_archived`              | boolean        |                                                                                                                                                                                                                                             |
| `sort_order`               | integer        |                                                                                                                                                                                                                                             |
| `created_at`, `updated_at` | timestamptz    |                                                                                                                                                                                                                                             |

Same `mistake_types_tenancy_check`-style CHECK (`is_system ⟺ workspace_id IS NULL`) and the same partial-unique-index pair (system keys globally unique, custom keys unique per workspace).

**No** `severity`/`weight` columns — Emotions are never scored, per explicit instruction.

**`trade_emotions`** — join table, direct sibling of `trade_mistakes` minus its severity/weight/note columns:

| Column                        | Type               |
| ----------------------------- | ------------------ |
| `trade_id`, `emotion_type_id` | uuid, composite PK |
| `workspace_id`                | uuid               |
| `created_at`                  | timestamptz        |

Reuses the exact hand-authored workspace-scope trigger `trade_mistakes` already has for its nullable-`workspace_id` system rows.

---

## 13. Journal V2 Entry Flow

**Locked conceptual flow (unchanged from the prior audit, reconfirmed):**

```
Trading Account → Strategy → Setup → Symbol/Direction → optional Timeframe/Session
→ Price and/or Money Plan → Setup Conditions → Confidence → Emotions → Entry Reason → Chart → Save
```

One progressive Journal Entry experience, not the current hard-gated four-step wizard. `trade-plan-validation.ts`'s pure stage-validity rules are reused as section-complete indicators rather than hard navigation gates (implementation detail for 13C, not this freeze).

**Keep/reuse, confirmed still correct after this freeze's corrections:** account/strategy/setup selectors, Long/Short control, Price/Money plan (unchanged by §2/§3 — those additions are additive, not replacements), Planned R, mismatch protection, Favorites/Recents, the Confidence draggable selector, TradingView URL, private Chart upload.

---

## 14. Review Flow &amp; State Machine

**Review flow (unchanged from the prior audit, reconfirmed):**

```
Actual Execution → Full Close or Partial Close
System Outcome → independent
Post-Trade Review → Execution Rules, Mistakes, review_notes
→ then: Planned R / Actual R / System R / Execution Gap
```

Setup Adherence and Execution Adherence are never merged into one number, at any point in this flow or in analytics.

**Locked V2 state machine:**

| Axis                                    | States                            | Transitions                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trade (`status`)                        | `planned, open, closed, canceled` | `planned→open→closed` (terminal); `planned→canceled` (terminal). **No new enum value.**                                                                                                                                                                                                                   |
| Partial-open (derived, never persisted) | n/a                               | `open AND 0 < SUM(closed_bps) < 10000`; the Trade transitions to `closed` exactly when an Exit brings `SUM(closed_bps)` to `10000`, via the same guarded-transaction idiom `closeTrade` already uses                                                                                                      |
| System (`system_status`)                | `pending, resolved, no_trade`     | `pending→resolved`, `pending→no_trade`, `resolved↔no_trade` via correction. Fully independent of the Trade axis — **unchanged by every decision in this document**, including §2's Money-only extension (Money-only only changes _how_ `resolved` computes `system_r`, never the state machine around it) |

---

## 15. Analytics contract

- **Actual performance:** only fully closed Trades (`status='closed'`, which under §4/§14 now specifically means `SUM(closed_bps)=10000`).
- **System performance:** resolved System Trades, regardless of Actual execution status — independent population, unchanged.
- **Partially-open Trades:** may appear in descriptive entry-snapshot statistics (Confidence, Setup Adherence, Emotion counts — captured at entry, independent of exit state) but **never** in finalized Actual Win Rate / Avg R / Expectancy.
- **Confidence/Condition/Emotion performance against Actual:** inherit Trader eligibility and `exited_at`.
- **Confidence/Condition/Emotion performance against System:** inherit System eligibility and `system_exited_at`.
- **No generic date axis** — every paired view inherits the eligibility/date-axis of whichever metric family (Trader or System) it is being compared against, per the existing Phase 09 contract (`docs/phases/PHASE-09-analytics.md:28-34`).
- **No verdict/confidence claims from small samples** — low-sample groups are labeled "insufficient data," never given a statistical-confidence annotation, per the product spec's own deferred minimum-sample-size question (`docs/product-spec.md:100`).

---

## 16. Implementation sequence

**Corrected finding:** the prior audit recommended sequencing Emotions first purely because it was the cheapest/lowest-risk slice. Overridden — sequence by product-core dependency, not by ease:

| Slice   | Scope                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **13A** | Contract Freeze — this document                                                                                                                  |
| **13B** | Setup Conditions domain (§5, §6, §7 schema/service)                                                                                              |
| **13C** | Single-page Journal Entry UX (§13)                                                                                                               |
| **13D** | Emotions + Review Note (§8, §12)                                                                                                                 |
| **13E** | Actual Execution V2 + Partial Close (§3, §4, §10, §11)                                                                                           |
| **13F** | Money-only System Resolution (§2)                                                                                                                |
| **13G** | Journal List/Detail redesign (§9 and related read-model work)                                                                                    |
| **13H** | Analytics extensions (§1's Execution Gap rename/recolor follow-up, §7's dual adherence metrics, Confidence/Condition/Emotion analytics from §15) |
| **13I** | Founder UAT / closeout                                                                                                                           |

No dependency-driven reordering is recommended beyond this — 13B before 13C because the Entry UX needs a real Setup Conditions checklist to render; 13D before 13E/13F because Emotions/Review Note are pure additions with no interaction with execution mechanics and are cheap to validate early without blocking on the higher-risk execution-model work; 13E before 13F because Partial Close's `trade_exits` table is a precondition for nothing in Money-only System Resolution, but both benefit from landing after the capture-side (13B–13D) is stable and UAT'd once; 13G/13H last because both need real captured data (Conditions, Emotions, Exits) to be meaningful to build and test against.

### 13B implementation record

- `setup_conditions` is version-owned content under an exact Setup Version. `condition_key` is generated server-side, survives rename/reorder/COW, and row IDs regenerate when the authoritative Strategy copy transaction remaps every Setup snapshot.
- Unlocked current Versions edit in place. Locked Versions are protected by PostgreSQL and mutate only through the existing Strategy COW transaction and lock order. Removal deletes only from an unlocked/current copied Version; locked history remains intact.
- `trade_setup_condition_checks` stores immutable server-authoritative key/label/order/status snapshots with exact Trade/Setup Version/source-row composite FKs. Status is exactly `met | not_met`.
- The future-capture helper accepts only keys and binary answers, requires exactly one answer for every authoritative Condition, and rejects duplicates, omissions, foreign keys, wrong Workspaces, and Setup Version mismatches. It is dormant until 13C; the old Trade flow still writes zero rows truthfully.
- Existing `strategy_rules.is_pre_trade_check = true` rows remain intact and COW preserves them. New Rule authoring no longer exposes or creates that legacy meaning; Setup Conditions own new pre-entry authoring.
- Workspace export schema version 2 includes both Setup Condition datasets. No adherence aggregate or analytics surface was added.
- Phase 13C captures complete Setup Condition answers from the single-page Entry surface and preserves the stale-set guard and unmet-answer confirmation.
- Phase 13D adds the ten canonical bilingual Emotion choices, `emotion_types`, `trade_emotions`, nullable `trades.review_notes`, and nullable `trades.emotions_recorded_at`. The marker distinguishes historical “not recorded” from a recorded zero selection. Create and correction accept keys only, resolve active system rows authoritatively, write atomically, and remain entitlement/audit guarded. Workspace export schema version 3 includes both Emotion datasets and both new Trade fields.
- Phase 13E adds explicit Price/Money Actual execution, authoritative `trade_exits`, partial-close/close-remaining/correction UI and services, parent-lock plus database cross-row enforcement, values-preserving legacy backfill, read-derived partial progress, final-only Trade caches, and Workspace Export schema version 4. Price mode never fabricates Money; Money mode never double-weights already-net leg P&L. System resolution and Execution Gap runtime behavior remain unchanged.

---

## 17. Classification — re-evaluated

**B — moderate domain migration, preserving the core Strategy/System/Analytics architecture — confirmed, not weakened by these corrections.**

The Actual/System dual-input changes (§2, §3) are explicit additive branches, but genuine Price-only Actual execution does require a new price-mode calculator/composer and a mode-aware replacement for the current money-only close path; the current `actualR` helper may remain as the Money-mode primitive, but it is no longer the universal Actual-result contract. Historical migration remains limited to §10's values-preserving Exit backfill plus the truthful `money` mode tag. The Execution Gap sign flip (§1) is the widest-blast-radius pure-function/copy change. Nothing found in this corrected pass elevates the finding to **C**: every new table mirrors an already-proven pattern (`strategy_rules` for Setup Conditions, `mistake_types`/`trade_mistakes` for Emotions), and the mode discriminator makes the execution-model widening explicit rather than overloading nullable fields.

---

## Out of scope for Phase 13 (unchanged)

Broker sync, automatic market-price tracking, partial **entry**/scale-in, multiple entry fills, live position sizing, automatic System outcome from a market feed, custom Emotions, custom Mistakes, trading automation. Partial **exit** (Partial Close) is in scope; partial **entry** is not — `actual_entry`/`actual_initial_stop` remain single-fill, unaffected by anything in this document.

## Open Founder decisions (genuinely unresolved by this freeze)

1. Whether the single-page Entry flow needs a distinct fast-path for logging an already-closed historical Trade in one submission, given `CreateTradeSchema` can currently only ever produce `status='planned'`.
2. Final Thai copy review for the 10 canonical Emotion `messages/th.json` entries (the `messages/*.json` keys/English strings are specified by this document; native Thai review is still required, matching `docs/localization-glossary.md`'s stated per-term review process).

Phase 13E resolves the former Exit-reason question as optional free text (500-character application limit), avoiding an invented taxonomy.

## Documentation impact map

| Doc                             | Why it will eventually need updating                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md` §6                  | Updated in 13A with a narrow Phase-13 supersession note for the dual Actual-result modes and corrected Execution Gap sign. It explicitly records that runtime remains on the legacy Money-only/opposite-sign behavior until 13E/13H. |
| `docs/product-spec.md`          | Setup Conditions, Emotions, Partial Close, and the corrected Execution Gap sign are all currently undocumented or documented with the old sign                                                                                       |
| `docs/data-dictionary.md`       | New tables (`setup_conditions`, `trade_setup_condition_checks`, `emotion_types`, `trade_emotions`, `trade_exits`) and the new `trades.system_gross_r_input`/`actual_result_mode`/`review_notes` columns                              |
| `docs/roadmap.md`               | Needs a Phase 13 row and status entries as 13B–13I land                                                                                                                                                                              |
| `docs/architecture.md`          | Its `src/server/db/schema/` directory listing is already stale relative to Phase 06–08 and will need the Phase 13 tables added at the same time                                                                                      |
| `docs/localization-glossary.md` | New terms: Setup Conditions, Setup Adherence, Execution Gap (sign-corrected), the 10 canonical Emotions                                                                                                                              |
| `docs/phases/README.md`         | Index table needs a Phase 13 row, matching the convention every other phase follows                                                                                                                                                  |

Except for the required `CLAUDE.md` authority correction called out above, none of these are edited in 13A; this table exists so 13B onward does not have to rediscover the list.

## Definition of Done — 13A only

- [x] Execution Gap sign corrected and its full blast radius enumerated with file citations
- [x] Money-only System Performance's exact current blocker identified by source, and the smallest schema/service delta specified
- [x] Actual Result Price and Money modes specified as genuinely independent authoritative paths
- [x] Explicit persisted `actual_result_mode` adopted with both-representation and legacy-mode policy
- [x] Partial Close child model specified (`trade_exits`, bps, mode-aware derived R)
- [x] Setup Conditions model simplified to two tables with the simplification proven against the `strategy_rules` precedent
- [x] Condition status corrected to binary with the disclosure-UI requirement stated
- [x] Setup Adherence's two distinct metrics named and separated
- [x] Entry vs. Review notes separated, migration slice assigned
- [x] Condition counts kept normalized for the initial implementation
- [x] Historical backfill strategy reversed and justified
- [x] Exit correction scope (any leg) determined and justified
- [x] Emotions model corrected to match the repository's real localization architecture
- [x] Entry flow, Review flow, and state machine reconfirmed
- [x] Analytics contract restated
- [x] Implementation sequence reordered to product-core dependency
- [x] Classification re-evaluated and held at B with reasoning
- [x] Zero runtime code, zero migrations, zero commits made in 13A

## Definition of Done — 13B

- [x] Exactly one additive migration (`0011_setup_conditions_domain.sql`); migration 0010 unchanged
- [x] Two-table model implemented without a speculative identity table
- [x] Setup Condition add/rename/reorder/remove authoring in EN/TH
- [x] Existing Strategy COW copies every Condition with a new row ID and remapped Setup Version while preserving `condition_key`
- [x] PostgreSQL protects locked Condition rows and immutable Trade snapshots, including the workspace-delete exception
- [x] Future Trade snapshot helper validates an explicit complete binary answer set from authoritative source rows
- [x] Phase 13C Trade creation captures authoritative Condition snapshots from the single-page Entry
- [x] Legacy pre-trade Rule history is preserved while new Rule authoring is Execution Rule-only
- [x] Workspace export schema version 3 includes Conditions, Emotions, their links/snapshots, and Review fields
- [x] No Setup Adherence analytics or customer-facing Trade checklist/list/detail surface shipped early

## Risks (carried into 13B–13I, not resolved here)

- **The `CLAUDE.md` §6 constitution now records the Phase-13 supersession while runtime still implements V1.** 13E and 13H must remove the explicitly labeled runtime-compatibility notes only when their respective Actual-mode and Execution-Gap changes actually ship; until then, tests must continue describing implemented behavior without being mistaken for the newer product contract.
- **Backfilling historical closed Trades (§10) runs against production-shaped data eventually.** It is values-preserving and idempotent by design, but it is still a data migration touching every historical closed Trade and should get its own rollback plan and dry-run verification when 13E is implemented, not be treated as a routine DDL-only migration.
- **Any-leg Exit correction (§11) increases the surface a bug in the bps-revalidation logic can reach.** Because every leg is editable, the full-recompute/full-revalidate transaction is doing more safety work than a latest-leg-only design would need — its test coverage (PostgreSQL integration tests for the invariant) is correspondingly more load-bearing and should not be shortcut in 13E.
