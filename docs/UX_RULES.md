# TradeChemist — UX Rules

> **Status:** v1 (2026-09-15), active. The UX behaviour and interaction authority for TradeChemist.
> UX boundary decisions 24–37 and pre-design decisions 38–40 in the [Add Trade contract](product-contracts/add-trade.md#decision-log)
> are applied. The recording-lifecycle decision 50 (2026-09-22) is applied in §20.
>
> **Position in the documentation chain.** Each level controls its own domain, and a lower level
> never overrides a higher level's semantic or behavioural decision
> ([`product-contracts/README.md`](product-contracts/README.md)):
>
> 1. **Approved Product Contracts** — product semantics: what states, values and results mean.
> 2. **UX Rules (this document)** — interaction and behaviour: hierarchy, disclosure, state
>    representation, drafts and navigation, validation, feedback, redesign guardrails.
> 3. **`CLAUDE.md` and canonical technical docs** — engineering and technical constraints as
>    applicable (authorization, tenancy, money precision, UTC time). They bind how these rules are
>    implemented but never contradict them.
> 4. **`DESIGN.md` / visual system** — visual expression. [`DESIGN.md`](../DESIGN.md) is the
>    visual-design authority; [`design-system.md`](design-system.md) is its implementation and token
>    reference. Colour, type scale, radius, shadow, component styling and brand direction belong
>    there, not here.
> 5. **Historical documents** — Phase documents, reviews and the frozen prototype record.
>
> Where a rule here appears to disagree with an approved contract, the contract wins and the
> disagreement is a defect in this document. Current production behaviour that differs from these
> rules is pending migration (see [Appendix B](#appendix-b--current-implementation-evidence)), not a
> precedent.
>
> **Scope:** the only approved Product Contract today is
> [Add Trade](product-contracts/add-trade.md) (v1), so the detailed rules cover At Entry, After
> Trade, Partial / Final Close, Review, System Assessment and the analytics that read them. The
> general rules (§1–§10, §15–§19) apply to every TradeChemist surface unless a later approved
> contract says otherwise. Review and System Assessment additionally follow the
> [Review & System Assessment contract](product-contracts/review-system-assessment.md) (v1,
> 2026-09-20), which elaborates the Add Trade contract; its decisions 41–49 are applied in §14–§15.
>
> **Sources, in precedence order:** (1) the approved Add Trade Product Contract; (2) `CLAUDE.md` and
> the governing technical documents; (3) the reconstructed prototype behaviour
> (`src/components/prototype/`) only where it does not conflict with (1)–(2); (4) Astra
> interaction/data-integrity findings as audit evidence only — no such report is present in this
> repository, none is reconstructed, and none of its findings are incorporated; (5) current
> production UX as implementation evidence only.
>
> **Rule language:** **MUST** / **MUST NOT** are requirements. **SHOULD** is the expected default; a
> deviation needs a recorded reason. Contract references are written as _(contract §N)_. Quoted
> English labels fix the **meaning** of an action or state, not its final copy — see §9.
>
> Items deliberately left for UX/copy prototyping or implementation policy are listed in
> [Appendix A](#appendix-a--deferred-items). None of them blocks visual design.

---

## UX Quick Reference

The non-negotiables. Each points to the full rule; the full rule governs.

1. **Never manufacture an answer.** No preselected answer, no inferred outcome, no blank turned into
   zero, no default presented as a choice (§4.1–§4.2).
2. **Preserve Unanswered / Unknown / None / Zero / Negative.** Each stays a distinct state in label,
   control and analytics (§4).
3. **Routine navigation is non-destructive.** Done, X, Escape, outside click, Back, Close and mode
   switch keep work; only an explicit destructive action destroys it. Draft preservation preserves
   user work, not unconfirmed system assumptions (§5, §5.5).
4. **Optional-for-save is not analytically unimportant.** Strategy, Setup, conditions and psychology
   stay visible and inviting (§2.4).
5. **Money is result authority; Price is context.** No Money/Price basis switch; price inconsistency
   is a notice, never a result or a block (§8.1–§8.2).
6. **Trader Outcome is trader-selected.** Win / BE / Loss is never derived; a sign contradiction is a
   quiet notice (§7.7, §8.10).
7. **Capture and Review stay separate.** Capture records; Review interprets, only for Closed Trades,
   and only by the trader's choice (§10, §14.2).
8. **Progressive disclosure never hides persistence or state.** Collapsing changes nothing, and a
   collapsed section shows that it holds answers (§3).
9. **Missing analytical data is coverage, not failure.** It is excluded and counted as coverage,
   never as Not Met, a violation, zero, a loss or Negative (§6.2, §15).
10. **Visual simplification may not delete approved semantics.** Presentation may adapt; states and
    distinctions may not be dropped or merged (§16.1, §18.4).
11. **When a design cannot represent the contract clearly, stop and report the conflict** rather
    than simplifying the semantics (§18).
12. **One recording lifecycle, three task flows.** A stage fixes what a question means; a flow may
    present stages in its own order. Review is never a stage (§20).

---

## 1. UX goals

1. **Match the trader's mental model at each moment** _(contract §27)_:
   - At entry — _What am I doing and why?_
   - At close — _What actually happened?_
   - At Review — _What should have happened, and what can I learn?_

   Each surface asks only the questions that belong to its moment.

2. **Capture simple → preserve truth → analyze deeply later** _(contract §2)_. Capture effort is
   proportional to the moment: a trader entering a live position must be able to save in seconds,
   and deeper interpretation waits for Review.
3. **Never manufacture certainty.** The interface never turns an unanswered or unknown fact into an
   answer, a zero, a default, or a negative observation _(contract §2, §24)_.
4. **Keep attribution honest.** System performance and trader performance stay visibly and verbally
   separate everywhere they appear _(CLAUDE.md §1; contract §16–§17)_.
5. **Nothing a trader typed is lost by routine interaction.** Losing work requires an explicit
   destructive action _(contract §23)_.
6. **TradeChemist carries the complexity.** The trader never needs to understand the data model,
   and internal vocabulary never reaches the screen _(contract §26–§27)_.
7. **Inform without judging.** Possible mistakes produce quiet notices, not blocks. Missing data is
   not failure, and not following an Exit Plan is not automatically bad execution _(contract §12,
   §18–§19)_.

---

## 2. Information hierarchy

1. **Rank information by the question of the moment, not by the data model.** Hierarchy is expressed
   as priority tiers; this document does not prescribe a layout.
2. **At Entry tiers** _(contract §6)_:
   - **Tier 1 — needed to save:** Account, Symbol, Direction, Risk at Entry; plus Entry time.
   - **Tier 2 — core intent:** Target (Unanswered / Fixed / No Fixed) and Exit Plan.
   - **Tier 3 — core analytical data:** Strategy, Setup, setup conditions, Confidence, Entry
     emotions.
   - **Tier 4 — optional context:** trade idea / reason, timeframe, session, notes, chart, price
     levels, size.
3. **After Trade tiers** _(contract §13)_:
   - **Tier 1 — minimum Trade identity, needed to save:** Account, Symbol, Direction.
   - **Tier 2 — what actually happened:** Final Net P&L and Trader Outcome — optional but strongly
     prompted — and Actual R when it can be derived.
   - **Tier 3 — risk and intent:** Risk at Entry, Actual Risk, Target, Exit Plan; optional Entry
     and final exit times.
   - **Tier 4 — history and context:** exit events and exit-history completeness, Strategy, Setup,
     conditions, recalled Confidence and Entry Emotion, Post-Trade Emotion, trade idea/context.
4. **Core analytical data is optional to save but never presented as unimportant** _(contract §6)_.
   It MUST NOT sit behind labels that imply it is extra or advanced.
5. **System vs Actual keeps three primary figures:** System R, Actual R, and Difference / Execution
   Impact. Risk Deviation (Risk at Entry vs Actual Risk) is secondary. Other internal R figures MUST
   NOT compete for attention _(contract §17)_.
6. **Final Net P&L is the primary money figure of a closed Trade.** The recorded exit subtotal is
   supporting history and is presented as subordinate to it _(contract §11)_.
7. **Three independent status axes stay visually and verbally independent:**
   - Trade lifecycle — Open / Partially Closed / Closed / Canceled.
   - Review lifecycle — Not Reviewed / Reviewed, for Closed Trades only.
   - System Assessment — Not Assessed / Assessed / Cannot Determine / No Trade, with Needs Review
     as an overlay.

   One indicator MUST NOT merge them; for example, a Closed trade never looks Reviewed
   _(contract §14, §20)_.

8. **Provenance appears where a value is shown, in plain language.** A legacy-derived Trader Outcome,
   a legacy R, an inherited Exit Plan, or an observation added during the trade or recalled after
   close carries its provenance next to the value, not only in a detail view _(contract §5, §7, §9,
   §28)_.

---

## 3. Progressive disclosure

1. **Disclosure hides fields, never answers.** Collapsing or expanding a section MUST NOT change any
   value or state inside it.
2. **A collapsed section that contains answers shows that it does,** so recorded data is never
   invisible and a trader can tell an untouched section from a completed one.
3. **Disclosure MUST NOT hide a contract distinction.** For example, "Don't know" is never folded
   into a blank field behind a disclosure.
4. **Actual risk differed (At Entry)** is a progressive action _(contract §4)_:
   - While it has not been opened, the interface MUST visibly state that actual risk matches the
     recorded Risk at Entry. That is an honest, visible affirmation, never a silent server
     inference.
   - Opening it records **Different**. An amount may be entered; left blank, the answer is
     **Different, amount unknown** and MUST NOT silently revert to Matched.
   - Collapsing the section does not change the answer (§3.1). Returning to the match is an explicit,
     specifically labelled action.
5. **Optional context (Tier 4) SHOULD be disclosed on demand.** Tier 1 and the Save action MUST be
   reachable without traversing optional sections.
6. **Nested editors are views of the same Draft** _(contract §23)_. This covers editors such as
   Exit Plan, trade idea, exit events, emotions and conditions. Opening one never forks or
   snapshots the Draft into a separate record.
7. **Review is not a wizard.** Its areas (Reflection, Discipline / Behavior, System Assessment) MUST
   NOT be gated in sequence, and no step locks another _(contract §21)_.
8. **Follow-up questions appear only when their premise holds.** Examples:
   - Deviation Type and Reason when adherence is Partly or Not Followed _(contract §18)_.
   - A System Result input only when the system would have taken the trade _(contract §15)_.
   - A Not Applicable adherence answer only when the Exit Plan is No Defined Exit Rule
     _(contract §18)_.
   - Hiding a follow-up MUST NOT delete its recorded answer. If the premise changes back, the
     earlier answer reappears.

---

## 4. State semantics

The interface MUST keep these states distinct in label, programmatic state and behaviour _(contract
§2, §24)_:

| State                      | Meaning                                                           | Examples                                                                                            |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Unanswered**             | The trader has not given an answer                                | No Strategy chosen yet; condition not answered; Confidence untouched; Target not chosen             |
| **Blank (not recorded)**   | An optional value left empty where no distinct Unknown is defined | Risk at Entry, Final Net P&L or a timestamp left empty in After Trade _(contract §13, §24)_         |
| **Unknown**                | The trader explicitly does not know                               | "Don't know" Actual Risk; Different, amount unknown; "Don't remember" condition; exit scope unknown |
| **None**                   | The trader explicitly says the thing does not exist               | No Strategy; No Setup; None of these (emotions); No Fixed Target; No Defined Exit Rule              |
| **Known Zero**             | A known value of exactly zero                                     | Final Net P&L of 0; a System Result of 0 (Flat) — never a Risk at Entry                             |
| **Known Value**            | A known non-zero value or a selected option                       | Risk at Entry $50; Confidence 75; Setup "Breakout"                                                  |
| **Negative answer**        | An explicit negative observation                                  | Condition Not Met; Exit Plan Not Followed                                                           |
| **Not Applicable**         | The rule explicitly does not apply to this trade                  | An execution rule marked Not Applicable; adherence with No Defined Exit Rule _(contract §8, §18)_   |
| **Inherited**              | A value visibly supplied by a default, not chosen                 | Exit Plan "From Strategy: <name>" _(contract §5)_                                                   |
| **Legacy / derived**       | A historical value created under earlier semantics                | Legacy-derived Trader Outcome; legacy R; Price-mode result _(contract §28)_                         |
| **Needs Review (overlay)** | A confirmed System Assessment whose dependency changed            | Strategy changed after an Assessed finding; the prior finding is kept _(contract §14, §22)_         |

Rules:

1. **No answer is preselected.** The only contract-sanctioned starting values are:
   - Entry time defaulting to now in At Entry, editable and clearable _(contract §6)_;
   - visible Strategy-default Exit Plan inheritance in At Entry _(contract §5)_;
   - the At Entry Actual Risk affirmation, which is visible under §3.4 _(contract §4)_.

   Each stays distinguishable as a default until the trader confirms or changes it, and none
   becomes a historical answer after a switch to After Trade (§5.5). Confidence has no default.
   Trader Outcome, conditions, emotions, Target, adherence and System Result have none either
   _(contract §9, §12, §15)_.

2. **Blank numeric input is never zero.** A cleared or untouched money, R, percentage or price field
   stays empty through blur, collapse, reload recovery and save. It is never rendered or announced
   as `0`, and it reduces analytical coverage rather than counting as a value.
3. **Unanswered and blank are never displayed as a negative.** They use a neutral "not answered" or
   "not recorded" presentation, never "No", "Not Met", "Loss", `0`, or a cue that reads as failure.
4. **Each explicit option is its own choice.** None, Unknown and Not Applicable are selectable
   options, not the absence of a selection.
5. **Returning an answer to Unanswered is an explicit, specifically labelled action** (for example
   "Remove answer"). It is never a side effect of another control. For Exit Plan, a generic "Clear"
   is avoided _(contract §5)_.
6. **Inherited, chosen and rejected states are distinguishable** _(contract §24)_:
   - an inherited Exit Plan reads as inherited;
   - a plan the trader picked reads as chosen;
   - a rejected inheritance stays rejected and never quietly reappears _(contract §5)_.
7. **Observation origin and revision are shown separately** _(contract §7, §9)_. Psychology,
   Strategy, Setup, setup conditions and Exit Plan each keep their capture origin — recorded at
   entry (in the first successful Save Open Trade), added during the trade (first supplied later
   while open), or recalled after close (first supplied after the trade closed). An edit may add an
   "edited later" indication and never changes the origin label.
8. **Legacy values are never presented as trader choices or canonical figures** _(contract §28)_.
9. **Explicit "Don't know" controls appear only where uncertainty changes product meaning**
   _(contract §24)_: Actual Risk, setup conditions in After Trade, exit scope in After Trade, and
   exit-history completeness. Other optional fields — including Risk at Entry, Final Net P&L and
   timestamps in historical capture — are simply left blank when not known or not recorded, unless
   a Product Contract defines a distinct Unknown state for them.

---

## 5. Draft and navigation behaviour

**Routine navigation is non-destructive. Destruction requires an explicit destructive action.**

**Draft preservation preserves user work, not unconfirmed system assumptions.** A default may carry
a state showing that it is still only a default until the trader confirms or changes it.

1. **Type → Draft · Save → Persist · Discard → Destroy** _(contract §23)_. Every entered value lands
   in the Draft as it is typed. Only Save creates or updates a Trade, and only Discard destroys the
   Draft.
2. **Every editor dismisses non-destructively** _(contract §23)_ — nested editors, Record Exit,
   Final Close, Review and saved-trade editing alike:
   - **Done** keeps the changes and closes the editor.
   - **X, Escape, and outside dismissal** keep the changes and close the editor. They MUST NOT
     behave like Cancel.
   - **Discard Changes** is the only dismissal action that removes edits. It explicitly restores the
     editor checkpoint — the Draft state when that editor was opened. It MUST be labelled
     specifically, never "Cancel" or "Close".
3. **Back, Close, route changes and the browser/system back gesture** navigate away with the Draft
   intact. Because nothing is lost, they MUST NOT show an "unsaved changes will be lost" warning.
   They MAY confirm that the Draft was kept. (Sign-out is different — §5.11.)
4. **Reload recovery** _(contract §23)_:
   - **Add Trade Recording Drafts and Review Drafts** MUST be durably recoverable after reload in
     the same browser on the same device. On return, the interface states that a draft was
     recovered and offers to continue it or explicitly discard it.
   - **Record Exit, Final Close and saved-trade editing** MUST preserve work across routine
     dismissal during the interaction. Durable reload recovery for them is not a v1 requirement,
     and the interface MUST NOT claim it exists.
   - Cross-device sync is not a requirement, and the interface MUST NOT imply a draft is synced.
5. **Switching At Entry ↔ After Trade never destroys work and never confirms a default**
   _(contract §23)_. User-entered values may carry across recording modes; contextual defaults must
   not silently become historical answers.
   - **Explicit shared values carry across** where their semantics remain valid — for example
     Account, Symbol, Direction, a manually entered Risk at Entry, a manually selected Strategy,
     Setup or Exit Plan, condition answers, psychology, notes, and an explicit Actual Risk
     "Different" answer.
   - **Untouched defaults do not become After Trade answers** _(contract §4, §5, §23)_:
     - **Entry time** — if the trader edited or confirmed it, it is preserved; if it is still the
       untouched automatic "now" default, it is not carried and After Trade shows Entry time as
       unanswered.
     - **Implicit Actual Risk match** — not carried; After Trade Actual Risk starts Unanswered.
     - **Automatically inherited Strategy-default Exit Plan** — not carried; After Trade applies
       no Strategy or Exit Plan default retrospectively.
   - **Mode-specific values stay in the Draft** and may be hidden while irrelevant — for example
     exit events and Final Net P&L after switching back to At Entry, or an untouched At Entry
     default after switching to After Trade. They are never silently deleted, and hidden or
     incompatible default data is never treated as a confirmed answer.
   - What is finally saved — lifecycle, provenance and origin — reflects the recording context at
     Save, not the route where the Draft began _(contract §7, §9)_.
6. **Discarding a whole Draft** is an explicit, clearly destructive action. It SHOULD require
   confirmation or offer an undo.
7. **Save failure preserves the Draft** exactly as entered and offers retry. **A retry MUST NOT
   create a duplicate Trade**, whether the trader presses Save again, retries after a network error,
   or saves again from a recovered draft.
8. **The Draft is cleared only after a confirmed successful Save.**
9. **After a successful Save:**
   - **Save Open Trade** confirms that the open Trade was saved. It MUST NOT offer Review
     _(contract §20)_.
   - **Save Closed Trade**, or a Final Close / Close Remaining that closes an existing Trade, shows
     **Trade Saved** with a choice of **Review Trade** or **Done** _(contract §20)_. Neither is
     preselected, the choice never auto-advances, and Done returns the trader to where they came
     from.
10. **The interface never auto-navigates into Review.** Entering Review is always the trader's
    choice.
11. **Draft privacy** _(contract §23)_:
    - Drafts are scoped to the signed-in user and the workspace. A draft MUST NEVER surface in
      another user's or another workspace's context.
    - Explicit sign-out clears local unsaved drafts. If an unsaved draft exists, sign-out MUST warn
      before destroying it, and the warning names what will be lost.
    - Automatic draft-retention time is implementation policy (Appendix A).

---

## 6. Validation

1. **Save is blocked only by contract requirements and by input that is invalid as entered:**
   - **Save Open Trade** requires Account, Symbol, Direction and Risk at Entry _(contract §6)_.
   - **Save Closed Trade (After Trade)** requires the minimum Trade identity — Account, Symbol and
     Direction _(contract §13)_. Risk at Entry, Final Net P&L and Trader Outcome stay optional.
   - **Risk at Entry, when entered, must be greater than zero** _(contract §4)_. Zero or a negative
     value is an error; zero is never a stand-in for unknown risk.
   - **An explicitly selected Fixed Target requires a Target Profit or a TP price** _(contract
     §5)_. With neither, Save is blocked by a field-level validation error that offers adding one
     or changing the Target choice. The interface never silently converts the state to Unanswered
     or No Fixed Target.
   - **Record Exit on a live Trade** requires scope, Part or All Remaining _(contract §10)_.
   - **Final Close of an existing Open / Partially Closed Trade** requires explicit confirmation
     that the remaining position is closed — All Remaining scope or the Close Remaining action
     _(contract §11)_.
   - **Invalid as entered** means a malformed number, price or date, or text that cannot be parsed
     as the field's type.
2. **These MUST NOT block Save, Close or Record Exit:**
   - missing Risk at Entry, Final Net P&L or Trader Outcome on Save Closed Trade or Final Close
     _(contract §11, §13)_;
   - Strategy, Setup, conditions, Confidence and emotions;
   - Target states other than an incomplete Fixed Target, and Exit Plan;
   - Actual Risk in After Trade, and Actual Risk "Different, amount unknown";
   - exit-history completeness, incomplete exit percentages, and missing exit price, time or
     percentage;
   - unknown exit scope in After Trade reconstruction;
   - an exit-subtotal discrepancy;
   - a Trader Outcome that contradicts the P&L sign;
   - a plausible price inconsistency, such as a Long stop above Entry _(contract §3)_;
   - Exit Plan Adherence, System Assessment, Reflection and Review
     _(contract §6, §10–§14)_.
3. **Four feedback classes, never confused:**
   - **Error** — blocks this action; says what is missing or malformed and how to fix it.
   - **Notice** — a quiet, non-blocking hint of a possible mistake or data-quality issue, such as a
     sign contradiction, a discrepancy or a price inconsistency.
   - **Attention** — a soft status or prompt that invites work without blocking, such as Not
     Reviewed, Not Assessed, Needs Review, or Final Net P&L and Trader Outcome not yet recorded at
     close.
   - **Information** — neutral context, such as an inherited Exit Plan or a recovered draft.
4. **Timing.** Required-field errors do not appear before the trader has interacted with the field
   or attempted to save. On a save attempt:
   - all blocking errors appear at once, inline;
   - a summary identifies them;
   - focus moves to the summary or to the first invalid field.
5. **The Save control stays operable and explains itself.** A disabled Save with no stated reason is
   not acceptable. Pressing Save when requirements are missing reveals what is needed.
6. **Validation never rewrites input:**
   - it does not flip a sign, round silently, or replace a blank with zero;
   - it does not choose an outcome;
   - it does not adopt the exit subtotal as Final Net P&L _(contract §11–§12)_.
7. **Clearing Entry time is valid** and produces no error _(contract §6)_.
8. **Errors and notices are programmatically associated** with their field and written in plain
   trading language.

---

## 7. Feedback and system status

1. **Saving is visible.** A pending save shows progress, prevents a repeat submission, and keeps
   the Draft editable-safe.
2. **Success is truthful and specific.** Confirmation names what was saved and the Trade's lifecycle
   state. It never appears before the server confirms.
3. **Failure is explicit.** A plain-language reason, the Draft kept, and a retry path. The interface
   never implies a failed save succeeded.
4. **Draft status is honest.** When a draft is kept or recovered, the interface says so, and it
   makes clear the draft lives in this browser on this device only.
5. **System Assessment status is always visible on a closed Trade** _(contract §14)_:
   - **Not Assessed** is a soft attention state.
   - **Cannot Determine** and **No Trade** are answered findings and MUST NOT be shown as
     incomplete.
   - **Needs Review** is a stronger attention state. It may lead the display, but the preserved
     prior finding MUST remain visible. It SHOULD say which dependency changed.
6. **Not Reviewed** may carry a soft attention indicator on Closed Trades only. Review is never
   presented as overdue or mandatory, and Open or Partially Closed Trades carry no Review attention
   _(contract §20)_.
7. **Quiet notices** _(contract §3, §11–§12)_:
   - **Sign contradiction** — shown only for Win with negative Final Net P&L, or Loss with positive
     Final Net P&L. It never auto-corrects and never blocks. BE carries no sign notice.
   - **Exit-subtotal discrepancy** — shown only when all three contract conditions hold. Both values
     are shown, and Final Net P&L is marked authoritative.
   - **Price inconsistency** — a plausible semantic inconsistency such as a Long stop above Entry is
     flagged as a possible data-quality issue. It never blocks and never changes any value.
8. **Strong prompts are not requirements.** At Save Closed Trade and Final Close, missing Final Net
   P&L and Trader Outcome are prompted prominently as attention, with Save still available
   _(contract §11, §13)_.
9. **Recalculation is visible, not surprising.** When Final Net P&L changes, Actual R and Difference
   update. The System Assessment is not marked Needs Review for that change _(contract §22)_.
10. **A value that cannot be derived shows why**, never `0` and never an invented figure. For
    example, "Actual R needs Risk at Entry and Final Net P&L." _(design-system §8)_.
11. **Status messages use a persistent live region** so assistive technology hears them
    _(design-system §12)_.
12. **Feedback does not moralize.** Outcomes, deviations and missing answers are reported neutrally.

---

## 8. Forms

1. **Money is the source of truth; Price is optional context** _(contract §3)_.
   - The interface **MUST NOT reintroduce a Money/Price result-basis switch**, or any equivalent
     control that lets Price become the basis of a result, in any form or name.
   - There is no Plan mode or Price-result mode _(contract §1)_.
2. **Price never becomes a result** _(contract §3, §5, §15)_.
   - Entry, SL, TP and exit prices MUST NOT produce a displayed or stored Final P&L, Actual R,
     System R, System Result or Win / Loss / BE.
   - A plausible price inconsistency is a non-blocking notice (§7.7); malformed price input is an
     error (§6.1).
   - Price-derived context such as distance or pips may be explored later (Appendix A), but only as
     labelled context and never as calculation authority.
3. **Money inputs:**
   - show the Trading Account's currency;
   - accept exact values without silent rounding;
   - keep blank distinct from zero (§4.2);
   - allow a negative value on every platform keyboard where the field accepts one — where a numeric
     keyboard has no minus key, an explicit sign control is provided;
   - format in the account currency, independent of UI language _(design-system §13)_.
   - **Risk at Entry** accepts only a value greater than zero, or blank where it is optional
     _(contract §4)_.
4. **Multi-state questions use controls that can represent Unanswered.**
   - A group of explicit options with no initial selection is required, not a checkbox or binary
     switch, because those cannot represent Unanswered.
   - This applies to Met / Not Met, adherence, Trader Outcome, Target state, After Trade Actual
     Risk (Matched / Different / Don't know) and exit scope.
5. **Timestamps:**
   - entered and displayed in the user's profile timezone, never the browser's or server's
     _(CLAUDE.md §7)_;
   - Entry time may default to now in At Entry, and stays editable and explicitly clearable
     _(contract §6)_;
   - in After Trade, Entry time and final exit time are optional and may stay blank (§4.9);
   - quick actions such as "Now" are welcome, but must not be confused with a date-only choice;
   - suggested times, such as the closing exit's time, require explicit adoption.
6. **Target** — Unanswered / Fixed Target / No Fixed Target _(contract §5)_.
   - A Fixed Target holds a monetary Target Profit, a TP price, or both; choosing Fixed Target asks
     for at least one (§6.1).
   - Leaving Target unanswered is not No Fixed Target.
   - Dynamic or non-fixed exit objectives, such as holding until a trend-line break, belong in Exit
     Plan, not Target.
7. **Exit Plan** — Not recorded / Saved Exit Plan / Customized for this trade / No Defined Exit Rule
   _(contract §5)_.
   - Editing a saved or inherited plan for this Trade produces "Customized for this trade". It never
     silently edits the library rule.
   - The Trade keeps a snapshot of the rule, and the interface presents it as the rule used then.
8. **Exit events** _(contract §10)_:
   - Scope is required for live exits. In After Trade it may be left unknown.
   - P&L, % of original position, exit time, exit price and exit reason are all optional.
   - A reason-only exit is valid in After Trade.
   - The interface MUST NOT multiply exit P&L by percentage, and MUST NOT require percentages to sum
     before All Remaining closes the position.
   - An exit of unknown scope never drives remaining-position status.
9. **Exit-history completeness** — Complete / Incomplete / Unknown / Unanswered, with no default
   _(contract §13)_.
10. **Final Net P&L and Trader Outcome are separate, optional, strongly prompted inputs** _(contract
    §11–§13)_.
    - Trader Outcome (Win / BE / Loss) is chosen by the trader and never preselected from sign or R.
    - "Use recorded exits as final result" is offered only when history is Complete and every
      relevant exit has P&L, and it applies only when pressed.
11. **System Result input** _(contract §15)_:
    - Money is the suggested unit; direct R is allowed.
    - Comparability is an explicit choice: net / comparable or gross only.
    - It is never prefilled or inferred from the actual result or from price.
12. **Deviation Type and Reason** use the provisional taxonomy _(contract §18)_. The option set must
    be changeable without a data or interaction redesign, and "Other" remains available. The final
    taxonomy is deferred to UX prototyping (Appendix A).
13. **Every control is labelled.** Numeric fields open numeric keyboards, and forms stay usable with
    password managers, autofill and paste where relevant.

---

## 9. Trading terminology and localization

1. **Preserve familiar trading vocabulary** _(contract §26)_: TP, SL, P&L, R, Win / Loss / BE,
   Long / Short, Entry / Exit, Partial Close, Risk, Strategy, Setup.
2. **Pair terms with plain explanations where helpful** — Target Profit (TP), Stop Loss (SL), Net P&L
   with a short helper.
3. **Product concepts use plain language and helper text:** System Result, Actual Result, Exit
   Plan, Execution Impact, Risk Deviation, Needs Review.
4. **Internal terms never reach the screen:** provenance, calculation authority, reconciliation
   state, dependency snapshot, persistence semantics _(contract §26)_. Their meaning is expressed in
   plain words, such as "Recalled after close", "Added during trade", "From Strategy: <name>" or
   "Needs Review — Strategy changed".
5. **Win / Loss / BE belongs to Trader Outcome only.**
   - The System side uses Positive / Flat / Negative, No Trade and Cannot Determine
     _(contract §16)_.
   - New UI MUST NOT use "System Win Rate"; the metrics are **System Positive Rate** and **Trader
     Win Rate** _(contract §25)_.
6. **Unanswered, not recorded and Unknown read differently** in every locale. One phrase must not
   stand for more than one of them.
7. **Meaning is fixed here; final copy is not.**
   - The labels quoted in this document and the contract fix intent. Examples: "Actual risk
     differed", "From Strategy: <name>", "Use strategy default", "Use recorded exits as final
     result", "Reviewed — nothing else to add", "Trade Saved", "Review Trade", "Done", "Finish".
   - Wording may be refined in `messages/` if the meaning and the state distinction survive.
8. **Thai copy follows the [localization glossary](localization-glossary.md):** preserve familiar
   trading vocabulary, and localize for comprehension, not literal translation.
   - This document does **not** lock Thai wording; final Thai copy is deferred to UX/copy
     prototyping (Appendix A).
   - Proposed Thai terms for new concepts (for example Positive / Flat / Negative, System Positive
     Rate, Unanswered vs Unknown) still need native-copy validation.
9. **Money formatting is locale-independent; dates pin the Gregorian calendar** in both locales
   _(design-system §13)_.

---

## 10. Capture vs Review

1. **Capture records observations; Review interprets them.**
   - Capture surfaces are At Entry, After Trade, Record Exit, Partial / Final Close, and ordinary
     notes or data capture on an Open or Partially Closed Trade.
   - Review holds Reflection, Discipline / Behavior and System Assessment _(contract §21)_.
2. **Capture never requires Review.** No Capture Save waits on Reflection, adherence or System
   Assessment _(contract §13–§14)_.
3. **Review never silently rewrites Capture.** Changing a captured observation from within Review is
   an explicit edit of that observation, keeping its origin and adding revision metadata. Review
   interpretation is stored alongside it, never over it _(contract §9, §22)_.
4. **At Entry shows no result or Review surfaces:** no Final P&L, Trader Outcome, System Result,
   System Assessment or Review _(contract §6)_.
5. **After Trade captures what happened** but does not present Reflection or System Assessment as a
   step before Save _(contract §13)_. The lifecycle's After-Trade Context stage (§20) is Capture:
   it never holds Reflection, rule checks, mistakes, Exit Plan Adherence or System Assessment.
6. **Post-Trade Emotion** may be captured at Final Close, in After Trade, or in Review. It is always
   separate from, and never overwrites, Entry Emotion _(contract §9)_.
7. **Formal Review exists only for Closed Trades** and is entered only by the trader's choice —
   after a closing save or later from the Trade (§5.9–§5.10, §14.2).

---

## 11. At Entry UX rules

1. **Question:** _What am I doing and why?_ Every element either answers it or is optional context.
2. **Fast save.** Save Open Trade needs only Account, Symbol, Direction and Risk at Entry greater
   than zero _(contract §4, §6)_. Everything else is optional, and Save is reachable without
   scrolling through optional sections. In the stepped Record Open Trade flow, Save is available
   from the Plan & Risk stage onward once those minimum fields are valid; it never waits for
   Setup & Checklist or Entry Context & Evidence (§20.4).
3. **Entry time** defaults to now, and stays visibly editable and clearable.
4. **Risk at Entry** is prominent as the 1R baseline. "Actual risk differed" follows §3.4: unopened
   states the match visibly; opened records Different, with an amount or with the amount unknown.
5. **Target** is Unanswered until chosen: Fixed Target (Target Profit, TP price, or both — at least
   one) or No Fixed Target _(contract §5)_.
6. **Exit Plan inheritance** _(contract §5)_:
   - While the trader has not made an explicit Exit Plan choice, the selected Strategy's default
     plan is inherited and labelled "From Strategy: <name>".
   - If the Strategy changes before any explicit choice, the inherited plan follows the newly
     selected Strategy's default, still labelled.
   - The trader can customize, replace with another plan, reject the inherited plan, or choose No
     Defined Exit Rule.
   - Any explicit override suppresses inheritance for this Trade. Changing Strategy afterwards does
     not bring a default back.
   - Inheritance returns only through an explicit restore action such as "Use strategy default".
   - A generic "Clear" is avoided.
7. **Strategy and Setup** — Unanswered / No Strategy (No Setup) / Selected, never collapsed
   _(contract §7)_. Conditions come from the selected Strategy/Setup version and are answered
   Met / Not Met / Unanswered. At Entry offers no Unknown _(contract §8)_.
8. **Confidence** has no default. **Entry emotions** are Unanswered, None of these, or selected
   emotions _(contract §9)_.
9. **No result, outcome, System Assessment or Review** appears (§10.4).
10. **After Save Open Trade** the confirmation offers no Review (§5.9).
11. **Later additions while the Trade is open are not "at entry"** _(contract §7, §9)_.
    - Psychology, Strategy, Setup, condition answers or Exit Plan first supplied after the first
      successful Save Open Trade are shown as added during the trade.
    - Edits to at-entry observations keep "recorded at entry" plus an edited indication.
    - An Open or Partially Closed Trade accepts ordinary notes and data capture, not formal Review.
12. **Mobile is a quick-entry experience.** The Save minimum and Save action come first, and
    everything else is progressive (§16).

---

## 12. After Trade UX rules

1. **Question:** _What actually happened?_ The surface accepts that some facts are unknown or were
   never recorded _(contract §13)_.
2. **Minimum Trade identity** — Account, Symbol and Direction are required to save _(contract
   §13)_. **Timing** — optional Entry time and final exit time, which may stay blank (§4.9).
3. **Save Closed Trade does not require Risk at Entry, Final Net P&L or Trader Outcome** _(contract
   §13)_. Missing values stay missing, reduce analytical coverage, and are never manufactured.
   Final Net P&L and Trader Outcome are strongly prompted (§7.8).
4. **Actual Risk starts Unanswered** and offers explicit **Matched Risk at Entry**, **Different**
   (with an amount, or amount unknown) and **Don't know** _(contract §4)_. It never silently assumes
   a match, and an unanswered or unknown Actual Risk does not block the System-vs-Actual
   comparison.
5. **Result:**
   - Final Net P&L and a trader-selected Trader Outcome, with the quiet sign notice (§7.7).
   - Actual R appears only when Final Net P&L and Risk at Entry are both known; otherwise its
     reason is shown.
6. **No current defaults are applied to a historical Trade** _(contract §5, §7)_.
   - Strategy defaults and Exit Plan defaults are not auto-applied.
   - If the trader chooses a current saved rule, it is presented as selected during
     reconstruction, never as the historical rule version, unless that version is provably the
     one in place at entry.
7. **Conditions** additionally offer Unknown / Don't remember, which is never counted as Not Met
   _(contract §8)_.
8. **Exit events** follow §8.8. Reason-only exits and unknown scope are valid, and unknown-scope
   exits never drive lifecycle. Completeness uses §8.9.
9. **Recalled context is labelled as recalled** _(contract §7, §9)_. Recalled Confidence, Entry
   Emotion, Strategy, Setup, condition answers and Exit Plan keep that origin even after later
   edits. Post-Trade Emotion is separate.
10. **Everything the trader entered persists** on Save Closed Trade _(contract §13)_.
11. **Reflection and System Assessment are not required** and are not steps of the form.
12. **After Save Closed Trade:** Trade Saved → Review Trade / Done (§5.9).

---

## 13. Partial / Final Close UX rules

1. **Lifecycle is explicit:** Open → Partially Closed → Closed. The Trade shows its current
   lifecycle state and whether position remains _(contract §11)_.
2. **Record Exit on a live Trade** requires scope, Part or All Remaining. Every other exit field is
   optional _(contract §10)_.
3. **Partial Close does not ask for whole-Trade results.**
   - Final Net P&L and Trader Outcome are not requested.
   - A running exit subtotal may be shown only when labelled as partial supporting history, not a
     result.
4. **All Remaining closes the position** even when earlier percentages are incomplete. There is no
   block and no percentage re-weighting _(contract §10)_.
5. **Final Close requires explicit confirmation that the remaining position is closed** — the All
   Remaining scope or the Close Remaining action. The interface never closes a Trade as a side
   effect of another input _(contract §11)_.
6. **At full close** the trader can record Final Net P&L, Trader Outcome and exit-history
   completeness, plus Post-Trade Emotion _(contract §9, §11)_.
   - Final Net P&L and Trader Outcome are strongly prompted but optional (§7.8); missing values
     reduce coverage and are never manufactured.
   - Incomplete exit history never blocks closing.
7. **"Use recorded exits as final result"** is offered only when exit history is explicitly Complete
   and every relevant exit has P&L. It applies only when pressed _(contract §11)_.
8. **Discrepancy language** is used only when history is explicitly Complete, every relevant exit
   has P&L, and the subtotal differs from Final Net P&L.
   - Both values are shown, and Final Net P&L is authoritative. It never blocks.
   - With Incomplete, Unknown or Unanswered history, the two figures may be shown but MUST NOT be
     called a discrepancy _(contract §11)_.
9. **Neither value is silently overwritten.**
10. **A closing Final Close / Close Remaining** shows Trade Saved → Review Trade / Done (§5.9).
11. **Later edits to Final Net P&L** recompute Actual R and Difference and do not mark System
    Assessment as Needs Review _(contract §22)_.
12. **Canceled** remains a lifecycle state, but its creation and transition UX is outside the Add
    Trade redesign v1. A redesign MUST NOT invent a Cancel Trade flow _(contract §20)_.

---

## 14. Review UX rules

1. **Question:** _What should have happened, and what can I learn?_
2. **Formal Review is for Closed Trades only, optional and chosen** _(contract §20)_.
   - Open and Partially Closed Trades may carry ordinary notes and data capture but are not formally
     reviewed, and no Review action or Review attention is shown for them.
   - On Closed Trades, Not Reviewed and Not Assessed may show soft attention; Review is never
     forced, auto-entered or scored.
3. **Three conceptual areas, no gating:**
   - Reflection;
   - Discipline / Behavior — Entry Discipline, Risk Discipline, Exit Plan Adherence, Deviation Type
     and Reason, Mistakes;
   - System Assessment _(contract §21)_.
4. **No completion percentage.** Reviewed never requires a note, a mistake, a Strategy or a System
   Assessment _(contract §21)_.
5. **Reviewed is an explicit trader action (Finish)** _(contract §20–§21)_.
   - "Reviewed — nothing else to add" is a valid completion: Finish with both reflection prompts
     (_What would you repeat?_, _What would you change?_) blank. No separate value is stored, and
     Review never asks "What happened?" _(decision 43)_.
   - A Reviewed Trade never returns to Not Reviewed, and the interface offers no "mark as not
     reviewed" action.
   - A Review can be reopened and edited, then Finished again, which updates review completion
     metadata. Work in a reopened Review is a Review Draft (§5.4).
   - System Assessment staleness (Needs Review) stays separate from the Review lifecycle.
6. **System Assessment asks, in order of meaning** _(contract §15)_:
   1. Would your rules have taken this trade? — yes, or **No Trade**. **Cannot Determine** is an
      answered finding available whenever the trader cannot establish the system outcome, and it
      is never presented as incomplete _(contract §14)_.
   2. If yes: what should have closed it? — Fixed Target, Initial SL, break-even rule, trailing
      exit, time/session exit, another predefined rule, or discretion the system explicitly allows.
   3. What result would following the rule have produced? — Money (suggested) or R, marked net /
      comparable or gross only, and never prefilled.
   4. System R — derived from System Money ÷ Risk at Entry, or given directly.
   5. Were these rules actually in place before entry?
   6. Did the trader follow them? — the canonical Exit Plan Adherence answer.
   7. If deviated: how and why? — Deviation Type and Reason.
7. **Rules that need a trader-stated result:**
   - A TP-price-only Fixed Target confirmed as hit, and any dynamic Exit Plan, ask the trader for
     the System Result in Money or R.
   - Price is never used to fill it _(contract §5, §15)_.
8. **One Exit Plan Adherence answer** _(contract §18)_.
   - It appears in both Discipline and System Assessment as the same field. The committed answer
     shows in both places, and the interface never offers two committed answers that could
     disagree.
   - Answers are Followed / Partly / Not Followed / Unknown / Not Answered, plus **Not Applicable**
     only when the Trade explicitly has No Defined Exit Rule _(decision 44)_. A recalled or
     unrecorded plan does not make the answer Unknown automatically.
   - Finish Review and Confirm System Assessment both commit it. If the saved answer changed since a
     draft began editing it, the commit stops and shows the latest saved answer and the draft
     answer with **Use latest saved answer**, **Replace with my draft answer** and **Go back**;
     only Replace overwrites _(decision 45)_.
   - When the Exit Plan is merely Not recorded, Not Applicable is never inferred; adherence stays
     Not Answered until the trader answers.
9. **System vs Actual shows System R, Actual R and Difference.**
   - Difference appears only when the System result is net / comparable and both R figures use
     Risk at Entry.
   - A gross-only result shows System R without a Difference and says why.
   - Risk Deviation is secondary _(contract §15, §17)_.
10. **Adherence and Execution Impact are separate readings.** A combination such as Not Followed
    with a positive impact is presented neutrally, as valid _(contract §19)_.
11. **Needs Review** presents the preserved finding, what changed, and explicit actions to reconfirm
    or update it _(contract §14, §22)_. Only dependencies the assessment actually used trigger it.
    Reflection is never invalidated automatically.
12. **Review interpretation never rewrites original observations** _(contract §9)_. Post-Trade
    Emotion may be recorded here, and Entry Emotion stays untouched.
13. **Discipline axes stay separate.** Entry, Risk and Exit Discipline are not merged into a single
    score _(contract §25; CLAUDE.md §6)_.

---

## 15. Analytics integrity in UX

1. **System and Trader performance are labelled and grouped separately** _(CLAUDE.md §1)_.
2. **Trader Win Rate** _(contract §25)_:
   - It counts only trader-selected Trader Outcomes.
   - BE is in the denominator, not the numerator.
   - Unanswered is excluded, never counted as a loss.
   - Legacy-derived outcomes are excluded by default.
   - The surface shows coverage, such as how many closed Trades the rate is based on.
3. **System Positive Rate** _(contract §16, §25)_:
   - It is Positive ÷ eligible canonical System Results.
   - It excludes Not Assessed, No Trade, Cannot Determine, Needs Review (until reconfirmed),
     gross-only (every gross-only result in v1, _decision 47_) and legacy results. The exclusions
     are shown as coverage, never as Negative.
   - Positive / Flat / Negative may be shown as a distribution and never labelled Win / Loss / BE.
4. **Canonical and legacy never mix silently.**
   - Legacy R, legacy outcomes and Price-mode results may appear on historical Trades with their
     provenance.
   - A legacy cohort, if shown, is separately labelled _(contract §28)_.
5. **Missing is coverage, not failure.** Charts, filters, tables and breakdowns never fold
   Unanswered, not-recorded or Unknown values into No, Not Met, None, zero, Loss or Negative.
   Closed Trades saved without Risk at Entry, Final Net P&L or Trader Outcome reduce the coverage of
   the metrics that need them _(contract §13, §24)_.
6. **Uncomputable metrics state their reason** instead of showing `0`, `NaN` or `∞`
   _(design-system §8; CLAUDE.md §6)_.
7. **Evidence limits are visible.** Insight wording avoids precision the sample cannot support and
   never states correlation as causation _(contract §25)_.
8. **Observation origin is respected.** Recorded-at-entry observations are not silently pooled with
   ones added during the trade or recalled after close _(contract §7, §9, §25)_.
9. **A metric's population SHOULD be inspectable** where a drill-down exists, so the definition
   can be checked against the data. This rule adds no required analytics feature.
10. **Price-derived context never enters canonical metrics** _(contract §3)_.
11. **Every data surface ships loading, empty, error and success states,** and empty states teach
    the next action _(design-system §8)_.

---

## 16. Responsive behaviour

1. **Same semantics at every width.**
   - Presentation may adapt, but a state may never be dropped or merged.
   - A multi-state question never becomes a binary toggle on a phone.
   - A distinction visible on desktop is available on mobile.
2. **Mobile At Entry is quick entry.** The Save minimum and Save come first; optional sections are
   progressive _(CLAUDE.md §8; design-system §6)_. In the stepped flow the Save minimum lives in
   the first two stages, and Save is offered from the second (§20.4).
3. **No horizontal page overflow** from 320px upward. Exit history and other wide content scroll
   inside their own container or switch to a card presentation _(design-system §6)_.
4. **Nested editors on small screens** may present full-height, keeping §5.2 semantics. The system
   back gesture behaves as Back / Close and keeps the Draft.
5. **The on-screen keyboard** must not hide the focused field or its error. Numeric fields open
   numeric keyboards, and negative values stay enterable where allowed (§8.3).
6. **Touch targets** meet the visual system's minimum _(design-system §6)_.
7. **Resize, rotation and backgrounding** never lose Draft content, disclosure answers or focus
   context.

---

## 17. Accessibility and interaction

1. **Baseline** — WCAG AA contrast, visible focus, full keyboard operation, semantic landmarks,
   labelled controls, and associated errors _(design-system §12)_.
2. **Every state is programmatically exposed.**
   - Unanswered is an option group with no selection, announced as such.
   - Unknown, None and Not Applicable are named options.
   - Inherited values are announced as inherited ("From Strategy: <name>").
   - The At Entry Actual Risk state is announced: matches Risk at Entry, Different with an amount,
     or Different with amount unknown.
   - Blank fields are never announced as `0`.
3. **Meaning never relies on colour, icon or position alone.** States, notices, attention indicators
   and System buckets carry text.
4. **Keyboard rules for editors:**
   - Escape closes and keeps changes (§5.2), and focus returns to the control that opened the
     editor.
   - Discard Changes is reachable by keyboard and named explicitly.
   - Enter inside a nested editor never submits the whole Trade.
5. **Focus management** — a failed save attempt moves focus to the error summary or first invalid
   field. Trade Saved moves focus to the confirmation and its Review Trade / Done choice. The
   sign-out draft warning receives focus and names both choices.
6. **Live announcements** use a persistent polite live region for save progress, success, failure,
   recovered draft and quiet notices _(design-system §12)_.
7. **Helper text and disclosures never depend on hover.** They are reachable by keyboard and touch.
8. **Nothing time-limited.** Choices and confirmations do not auto-dismiss or auto-advance.
9. **Motion** respects `prefers-reduced-motion` and never gates access to content _(design-system
   §7)_.

---

## 18. AI redesign guardrails

**If a visual/interaction design cannot represent the approved product semantics clearly, stop and
report the conflict rather than simplifying the semantics.**

1. **Read order for any redesign:** the approved Product Contract → this document → `CLAUDE.md` and
   technical constraints → the visual system → current code.
2. **Neither current production nor the prototype is an authority.** They are evidence. Reuse their
   interaction ideas only where they satisfy the contract and these rules. Do not reconstruct or
   invent audit reports that are not in the repository.
3. **Known prototype conflicts must not be copied** _(prototype reconstruction)_:
   - a blocking exit-history conflict;
   - adoption of the exit subtotal before save;
   - outcome words that sign an amount;
   - a Review surface before save.
4. **A redesign MUST NOT:**
   - reintroduce a Money/Price result-basis switch, a Plan mode, or a Price-result mode;
   - derive P&L, R, System Result or Trader Outcome from price, or derive Trader Outcome from sign
     or R;
   - block Save on a plausible price inconsistency;
   - preselect an answer, or give Confidence, Trader Outcome, conditions, emotions, Target,
     adherence or System Result a default;
   - fold Unanswered, not recorded, Unknown, None, Known Zero and negative answers into fewer states
     to simplify a control;
   - add "Don't know" controls to every optional field, or remove the ones §4.9 requires;
   - accept zero as Risk at Entry, or save a Fixed Target with neither Target Profit nor TP price;
   - silently revert an opened "Actual risk differed" to Matched;
   - carry an untouched default (the "now" Entry time, an implicit Actual Risk match, an inherited
     Exit Plan) into After Trade as a historical answer, or treat hidden draft data as confirmed;
   - use Win / Loss / BE, or "System Win Rate", on the System side;
   - make dismissal (X, Escape, outside click, Back, Close, mode switch) destructive, or delete
     mode-specific draft values on a mode switch;
   - let a draft surface for another user or workspace, or sign out over an unsaved draft without
     warning;
   - add blocking validation beyond §6.1 — including requiring Risk at Entry, Final Net P&L or
     Trader Outcome to save a Closed Trade — or block on a notice;
   - offer Review after Save Open Trade or for an Open / Partially Closed Trade, auto-enter Review,
     add a completion percentage, require content to mark a Trade Reviewed, or return a Reviewed
     Trade to Not Reviewed;
   - auto-apply a current Strategy or Exit Plan default in After Trade, re-apply a rejected
     inheritance, or use a generic "Clear" for Exit Plan;
   - show two editable Exit Plan Adherence answers, or infer Not Applicable from a Not recorded Exit
     Plan;
   - invent a Cancel Trade flow;
   - expose internal technical vocabulary;
   - mix legacy and canonical values, or count excluded records as negative;
   - freeze the Deviation Type / Reason taxonomy, or lock Thai copy that still needs native
     validation.
5. **Styling decisions stay in the visual system.** A redesign that changes appearance only still
   passes the §19 checklist.
6. **When semantics seem to need a new decision,** record the question and stop. Do not resolve it
   in UI.

---

## 19. UX review checklist

Use this for every design, prototype, pull request or AI-generated redesign touching these flows.

**Semantics and states**

- [ ] Every contract state is representable: Unanswered, not recorded, Unknown, None, Known Zero,
      Known Value, negative answer, Not Applicable, Inherited, Legacy, and the Needs Review overlay
      (§4).
- [ ] No answer is preselected beyond the three contract-sanctioned starting values (§4.1).
- [ ] Blank numeric fields stay blank through blur, collapse, reload and save (§4.2).
- [ ] Unanswered and not-recorded values never read as No, Not Met, Loss, zero or Negative (§4.3,
      §15.5).
- [ ] "Don't know" controls appear exactly where §4.9 requires them.
- [ ] Capture origin (at entry / during trade / recalled) is kept for psychology, Strategy, Setup,
      conditions and Exit Plan, and edits never change it (§4.7).
- [ ] There is no Money/Price basis switch, price derives no result, and a price inconsistency is
      only a notice (§8.1–§8.2).
- [ ] Win / Loss / BE appears only for Trader Outcome, and Trader Outcome is never derived (§8.10,
      §9.5).
- [ ] Exit Plan inheritance is visible, overridable, suppressed after override, and restored only
      explicitly. There is no generic "Clear" (§11.6).
- [ ] After Trade applies no current defaults and presents Actual Risk as Unanswered (§12.4, §12.6).
- [ ] An opened "Actual risk differed" without an amount stays Different, amount unknown (§3.4).

**Draft, navigation and validation**

- [ ] Done, X, Escape and outside dismissal keep changes in every editor, and Discard Changes
      restores the editor checkpoint (§5.2).
- [ ] Back, Close and route change keep the Draft; Add Trade and Review Drafts survive reload
      (§5.3–§5.4).
- [ ] A mode switch carries explicit shared values, hides but keeps mode-specific values, and never
      turns an untouched default (the "now" Entry time, an implicit Actual Risk match, an inherited
      Exit Plan) into an After Trade answer (§5.5).
- [ ] Drafts never cross users or workspaces, and sign-out warns before clearing an unsaved draft
      (§5.11).
- [ ] Save failure keeps the Draft, and retry cannot duplicate a Trade (§5.7).
- [ ] Only §6.1 requirements and invalid input block Save; notices and strong prompts never block
      (§6.1–§6.3, §7.8).
- [ ] Risk at Entry, when entered, is greater than zero, and Fixed Target has a Target Profit or TP
      price (§6.1).
- [ ] Save explains what is missing instead of being silently disabled (§6.5).
- [ ] Review is offered only after Save Closed Trade or a closing Final Close / Close Remaining,
      never after Save Open Trade, and never auto-entered (§5.9–§5.10).

**Capture, close and Review**

- [ ] At Entry shows no Final P&L, Trader Outcome, System Result, System Assessment or Review
      (§10.4).
- [ ] Save Closed Trade requires only Account, Symbol and Direction; neither it nor Final Close
      requires Risk at Entry, Final Net P&L or Trader Outcome, and both prompt for the latter two
      (§6.1, §12.2–§12.3, §13.6).
- [ ] Final Close requires explicit confirmation that the remaining position is closed (§13.5).
- [ ] Partial Close asks for no whole-Trade result, and All Remaining closes without percentage
      completeness (§13.3–§13.4).
- [ ] Exit subtotal adoption is explicit and offered only for a Complete, fully priced history.
      Discrepancy language appears only under all three conditions (§13.7–§13.8).
- [ ] No Cancel Trade flow was invented (§13.12).
- [ ] System Result is trader-stated in Money or R, marked net or gross-only, and never prefilled
      (§8.11, §14.6).
- [ ] There is one Exit Plan Adherence answer; Not Applicable appears only with No Defined Exit
      Rule; Execution Impact is shown separately (§14.8, §14.10).
- [ ] Formal Review is available only for Closed Trades (§14.2).
- [ ] Reviewed is explicit via Finish, never reverts to Not Reviewed, and can be reopened and
      Finished again, with no completion percentage and no required content (§14.4–§14.5).
- [ ] Needs Review keeps and shows the prior finding, and Final Net P&L changes do not trigger it
      (§13.11, §14.11).

**Analytics, language, responsive and accessibility**

- [ ] System Positive Rate and Trader Win Rate use their contract populations and show coverage
      (§15.2–§15.3).
- [ ] Legacy and canonical values are never silently mixed (§15.4).
- [ ] Uncomputable values show a reason, never `0` (§7.10, §15.6).
- [ ] Familiar trading vocabulary is preserved, and internal terms are absent (§9.1, §9.4).
- [ ] Thai copy follows the glossary, and unvalidated Thai wording is not treated as final (§9.8).
- [ ] Semantics are identical at 320px, tablet and desktop, with no horizontal page overflow
      (§16.1, §16.3).
- [ ] Every state is exposed programmatically, meaning never relies on colour alone, and focus and
      live announcements follow §17.
- [ ] Any semantic conflict found was reported rather than simplified away (§18).

**Recording lifecycle**

- [ ] Every question sits in its canonical stage, and no flow asks the same question on two steps
      (§20.1–§20.2).
- [ ] Record Open Trade offers Save from Plan & Risk once its minimum is valid, and never waits on
      later stages (§20.4).
- [ ] Close Existing Open Trade shows stages 1–4 as preserved context, never as a re-entry form,
      and reaches Closed only through the explicit close confirmation (§20.5).
- [ ] Review and System Assessment are not a step of any flow (§20.7).
- [ ] At Entry Exit Plan inheritance stays visible when the Strategy is chosen on a later step, and
      Record Closed Trade never inherits (§20.8).
- [ ] The protected Step 1 baseline is unchanged unless a real regression is being fixed (§20.9).

---

## 20. Recording lifecycle and task flows

_(contract §1 Recording lifecycle, decision 50)_ Recording a Trade is one lifecycle presented
through task flows. The lifecycle organizes the questions this document already governs; it adds no
new state or requirement, and every rule in §1–§19 still applies inside every stage.

1. **Six canonical stages.** Each stage owns its questions, wherever a flow presents it:

   | Stage                            | Questions                                                                                                                                                                               |
   | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **1 — Trade Details**            | Account, Symbol, Direction, Entry time                                                                                                                                                  |
   | **2 — Plan & Risk**              | Risk at Entry, with the recording mode's Actual Risk follow-up beside it (§3.4, §12.4); Target (Target Profit, TP price); Exit Plan; price levels — Entry, SL, size — folded as context |
   | **3 — Setup & Checklist**        | Strategy, Setup, setup conditions                                                                                                                                                       |
   | **4 — Entry Context & Evidence** | Confidence, Entry Emotion, trade idea / reason, timeframe, session, chart, notes                                                                                                        |
   | **5 — Exit & Result**            | Exit events and exit-history completeness, final exit time, Final Net P&L, Trader Outcome, and Actual R when it can be derived                                                          |
   | **6 — After-Trade Context**      | Capture-only context about the close, such as Post-Trade Emotion                                                                                                                        |

2. **A stage decides meaning; a flow decides order.** Canonical order and task presentation order
   may differ. Moving a stage in a flow never changes what its answers mean, which defaults apply,
   what Save requires or what provenance is written. A flow never asks one question on two of its
   steps.
3. **Moving between steps is view state, never draft state.** Every step's answers stay in the
   Draft whichever step is shown, and routine navigation follows §5. No step locks another; only
   §6.1 requirements block Save, and a blocked Save opens the step holding the first error.
4. **Record Open Trade — stages 1 → 2 → 3 → 4, then Save Open Trade.**
   - Save Open Trade is available from Plan & Risk onward once Account, Symbol, Direction and Risk
     at Entry greater than zero are valid, with no other §6.1 error. Setup & Checklist and Entry
     Context & Evidence are optional to save and never presented as unimportant (§2.4).
   - The flow shows no Exit & Result or After-Trade Context stage, and no result, outcome, System
     Assessment or Review (§10.4). Confirmation offers no Review (§5.9).
5. **Close Existing Open Trade — stages 5 → 6, then Closed.**
   - Stages 1–4 are the Trade's existing, preserved context. They are shown as read-only context,
     never as a form to fill again. Changing one is an ordinary edit of the saved Trade that keeps
     its capture origin and adds revision metadata (§4.7, §11.11).
   - Exit & Result follows §13: a live exit's scope is required, a Part exit records a Partial
     Close with no whole-Trade result, and the Trade reaches Closed only through the explicit All
     Remaining / Close Remaining confirmation.
   - After-Trade Context and the whole-Trade result belong to the close that reaches Closed.
   - A close that reaches Closed shows Trade Saved → Review Trade / Done (§5.9). Work survives
     routine dismissal; durable reload recovery is not claimed (§5.4).
6. **Record Closed Trade — Trade → Result → Plan → Setup → Entry Context → After-Trade Context**,
   that is stages 1, 5, 2, 3, 4, 6. Result comes early because it answers the moment's question
   (§2.3, §12.1). Save Closed Trade needs only the minimum Trade identity and stays available from
   every step once it is valid (§6.1, §12.2).
7. **Review and System Assessment are not a stage.** No flow contains Reflection, rule checks,
   mistakes, Exit Plan Adherence or System Assessment as a step. Formal Review stays post-save, for
   Closed Trades only, entered by the trader's choice (§10, §14).
8. **Exit Plan inheritance across stages** follows §11.6 and §12.6 unchanged:
   - **Record Open Trade:** while the Exit Plan is still in its inherited state, the selected
     Strategy's default is inherited automatically and visibly, and changing the Strategy updates
     the inherited plan. Because the Strategy is chosen in Setup & Checklist and the Exit Plan is
     shown in Plan & Risk, the update is stated where the Strategy is chosen — for example "Exit
     Plan: From Strategy: <name>" — and Plan & Risk shows the plan as inherited. Once the trader
     explicitly overrides the Exit Plan, Strategy defaults are no longer followed until an explicit
     restore such as "Use strategy default".
   - **Record Closed Trade:** no Strategy or Exit Plan default is ever applied or offered
     retrospectively.
9. **The Step 1 baseline is protected.** Trade Details keeps its current interaction baseline —
   read-first launcher rows, one editor overlay per concept, the Saved Symbols picker, the entry
   date and time controls, motion, on-screen keyboard handling, and the progress, header and footer
   behaviour — in every flow that shows it. It changes only to fix a real regression.
   Mode-specific semantics, such as At Entry's editable and clearable "now" Entry time (§11.3),
   are added inside the existing Entry date and time interaction, not by redesigning the step.
   Visual expression stays governed by [`DESIGN.md`](../DESIGN.md).
10. **Setup & Checklist is multi-state.** "Checklist" names the stage, not a control: each
    condition is Met / Not Met / Unanswered, plus Don't remember in Record Closed Trade, never a
    binary checkbox (§8.4, §11.7, §12.7).
11. **Money is the result; Price is context** in every stage (§8.1–§8.2). The TP price stays with
    the Target it describes, and Entry, SL and size stay folded, labelled context in Plan & Risk.
12. **"Evidence" in a stage name means context the trader attaches**, such as a chart. It is never
    presented as verified, and it is not the Capture evidence Review reads (§9.4).

---

## Appendix A — Deferred items

The UX/product boundary questions raised in v1 of this document are resolved by Add Trade contract
decisions 24–40 and applied above. What remains is **deliberately deferred**. None of these items
blocks visual design or interaction design; each has a safe rule to follow meanwhile.

| Item                                                          | Deferred to                 | Meanwhile                                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final Thai copy for new concepts                              | UX/copy prototyping         | Follow the glossary; treat proposed Thai terms as unvalidated (§9.8).                                                                                                                                          |
| Deviation Type / Reason taxonomy                              | UX prototyping              | Keep the provisional options changeable, with "Other"; never freeze them into a rigid definition (§8.12) _(contract §18)_.                                                                                     |
| Cancel Trade creation / transition UX                         | After Add Trade redesign v1 | Canceled stays a lifecycle state; no Cancel flow is designed (§13.12) _(contract §20)_.                                                                                                                        |
| Durable reload recovery for Record Exit, Final Close, editing | Later than v1               | Preserve work across routine dismissal during the interaction; claim no reload recovery (§5.4) _(contract §23)_.                                                                                               |
| Automatic draft-retention time (TTL)                          | Implementation policy       | Drafts stay user/workspace-scoped and are cleared by explicit sign-out after a warning (§5.11) _(contract §23)_. Current policy: an Add Trade Recording Draft untouched for 30 days is removed when next read. |
| Price-derived context displays (distance, pips)               | Later exploration           | None required; if explored, labelled context only, never calculation authority (§8.2) _(contract §3)_.                                                                                                         |
| Cross-device draft sync                                       | Not a requirement           | Never imply a draft is synced (§5.4) _(contract §23)_.                                                                                                                                                         |
| After-Trade Context contents beyond Post-Trade Emotion        | Before stage 6 is built     | Hold only capture-only close context the contract already defines; never Reflection, adherence, rule checks, mistakes or System Assessment (§20.7).                                                            |
| Attached evidence (chart images) in a Recording Draft         | Before stage 4 attachments  | Keep the TradingView link as the chart context; an upload a draft holds must not be orphaned by Discard, sign-out or retention cleanup (§5.6, §5.11).                                                          |
| Final EN / TH copy for lifecycle stage names                  | UX/copy prototyping         | The §20.1 names fix meaning, not final copy (§9.7–§9.8).                                                                                                                                                       |
| Astra interaction/data-integrity findings                     | Not available               | None exist in the repository and none are reconstructed; the contract and these rules are the current authorities.                                                                                             |

If new questions arise, record them here and stop rather than deciding them in UI (§18.6).

---

## Appendix B — Current implementation evidence

Implementation evidence only, recorded so redesign and migration work can find the gaps. These are
**current implementation pending migration**, not approved behaviour
(see [`CLAUDE.md`](../CLAUDE.md) §6 _Current implementation pending migration_):

- The live exit/close and execution-correction flows offer a Money/Price basis and a Price actual
  result (§8.1). At Entry and After Trade no longer do.
- A Stop or Target on the wrong side of Entry is rejected as a validation error in the legacy plan
  and execution paths rather than shown as a non-blocking notice (§6.2, §7.7). At Entry and After
  Trade show the notice.
- Trader Outcome is derived from R with a ±0.05R band or from P&L sign on a live close (After Trade
  records the trader's own choice since migration 0023), and a Win/Loss/BE
  `system_outcome` and System Win Rate are still shown (§8.10, §9.5, §15.3).
- Journal overlays treat Cancel / Escape as discard (§5.2).
- **Add Trade Recording Draft (implemented 2026-09-17, §5.1, §5.3–§5.8, §5.11):** one durable,
  browser-local draft per user and workspace backs At Entry and After Trade; reload recovery with a
  recovered notice, non-destructive mode change, one confirmed whole-draft discard, save-failure
  preservation with an idempotent retry key, clear only after a confirmed Save, and a naming
  sign-out warning (see [`docs/data-dictionary.md`](data-dictionary.md) _Browser-local Add Trade
  Recording Draft_):
  - ~~**Carry across modes is narrower than §5.5.**~~ Closed with the After Trade migration: every
    explicit shared answer now crosses both ways, including condition answers, the Target answer,
    an explicit Exit Plan and an explicit Actual Risk "Different"; envelope version 2 upgrades a
    version-1 draft once, explicitly.
  - ~~**The `/admin` shell's sign-out** does not warn or clear Add Trade drafts.~~ Closed
    2026-09-18: `/admin` sign-out now warns, names the drafts and clears only that owner's, reusing
    the product shell's own mechanism.
- ~~After Trade redirects straight to the Review tab instead of offering Trade Saved → Review Trade /
  Done (§5.9–§5.10).~~ Closed with the After Trade migration.
- A Complete-history exit conflict blocks saving on a legacy row, and a live close derives net P&L
  from exit legs (§6.2, §13.8). After Trade keeps Final Net P&L authoritative with a non-blocking
  discrepancy notice.
- A closed Trade counts as reviewed when review notes exist, rather than by an explicit Reviewed
  action (§14.5).
- `plan_adherence` has no Not Applicable answer (§14.8).
- ~~Setup condition checks store only Met / Not Met, exit rows cannot be reason-only, and no
  observation origin is stored for psychology, Strategy, Setup, conditions or Exit Plan (§4,
  §12.7–§12.9).~~ Closed by migrations 0021–0023: conditions may be Don't remember (`unknown`),
  After Trade exits may be reason-only with an Unknown scope, and capture origin is stored.
- ~~**Capture origin has no record-surface presentation.**~~ Closed with the After Trade migration:
  Trade Details names when Strategy, Setup, Exit Plan, confidence, setup conditions and entry
  emotions were captured ("Recorded at entry", "Added during trade", "Recalled after close"); a
  legacy row falls back to "Captured at entry" / "Added after entry" from the assignment time. The
  whole-Trade "Recorded retrospectively" disclosure (contract §28, Phase 15G.5C) stays on the Trade
  Details Plan tab.
- **Recording lifecycle (§20), 2026-09-22:**
  - Record Open Trade (At Entry) is still one linear page, not the stepped 1 → 2 → 3 → 4 flow, and
    its Save does not yet follow §20.4's stage rule.
  - Record Closed Trade (After Trade) still presents five steps — Trade, Result, Plan, Context
    (Strategy, Setup, conditions, Confidence, Entry and Post-Trade Emotion, trade idea) and Save
    (market context, notes) — rather than §20.6's six. Its Plan step renders the shared Plan & Risk
    stage (commit `cc4e380`), with price levels folded there.
  - Close Existing Open Trade does not exist as a contract flow: closing still uses the legacy exit
    and close paths described above (§8.1, §8.10). Contract-compliant Record Exit / Final Close is a
    separate prerequisite.
- Timestamp fields use native date-time inputs (§8.5 — acceptable only if they meet the timezone,
  clearing and accessibility rules).
