# Review screenshots — audited prototype

Captured from the audited prototype at commit `db7ff4a`. **The prototype was not
modified to produce these.** Regenerate with the dev server running:

```
node scripts/prototype-review-screenshots.mjs
```

## How these were captured

- **Real viewports**, never a scaled column. Every responsive rule in this
  codebase is a viewport media query, so a 390px column inside a 1440px window
  would render the desktop composition squeezed — the exact failure the mobile
  design exists to prevent, presented as though it were the design.
- **2× device pixel ratio**, so type and hairlines are judged at retina density.
- **Reduced motion on**, so no capture catches a transition mid-flight and
  reports it as the design.
- **Populated states only.** No empty journals and no untouched forms.
- **Dark is the primary theme** (the product default). A light companion is
  included only where theme behaviour materially differs — see below.
- **Full-page vs first fold is chosen per screen.** Desktop forms and specimen
  pages capture full page, because the whole form's length is what is under
  review, and `FormFooter` is `lg:static` there so there is no sticky element to
  duplicate. Mobile captures the real device fold, because the sticky save
  action's true position is itself part of what is being judged.

## The set

| #   | File                                  | Screen               | Viewport               | State shown                                                                      |
| --- | ------------------------------------- | -------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| 1   | `01-trade-log-desktop-1440`           | Trade Log            | 1440×1200              | Seven-column table, 25 populated rows                                            |
| 1b  | `01b-trade-log-desktop-1440-light`    | Trade Log            | 1440×1200 · light      | Same, light theme                                                                |
| 2   | `02-trade-log-desktop-1280`           | Trade Log            | 1280×1100              | Still the table (content ≥ 1120px)                                               |
| 3   | `03-trade-log-tablet-1024`            | Trade Log            | 1024×1100              | Multi-line journal rows — the mid-width composition                              |
| 4   | `04-trade-log-mobile-390`             | Trade Log            | 390×844                | Mobile journal list                                                              |
| 4b  | `04b-trade-log-mobile-390-light`      | Trade Log            | 390×844 · light        | Same, light theme                                                                |
| 5   | `05-trade-log-mobile-320`             | Trade Log            | 320×800                | Narrowest supported width                                                        |
| 6   | `06-trade-details-desktop-overview`   | Trade Details        | 1440×1100              | `t-01` — strategy, setup, plan, confidence, emotions, entry reason, chart, notes |
| 6b  | `06b-…-overview-light`                | Trade Details        | 1440×1100 · light      | Same, light theme                                                                |
| 6c  | `06c-…-execution`                     | Trade Details        | 1440×1100              | `t-04` — recorded exit, 40% closed / 60% remaining, realized-so-far              |
| 6d  | `06d-…-review`                        | Trade Details        | 1440×1100              | `t-07` — resolved system result, execution gap, mistakes, review note            |
| 7   | `07-trade-details-mobile`             | Trade Details        | 390×844                | Full-viewport detail, not a narrow drawer                                        |
| 8   | `08-log-a-trade-choice`               | Log a trade          | 1440 full page         | Two directly actionable cards                                                    |
| 9   | `09-at-entry-desktop`                 | At Entry             | 1440 full page         | The short path: core populated, optional sections collapsed                      |
| 9b  | `09b-…-optional-sections-filled`      | At Entry             | 1440 full page         | Optional sections answered, showing collapsed summaries                          |
| 10  | `10-at-entry-mobile`                  | At Entry             | 390×844                | Focused form shell, sticky save in its real position                             |
| 11  | `11-after-trade-desktop`              | After Trade          | 1440 full page         | Actual-first: `+2.00R · Win` computed, plan optional below                       |
| 11b | `11b-…-light`                         | After Trade          | 1440 full page · light | Same, light theme                                                                |
| 12  | `12-after-trade-mobile`               | After Trade          | 390×844                | Same hierarchy on a phone                                                        |
| 13  | `13-partial-exits-desktop`            | Partial exits        | 1440 full page         | Three completion states: full close, remainder unrecorded, still open            |
| 13b | `13b-partial-exits-mobile`            | Partial exits        | 390×844                | Same editor, touch widths                                                        |
| 14  | `14-confidence-entry-context-desktop` | Confidence / context | 1440 full page         | Five confidence states, three emotion states                                     |
| 14b | `14b-…-light`                         | Confidence / context | 1440 full page · light | Same, light theme                                                                |
| 14c | `14c-…-mobile`                        | Confidence / context | 390×844                | Same controls, touch widths                                                      |

Every screen on the required list is present. `06c`/`06d` and `09b` are
additions: Trade Details is a three-tab architecture that one Overview capture
under-covers, and the collapsed-summary treatment cannot be judged from an
untouched form.

## Two things to expect in the frames

1. **The detail captures show a focus ring on "Previous".** That is real
   behaviour, not an artifact — the drawer is a modal and the browser moves focus
   into it on open. It is left visible because the focus indicator is itself a
   review-relevant property.
2. **The journal's Net P&L reads "P&L incomplete", not a total.** Correct, and
   deliberate: a price-only trade is in scope, and the design refuses to publish
   a silently partial money total. Total R is unaffected and reads `+105.22R`.
   This is a product consequence worth a decision at review, not a defect.
