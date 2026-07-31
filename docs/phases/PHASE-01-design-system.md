# Phase 01 — Design System, Marketing & Application Shell

**Depends on:** 00b · **Blocks:** every UI phase · **Completed:** 2026-07-31

## Goal

The first complete visual representation of the product: a design system with real tokens, a marketing site that explains the thesis, and an application shell with five working sections — all from static fixtures, with no authentication, no database and no server-side product logic.

## Sequencing change

This phase did not exist in the Phase 00b roadmap, which had `01 = Data Model & Tenancy` and `11 = Landing & Marketing`. It was inserted at 01 and the remaining phases shifted; the old Phase 11 is **superseded** — its landing-page scope is delivered here.

Two consequences worth stating plainly rather than burying:

**Auth (02) now precedes tenancy (03).** The Phase 00b rationale for the opposite order was that the scoping primitive is the security boundary, so building it first means auth plugs into a guard that already provably works. That reasoning still holds in general, and the reordering is only safe because of a specific fact: between 02 and 03 there are **no tenant-scoped records**. Product data starts at Phase 05. The failure the old order guarded against — retrofitting workspace scope onto queries that already exist — cannot occur across this gap because there are no queries. Phase 03 must still ship the isolation tests before any business table lands.

**The landing page ships before final pricing and real screenshots.** That was the stated reason for scheduling it last. It ships anyway because the design system has to be exercised by something real, and a marketing page is the most demanding consumer of it. The cost is paid honestly: prices are absent rather than invented, and the product preview is a live composition of fixtures rather than a screenshot that would go stale.

## What shipped

### Design tokens

Extended the Phase 00b vocabulary with `surface`, `info`, `overlay`, `chart-1`–`chart-4`, semantic elevation, and the `system` / `trader` chart aliases, across all four palette blocks. Added a typography scale (`text-display`, `text-page-title`, `text-section-title`, `text-card-title`, `text-metric`, `text-label`), the `numeric` utility for tabular figures, safe-area utilities, and `--shell-header-height` / `--shell-sidebar-width` so the shell's geometry is one decision.

### Chart palette — validated, not chosen

The series colours were produced by running a validator, not by eye. Recorded output:

| Mode  | Surface   | Slots                                   | Worst adjacent ΔE (CVD / normal) |
| ----- | --------- | --------------------------------------- | -------------------------------- |
| Dark  | `#0d1424` | `#0f9e8e` `#3b82f6` `#c2650f` `#b06ef0` | 18.8 protan / 19.6 normal        |
| Light | `#ffffff` | `#0891b2` `#1d4ed8` `#c2570f` `#7c3aed` | 17.0 deutan / 19.6 normal        |

All six checks pass in both modes: lightness band, chroma floor, CVD separation, normal-vision floor, contrast, documented palette.

The first four candidate palettes failed. Blue against violet collapsed to **ΔE 0.3 under deuteranopia** — indistinguishable — and several steps sat outside the mode lightness bands. That is exactly the class of defect that survives visual review, which is why the palette was computed.

**Light-mode `system` is 3.68:1** against white. Legal for a graphic mark, below the 4.5:1 needed for small text — so series colours are used for marks only, and every label wears a text token beside a coloured swatch.

### Marketing site

`/` (hero, problem, attribution, workflow, features, pricing, FAQ, CTA), `/pricing`, `/login`, `/register`, `/demo`. Registration, login, trial and pricing language is explicitly labelled as a preview or plan; no CTA claims that authentication, a trial or payment processing is live.

The landing page argues rather than lists: it states the problem, shows that profit cannot resolve it, demonstrates the measurement, explains the work required, then prices it. The outcome matrix appears in full, including the two asymmetric cells that a conventional journal cannot express.

### Demo dashboard

One `DemoDashboard` component rendered on both `/demo` and `/app`, so the marketing demo and the product cannot drift apart. Date-range and account controls do real local work against three literal fixture bundles.

### Application shell

Five real routes: `/app`, `/app/trades`, `/app/strategies`, `/app/analytics`, `/app/settings`. Theme selection in settings is genuinely functional; everything else is a labelled preview.

## Decisions worth recording

**Demo data is labelled everywhere it appears.** These are trading figures on a public page, and an unlabelled screenshot of them would function as a track record. Enforced by unit and e2e tests, not by discipline. See [ADR 0006](../decisions/0006-design-system-and-demo-data.md).

**No formulas in `src/lib/demo/`.** Every metric is a literal. A plausible-looking formula written to make a demo move would become a second, untested implementation of the thing the product is about. `fixtures.test.ts` asserts the internal consistency a reader would infer — edge leakage equals system minus actual total R, and the mistake costs sum to it exactly.

