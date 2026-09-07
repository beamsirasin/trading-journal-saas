# Review screenshots — final refinement pass

Captured from the prototype after the accepted Astra design delta. **Regenerate
with the dev server running:**

```
node scripts/prototype-review-screenshots.mjs
```

## How these were captured

- **Real viewports**, never a scaled column. Every responsive rule in this
  codebase is a viewport media query, so a 390px column inside a 1440px window
  would render the desktop composition squeezed — the exact failure the mobile
  design exists to prevent, presented as though it were the design.
- **2× device pixel ratio**; **reduced motion on**, so nothing is caught
  mid-transition.
- **Populated states only.**
- **Dark is primary.** Light companions only where theme behaviour materially
  differs.
- **Full-page vs first fold per screen.** Desktop forms capture full page
  (their length is what is under review, and the footer is `lg:static` there);
  mobile captures the real device fold, because the docked save action's true
  position is part of what is being judged.

## The set

| #     | File                                     | Shows                                                               |
| ----- | ---------------------------------------- | ------------------------------------------------------------------- |
| 1     | `01-trade-log-desktop-1440`              | Seven-column journal, unchanged architecture                        |
| 1b    | `01b-…-light`                            | Same, light theme                                                   |
| 2     | `02-trade-log-mobile-390`                | Compact scope row, three-line rows, follow-up in the row rhythm     |
| 2b    | `02b-…-light`                            | Same, light theme                                                   |
| 3     | `03-trade-log-mobile-320`                | Narrowest width; Search no longer clips its placeholder             |
| 4     | `04-trade-details-desktop-overview`      | Identity de-duplicated, timing first, setup conditions with Setup   |
| 4b    | `04b-…-execution`                        | `t-04` — opening, exits, remaining, costs, actions                  |
| 4c    | `04c-…-review`                           | `t-07` — system result, comparison, execution rules, mistakes, note |
| 4d    | `04d-…-system-not-recorded`              | The concise unresolved state + Add system result                    |
| 5     | `05-trade-details-mobile`                | Full-viewport detail                                                |
| 6     | `06-log-a-trade-choice`                  | Concise two-card copy                                               |
| 7     | `07-at-entry-desktop`                    | Short path; "Opening matches plan · Change" as one line             |
| 7b    | `07b-…-optional-filled`                  | Collapsed optional entries showing their summaries                  |
| 8     | `08-at-entry-mobile-main`                | Main form with compact optional entry points                        |
| 9     | `09-at-entry-mobile-optional-subview`    | Full-screen Entry context subview with Done                         |
| 10    | `10-at-entry-mobile-keyboard-open`       | Keyboard up: field, label and helper visible; save undocked         |
| 11    | `11-after-trade-desktop`                 | Actual-first; optional group visually subordinate                   |
| 11b   | `11b-…-light`                            | Same, light theme                                                   |
| 12    | `12-after-trade-mobile-main`             | Same hierarchy on a phone                                           |
| 13    | `13-after-trade-mobile-optional-subview` | Add original plan as a subview                                      |
| 14    | `14-ordinary-full-close`                 | Result + exit time only. No allocation machinery                    |
| 15    | `15-multiple-exits`                      | The allocation editor, three completion states                      |
| 15b   | `15b-…-mobile`                           | Same, touch widths                                                  |
| 16    | `16-confidence-context-mobile`           | Confidence rail and emotion catalog on a phone                      |
| 16b/c | `16b`, `16c`                             | Desktop, dark and light                                             |
| 17    | `17-known-net-pnl-qualified`             | **Known net P&L** + coverage, closed-population denominator         |
| 17b   | `17b-net-pnl-complete`                   | Complete coverage → plain **Net P&L**, no caveat                    |
| 17c   | `17c-net-pnl-multiple-currencies`        | **Multiple currencies** + Select one account                        |

## Notes for the reviewer

1. **The keyboard frame is emulated.** Headless Chromium has no soft keyboard,
   so the visual viewport is shrunk to the height a real keyboard leaves — which
   is exactly the signal the docked-save logic reads. The capture script
   **asserts** the footer actually undocked before taking the shot; if it had
   not, the run fails rather than producing a misleading image.
2. **Detail captures show a focus ring on "Previous".** Real modal focus
   behaviour, left visible because the indicator is review-relevant.
3. **The emotion catalog is the product's own** — the ten `is_system` emotions
   from `src/config/emotions.ts` in the four groups the production recording form
   already uses. An earlier prototype pass had invented a different vocabulary.
