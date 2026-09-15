# At Entry — visual pilot

**Status:** design validation, 2026-09-16. Not production. The production At Entry route
(`/app/trades/new?timing=at_entry`) is unchanged.

The first visual calibration page for [`DESIGN.md`](../../DESIGN.md). It checks whether the
approved [Add Trade contract](../product-contracts/add-trade.md), [UX Rules](../UX_RULES.md) and
`DESIGN.md` can produce an At Entry page that is calm, clearly TradeChemist, and better than today's.

| Route (development only)              | What it shows                              |
| ------------------------------------- | ------------------------------------------ |
| `/en/prototype/design-pilot/at-entry` | Untouched                                  |
| `…?state=partial`                     | Symbol, Direction, Risk entered            |
| `…?state=no-target`                   | Explicit No fixed target                   |
| `…?state=inherited`                   | Strategy selected; Exit Plan inherited     |
| `…?state=customized`                  | Exit Plan customized; entry time confirmed |
| `…?state=validation`                  | Save attempted: errors and a price notice  |
| `…?state=analytical`                  | Journal answered; Actual Risk different    |
| `…&figures=mono`                      | Same page with monospace figures           |

The route lives in the existing `(prototype)` group, so production builds return 404. The pilot adds
new files only; the frozen prototype is untouched and only its models are reused.

- **Code:** `src/components/prototype/design-pilot/` (model, visual primitives, Exit Plan block,
  journal controls, page, tests) and `src/app/[locale]/(prototype)/prototype/design-pilot/at-entry/`.
- **Screenshots:** `docs/reviews/at-entry-visual-pilot/baseline/` (production, 32) and `…/pilot/`
  (pilot, 36). Regenerate the pilot set with the dev server running:
  `node scripts/at-entry-pilot-screenshots.mjs`.

---

## 1. Baseline — current production At Entry

Captured on 2026-09-16 from a fresh production build against the guarded e2e test database, for a
newly provisioned journal user, at 1440 / 1120 / 390 / 320 in Light and Dark. Earlier screenshots in
`docs/reviews/log-trade-*` show a retired tabbed form and were not used.