**Prices are absent, not placeholder.** `price: null` renders "Pricing to be confirmed". A placeholder number is indistinguishable from a real one once screenshotted.

**The FAQ is `<details>`/`<summary>`.** Keyboard operable, correct expanded state, works with JavaScript off, and findable by browser find-in-page — none of which a JS accordion gives without reimplementing it worse.

**Nav items lost their `enabled` flag.** Phase 00b rendered unbuilt sections as disabled placeholders because linking to a 404 is worse. All five routes now exist, so the e2e assertion moved from "unbuilt sections are marked unavailable" to "every nav item resolves, and exactly one is `aria-current`".

**Active matching is exact, not prefix.** A `startsWith` match would light `/app` on every child route and give a screen reader two "current page" claims.

## Two bugs the tests caught

**The date-range radios are not clickable by Playwright.** They are `sr-only`, so `.check()` fails actionability on a 1px clipped input. Real users click the `<label>`, and keyboard users focus the input and press Space — both verified. Worth recording because the natural reading of the failure is "the control is broken", and it is not.

**A comment claimed something false.** `TradesTable` documented that only one of its two presentations is "in the DOM at a time". Both are; the inactive one is `display:none`, which removes it from the accessibility tree but not from a DOM query. The accessibility claim was right and the DOM claim was wrong; a test scoped with `.first()` resolved to the hidden table and failed. Both the comment and the test are fixed, and each presentation now carries `data-trades-view`.

## Independent hardening review

The post-completion review confirmed and fixed: non-AA dark primary and light warning text, trial/authentication copy that read as live, false intermediate KPI values, undersized shared touch targets, drawer wordmarks that left their dialogs open, Recharts in the landing payload, raw overlay/elevation values at call sites, and metadata origin resolution that ignored the documented portable environment variable. Regression coverage exercises the rendered production UI, not only class names or source structure.

The same review found no confirmed broken routes, hydration mismatch, horizontal overflow, mobile table/chart breakage, server secret leakage, build-time database initialization, unlabeled fixture data, expected-return claim, or unnecessary server-to-client component conversion.

## Verification

All executed on 2026-07-31, exit codes checked individually.

| Command                               | Result                                          |
| ------------------------------------- | ----------------------------------------------- |
| `pnpm format:check`                   | pass                                            |
| `pnpm lint`                           | pass                                            |
| `pnpm typecheck`                      | pass                                            |
| `pnpm test`                           | **274 passed**                                  |
| `pnpm build`                          | pass, with no `DATABASE_URL` in the environment |
| `pnpm scan:client`                    | pass — 29 client assets, no server secrets      |
| `pnpm test:e2e`                       | **214 passed** (desktop + mobile)               |
| `git diff --check`                    | clean                                           |
| Production server, 13 required routes | all HTTP 200                                    |

## Deliberately deferred

| Item                                   | Phase | Why                                                                                   |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| Authentication, sessions, Google OAuth | 02    | Forms are visual only and say so                                                      |
| Real metrics from a calculation engine | 07    | Fixtures are literal; no formula exists to call yet                                   |
| Per-account attribution                | 09    | Would require computing, which this phase does not do                                 |
| Payment processing                     | 04    | Mock flow behind an adapter, once entitlements exist                                  |
| Open Graph **image**                   | 09    | `ImageResponse` needs a real screenshot to be worth generating; metadata only for now |
| Web font                               | later | Still no measured benefit over the system stack; revisit with brand identity          |
| Indexing                               | 12    | `robots.ts` disallows everything while the product is a preview                       |

## Open risks

- **`/app` is still unauthenticated.** Carried forward from Phase 00b. Safe only because it holds fixtures rather than anyone's data. Phase 02 adds the guard.
- **The account selector does not re-scope the metrics.** It filters the trade list and says so on the page. Making it appear to recompute would be faking the product's core calculation.
- **Recharts is a substantial dependency** and is restricted to interactive demo and application routes. The landing page uses server-rendered SVG and disables prefetch for chart-bearing destinations, keeping Recharts out of its initial client assets. If chart usage does not grow by Phase 09, a lighter renderer is worth reconsidering.
- **Chart colours are validated against `card`, not every surface.** Charts currently render only on `card`. A chart placed on `surface` or `muted` needs its contrast re-checked.
- **No visual regression testing.** Layout is asserted structurally (overflow, touch targets, landmarks) rather than by pixel comparison, which is deliberate — but it means a purely cosmetic regression would pass CI.
