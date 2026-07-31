# ADR 0006 — Chart palette, demo-data policy, and the Phase 01 resequencing

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 01 — Design system, marketing, application shell

## Context

Phase 01 puts numbers on a public page for the first time. Three decisions had to be made before any of it could ship honestly: what colour a data series is allowed to be, what may be shown when the real figures do not exist yet, and where this phase sits in a roadmap that did not contain it.

## Decision 1 — Chart colours are computed and validated, never chosen

Categorical series colours are produced by running a validator against the candidate palette in both themes, and a palette ships only when all six checks pass: lightness band, chroma floor, CVD separation, normal-vision floor, contrast against the surface, and provenance from a documented set.

Recorded result for the shipped palette:

| Mode  | Surface   | Slot 1 (`system`) | Slot 2 (`trader`) | Slot 3    | Slot 4    | Worst adjacent ΔE      |
| ----- | --------- | ----------------- | ----------------- | --------- | --------- | ---------------------- |
| Dark  | `#0d1424` | `#0f9e8e`         | `#3b82f6`         | `#c2650f` | `#b06ef0` | 18.8 CVD / 19.6 normal |
| Light | `#ffffff` | `#0891b2`         | `#1d4ed8`         | `#c2570f` | `#7c3aed` | 17.0 CVD / 19.6 normal |

**Why this is a decision and not a detail.** The first candidate palette looked correct and was not: blue against violet measured **ΔE 0.3 under simulated deuteranopia** — two series that a red-green colour-blind reader would see as one line. Several other candidates sat outside the per-mode lightness band. None of this is visible to a designer with typical colour vision reviewing a screenshot, and red-green colour blindness is common enough among the intended users that shipping it would have made the product's central chart unreadable for a real fraction of them.

**Consequences.**

- Adding a fifth series is not a matter of picking another blue. Slots are assigned in fixed order and never cycled; a fifth series folds into "Other" or becomes small multiples.
- `system` and `trader` are semantic aliases of slots 1 and 2, so a future reordering of the generic ramp cannot repaint the product's most important comparison.
- **Series colours may not carry text.** Light-mode `system` is 3.68:1 against white — legal for a mark, below the 4.5:1 needed for small text. Labels use text tokens beside a coloured swatch. This is a hard rule, not a preference.
- The palette is validated against `card`. A chart placed on a different surface needs re-validation.
- Colour is never the only encoding: the system series is dashed because it is hypothetical, the actual series is solid because it happened. That reads in greyscale, in print, and under any colour vision.

## Decision 2 — Demo data is fixtures only, labelled everywhere, with no formulas

**Fixtures contain no arithmetic.** Every metric in `src/lib/demo/` is a literal string. The real formulas arrive with the calculation engine in Phase 07; a formula written here to make a demo chart move would be a second implementation of the product's defining logic, living outside `src/lib/calc/`, untested and free to disagree with the real one.

**Every surface that renders a fixture carries a visible marker.** These are trading figures. An unlabelled screenshot of a rising equity curve functions as a performance claim regardless of intent, and screenshots travel. The marker is asserted by unit tests and by e2e on both routes that render the dashboard, so it cannot be dropped by a refactor.

**Internal consistency is tested.** `fixtures.test.ts` asserts what a reader would reasonably infer: edge leakage equals system total R minus actual total R, the mistake costs sum exactly to the edge leakage, the equity curve ends at the reported totals, reported drawdown is at least the sampled trough, and all four cells of the outcome matrix are represented. Hand-written data drifts silently when edited, and an internally contradictory demo undermines the argument it is there to make.

Comparisons in those tests go through fixed-point integers rather than `parseFloat`, because `37.8 - 9.9 === 27.900000000000002` and the product's whole position is that financial values are not compared as floats.

**Prices are absent rather than placeholder.** `price: null` renders "Pricing to be confirmed". A placeholder figure on a public pricing page is indistinguishable from a real one once it has been screenshotted, and "we will change it before launch" is not a control.

**Nothing may imply a capability that does not exist.** No fake OAuth, no submit that appears to succeed, no purchase path. The e2e suite includes assertions specifically for this — a registration submit must not create a session cookie, and the Google button must be disabled and explained.

## Decision 3 — Phase 01 is the design system; the roadmap resequences around it

This phase was inserted at 01 and the rest shifted. The former Phase 11 (Landing & Marketing) is superseded, its scope delivered here.

**Auth (02) now precedes tenancy (03), reversing a documented Phase 00b decision.** The original rationale — build the scoping primitive first so auth plugs into a guard that already provably works — was sound and is not being discarded on aesthetic grounds. It is safe to reverse here for one specific reason: **between phases 02 and 03 there are no tenant-scoped records**. Product data begins at Phase 05. The failure the old order guarded against is retrofitting workspace scope onto queries that already exist, and across this gap there are no queries.

The obligation transfers rather than disappearing: Phase 03 must ship cross-workspace isolation tests before any business table lands, and no product query may be written in Phase 02.

**The landing page ships before final pricing and real screenshots**, which was the stated reason for scheduling it last. It ships anyway because a design system that nothing consumes is unreviewable, and a marketing page is its most demanding consumer. The cost is paid in the open: no prices are invented, and the product preview is a live composition of fixtures rather than a screenshot that would go stale the moment a token changed.

## Alternatives considered

**Keep the brand cyan as the system series colour.** `#22d3ee` sits above the dark-mode lightness band and, at an in-band step, collapses toward blue. Teal at `#0f9e8e` clears every check with a wide margin. The identity colour remains `brand` for UI; the data series is a separate, validated concern.

**Show illustrative prices behind a "not final" banner.** Rejected: the banner does not survive a screenshot, and the number does.

**Generate the demo numbers from a small formula so ranges recompute.** Rejected under Decision 2. Three literal bundles cost more lines and cannot lie.

**Bottom navigation on mobile instead of the drawer.** Rejected: the Phase 00b drawer is hardened, focus-trapped and tested, and five sections fit it comfortably. Replacing working, tested behaviour needs a reason better than fashion.
