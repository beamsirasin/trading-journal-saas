# TradeChemist — DESIGN.md

> **Status:** v1 (2026-09-15). The visual-design authority for TradeChemist.
>
> **Position in the documentation chain.** Each level controls its own domain, and a lower level
> never overrides a higher level's semantic or behavioural decision
> ([`docs/product-contracts/README.md`](docs/product-contracts/README.md)):
>
> 1. **Approved Product Contracts** — what things **mean**
>    ([Add Trade](docs/product-contracts/add-trade.md)).
> 2. **[`docs/UX_RULES.md`](docs/UX_RULES.md)** — how the product **behaves**.
> 3. **`CLAUDE.md` and canonical technical docs** — engineering constraints.
> 4. **This document** — how the product **looks**: visual philosophy, hierarchy, composition and
>    visual rules. **[`docs/design-system.md`](docs/design-system.md)** is its implementation
>    reference: concrete tokens, component implementations and measured decisions (§ _Relationship
>    to `docs/design-system.md`_).
> 5. **Historical documents** — Phase documents, reviews, screenshots and the frozen prototype.
>
> If a visual idea here would blur a contract state or a UX behaviour, the higher document wins. If
> the visual system cannot represent an approved semantic clearly, **stop and report the conflict**;
> never simplify the semantic to make a screen cleaner.
>
> **Scope.** Visual direction only. This document does not redesign any page, does not change
> information architecture, and does not define product states or interaction behaviour. Where a
> rule names a state (Unanswered, Needs Review, Legacy…), the state's meaning comes from the
> contract and its behaviour from UX Rules; this document only says how it should look.
>
> **Inputs.** The approved contract, UX Rules, `CLAUDE.md`, `docs/design-system.md`, the current
> production code (`src/app/globals.css`, `src/components/**`) and dated review screenshots
> (`docs/reviews/**`, 2026-08-28 → 2026-09-04, older than the latest code). The structure and several
> principles draw on the [awesome-claude-design](https://github.com/VoltAgent/awesome-claude-design)
> `DESIGN.md` format — keeping token, rule and rationale together; a surface ladder instead of
> borders everywhere; an accent reserved for meaning; hairline before shadow; no atmospheric
> decoration — adapted to a trading journal rather than copied from any listed product. Inspection
> findings are in [Appendix A](#appendix-a--inspection-findings) and the conceptual evaluation in
> [Appendix B](#appendix-b--direction-evaluation).

---

## Quick reference for agents

1. **Hierarchy comes from plane, type and space — not from boxes.** Reach for a border or card last.
2. **Density follows the task.** Capture breathes, Review structures, Analytics compares.
3. **One strong action per region.** Never two equally loud calls to action in one view.
4. **Colour states a meaning, always with words.** Direction, status, selection, series — nothing
   decorative.
5. **Answered, unanswered and default must look different at a glance** — without making unanswered
   look wrong.
6. **Trader Outcome and System Result never share a visual form.** Win / BE / Loss is a Trader
   Outcome word; the System side is a signed figure and a Positive / Flat / Negative bucket.
7. **Same hierarchy in Light, Dark, English and Thai.** Hierarchy that depends on uppercase or on
   one theme's contrast is broken hierarchy.
8. **Mobile is recomposed, not shrunk.**
9. **Nothing below 12px. No hidden labels. No colour-only meaning.**
10. **Use the canonical primitive** (§18) before inventing a variant.

---

## 1. Design principles

Eight principles. Each one exists to settle a visual decision, not to restate UX Rules.

1. **Hierarchy before decoration.** Decide what the reader must see first, second and never, then
   express it with type weight, plane and spacing. Borders, tints, icons and gradients are allowed
   only after hierarchy already works in greyscale.
2. **Progressive density.** Density rises only where the task is comparison. A Capture form shows
   one question group at a comfortable measure; a report may show a dense table. Complexity is never
   solved by making text small.
3. **Calm surfaces, strong actions.** Surfaces are quiet and neutral; the single most important
   action in a region is unmistakable; everything else steps down in weight.
4. **Colour is a sentence, not a mood.** A colour always means one thing — money direction, a status
   tone, a selection, a chart series — and that meaning is also said in words, sign or shape. A
   colour that means nothing is removed.
5. **Answers look answered.** A recorded answer, an untouched question, an explicit "none", a
   default still waiting for confirmation, and a legacy value each have a distinct, calm visual
   form. Unanswered is neutral, not alarming; a default is visibly a default.
6. **The finding gets the type.** Where a number is the answer — Final Net P&L, Actual R, System R,
   Execution Gap — it carries the strongest typographic treatment on its surface. Supporting numbers
   and prose stay quiet. Where no number is the finding (most of Capture), no number is dressed up.
7. **One hierarchy across themes and scripts.** Light and Dark express the same planes, emphasis and
   status in their own materials. Thai has no letter case and needs taller line-height, so hierarchy
   never depends on uppercase, tracking or tight leading.
8. **Structure only where it carries meaning.** A card is a boundary around something that stands
   alone; a divider separates things that are genuinely different; numbering marks a real sequence;
   an eyebrow names a real category. Anything else is spacing.

---

## 2. Visual personality

**What TradeChemist communicates:** a careful, trustworthy notebook for decisions — the calm of a
good financial product with the curiosity of an analytical tool. It respects the trader's records as
something serious, and it respects the trader as someone learning.

| Axis                    | Position                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Seriousness             | High enough to trust with money records; never solemn. Plain sentence-case language, no hype.                                    |
| Warmth                  | Quiet warmth through generous spacing, human questions ("Where was your head?"), and neutral treatment of emotions and mistakes. |
| Restraint               | Strong. One accent family (blue / cyan identity, `CLAUDE.md` §8), used for action, focus and selection — not for area.           |
| Analytical character    | Precise figures, tabular alignment, honest coverage and caveats. Never theatrical charts or animated numbers.                    |
| Whitespace              | Whitespace separates groups before lines do. Capture and Review are airy; analytics spends space on comparison, not padding.     |
| Density by default      | Low to medium. Dense only on surfaces whose job is comparison.                                                                   |
| Beginner / professional | Beginners get plain labels, visible helper text and one question at a time; professionals get speed, precision and no clutter.   |

**What it is not:**

- not a trading terminal (no ticker tape, candlestick decoration, flashing figures, wall-to-wall
  grids);
- not a crypto casino (no neon, glow, gradients as reward, confetti, streaks or badges for trading);
- not gamified (no scores, levels or celebratory outcome states — a win is data, not a prize);
- not a generic SaaS dashboard (no identical rounded cards chopping every page, no tracked-out caps
  eyebrow above every heading, no stat-card-plus-sparkline by reflex);
- not enterprise-heavy (no dense chrome, nested panels or toolbars on every surface);
- not emptily minimal (fields and states are never removed to make a screenshot cleaner);
- not a clone of TradeZella, TradeDee or any other journal. Benchmarks calibrate measurements
  (`docs/design-system.md` records several); they never set identity.

---

## 3. Surface hierarchy

TradeChemist uses a **surface ladder**: each level is one perceptible step from its neighbour.
Levels are expressed by plane (lightness step), then hairline, then shadow — in that order of
preference.

| Level | Role                                   | Expression                                                                                                          |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| L0    | App ground (canvas)                    | The page background. Carries nothing but the workspace.                                                             |
| L1    | Shell (header chrome, sidebar)         | A stable frame that recedes. The header chrome stays dark in both themes (`docs/design-system.md` §2).              |
| L2    | Primary workspace plane                | Where the page's content lives — one plane per region, not one per group.                                           |
| L3    | Inset / answer plane                   | A step inside L2 for the figure that is the answer, a selected choice, an input well or a nested read-only summary. |
| L4    | Overlay (popover, menu, dialog, sheet) | Lifted with elevation and, for modal overlays, a scrim. Overlays never stack more than one modal deep.              |
| —     | Selected / active                      | A neutral step plus an explicit marker (check, indicator, weight). The accent marks the marker, not the whole area. |

Rules:

1. **Two planes inside a workspace, at most.** L2 with an L3 inset is the deepest nesting on a page.
   A third nested plane means the grouping is wrong.
2. **Plane before border.** Adjacent regions separate by plane contrast and spacing. A hairline is
   used where planes are too close to read (mostly Light) or where structure is tabular.
3. **Shadow means "above".** Shadow is reserved for L4 overlays and for Light-theme L2 planes whose
   plane contrast alone cannot hold an edge. Dark L2 planes do not need shadow to be visible.
4. **Selection is not elevation.** A selected option or row does not get a card shadow; it gets the
   neutral active step plus its marker.
5. **Equivalent hierarchy in both themes.** Dark lifts by getting lighter; Light lifts by getting
   whiter on a tinted ground with a soft shadow. A reviewer should be able to point at the same
   levels in a Light and a Dark screenshot of the same page.
6. **Capture is one plane.** A Capture form is a single workspace plane with grouped content, not a
   stack of bordered group boxes.

---

## 4. Typography

One family for prose and UI (**Noto Sans Thai**, covering Latin and Thai — see
`docs/design-system.md` §4) plus a tabular figure treatment for numbers. No additional families.

Typography is expressed as **roles**. Implementations map each role to a token in
`docs/design-system.md`; a call site never picks a raw size.

| Role             | Job                                                   | Visual rule                                                                                                      |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Page title       | The single `<h1>` naming the destination              | Largest UI role, semibold, balanced wrap. In Capture it is compact — a flow title, not a hero.                   |
| Section title    | Names a region within a page                          | Clearly above body in weight; smaller than page title. The landing-page section role is not used inside the app. |
| Group title      | Names a set of fields or readings                     | Body size, semibold. Sentence case. Written as a plain name or a human question.                                 |
| Field label      | Names one control                                     | Body-small, medium weight, full contrast. Always visible above or beside the control.                            |
| Primary number   | The figure that is the answer                         | Metric / KPI role, semibold, tabular figures, sign always shown for signed values.                               |
| Secondary metric | A supporting reading beside a primary number          | Body size, semibold, tabular figures, foreground colour (not muted, not tinted).                                 |
| Explanatory text | A sentence that helps the reader decide or understand | Body-small, muted, readable measure (≤ ~70 characters per line), sentence case.                                  |
| Helper text      | One short clarification attached to a field           | Body-small or caption (never below 12px), muted, attached to its field, one to two lines.                        |
| Status text      | Names a state (Saved, Needs Review, Not assessed)     | Body-small, medium weight, paired with an icon; tone from §8. Readable without its colour.                       |
| Compact data     | Table cells, dense report rows                        | Body-small with tabular figures; headers caption size, medium weight, muted, sentence case.                      |

Rules:

1. **Nothing below 12px** (existing rule, `docs/design-system.md` §1). Caption is the smallest role.
2. **Weight and size carry hierarchy, not case.** Sentence case is the default for labels, headers,
   tabs and buttons. Uppercase with tracking is reserved, at most, for a rare structural label and
   never used as the only hierarchy signal, because Thai renders it as ordinary text.
3. **Numbers need stronger treatment than prose where they are compared or are the finding:**
   tabular figures, explicit sign, consistent decimals within one column or group, unit (`R`,
   currency) set lighter than the digits but never omitted.
4. **Numbers inside sentences stay proportional.** Tabular treatment is for figures that align or
   are read as data.
5. **No "not available" shaped like a number.** A missing figure is words ("Needs Risk at Entry"),
   set in the explanatory role — never `0`, `—` pretending to be a value, or a greyed number.
6. **Thai rhythm is part of the role.** Every role keeps script-appropriate line-height and removes
   Latin tracking for Thai (implemented in `globals.css`); a new role must do the same.

---

## 5. Spacing and density

Spacing is built on the 4px grid Tailwind already provides. Rhythm has **four relationship
distances**; choosing among them is the design decision.

| Relationship | Meaning                                       | Typical distance                                                               |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Bound        | Label ↔ control ↔ helper ↔ error of one field | 4–8px                                                                          |
| Related      | Fields or readings in one group               | 12–16px                                                                        |
| Grouped      | One group ↔ the next group in a region        | 24–32px                                                                        |
| Sectioned    | One page section ↔ the next                   | 32–40px (Capture, Review); 16–24px (analytics, per `docs/design-system.md` §5) |

Rules:

1. **Distance encodes relationship.** If two things are further apart than two unrelated things
   elsewhere on the page, the rhythm is wrong.
2. **Groups are separated by space and a group title first**, a divider second, a box last.
3. **Card padding is proportional to the card's job:** compact readings 16px; standard regions
   16px mobile / 20–24px desktop; a prominent answer region may take more. Do not pad a card to fill
   empty space.
4. **Dense analytical areas tighten rows and gaps, not type.** A dense table keeps body-small text
   and caption headers; it reduces vertical padding and removes decorative gaps.
5. **Density islands are allowed.** A comparison inside a calm surface — exit history in After Trade,
   a System vs Actual strip in Trade Detail — may be locally dense while its surroundings stay calm.
6. **Mobile compresses space before content.** Section and group distances shrink first (roughly
   one step down); field height, touch targets and text roles do not shrink.
7. **Measure matters.** Prose and single-question Capture content hold a readable measure; wide
   screens give analytics more columns, not wider text lines.

---

## 6. Forms

Forms are where truth is captured. Their visual job is to make each question clear, each answer
unambiguous, and optional analytical data inviting.

**Text and number inputs**

- One input style (`Input`, 44px) for every text, money, price and R field. Visible label above;
  helper under the label; error under the control.
- Placeholder text is an example of format, never a label and never a number that could be read as
  a recorded value (no `0.00` placeholders).
- Inputs sit on an input well that reads as "a place to type" in both themes; focus is the ring from
  §17, not a colour change of the well alone.

**Money inputs**

- The account currency is visible as an adornment or suffix, not only in the label.
- Tabular figures; the value is displayed exactly as entered and formatted on blur without rounding.
- Sign is explicit. Where the platform keyboard has no minus, a visible sign control sits beside the
  field (UX Rules §8.3) and reads as part of the field, not as a separate toggle.
- A blank money field looks empty, not zeroed.

**Price-context inputs**

- Price fields (entry, SL, TP, exit prices) are **context**. They are visually grouped as context —
  a group titled as price context, placed after the money fields that decide results — but use the
  same input style and text size. Context is signalled by grouping and order, not by shrinking.
- **No Money/Price mode switch, toggle, tab or segmented control is ever designed.** Money and price
  fields coexist; price never looks like an alternative basis for a result.
- A price-consistency notice (for example a stop above entry on a Long) appears as a quiet notice
  beside the price group (§8), never as field error styling.

**Choices (radios, choice cards, segmented answers)**

- **Two different controls, two different looks.**
  - _Recorded answers_ (Target state, Actual Risk, conditions, adherence, Trader Outcome, exit scope)
    use a **choice group**: every option neutral at rest; the selected option shows a neutral active
    step **plus** an explicit marker (radio dot or check) and a stronger label weight. No option looks
    pre-selected, and a group with no selection reads as calmly unanswered.
  - _View switches and filters_ (date range, tabs, list/calendar) use the **segmented control**: a
    neutral track with a travelling indicator. It is never used for a recorded answer, because a
    segmented control always looks like one segment is "on".
- Explicit **None**, **Don't know** and **Not applicable** options are full options in the same group
  with the same weight as the others — never a dimmer link, never a dashed "lesser" chip that reads
  as optional garnish. They may sit slightly apart to show they are a different kind of answer.
- Descriptions under choice labels are explanatory text, one line where possible.

**Selects**

- Native `<select>` styled like `Input` on forms (`docs/design-system.md` §6). Its empty state is a
  visible "Choose…" style option that cannot be mistaken for a chosen value.

**Confidence and emotion controls**

- **Confidence** shows its steps and labels clearly. With no answer there is no knob, fill or
  highlighted step — an untouched control must not suggest 0% or 50%. The selected step shows value
  and level word together.
- **Emotions** are neutral chips with no valence colour: a feeling is not a mistake. Grouping labels
  are group titles in sentence case, not caps eyebrows. "None of these" is a first-class option with
  equal weight.

**Optional fields**

- One optional marker everywhere: the word "Optional" in muted text after the label, sentence case.
  No parentheses, no `· optional` suffix, no asterisk convention for required fields.
- Optional analytical fields (Strategy, Setup, conditions, confidence, emotions) keep full-size
  labels, full-contrast inputs and a place in the main reading order. **Optional looks optional, not
  unimportant.**

**Progressive-disclosure triggers**

- A disclosure trigger is a text control with a chevron and a **summary of what is inside** ("2
  answers", "Not answered") so a collapsed group never hides that it holds data (UX Rules §3.2).
- Triggers are not cards and not primary buttons. A disclosure that opens an editor surface
  (dialog/sheet) looks like a launcher row: title, current summary, chevron.

**Helper text, validation and notices**

- Helper text: muted, attached to its field, short. It is never the only place a requirement lives.
- **Field error:** destructive colour on the error text and control border, an icon, and plain
  language. Errors appear at the field; a compact summary appears near the save action on submit.
- **Notice** (possible mistake, data quality): quiet warning tone, icon, text, placed next to what it
  concerns; no destructive colour, no filled alert box.
- **Default awaiting confirmation** (e.g. Entry time defaulted to now): the value is shown with a
  small "Default" indication that disappears once the trader edits or confirms it.

**Semantic-state guardrail.** A form may restyle a control, but it may never collapse Unanswered /
Unknown / None / Known Zero / Negative into fewer visual states (UX Rules §4).

---

## 7. Action hierarchy

| Level       | Use                                                                                       | Visual form                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Primary     | The one action that completes the region's job (Save Open Trade, Done)                    | Filled accent button. At most one per region; at most one page-level primary.                                                      |
| Secondary   | A real alternative the trader may want (Record Exit, Review Trade)                        | Outlined or neutral-filled button.                                                                                                 |
| Tertiary    | Low-commitment or navigational ("Back", "View all")                                       | Ghost button or text link.                                                                                                         |
| Destructive | Destroys data or work (Discard draft, Delete trade)                                       | Destructive text or outlined at first touch; filled destructive only on the confirmation that performs it.                         |
| Contextual  | Acts on one object (edit a row, open an exit)                                             | Icon-plus-label or small ghost button next to the object; icon-only only with an accessible name and when the icon is unambiguous. |
| Inline      | Changes one field or reveals one detail ("Use strategy default", "Use closing exit time") | Text button at body-small, accent text, within the field's bound distance.                                                         |

Rules:

1. **No competing primaries.** If two actions both look primary, one of them is secondary.
2. **Destructive is never the easiest target.** It is not the rightmost filled button and not
   adjacent to the primary without separation.
3. **Discard Changes inside an editor is destructive-text, not a filled red button** — it removes
   edits but not data, and Done must remain the obvious completion.
4. **Long Capture forms keep the primary action reachable**: a sticky action bar at the bottom of
   the workspace (desktop) or viewport (mobile), holding the primary action and a short status line
   (what is still needed, saving, draft kept). The status line is one sentence, not a list of every
   field name.
5. **On mobile the action bar respects safe areas and the keyboard.** It never covers the focused
   field or its error; while the keyboard is open it may move into the content flow (as the adaptive
   overlay already does).
6. **Save and confirmation surfaces present choices, not a race.** "Review Trade" and "Done" after a
   closing save are equal-weight choices: same footprint and emphasis, no primary styling that would
   read as a preselected default, and neither animates attention (UX Rules §5.9).
7. **Button labels are verbs in sentence case** that name the result ("Save open trade"), and keep
   the same name as the confirmation that follows ("Trade saved").

---

## 8. Status and feedback

Status is told by **tone + icon + words**. Colour alone never carries it. Tones are few:

| Tone        | Meaning                                         | Allowed for                                                                             |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Neutral     | A fact about state, nothing to worry about      | Draft, Saving, Not Reviewed, Not Assessed, Cannot Determine, No Trade, Legacy, coverage |
| Info        | Helpful context                                 | Information, recovered draft, explanations                                              |
| Warning     | Attention or a possible mistake                 | Notice, Needs Review, strong attention                                                  |
| Destructive | Something failed or is invalid                  | Error only                                                                              |
| Accent      | Selection and confirmation of the user's action | Saved confirmation, selected marker                                                     |

**`positive` and `negative` are not status tones.** They mean money / R direction (§9) and are never
used for Saved, Closed, Resolved, Complete or any lifecycle state.

| State                  | Tone            | Visual treatment                                                                                                                    |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Draft (kept/recovered) | Neutral / Info  | Small status line near the form's action ("Draft kept on this device"); recovered draft uses an info notice with its two choices.   |
| Saving                 | Neutral         | Pending label on the action and in the status line; no spinner overlay over the form; the form stays visible.                       |
| Saved                  | Accent          | Short confirmation with a check icon naming what was saved and its lifecycle state. Not green.                                      |
| Error                  | Destructive     | Icon + message + retry; field errors at fields. The draft remains visibly intact.                                                   |
| Information            | Info            | Inline text with an info icon; boxed only when it introduces a whole region.                                                        |
| Notice                 | Warning (quiet) | Icon + one sentence next to the subject; text-level emphasis, no fill or a very light tint; dismissible only if the product allows. |
| Attention (soft)       | Neutral         | Outline dot or ring icon + label (e.g. "Not reviewed"). Calm enough to ignore.                                                      |
| Not Reviewed           | Neutral         | Soft attention form. Shown on Closed trades only.                                                                                   |
| Not Assessed           | Neutral         | Soft attention form.                                                                                                                |
| Needs Review           | Warning         | Stronger attention: warning icon + "Needs review" + what changed; the preserved prior finding stays visible beside it.              |
| Cannot Determine       | Neutral         | Answered form (solid neutral icon), never incomplete styling.                                                                       |
| No Trade               | Neutral         | Answered form, same family as Cannot Determine.                                                                                     |
| Legacy-derived data    | Neutral         | The value is shown normally with a "Legacy" label and history icon beside it; never faded to near-invisibility.                     |

Rules:

1. **Coverage is not an error.** Missing analytical data, exclusions and small samples use the
   neutral tone with explanatory text ("Based on 42 of 58 closed trades"). Warning or destructive
   tones are never used to express "incomplete but valid".
2. **One status indicator per axis.** Trade lifecycle, Review lifecycle and System Assessment each
   get their own indicator; they are never merged into one chip (UX Rules §2.7).
3. **Status chips are for state, not labels.** Categories (Strategy name, symbol) are plain text.
4. **Feedback appears where the eye already is** — at the field, beside the action, or on the
   record — before any global toast. Toasts are reserved for events outside the current view.
5. **Nothing blinks, pulses or loops** to demand attention.

---

## 9. Analytical colour

Colour in figures and charts answers one question: _does this colour tell me something I need in
order to compare or decide?_

| Meaning                          | Colour                       | Rule                                                                                                                                                                |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money / R direction              | `positive` / `negative`      | Only on signed results where direction is the finding (Final Net P&L, Actual R, System R, Total R, Execution Gap). Sign always shown too.                           |
| Zero / flat                      | Foreground                   | Zero and Flat are neutral — never positive, negative or accent coloured.                                                                                            |
| Levels and ratios                | Foreground                   | Win rate, System Positive Rate, expectancy, profit factor, counts: readings, not verdicts.                                                                          |
| Trader Outcome (Win / BE / Loss) | Tinted word badge            | A word chip labelled as the trader's outcome; Win/Loss tints may echo direction hues; BE is neutral. Always the word, never a bare dot.                             |
| System Result bucket             | Figure-first, bucket as text | The signed figure carries direction colour; "Positive / Flat / Negative" is secondary text, **never** a Win/Loss/BE badge or the same chip shape as Trader Outcome. |
| System vs Trader series          | `system` / `trader` series   | Identity colours for the two axes in charts; the System line is dashed (hypothetical), the Trader line solid (happened).                                            |
| Warnings / attention             | `warning`                    | Status only (§8). Never used to colour a metric.                                                                                                                    |
| Selection / focus                | Accent                       | Marker, focus ring, active indicator. Never used for a money direction or an outcome.                                                                               |
| Chart categories                 | `chart-1…4`, fixed order     | Validated palette (`docs/design-system.md` §9); a fifth series folds into Other.                                                                                    |
| Analytics zones                  | Zone accents                 | Chrome only (rule, icon, heading); never a data encoding or a card fill.                                                                                            |

Rules:

1. **Colour a figure only when its direction is the point.** Supporting cells stay foreground.
2. **Trader Outcome and System Result must not be visually interchangeable.** Different shape
   (chip vs figure), different words (Win/BE/Loss vs Positive/Flat/Negative) and an axis label. A
   screen showing both must still read correctly in greyscale.
3. **A hue has one job per theme.** Accent (action/selection), a series colour and an outcome tint
   must be distinguishable in the same view. Where current tokens share a hue across these jobs
   (Appendix A, finding 7) that is a defect to resolve in tokens, not a pattern to copy.
4. **No red/green-only encodings.** Direction also shows as sign, arrow or label.
5. **Legacy and canonical values never share a series or a colour** without a visible legacy label.

---

## 10. Cards and containers

A card is a **boundary around something that stands on its own**. Use one when at least one is true:

- it is an independent object the reader can act on or open as a whole (a trade row on mobile, a
  recent trade, a launcher to an editor);
- it holds an answer that must be read as one unit (a System vs Trader panel, a chart with its
  caption and coverage);
- it has its own actions or its own state indicator;
- it floats above something else (a popover, a sheet).

Do **not** use a card:

- for a group of form fields — use a group title and spacing;
- to fill empty width or height;
- inside another card — use an L3 inset plane instead, once;
- as a default wrapper for every section of a page.

Rules:

1. **Page → card → inset** is the deepest container structure.
2. **Cards in one region share one radius, one padding scale and one border rule.** Different card
   styles mean different kinds of object, never different authors.
3. **Interactive cards look interactive** (hover step, focus ring, chevron or affordance) and
   non-interactive cards do not hover.
4. **An outline is optional in Dark** when plane contrast separates the card; Light keeps a hairline
   or soft shadow where contrast cannot (already implemented for the Dashboard).
5. **Capture forms are not built from cards.** Launchers that open editors may be card-like buttons;
   the form itself is one plane.

---

## 11. Tables and analytical views

1. **Numeric columns right-aligned** with tabular figures, consistent decimals per column, and the
   unit in the header or set lighter after the digits.
2. **Headers:** caption size, medium weight, muted, sentence case; sortable headers show sort state
   with an icon and text for assistive tech; headers stay visible when the table scrolls.
3. **Rows:** comfortable desktop height with enough vertical padding to scan, no zebra striping by
   default; hairline dividers between rows; interactive rows show a hover step and a visible focus
   state; touch rows meet 44px.
4. **Selected rows** use the neutral active step plus a leading indicator and `aria-selected`; never
   a saturated fill.
5. **Secondary metadata** goes on a second line in muted body-small inside the primary cell, not in
   extra columns that force horizontal scrolling.
6. **Status chips:** at most one chip per status column per row, icon + word; categories stay plain
   text.
7. **Missing values** are words in muted text ("Not recorded"), aligned like the column's content;
   never `0` and never an empty cell that looks like a rendering gap.
8. **Mobile transformation:** below tablet width a table becomes record cards (existing pattern):
   the primary identity and the primary figure first, two to three supporting readings, status last.
   A true comparison matrix may scroll horizontally inside its own labelled container instead.
9. **Dense does not mean small.** Report tables keep body-small text; density comes from padding,
   column discipline and fewer decorative elements.

---

## 12. Charts

A chart exists to answer one stated question. Its caption says the question or the takeaway.

1. **Restrained series.** One to four series; the System vs Trader comparison is two lines. More
   categories fold into Other or become small multiples.
2. **Grid and axes stay behind the data:** horizontal gridlines only, faint and dotted; no vertical
   grid unless time comparison needs it; axis labels at caption size (never below 12px), muted;
   explicit zero line on signed/cumulative R.
3. **One y-axis.** Never two scales in one plot.
4. **Tooltips** use the shared tooltip shell: label, series swatch plus name, value with sign and
   unit, and coverage context when relevant. Tooltips never contain the only copy of a number that
   matters.
5. **Selected points** show a single marker and a crosshair/cursor, not a glow.
6. **Positive/negative semantics** follow §9: bars for signed values may use direction colours; line
   identity uses series colours; the two schemes are never mixed in one mark.
7. **Empty and insufficient data** are stated in text in the chart's area ("Needs at least 5 closed
   trades with a System Result") with the next action where one exists — never an empty axis frame
   or a flat line at zero.
8. **Coverage indicators** sit with the caption ("42 of 58 trades"), in neutral tone.
9. **No decoration:** no gradient area fills for emphasis, no 3D, no animated drawing beyond a short
   entrance that respects reduced motion (`docs/design-system.md` §7, §9).
10. **Every chart ships its caption and a hidden data table** (existing `ChartContainer` rule).

---

## 13. Navigation and shell

The current information architecture stays. These rules govern how the shell looks.

1. **The shell recedes.** Header chrome, rail and secondary panel are quiet frames; the workspace is
   always visually dominant. The active route is marked by a neutral step plus an accent icon, not a
   large tinted block (`docs/design-system.md` §2).
2. **Desktop:** fixed icon rail plus a labelled secondary panel. Labels are visible whenever the
   panel is open; the collapsed rail shows icons with accessible names and tooltips.
3. **Mobile:** the header bar plus the focus-trapping drawer (not a bottom bar). The drawer shows
   full labels; it uses the same active-state treatment as desktop.
4. **Page header:** left-aligned page title, optional one-sentence description, actions on the right
   (desktop) or below (mobile). Descriptions are optional and short; data surfaces may omit them.
5. **Contextual toolbar** (filters, date range, account) sits directly under the page header, stays
   sticky on analytical pages, and uses one control family (`ToolbarTrigger`).
6. **Capture flows use a focused frame** with minimal chrome and a compact title. The frame's title
   area never consumes the first screen on mobile.
7. **Account and settings surfaces** are functional: lists and forms on one plane, restrained
   headings, no dashboard-style cards.

---

## 14. Responsive composition

Components **recompose** by priority. Semantics and actions stay equivalent at every width
(UX Rules §16).

| Width band                          | Composition intent                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop (≥1280px)                   | Full workspace; multi-column analytics; Capture keeps a readable measure with optional side context.                                                     |
| Laptop / intermediate (1024–1279px) | Secondary context collapses first (side panels become sections below); navigation panel may be collapsed; analytics drop a column before shrinking type. |
| Tablet (768–1023px)                 | Single main column with paired regions where comparison needs it; tables still tables.                                                                   |
| Mobile (≈390px)                     | One primary column; recomposed priority order; tables become record cards; sticky capture actions.                                                       |
| Narrow mobile (320px)               | Same content and actions as mobile; wrap rather than truncate labels; indicators drop to their own line rather than disappear.                           |

Rules:

1. **Dialogs become sheets below tablet width** (the adaptive overlay). **Long editors become
   full-height sheets or full-screen editors** on mobile, with the title, a clear Done and the
   Discard Changes action in a persistent footer.
2. **Actions become sticky** for long Capture and Review forms on mobile, and for long forms on
   desktop when the primary action would otherwise leave the viewport.
3. **Secondary context collapses** (behind a disclosure with a summary) before primary content is
   reduced; nothing required or answered becomes invisible.
4. **Analytical tables transform** to record cards below tablet width; true comparison matrices
   scroll inside their own container.
5. **Labels remain visible** at every width: no placeholder-as-label, no icon-only form controls,
   no truncated side names in a two-sided comparison.
6. **Do not simply stack desktop.** A mobile KPI area becomes a priority list — the lead figure
   first, supporting readings grouped — rather than a grid of equal tiles. A paired comparison
   (System vs Trader) stays paired in compact rows rather than splitting into two distant cards.
7. **Tabs that hide required or answered content are avoided on mobile** — prefer a single scrolling
   flow with section titles and a compact jump list.
8. **Container queries** size widgets inside partial-width columns (`docs/design-system.md` §6).

---

## 15. Light and Dark themes

Both themes are first-class. Dark remains the product default (`CLAUDE.md` A8); Light is not its
inversion.

| Aspect             | Dark                                                                            | Light                                                                                             |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Surface hierarchy  | Ground darkest; planes lift by lightness steps; overlays lightest.              | Tinted ground; planes white; hairline or soft shadow where plane contrast is insufficient.        |
| Borders / dividers | Low-alpha light hairlines, used sparingly; plane contrast does most separation. | Visible cool-neutral hairlines; used for tables, inputs and card edges that contrast cannot hold. |
| Text hierarchy     | Near-white primary; muted for supporting; no pure white text walls.             | Near-black primary; muted blue-grey supporting; subtle text only for tertiary metadata.           |
| Interaction states | Hover/active as lightness steps; accent limited to markers and focus.           | Hover/active as tint steps; the same markers and focus.                                           |
| Analytical colours | Brighter direction and series hues validated on the dark card plane.            | Deeper hues validated as text on white; never reuse the action accent for an outcome or series.   |
| Charts             | Faint grid, series validated for CVD on dark.                                   | Same grid logic with light hairlines; series re-validated for light.                              |
| Overlays           | Scrim plus a lifted plane with deep elevation.                                  | Scrim plus white plane with soft elevation.                                                       |

Rules:

1. **Same levels, same emphasis, same status.** A theme may change material, never meaning or rank.
2. **Dark is neutral and readable, not black-and-neon.** The ground should read as a deep neutral
   rather than as true black; accents stay desaturated enough to avoid glow; large areas never carry
   saturated colour.
3. **Light has real surface hierarchy.** Ground, plane and inset are distinguishable at a glance;
   Light must not look like an unfinished wireframe.
4. **Themes share a temperature.** Dark and Light should feel like the same product; one theme being
   pure neutral grey while the other is blue-tinted is a drift to correct (Appendix A, finding 8).
5. **Every colour change is re-validated** for contrast and colour-vision separation in both themes
   (`docs/design-system.md` §2, §9).
6. **The header chrome stays dark in both themes** unless a later decision changes it; its tokens
   must be edited independently of the page tokens.

---

## 16. Motion

Motion shows **what changed because of what the trader did**.

| Communicates              | Treatment                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Opening / closing context | Dialogs, sheets and menus enter from their origin (fade + small scale or slide); exit faster. |
| Selection change          | Segmented and navigation indicators travel; selected choices change state without bounce.     |
| Validation                | Errors appear in place with a short fade; no shaking.                                         |
| Disclosure                | Height/opacity reveal on the disclosed content only; the rest of the page does not jump.      |
| Save state                | Label change on the action and status line; confirmation fades in; no progress theatre.       |
| Reordering                | Items move to their new position with the shared layout transition, where reordering exists.  |

Rules:

1. **No decorative motion on Capture.** No section entrance animations, staggered field reveals or
   hover lifts on form groups.
2. **No motion delays input or content.** Nothing waits for an animation to finish.
3. **Financial figures never count or tween through false values** (`docs/design-system.md` §7).
4. **Reduced motion** replaces travel with fades or instant state changes; state must remain
   readable (existing global guard and `usePrefersReducedMotion`).
5. **Durations and easings come from the motion tokens**; a component never invents timing.

---

## 17. Accessibility

Accessibility is part of the visual language (baseline in `docs/design-system.md` §12, UX Rules
§17).

1. **Visible focus:** a 2px ring with offset on every interactive element, in both themes, never
   removed or replaced by colour alone.
2. **Contrast:** WCAG AA for text and 3:1 for meaningful non-text marks (selected markers, chart
   lines, input borders), measured on the actual plane the element sits on.
3. **Non-colour indicators:** every status, direction, selection and series has a word, sign, icon
   or line style.
4. **Target size:** 44px for touch targets and inputs; dense desktop controls may be smaller only
   inside a row that itself meets 44px.
5. **Keyboard:** focus order follows visual order; sticky bars and overlays never trap or hide focus.
6. **Zoom and text scaling:** layouts survive 200% zoom and larger text without clipped labels,
   overlapping sticky bars or horizontal page scroll.
7. **Readable error states:** error text is full size, full contrast in the destructive tone, and
   close to its field; a red border alone is never the message.
8. **Touch:** no hover-only information; helper text and indicator details open on tap.
9. **Minimum text size 12px**, and Thai line-height rules apply to every role.

---

## 18. Component consistency rules

Canonical primitives, to be consolidated in later implementation work (no refactor in this task):

| Need                          | Canonical primitive (existing or to consolidate into)                       | Duplication found                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Text / number input           | `ui/input`                                                                  | Consistent today; keep.                                                                                                           |
| Field with label, hint, error | One shared `Field` (today `trade-recording-primitives` `Field`)             | Recording forms share it; other forms hand-roll label/error markup.                                                               |
| Recorded-answer choice group  | One `ChoiceGroup` (today in `trade-recording-primitives`)                   | `ChoiceGroup`, `trade-recording-mode-selection` (custom radiogroup), emotion and reflection chip toggles.                         |
| View switch / filter          | `ui/segmented-control` (page) and `ui/menu-segmented-row` (menus)           | Justified pair; keep both, document which is which.                                                                               |
| Status indicator              | `status/status-badge` (icon + tone + words)                                 | `trade-status-badge`, `trade-outcome-badge`, `product/outcome-badge`, ad hoc `rounded-full px-2` chips (~20 files).               |
| Trader Outcome display        | One outcome chip (from `trade-outcome-badge`)                               | `product/outcome-badge` (demo, own sizes and BE styling) diverges.                                                                |
| Notice / callout              | A new shared inline notice (tone + icon + text)                             | ~32 files style `bg-warning/10`, `bg-info/10`, `bg-destructive/10` boxes by hand.                                                 |
| Section heading               | `product/page-header` `SectionHeader` (+ `ZoneSection` for Analytics zones) | `SectionHeading` (numbered circles), `SectionTitle`, `SubSection`, ad hoc `h5` in review.                                         |
| Card                          | `ui/card`                                                                   | 26 imports vs ~61 hand-rolled `bg-card border rounded-*` wrappers.                                                                |
| Adaptive editor overlay       | `trades/trade-adaptive-overlay` (dialog ≥ tablet, sheet below)              | Plain `ui/dialog` (12 uses) and `ui/sheet` (8) used directly for similar editors.                                                 |
| Confirmation                  | `ui/alert-dialog`                                                           | Keep; 14 uses.                                                                                                                    |
| Buttons                       | `ui/button` variants                                                        | Every size already renders at the 44px minimum; nominal `xs`/`sm` sizes are visual density only and should be documented as such. |
| Metric label / value          | `MetricLabel` + figure roles                                                | Caps vs plain variants; mono/`numeric` figure utility vs sans figures in forms.                                                   |
| Radius                        | Four role-named radii (control, card, overlay, pill)                        | `rounded-lg` 220, `rounded-md` 188, `rounded` 47, `rounded-xl` 35, `rounded-sm` 29, `rounded-2xl` 1 — no roles.                   |
| Elevation                     | Semantic `shadow-control/card/elevated/popover`                             | 4 raw `shadow-sm` uses.                                                                                                           |

Rules:

1. **Before building a control, find its canonical primitive.** A new variant is a documented
   addition to the primitive, not a local copy.
2. **Variants encode meaning, not taste.** Two badge styles must mean two different things.
3. **Consolidation preserves semantics.** Merging components must keep every state distinction the
   originals carried.

---

## 19. Anti-patterns

Future work — human or AI — must avoid:

**General**

- Excessive cards; a card inside a card; cards used to fill space.
- Borders around every group; boxing each form group.
- Oversized page or step titles that push Capture content below the first screen.
- Tiny grey text for important information; any text below 12px.
- Hidden labels; placeholder-as-label; icon-only form controls.
- Excessive pills and chips; chips for categories that should be plain text.
- Multiple competing primary actions in one view.
- Gradients as decoration, washes behind content, glow, glassmorphism beyond the one sticky header.
- Decorative animation, section entrances, hover lifts on form groups, count-up numbers.
- Desktop UI squeezed onto mobile; equal-tile grids stacked into long mobile columns.
- Removing fields or states to achieve a cleaner screenshot.
- Colour-only meaning; red/green-only direction.
- Inconsistent radius, spacing or component variants; a new component style where a canonical
  primitive exists.

**Repository-specific (found during inspection)**

- **Tracked uppercase labels as the default hierarchy** (`text-label uppercase`, 82 `uppercase`
  uses): they read as template chrome and vanish as hierarchy in Thai.
- **Middle-dot meta strings for data** (`16W · 0BE · 12L`, `Setup · optional`, `Live · USD`): they
  compress meaning into punctuation and read as generated chrome; use labelled readings or plain
  words.
- **Win / BE / Loss composition shown for the System side**: the System uses Positive / Flat /
  Negative (contract §16); the current rendering is implementation pending migration and must not be
  copied.
- **Lifecycle or process status in outcome colours** (Closed/Resolved shown `positive` green,
  Open/Pending `warning` amber): state is not a result.
- **Arbitrary sub-12px sizes** (`text-[11px]` ×22, `text-[10px]` ×9) and raw size classes
  (`text-2xl` on Trade Detail headings) instead of type roles.
- **Numbered circles on non-sequential groups** (`SectionHeading` numbers): numbering implies an
  order the trader must follow.
- **Tabs that hide required or answered sections** in Capture without showing what they contain.
- **Three different optional markers** ("(optional)", "· optional", "optional").
- **A decorative brand-colour wash** at the top of the Capture frame and gradient brand marks.
- **Hand-rolled notice boxes** in warning / info / destructive tints instead of one notice primitive.
- **`transition-all` on controls**, which drags layout and focus ring onto the same clock.
- **One hue doing several jobs** (in Light, the action blue is also the break-even tint, the trader
  series and the focus ring).
- **An action-bar status line listing every missing field name** as one long sentence.

---

## 20. Page-type guidance

Character, not layout. None of this prescribes a final page design.

**Capture pages** (At Entry, After Trade, Record Exit, Final Close)

- Fast, focused, low cognitive load: one plane, one question group at a time in reading order,
  compact title, sticky primary action, calm optional analytical groups.
- Numbers are inputs, not trophies: no KPI styling, no coloured results before save.
- Answer states are visually unambiguous (§6); defaults are visibly defaults.

**Review**

- Reflective and structured: generous space, clear area titles (Reflection, Discipline / Behavior,
  System Assessment) without gating visuals such as steppers or completion meters.
- The System vs Actual comparison is the one analytical island: paired figures, coverage and
  comparability stated, Needs Review shown with the preserved finding.
- Writing areas get a comfortable measure and quiet chrome.

**Analytics / reports**

- Comparative and information-dense: tables, small multiples and paired figures; colour spent only on
  direction and series; coverage and population always visible near the figure.
- Sticky toolbar, consistent chart heights across comparable charts, one question per chart.

**Trade Detail**

- Readable record first, analysis second: identity, lifecycle and the trader's recorded facts read
  like a well-set document (label/value rows, plain text, provenance beside values); analysis
  (System vs Actual, Execution Impact) follows as a distinct, denser region.
- Status axes (lifecycle, review, assessment) are separate, compact indicators near the identity.
- Contextual actions (Record Exit, Review Trade) are secondary; there is at most one page-level
  primary.

**Settings / management**

- Functional and restrained: forms and lists on one plane, section headings, clear destructive
  separation, no analytic flourishes or cards-as-decoration.

---

## Relationship to `docs/design-system.md`

| Document                | Owns                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DESIGN.md` (this file) | Visual philosophy, principles, personality, hierarchy, composition, visual rules, anti-patterns, page-type character.                                                                                                                              |
| `docs/design-system.md` | Concrete implementation: tokens and palettes, type-role tokens, spacing utilities, component inventory and customisations, measured Dashboard decisions, chart chrome, motion tokens, accessibility implementation, i18n and auth-state specifics. |

- `docs/design-system.md` is **retained** as the implementation reference and is not superseded
  wholesale. Its measured, surface-specific decisions (for example the Dashboard density rules)
  remain valid.
- Where the two disagree on **visual direction** for new work, this document wins and the
  implementation reference is updated when that work lands. Known divergences today: caps
  `text-label` as a default metric/field-group label (§4 rule 2), lifecycle badges in outcome colours
  (§8), and sub-12px sizes present in code despite its own 12px floor (§4 rule 1).
- A change of token values, component APIs or measured geometry belongs in
  `docs/design-system.md`; a change of what those things are _for_ belongs here.

---

## Appendix A — Inspection findings

Evidence: `src/app/globals.css`, `src/components/ui/*`, recording forms and primitives, badges,
headers, shell, Dashboard components, and screenshots in `docs/reviews/` (log-trade-context
2026-09-04, log-trade-shell 2026-09-03, dashboard-d9 2026-08-29, app-shell shell-polish 2026-08-28).
Screenshots predate the latest code (trade forms 2026-09-14, Dashboard 2026-09-12) and the approved
contract, so they are evidence of direction, not of every current pixel. Counts below are approximate
`grep` counts over `src/components` with tests excluded; the chip, card, radius, uppercase and
sub-12px counts also include the frozen prototype.

**Strengths worth keeping**

1. Semantic token discipline: call sites use roles, never raw colours; elevation, motion and type are
   tokenised; contrast is measured and recorded.
2. A validated, colour-vision-checked chart palette with fixed slots, `system`/`trader` aliases and a
   dashed-hypothetical / solid-actual convention.
3. Restraint already written down: no glow, no count-up numbers, no decorative motion, reduced-motion
   honoured twice, skeletons that reserve real geometry, "numbers that cannot be computed render
   their reason".
4. Measured density work on the Dashboard: borderless cards on plane contrast in Dark, one owner per
   fact, one finding per card, sign colour only on signed outcomes.
5. Accessibility built into primitives: 44px inputs and buttons, native radios under the segmented
   control, persistent live regions, chart captions with hidden tables.
6. An adaptive overlay (dialog on larger screens, sheet on phones) with a keyboard-aware footer.
7. Neutral treatment of emotions (no valence colour) and a distinct "None of these" option.
8. A quiet shell: neutral active pill with an accent icon, dark chrome frame in both themes.
9. Thai typography handled deliberately (one Latin+Thai family, script-specific line-heights).

**Main problems**

1. **Generic-template tells:** tracked uppercase labels and eyebrows everywhere, middle-dot meta
   strings, monospace figures in small labels, and a centred step title with an eyebrow above a
   bordered form card — the recognisable "SaaS card kit" look.
2. **Weak Capture hierarchy:** the step header (progress bar, back/close row, eyebrow, large centred
   title, description) consumes roughly a third of the first desktop screen and more on mobile before
   the first question; optional sections are tabs labelled `· optional`, which both hides answered
   state and makes analytical data look secondary.
3. **Component drift:** four badge implementations with different sizes and colour logic; ~20
   hand-rolled chip patterns; ~32 hand-rolled notice boxes; ~61 hand-rolled card wrappers against 26
   `Card` uses; five section-heading patterns; three optional-marker styles.
4. **Radius without roles:** seven radius classes in use with no documented mapping to control, card,
   overlay and pill.
5. **Type-scale leaks:** 31 sub-12px arbitrary sizes against a documented 12px floor; raw
   `text-2xl`/`text-xl` headings bypass roles.
6. **Status colour conflated with outcome colour:** Closed/Resolved in `positive`, Open/Pending in
   `warning`; Saved-style confirmations risk reading as profit.
7. **Hue overloading in Light:** the action blue is also primary text links, the focus ring, the
   break-even tint and the `trader` chart series.
8. **Themes differ in temperature:** Dark uses pure neutral greys on a near-black ground; Light uses
   blue-tinted neutrals — the same hierarchy, but two personalities.
9. **Mobile often shrinks desktop:** KPI tiles become a two-column grid of equal cards; the Capture
   tab strip wraps two-line labels; a sticky action bar in mobile captures overlaps content in a
   full-page capture (to verify on a device).
10. **Visual conflicts with UX Rules in current UI (pending redesign):** tabs hide whether a section
    holds answers (UX Rules §3.2); `· optional` framing weakens core analytical data (§2.4); System
    side shows W/BE/L composition (§9.5, contract §16); lifecycle colours imply judgement (§7.12).

---

## Appendix B — Direction evaluation

Each principle was checked conceptually against representative contexts. Failures found and the
adjustment made:

| Context            | Finding                                                                                                                         | Adjustment                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| At Entry           | "The finding gets the type" would dress Risk at Entry up as a KPI, though it is an input.                                       | Principle 6 scoped to figures that are the answer; §20 says Capture numbers are inputs, not trophies. |
| After Trade        | "Progressive density" as "Capture is calm" conflicted with exit history, which needs a compact comparison.                      | Density islands allowed (§5 rule 5).                                                                  |
| Review             | "One strong action" was read as one primary per page, but Review areas may each need to save while Finish completes the review. | §7: one primary per region, at most one page-level primary.                                           |
| Trade Detail       | Several contextual actions (Record Exit, Review Trade) competed as primaries.                                                   | Contextual actions defined as secondary (§7, §20).                                                    |
| Dashboard          | "Structure only where it carries meaning" risked removing all cards, though Dashboard answers are independent units.            | §10 keeps cards for independent answers and objects; removes them only from form groups and filler.   |
| Analytics / report | "Colour is a sentence" could be read as no colour at all in dense tables.                                                       | §9 keeps direction colour on signed results in tables and forbids it on levels and ratios.            |
| Mobile Capture     | "Recompose, not shrink" plus sticky actions could hide the focused field under the keyboard.                                    | §7 rule 5 and §14: bar yields to keyboard and never covers the focused field or its error.            |
| Mobile analytical  | Recomposition into a single column split System and Trader into distant cards, losing the comparison.                           | §14 rule 6: paired comparisons stay paired in compact rows.                                           |
| Light              | "Plane before border" failed where white planes sit on a near-white ground.                                                     | §3 rule 3 and §10 rule 4: Light may use hairline or soft shadow for card edges.                       |
| Dark               | A single warning tone for every attention level made Dark screens loud with amber.                                              | §8: soft attention is neutral; warning is reserved for notices and Needs Review.                      |
| Thai (both themes) | Caps-label hierarchy disappeared in Thai.                                                                                       | §4 rule 2: hierarchy by weight and size; caps optional and never the only signal.                     |

After these adjustments no principle was found to fail in the listed contexts.

---

## Appendix C — Intentionally deferred decisions

These are visual decisions this document frames but does not settle; each needs a measured
implementation pass recorded in `docs/design-system.md`.

1. **Palette retune:** a less-black Dark ground, a shared temperature across themes, and separating
   the Light action blue from break-even, `trader` series and focus — with contrast and CVD
   re-validation.
2. **Figure typeface:** whether tabular figures in Noto Sans Thai can replace the monospace `numeric`
   stack for figures, keeping alignment.
3. **Uppercase label retirement:** migration path for caps `text-label` / `MetricLabel` defaults.
4. **Radius roles:** mapping the current radius classes onto control / card / overlay / pill.
5. **Notice primitive:** API and emphasis levels for info / notice / attention.
6. **Status badge consolidation:** one indicator covering lifecycle, review, assessment, outcome and
   legacy with tone rules from §8.
7. **Capture frame:** compact step header, disclosure-with-summary pattern replacing tabs, and the
   sticky action bar's status line — to be designed during the Add Trade redesign, within the
   approved contract and UX Rules.
8. **Chart tick size:** current 10.5px ticks against the 12px floor.
9. **Brand mark and wash:** whether the gradient brand mark stays; removal of the Capture wash.
10. **Thai copy lengths:** final label widths depend on the deferred Thai copy work (UX Rules
    Appendix A).
