# TradeChemist — Review & System Assessment Product Contract v1

> **Status: Approved (v1, 2026-09-20).** This contract elaborates the approved
> [Add Trade Product Contract](add-trade.md) for Trade Review and System Assessment. It does not
> replace it: Add Trade §14–§22, §25 and §28 remain the governing sections, and this document
> defines how they are applied. Where this contract's owner decisions amend an Add Trade section,
> that section has been updated in place and the amendment is recorded in the Add Trade
> [Decision log](add-trade.md#decision-log) (decisions 41–49), so no two canonical statements
> disagree.
>
> **Authority:** Product Contract level (see [`README.md`](README.md)). [`docs/UX_RULES.md`](../UX_RULES.md)
> applies it; `CLAUDE.md` and the canonical technical docs describe its implementation and label
> current code that has not caught up.
>
> **Implementation status:** approved target, not implemented. Capture (At Entry, After Trade and the
> Recording Draft) is frozen and is not reinterpreted by this contract. Current Review and System
> Assessment code predates it; see [Current implementation pending migration](#current-implementation-pending-migration).

---

## 1. Purpose and principle

Review answers: _what should have happened, and what can I learn?_ (Add Trade §27). It interprets
Capture; it never re-records it.

- **Capture is authoritative for what happened.** Review shows Capture evidence read-only and never
  re-asks a Capture question.
- **Review never rewrites Capture.** Missing or wrong Capture evidence is changed only through a
  Capture correction (§20 below).
- **Missing is never negative.** Unanswered, Unknown, Not Checked and Not Applicable are never a
  violation, a failure, a loss, zero or Negative (Add Trade §2, §24).
- **No global score.** There is no Review score, discipline score, completion percentage or overall
  good / bad Trade rating (Add Trade §21, §25; CLAUDE.md §6).

---

## 2. Review lifecycle

Server states for a Trade's Review (Add Trade §20):

- `not_reviewed`
- `reviewed`

There is no third server state.

- **Closed Trades only.** Open and Partially Closed Trades are not formally reviewed and show no
  Review action or Review attention (Add Trade §20).
- **Never forced.** Review is offered as _Review Trade / Done_ after Save Closed Trade or a closing
  Final Close, or opened later by the trader. It is never entered automatically.
- **Finish Review** persists the Review content (§3–§7) and explicitly marks the Trade `reviewed`, in
  one action. It records `firstReviewedAt` (first Finish only), `lastFinishedAt` and `finishCount`.
- **Finish needs nothing.** No reflection, mistake, Strategy, adherence or System Assessment is
  required (Add Trade §21).
- **No return to `not_reviewed`.** Not through reopening, Capture corrections or a stale System
  Assessment. The interface offers no "mark as not reviewed" action (Add Trade §20).
- **Reopen:** a Reviewed Trade may be reopened, edited in a Review Draft and Finished again, which
  updates `lastFinishedAt` and `finishCount`.
- `Needs Review` is not a Review state. It is an overlay on a confirmed System Assessment only (§19).

---

## 3. Review Draft

A Review Draft holds unsaved Review work: rule-check answers, mistakes answer, Exit Plan Adherence
with Deviation Type / Reason, and reflection. It never holds System Assessment answers, which have
their own draft (§8).

- **Browser-local until Finish Review.** Stored in this browser only, scoped to the signed-in user
  and the active workspace; never synced across devices (Add Trade §23).
- **Survives reload** on the same browser and device, and the interface says a draft was recovered.
- **Does not change the persisted Review** until Finish succeeds. A failed Finish keeps the draft
  exactly as entered.
- **Discard is explicit** and confirmed. It returns to the last persisted Review — or to an empty
  Review if the Trade was never reviewed.
- **Reopening** a Reviewed Trade starts a draft from the last persisted Review.
- **Sign-out** warns, naming the drafts, before it removes local drafts (Add Trade §23).
- **Another tab** editing the same draft is detected, and the trader is offered the latest version
  rather than silently overwriting it.
- No server-side Review-draft versioning in v1. Each Finish is audited.

---

## 4. Reflection

Canonical Review v1 reflection is two optional prompts (Add Trade §21, amended by decision 43):

- **What would you repeat?**
- **What would you change?**

Pressing **Finish Review** with both blank is a valid, explicit completion. No separate
"nothing to add" value is stored.

Review does not ask "What happened?": Capture is authoritative for what happened, and the trader is
never asked to narrate it again.

Legacy `review_notes` stay readable as _Notes from earlier review_ with legacy provenance. They are
not converted into either prompt and never imply Reviewed (§22).

---

## 5. Rule-check semantics

Rule checks are the granular execution-rule evidence of Add Trade §8, snapshotted from the Strategy /
Setup version the Trade pins. Each check has exactly one of:

| Answer         | Meaning                                                           | A violation?        |
| -------------- | ----------------------------------------------------------------- | ------------------- |
| Unanswered     | No Review answer given                                            | No                  |
| Followed       | The rule was followed                                             | No                  |
| Violated       | The rule was broken                                               | **Yes — only this** |
| Not Applicable | The rule did not apply to this Trade                              | No                  |
| Not Checked    | The trader explicitly did not check or apply the rule at the time | No                  |
| Unknown        | The trader cannot remember or determine what happened             | No                  |

- Unanswered, Not Checked and Unknown are three different answers and are never collapsed (Add
  Trade §8, amended by decision 41).
- **Historical `not_checked`.** On an Add Trade v1 row created before this state model, a stored
  `not_checked` may have been a system default, and nothing records that the trader chose it. It is
  read canonically as **Unanswered**. No explicit answer is manufactured (decision 42).
- Legacy rows keep their historical "Not checked" presentation, marked Legacy.
- Rule checks map to Entry, Risk and Exit Discipline by category (Add Trade §8); management and
  invalidation rules stay granular evidence.

## 6. Mistake semantics

A Trade's mistakes answer is one of:

- **Unanswered**
- **No mistake identified** — an explicit answer
- **One or more selected mistakes** from the workspace taxonomy

An empty selection is Unanswered, never "none". "No mistake identified" cannot be combined with a
selected mistake. Mistakes carry no severity score or penalty (CLAUDE.md §6, A2).

## 7. Discipline evidence and Exit Plan Adherence

### 7.1 Evidence, not new judgments

Review shows the discipline evidence that already exists and adds no new Entry or Risk discipline
judgment (Add Trade §8, §21, §25):

- **Entry:** Setup condition answers from Capture (Met / Not Met / Don't remember, with unanswered
  coverage) and entry-category rule checks.
- **Risk:** Risk at Entry and the Actual Risk answer from Capture; the risk deviation
  `(Actual Risk − Risk at Entry) / Risk at Entry` only when Actual Risk is Different with an amount
  and Risk at Entry is known; risk-category rule checks.
- **Exit:** Exit Plan Adherence (§7.2) and exit-category rule checks.

### 7.2 Exit Plan Adherence

Exit Plan Adherence is **one canonical field** (Add Trade §18). It appears in Review and in System
Assessment as the same field. Answers:

- **Unanswered**
- **Followed**
- **Partly Followed**
- **Not Followed**
- **Unknown / Cannot Determine** (Add Trade §18, amended by decision 44)
- **Not Applicable** — only when the Trade's Exit Plan is explicitly _No Defined Exit Rule_

An Exit Plan that is merely Not recorded never implies Not Applicable. A recalled or unrecorded plan
does not make the answer Unknown automatically: if the trader can still judge adherence, they may.

When adherence is Partly Followed or Not Followed, the trader may record Deviation Type and
Deviation Reason. That taxonomy stays provisional and is not a rigid enum (Add Trade §18).

Adherence and Execution Impact are separate readings; Not Followed with a positive impact is a valid,
neutral combination (Add Trade §19).

### 7.3 Adherence concurrency

Two actions commit the one adherence field: **Finish Review** and **Confirm / Update System
Assessment** (decision 45). There is never silent last-write-wins.

- When a draft first edits adherence, it remembers the **base**: the persisted adherence value and
  its revision at that moment.
- **Commit, unchanged base:** if the persisted adherence still matches the base, the commit writes
  the draft value.
- **Commit, changed base:** if the persisted adherence changed since the base, nothing is written for
  adherence and the trader sees _Exit Plan Adherence changed since you started editing_, with the
  **latest saved answer** and **the draft answer**, and three explicit actions:
  - **Use latest saved answer** — the draft adopts it;
  - **Replace with my draft answer** — the only action that overwrites the newer saved value;
  - **Go back** — return to editing, nothing committed.
- The rule is the same whichever of Review or System Assessment committed first.
- The mechanism is the smallest reliable optimistic check on this one field (for example a revision
  counter or updated-at on adherence). Broad Review versioning is not built for it.

---

## 8. Canonical System Assessment state machine

System Assessment asks what following the system's rules, as the trader understood them, would have
produced for the **whole position** (Add Trade §14–§16). It is separate from what the system
prescribed (Capture evidence) and from what the trader did (Capture evidence).

**Canonical finding:**

| Finding                 | Meaning                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| No confirmed assessment | Nothing confirmed yet — shown as _Not Assessed_, a soft attention state |
| `assessed`              | The rules would have taken the Trade, and a System Result was confirmed |
| `no_trade`              | The rules would not have taken the Trade — a complete answer            |
| `cannot_determine`      | The trader cannot establish the System outcome — a complete answer      |

`no_trade` and `cannot_determine` are answered findings and are never shown as incomplete (Add Trade
§14).

- **System Assessment Draft:** answers typed in the assessment editor. Browser-local until Confirm,
  scoped to user and workspace, recoverable after reload on the same device, preserved on a failed
  Confirm, cleared only after the server confirms, protected by the sign-out warning, discarded only
  explicitly, and guarded against silent cross-tab overwrite as the other drafts are. **A draft is
  never canonical System evidence.**
- **Confirm System Assessment** is its own explicit action. It validates the answers and persists the
  finding with `confirmedAt` and a dependency snapshot (§19). It does not require Finish Review, and
  Finish Review does not require it.
- **Update** replaces a confirmed finding through a new draft and Confirm; the change is recorded as
  a revision.
- **Reconfirm** keeps a confirmed finding unchanged and refreshes its dependency snapshot, clearing
  Needs Review.
- **Needs Review** is derived only for a previously confirmed finding (§19).
- Only a confirmed finding that is not Needs Review participates in canonical System analytics.

## 9. The seven-question flow

The questions and their order are those of Add Trade §15:

1. **Would your rules have taken this trade?** Yes / No Trade / Cannot Determine. No Trade and
   Cannot Determine can be confirmed immediately.
2. **If yes — what should have closed it?** Fixed Target, Initial SL, Break-even rule, Trailing
   exit, Time / session exit, Another predefined exit rule, or Discretionary judgement explicitly
   allowed by the system. _Fixed Target_ is offered only when Capture's Target state is Fixed.
3. **What result would following the rule have produced?** In Money (suggested) or R, with
   **Net / comparable** or **Gross only** (§11). Never prefilled; helpers per §10.
4. **System R** — derived or entered (§14).
5. **Were these rules actually in place before entry?** Yes / No / Unknown, or left Unanswered — a
   trader claim (§13).
6. **Did the trader follow them?** The one Exit Plan Adherence field (§7.2).
7. **If deviated — how and why?** Deviation Type and Reason (§7.2).

A TP-price-only Fixed Target confirmed as hit, and any dynamic Exit Plan, need the trader to state
the result in Money or R; Price is never used to fill it (Add Trade §5, §15).

## 10. System Result basis and helpers

The trader chooses the result basis — **Money** or **R** — and the value is entered in that basis
only. Money and R are never blurred.

Explicit helpers may fill the value (decision 46):

| Helper     | When offered                                                               | Fills                                                                                                     |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Initial SL | Mechanism = Initial SL, and Risk at Entry is known (Money) or basis is R   | Basis R: `−1R`. Basis Money: the negative Risk at Entry amount                                            |
| Target     | Mechanism = Fixed Target, and Capture holds a value for the selected basis | Basis Money: the recorded Target Profit. Basis R: Target Profit ÷ Risk at Entry, only when both are known |

A helper requires an explicit click, only fills the field, never confirms, never decides Net vs Gross
only, and is never offered from a TP price: **Price never calculates a System Result** (Add Trade §3,
§15).

## 11. Net vs Gross-only

Every confirmed `assessed` result is marked **Net / comparable** or **Gross only**. The choice starts
unanswered, is required to confirm a result, and is never inferred — not from a helper, not from a
missing cost.

- **Net / comparable:** eligible for canonical System aggregates and the Execution Gap.
- **Gross only** (decision 47): stored, shown on the Trade with its exact-sign bucket where useful,
  and reported as coverage — but **excluded from every canonical aggregate System metric in v1**:
  System Positive Rate, System Result Distribution, System R aggregates, Execution Gap and every other
  net / comparable aggregate. Gross-only and net populations are never mixed. A separately defined
  gross cohort may be added later without changing v1 semantics.

## 12. Strategy, Setup and Exit Plan provenance

Capture origin (Add Trade §7, §9) decides what an assessment may say about the rules it used:

| Capture origin        | What it proves                                                                                                                                                                                          | What the assessment may say                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Recorded at entry     | The rules were on record in the first Save Open Trade                                                                                                                                                   | Assessed against the rules you recorded at entry                                 |
| Recorded during trade | Added while the Trade was open, after entry                                                                                                                                                             | Assessed against rules added during the trade                                    |
| Recalled after trade  | Only "the Strategy / plan I remember using". The pinned version is the one current when the Trade was recorded: it keeps later records consistent, but does not prove that version existed before entry | Assessed against the rules as you recall them (version as of the recording date) |
| Not recorded          | Nothing                                                                                                                                                                                                 | A mechanism and result may still be stated; rule provenance is unknown           |

Recalled evidence is never called verified and never implies the exact rules were proven to exist
before entry.

The Exit Plan assessed is the Trade's snapshot — Saved, Customized or No Defined Exit Rule — or Not
recorded; a plan chosen during After Trade reconstruction is labelled _as recalled_.

## 13. Q5 claim versus Capture evidence

Question 5 records what the trader **claims**. Capture origin records what was **observed** and
when. Neither overwrites the other:

- A Q5 _Yes_ on a Strategy recalled after the trade is kept, shown beside the recalled origin, and
  never upgrades the origin.
- A recorded-at-entry origin is never downgraded by a Q5 _No_ or _Unknown_; both are shown.
- The dependency snapshot records the origins in force at confirmation.

## 14. Actual R, System R and Execution Gap

All three use the one Risk at Entry baseline (Add Trade §4, §17).

- **Actual R** = Final Net P&L / Risk at Entry (frozen Capture). Unavailable, with its reason, when
  either is missing.
- **System R**
  - Money basis: System Money / Risk at Entry — **only when Risk at Entry is known**. Without it,
    System R is unavailable, though the Money figure still has a sign.
  - R basis: the trader's figure, even without Risk at Entry. Its money equivalent is then
    unavailable and never estimated.
  - Unavailable for `no_trade`, `cannot_determine` and no confirmed assessment.
- **Execution Gap** (Difference) = Actual R − System R, **only when** Actual R is canonical, the
  System Result is confirmed, `assessed`, net / comparable, not Needs Review, and both R figures use
  Risk at Entry. Otherwise it is unavailable with its reason — never `0R`.

The System Result is a whole-position figure; actual exit legs never construct it.

## 15. Positive / Flat / Negative

A confirmed `assessed` System Result is bucketed by the exact sign of its value (System Money, or
System R — always the same sign because a known Risk at Entry is positive) (Add Trade §16):

- **Positive:** > 0
- **Flat:** = 0
- **Negative:** < 0

No tolerance band. `+0.01R` is Positive and `−0.01R` is Negative. The System side never uses
Win / BE / Loss, which belong to Trader Outcome only. An exit mechanism such as a break-even rule is
separate from the bucket.

## 16. Metric-specific eligibility

Every metric has its own population. Anything excluded is reported as coverage, never counted as
zero, Negative, a loss or a violation. Only Add Trade v1 rows enter canonical metrics.

| Metric                        | Definition                                               | Population                                                        | Shown as coverage                                                                         |
| ----------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| System Positive Rate          | Positive / (Positive + Flat + Negative)                  | Confirmed `assessed`, net / comparable, not Needs Review          | No confirmed assessment, `no_trade`, `cannot_determine`, Needs Review, gross only, legacy |
| System Result Distribution    | Counts of Positive / Flat / Negative                     | Same as System Positive Rate                                      | Same                                                                                      |
| System R total / average      | Sum / mean of System R                                   | The System Positive Rate population with a known System R         | Unknown System R                                                                          |
| Execution Gap total / average | Sum / mean of per-Trade Execution Gap                    | Trades with an available Execution Gap (§14)                      | Every unpaired Trade                                                                      |
| Exit Plan Adherence rate      | Followed / (Followed + Partly Followed + Not Followed)   | Trades with one of those answers                                  | Unanswered, Unknown, Not Applicable — each counted                                        |
| Rule-check rate, per category | Followed / (Followed + Violated)                         | Checks with one of those answers                                  | Unanswered, Not Applicable, Not Checked, Unknown — each counted                           |
| Risk deviation                | Mean per-Trade risk deviation (§7.1)                     | Actual Risk Different with an amount and Risk at Entry known      | Matched counted; Different amount unknown, Don't know, Unanswered as coverage             |
| Mistake frequency             | Share of answered Trades with each mistake               | Trades answered _No mistake identified_ or with selected mistakes | Unanswered                                                                                |
| Reviewed coverage             | Reviewed / closed canonical Trades                       | Closed Add Trade v1 Trades                                        | —                                                                                         |
| System Assessment coverage    | Confirmed findings by type / closed canonical Trades     | Closed Add Trade v1 Trades                                        | Needs Review shown separately                                                             |
| Provenance coverage           | Count of confirmed assessments per rule provenance (§12) | Confirmed assessments                                             | —                                                                                         |

- **Dates:** System figures use the Trade's final exit time; a Trade with none follows the frozen
  undated-coverage rule (calculation-spec, _Canonical analytics populations_).
- **Provenance:** confirmed assessments count whatever their rule provenance (decision 49), and the
  population keeps provenance so a _recorded at entry only_ filter can be added later without
  re-modelling.

## 17. Gross-only exclusion

Restating §11 for analytics: no gross-only System Result enters any canonical aggregate System
metric in v1. Its count appears in System Assessment coverage.

## 18. Provenance coverage

Every surface showing a canonical System metric can state how many of its assessments used rules
recorded at entry, added during the trade, recalled after the trade or not recorded. Recalled and
not-recorded provenance is never presented as verified.

## 19. Needs Review and staleness

Only a **confirmed** System Assessment can become **Needs Review** (Add Trade §14, §22). When it does:

- the confirmed finding and result are preserved exactly;
- the surface shows the previous finding, what changed, **Reconfirm** and **Update**;
- the assessment is excluded from canonical System analytics until reconfirmed or updated;
- nothing is recomputed over the confirmed result. A recomputed figure may appear only as a preview.

Dependencies — only what the assessment actually used makes it stale:

| Capture change after confirmation                                                                                 | Needs Review?                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Strategy / Setup, or its pinned version, corrected                                                                | Yes                                                               |
| Exit Plan state or snapshot corrected                                                                             | Yes                                                               |
| Risk at Entry changed, when the result basis is Money                                                             | Yes — confirmed Money kept; recomputed System R is a preview      |
| Risk at Entry changed, when the result basis is R and no Risk-based helper was used                               | No                                                                |
| Risk at Entry changed, when a Risk-based helper filled the value                                                  | Yes                                                               |
| Target state, Target Profit or TP price changed, when the mechanism is Fixed Target or the Target helper was used | Yes                                                               |
| Direction corrected                                                                                               | Yes                                                               |
| Final Net P&L, exit history, Trader Outcome, times, symbol or account changed                                     | No (Add Trade §22). Actual R and the Execution Gap recompute live |
| Reflection, adherence, rule checks, mistakes, emotions or notes changed                                           | No                                                                |

**Review is never stale.** A Capture correction made after the Review's `lastFinishedAt` shows an
informational _Changed since your last Review_, naming what changed where useful. It is not a state,
changes nothing and adds no second stale overlay for Review or adherence.

## 20. Capture-correction shortcuts from Review

Review may offer **Add / correct trade data** for missing or wrong Capture evidence — for example
Trader Outcome or Risk at Entry. The shortcut runs the Capture correction itself:

- Capture semantics apply unchanged (Trader Outcome trader-selected; Risk at Entry positive or
  blank; and so on);
- origin is preserved and revision metadata is added;
- §19 decides whether a confirmed System Assessment becomes Needs Review;
- no Review-only copy of Capture evidence is ever stored.

An entry emotion edited from Review is a Capture correction of the entry observation, never Review
interpretation stored over it. Post-Trade Emotion may be recorded in Review and never overwrites
Entry Emotion (Add Trade §9).

## 21. Independent coverage

Reviewed status and System Assessment status are independent:

- a Trade may be Reviewed with no confirmed System Assessment;
- a System Assessment may be confirmed on a Trade that is Not Reviewed.

They are reported separately — Reviewed coverage and System Assessment coverage — and each may carry
its own soft attention on closed canonical Trades (Not Reviewed; Not Assessed).

## 22. Legacy isolation

Pre-contract evidence keeps its historical meaning and is never converted by assumption (Add Trade
§28).

- **Legacy rows** keep `system_*` results and `system_outcome`, `plan_adherence`, `review_notes`,
  rule checks and mistakes as stored, marked Legacy, and excluded from canonical metrics by default.
- **Legacy notes never imply Reviewed.** Legacy closed Trades start `not_reviewed`, receive no new
  soft Review attention because the new lifecycle exists, and are outside the Reviewed-coverage
  denominator. Their notes stay visible as legacy evidence.
- **Add Trade v1 rows resolved through the pre-contract System flow** keep that result visible as
  _Assessed under the earlier model_, marked Legacy. Canonically they have no confirmed assessment
  and may be reassessed.
- **No new legacy System resolutions** once canonical System Assessment ships, for any row.

## 23. Local draft recovery

Review Drafts and System Assessment Drafts follow the Add Trade §23 draft principles, as the
Recording Draft does:

- Type → Draft; Finish / Confirm → Persist; Discard → Destroy;
- user- and workspace-scoped, browser-local, recoverable after reload on the same device, never
  implied to be synced;
- a failed Finish or Confirm keeps the draft; a successful one clears it only after the server
  confirms;
- sign-out warns before removing drafts, naming them;
- another tab's change is detected rather than silently overwritten;
- an unreadable or unsupported stored draft is reported, never guessed at.

## 24. Responsive and accessibility behaviour

Review and System Assessment follow UX Rules §16–§17 and the design system:

- usable at desktop, tablet, 390px and 320px with no horizontal page overflow;
- every answer, including Unanswered, Unknown, Not Checked and Not Applicable, is conveyed by text
  and programmatic state, never by colour alone;
- choices are real radio groups or equivalent with labels; keyboard operable with visible focus;
- the adherence conflict, Needs Review and draft notices are announced to assistive technology and
  move focus sensibly;
- dismissal of nested editors is non-destructive (UX Rules §5.2);
- motion respects `prefers-reduced-motion`;
- EN and TH copy follow the localization glossary (Add Trade §26).

## 25. Deferred

Not defined by any approved authority, and not implemented until a later contract defines them:

- **System Edge Captured.** The Add Trade contract does not define it; `CLAUDE.md` §6 describes a
  formula only for the pre-contract implementation.
- **Impact-by-deviation analytics** (average Execution Gap per Deviation Type / Reason).
- **The final Deviation Type / Reason taxonomy** (Add Trade §18).
- **Any Review score, discipline score or completion percentage.**
- **Any global good / bad Trade score.**
- **A gross-only System cohort** (§11).
- **A _recorded at entry only_ provenance filter** — supported by the model, not required in v1.

---

## Current implementation pending migration

Until implementation lands, the running code still:

- infers a closed Trade as reviewed when `review_notes` is present, and shows Review / System
  attention on open Trades;
- stores one `review_notes` text and no Review lifecycle;
- defaults rule checks to `not_checked` with no Unanswered or Unknown answer, and has no explicit
  "No mistake identified";
- resolves System results through the pre-contract flow — Target Profit ÷ Risk, −1R, 0R or a typed
  R, minus an optional cost, with a Win / Loss / BE `system_outcome` from the ±0.05R band — on legacy
  and Add Trade v1 rows alike;
- stores `system_plan_provenance` and `plan_adherence` (no Unknown or Not Applicable) and a v1
  dependency snapshot;
- admits no canonical System Result to analytics.

None of it is approved behaviour, and none of it may be extended as though it were.

## Decision summary

Owner decisions 2026-09-20, recorded in the Add Trade decision log as decisions 41–49:

- Rule-check answers split Unanswered, Not Checked and Unknown (41); historical contract-row
  `not_checked` reads as Unanswered (42).
- Reflection is _What would you repeat?_ and _What would you change?_; blank Finish is complete (43).
- Exit Plan Adherence adds Unknown / Cannot Determine (44) and commits under explicit optimistic
  concurrency (45).
- System Result helpers fill the chosen basis only, on an explicit click (46).
- Gross-only results are excluded from every canonical aggregate System metric in v1 (47).
- Review Draft and System Assessment Draft are browser-local until Finish / Confirm; System
  Assessment is confirmed independently of Finish Review; mistakes have an explicit _No mistake
  identified_; missing Capture evidence is added only through Capture corrections; a later Capture
  change shows _Changed since your last Review_ and Needs Review stays reserved for confirmed System
  Assessment (48).
- Confirmed assessments count whatever their rule provenance, with provenance coverage and Q5 kept
  as a claim; legacy notes never imply Reviewed; legacy closed Trades get no new Review attention;
  no new legacy System resolutions are made (49).