**What renders today:** a centred step header (progress bar, back and close icons, "LOG A TRADE"
eyebrow, "At Entry" title, one-line description with "Change"), then one bordered task card with
bands: account line, Symbol + Long/Short, "Times use UTC." above a native date-time input, a
"PLAN AT ENTRY" band with Risk at entry and Target profit side by side, and two text actions ("Use
price levels instead", "Your actual opening differed from this plan"). Below the card, a "JOURNAL AT
ENTRY — Now or later" pair of launchers (Trade idea, Feelings at entry), then Save open trade.

### Against the contract, UX Rules and DESIGN.md

| Area                 | Finding                                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantics            | A Money/Price basis switch ("Use price levels instead") is still offered (contract §3 — pending migration). No No fixed target option and no Exit Plan at all (contract §5). Target is an "Optional" amount, so Unanswered and No fixed target collapse into a blank. |
| First screen         | At 1440 the step header takes ~310px before the first field; at 390 the whole first screen reaches only Entry time. The header repeats the flow three ways (eyebrow, title, description).                                                                             |
| Save action          | Not sticky on desktop: at 1440 Save is below the fold. On phones a docked bar covers the Risk section while scrolling.                                                                                                                                                |
| Risk / Target / Exit | Risk and Target read as two equal inputs; there is no Exit Plan to relate them to. Actual Risk is a text action with no visible "matched" statement (UX Rules §3.4).                                                                                                  |
| Analytical fields    | Strategy, Setup, confidence and emotions are hidden behind two launchers labelled "Now or later"; nothing on the page says they feed analytics (UX Rules §2.4).                                                                                                       |
| Visual character     | Tracked uppercase labels ("LOG A TRADE", "PLAN AT ENTRY", "JOURNAL AT ENTRY", emotion group caps), a centred hero title, a brand gradient wash, middle-dot meta ("· USD"), 12px muted field labels.                                                                   |
| State visibility     | Unanswered Target looks identical to "no target". The auto-filled entry time is flagged only by a small helper line. Direction has no visible difference between unanswered and a hover state.                                                                        |
| Editors              | Dialog on desktop, sheet on phones (good). Footers say **Cancel** / Done — Cancel reads as discard (UX Rules §5.2). Confidence is five full-width radio rows on phones.                                                                                               |
| Validation           | Good placement (field-level + a summary banner) but the banner uses a filled destructive box and both Direction choices turn red.                                                                                                                                     |
| Mobile               | A compressed desktop: same order, same bands, 12px labels; the step header alone is ~40% of a 390px first screen.                                                                                                                                                     |
| Light / Dark         | Same structure, but Dark is cyan accent on near-black while Light is royal-blue accent on a blue-tinted ground with a blue wash: two personalities.                                                                                                                   |

---

## 2. Pilot — what changed and why

1. **A compact, left-aligned flow header.** "← Trades", "Record an open trade", and one line naming
   the situation with a way to switch. No eyebrow, no progress bar, no wash. The first field sits
   ~230px from the top at 1440 (was ~310px).
2. **One capture plane in four groups, in the order of the moment question** — _The trade_, _Risk and
   plan_, _Why you are taking it_, then a _Trade idea, chart and price levels_ disclosure. Groups are
   separated by a group title, space and one hairline; there is no card per group.
3. **One primary action with a status, placed where it stays reachable.** Desktop: a sticky side
   panel "Needed to save" listing the four contract requirements with checks, the Save button and a
   one-line status. Phones: a docked bar with a short status ("3 of 4 needed to save") that returns
   to the page flow while the keyboard is open.
4. **States have shapes.** Unanswered choice groups show no selection and a quiet "Not answered";
   the automatic entry time has dashed inputs and a dashed "Set automatically to now" tag plus
   "This time is right" / "Clear time"; an inherited Exit Plan sits in a dashed box with a dashed
   "From Strategy: Elliott Wave" tag and explicit Use / Customize / Choose another; a chosen plan,
   a customized plan and "No defined exit rule" each read differently; a declined default offers
   "Use strategy default".
5. **Risk leads.** Risk at entry is the one large figure, with "This is your 1R." and a visible
   "Your actual risk matched this amount" statement plus "It was different". Opened, Actual Risk
   shows "Different, amount not known" while blank and an explicit "It matched after all".
6. **Target is a real three-state question** — no selection, Fixed target (Target profit and/or TP
   price, the price tagged "Price context"), or No fixed target — with a quiet "+3.00R" hint only
   when both amounts exist. No Money/Price switch.
7. **Analytical data is on the page, not behind launchers**, under "Why you are taking it — Not
   needed to save. These answers build your Strategy and Psychology insights." with a small "Used in
   analytics" note. Desktop shows it open; phones show one disclosure whose summary states what is
   answered. There are no per-field "Optional" tags.
8. **Price is context**: entry, SL and size live in the disclosure under "Price levels — Context
   only, never used to calculate results"; a Long stop above entry produces a quiet warning notice,
   never an error.
9. **Errors are local and calm**: icon + sentence under the field, a destructive border on that
   control, and a status line in the save panel or bar. No filled banner.
10. **Editors dismiss non-destructively**: the Exit Plan editor offers Done and a destructive-text
    "Discard changes"; closing keeps what was chosen.

---

## 3. Product / UX parity

| Contract / UX semantic                                                                                                                    | Represented          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Account, Symbol, Direction, Risk at Entry (> 0) required to save; nothing else                                                            | ✓ (tested)           |
| Entry time defaults to now, visibly a default, editable, confirmable, clearable                                                           | ✓ (tested)           |
| Risk at Entry as the 1R baseline                                                                                                          | ✓                    |
| Actual Risk: matched affirmation visible; Different with amount; Different, amount unknown; explicit return to matched                    | ✓ (tested)           |
| Target: Unanswered / Fixed (Target Profit, TP price or both) / No fixed target; Fixed with neither blocks save with a field error         | ✓ (tested)           |
| Exit Plan: Not recorded / inherited from Strategy / saved / customized / No defined exit rule                                             | ✓ (tested)           |
| Inheritance only from a Strategy that states a plan; explicit override or decline suppresses it; explicit "Use strategy default" restores | ✓ (tested)           |
| Strategy / Setup: Not answered / No strategy / selected; conditions Met / Not met / Not answered, never counted as not met                | ✓                    |
| Confidence: no default position; five labelled steps; explicit "Remove answer"                                                            | ✓                    |
| Entry emotions: Not answered vs "None of these" vs selected; neutral, no valence colour                                                   | ✓                    |
| Optional context (reason, chart, notes, timeframe, session, size, price levels)                                                           | ✓                    |
| No Money/Price mode switch; price never derives a result; price inconsistency is a notice                                                 | ✓ (tested)           |
| No Final P&L, Trader Outcome, System Result, System Assessment or Review on At Entry                                                      | ✓                    |
| Routine editor dismissal keeps changes; Discard changes restores the checkpoint                                                           | ✓ (Exit Plan editor) |

Not represented, by design of a visual pilot: draft persistence and reload recovery, save
reliability and idempotent retry, the mode switch itself, real account switching, and Thai copy.

---

## 4. Before / after

| Criterion                  | Baseline                                                           | Pilot                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task clarity               | "At Entry" mode name; plan and journal split                       | "Record an open trade" plus the moment's groups in order                                                                                                                                        |
| Visual hierarchy           | Header dominates; all labels 12px muted                            | Risk leads; 14px medium labels; group titles carry sections                                                                                                                                     |
| Visible chrome             | Progress bar, two icons, eyebrow, centred title, wash, banded card | Back link, title, one line; one plane                                                                                                                                                           |
| Scan speed                 | Uppercase labels and bands interrupt                               | Sentence-case labels, one left edge                                                                                                                                                             |
| Density                    | Low, but spent on chrome                                           | Low in the trade, denser only in setup conditions                                                                                                                                               |
| Analytical discoverability | Behind two launchers                                               | Visible on desktop; one summarised disclosure on phones                                                                                                                                         |
| Mobile usability           | Compressed desktop; bar overlaps Risk                              | Recomposed order; short status in the bar; single column below ~420px for described choices                                                                                                     |
| Theme consistency          | Two accent hues, two grounds                                       | One accent family, one temperature (pilot-scoped)                                                                                                                                               |
| Perceived polish           | Generic step-form look                                             | Calmer and more specific to the trade                                                                                                                                                           |
| **Harder than before**     | —                                                                  | The page is **longer** (states and the Exit Plan are now visible); desktop needs scrolling to reach Strategy; setup conditions add a dense block. The side save panel removes a scroll-to-save. |

Not claimed: faster completion. That needs usability testing, not screenshots.

### Desktop — 1440 / 1120

- The side save panel keeps the one primary action and the four requirements in view at both widths;
  at 1120 the main column is still comfortable (~670px).
- The inherited Exit Plan's dashed treatment is clearly distinct from a chosen plan in both themes.
- Setup conditions (four Met / Not met rows) are the densest part of the page; acceptable as a
  density island, but a production redesign should consider a more compact row.
- The "Used in analytics" note wraps under the description at 1120; harmless.

### Mobile — 390 / 320

- No horizontal overflow at 390 or 320 in any state (measured by the capture script).
- Described choice cards now stack below ~420px; Direction stays two-up.
- The docked action bar keeps Save visible; at 320 the status wraps to three lines — shorter status
  copy should be tested.
- The journal disclosure's summary ("Elliott Wave, High confidence, 2 feelings") says what is inside
  without opening it.
- Full-page captures draw the docked bar mid-page — a capture artefact of `position: sticky`, not a
  layout defect; first-screen captures show it docked.

### Light / Dark

- Same planes, same emphasis, same state shapes in both. Dark no longer reads black-and-cyan; Light no
  longer reads blue-grey SaaS. The header chrome stays dark in both (DESIGN.md §15).
- Selected choices use a neutral step plus an accent radio dot in both; errors and warnings keep
  their tokens and read in both.
- Portalled editors pick up the pilot palette in both themes.

---

## 5. Visual foundations — what now has evidence

| Deferred decision (DESIGN.md Appendix C) | Evidence from the pilot                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Figure typeface (2)                      | Side-by-side `?figures=mono`: monospace makes Risk and the date/time inputs read as code; tabular figures in Noto Sans Thai read as product UI. **Use tabular sans for Capture inputs.** Tabular alignment in columns is not tested here. |
| Uppercase label retirement (3)           | The page uses no uppercase anywhere and hierarchy holds through weight and size at every width. **Sentence case works for Capture.** Thai not tested.                                                                                     |
| Radius roles (4)                         | Four roles (control 10px, surface 16px, overlay primitive, pill) were enough for every element on the page. **Validated for Capture.**                                                                                                    |
| Capture frame (7)                        | Compact left header, one plane, grouped sections, side save panel on desktop, docked status bar on phones. **Validated as direction**, not final layout.                                                                                  |
| Palette retune (1) — temperature only    | A lifted cool-neutral Dark ground (`#121417` / card `#1a1d21`) and a neutral Light ground (`#f3f5f7`) with one cyan accent family across themes kept hierarchy and contrast. **Direction validated; token migration still deferred.**     |

---

## 6. Still unresolved — should wait

- **Accent separation.** At Entry shows no chart series, outcome or break-even colour, so the pilot
  cannot prove the Light action-blue collision is solved; revisit on Trade Detail or Analytics.
- **Global palette values.** The pilot's hex values are scoped to one page and approximately
  contrast-checked; a real token migration needs instrument measurement and CVD validation.
- **Thai.** Label widths, the 320px status line and sentence-case hierarchy in Thai need real copy.
- **Status badge and notice primitives.** Only one quiet warning notice and one tag family were
  exercised.
- **Density of setup conditions** and whether conditions belong on the page or in an editor.
- **Emotion deselection.** Removing the last selected chip returns to Not answered; whether that
  needs a separately labelled action (UX Rules §4.5) should be tested.
- **Chart tick size and brand mark** — not on this page.

## 7. Component implications (for later consolidation, not done here)

- **Reusable from production today:** `Button`, `AdaptiveOverlay`/`OverlayActions` pattern,
  `useKeyboardObscuringViewport`, native `select` and date/time inputs.
- **Pilot primitives that should become canonical:** a recorded-answer `ChoiceGroup` with a visible
  "Not answered" state; a `Legend` that keeps the fieldset's accessible name while showing state; a
  dashed "default / inherited" `Tag`; an `InlineAction`; a quiet `Notice`; a `Disclosure` with a
  summary; a save-requirements panel.
- **Production primitives the pilot did not use, and why:** `SegmentedChoice` (always looks like one
  segment is on), `SectionLabel` (uppercase), `JournalLauncherSurface` (hides analytical fields),
  `FormFooter` (no status line), `TradeConfidenceChoice` rows on phones.
