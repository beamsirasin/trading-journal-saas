# Product Specification

**Status:** Living document. Phases 03–11 are officially complete; Phase 12 — Hardening & Launch Readiness is next. Settings now provides real self-scoped Profile/Preferences and Account Security, owner-authorized Workspace controls, canonical Account/Plan/Billing navigation, and owner-only versioned Workspace export without exposing credentials, sessions, provider internals, Audit Logs, or server secrets. Phase 11 added minimal SaaS administration: platform-admin grant-history authority, an EN-only `/admin` shell, privacy-limited User/Workspace oversight, exactly three named Subscription Support mutations, an append-only Admin Audit, and DB-authoritative platform VAT configuration. Discipline Score, mistake-cost attribution, verdict thresholds, FX/currency portfolio analytics, advanced/global filters, account/workspace deletion, admin impersonation/suspension, and refunds/reconciliation still require explicit approved policy.

## 1. The problem

A trader with a losing account cannot tell which of these is true:

1. The strategy has no edge, and following it perfectly would still lose money.
2. The strategy has an edge, and the trader is destroying it through execution.
3. Both.

These demand opposite responses. Case 1 means change the strategy. Case 2 means change the behaviour — and changing the strategy would be the worst possible move, discarding a working system because of a discipline problem.

Conventional journals cannot distinguish them. They record what happened, so they can only ever report P&L. They have no representation of what _should_ have happened, which is the other half of the comparison.

## 2. The product thesis

Record two parallel results for every trade:

- **System result** — what the strategy's rules would have produced.
- **Trader result** — what the trader's actual decisions produced.

The difference between them is the trader's contribution, positive or negative. That difference is the product.

## 3. Core concepts

### System performance

The hypothetical result had the strategy been followed exactly: planned entry, planned stop, and the rule-defined exit.

Metrics: System Win Rate · System Avg R · System Expectancy · System Profit Factor · System Total R · System Max Drawdown.

### Trader performance

The realised result of actual entries, management, exits, and costs.

Metrics: Actual Win Rate · Actual Avg R/Expectancy · Actual Profit Factor · Actual Total R · Actual Max Drawdown. System Edge Captured and Execution Gap (formerly "Edge Leakage" — renamed and sign-corrected in Phase 13H: `actualR − systemR`, negative means the Trader captured less than the System) are paired comparison metrics over Trades eligible on both axes; they are not Trader-population aggregates. Discipline Score remains deferred.

### R-multiples

All performance is normalised to **R** — the initial risk on the trade. A trade risking $100 to make $250 is `+2.5R`.

R is what makes system and trader results comparable even when the trader sized the position differently from the plan. Without it, a trader who doubled their size would look like a genius or an idiot for reasons unrelated to the decision quality being measured.

### The outcome matrix

System outcome and trader outcome are **independent stored fields**. System outcome is never inferred from actual profit.

|                 | Trader win                                                          | Trader loss                                                    |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| **System win**  | Followed a good signal                                              | **The valuable cell** — a working system, damaged by execution |
| **System loss** | Made money by breaking the rules — dangerous, reinforces bad habits | Followed a bad signal; the strategy is the problem             |

The bottom-left cell matters as much as the top-right. A trader rewarded for deviating learns exactly the wrong lesson, and a journal that only reports profit will congratulate them for it.

### Discipline and mistakes

Each Trade may carry one or more of the nine canonical system Mistakes. Phase 09 reports deterministic distinct-Trade frequency only. Snapshotted severity/weight fields preserve future design room, but no Discipline Score or mistake-cost/leakage attribution exists until an explicit non-double-counting policy is approved.

## 4. MVP scope

Landing page · Google and email authentication · 7-day full-feature trial with 1 active trading account · three monthly paid plans gated only on active trading-account count · unlimited strategies, setups, trades, and trade history on every plan · mock payment and future-ready exclusive VAT checkout behavior · onboarding · trading-account management · strategy and strategy-version management · manual trade journal · TradingView chart URLs · system vs actual outcome · mistake and discipline tracking · dashboard · identical analytics across plans · account, subscription and profile settings · basic SaaS administration · responsive desktop, tablet, and mobile · English and Thai localization.

## 5. Explicitly excluded from the MVP

Broker API integration · MT4/MT5 synchronisation · CSV import · OCR · TradingView API integration · real payment processing · AI API integration · native mobile apps.

Payments are mocked behind an adapter so a real provider can be added without touching feature code.

## 6. Users

**Primary — the serious retail trader.** Has a defined strategy, already journals in a spreadsheet, suspects execution is costing them, and cannot prove it.

**Secondary — the prop-firm challenge trader.** Under strict rules where a single discipline breach ends the account. Wants to know which breach is most expensive before it happens again.

Not targeted for the MVP: fully automated traders (no execution gap to measure), and complete beginners (no strategy to compare against).

## 7. Success criteria

The product works if a user can answer, within a month of journaling:

1. Does my strategy have an edge?
2. How much of that edge am I capturing?
3. Which canonical mistakes occur most frequently?
4. What objective proportion of evaluated Rule checks did I follow?

## 8. Known limitations

**The system counterfactual is self-reported.** The product cannot verify what the strategy's rules would have produced — the trader tells it. A trader who records the counterfactual dishonestly gets attribution that flatters them.

Mitigations: prefill the system outcome where plan and execution agree, keep the wording neutral so recording a mistake does not feel like a confession, and be candid in the product that output quality follows input honesty. This is inherent to a manual journal and is not solved by more UI.

## 9. Product decisions and open questions

| #   | Question                                                                                                                                                                                                                                                                 | Needed by  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | ~~Do plan limits match how traders actually segment accounts?~~ **Locked in Phase 3C**: Starter 1 / Trader 5 / Professional 15, gating exclusively on active trading-account count, identical feature set across plans. See `src/config/plans.ts` and CLAUDE.md A3.      | Phase 3C ✓ |
| 2   | **Locked in Phase 3C:** 7-day trial, exactly 1 active trading account, every feature unlocked, and no user-data deletion at expiry. The allowance is not derived from any paid plan.                                                                                     | Phase 3C ✓ |
| 3   | What is the minimum closed-trade count before a verdict may be stated? Phase 09 deliberately shipped measurements without verdicts; approve this policy before any later verdict layer.                                                                                  | Deferred   |
| 4   | **Locked in Phase 07C:** `BREAK_EVEN_TOLERANCE_R` is `0.05R`, a global Calculation Engine Version 1 constant (`src/config/trade-calc.ts`) — identical for every Workspace and every Trading Account, not per-account configuration. See CLAUDE.md A1.                    | Phase 07 ✓ |
| 5   | **Locked for launch/future implementation:** VAT collection disabled at launch; future exclusive VAT is admin-configured, initially prepared as 7%, server-calculated in integer minor units, snapshotted immutably, and presented/calculated for customers by Phase 04. | 04/11/12   |
