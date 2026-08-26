# Phase 01.1 — UI Simplification and Thai/English Localization

**Depends on:** 01 · **Blocks:** every later UI phase · **Completed:** 2026-08-01

## Goal

Two changes to the surface Phase 01 shipped, made together because they touch the same files: reduce the dashboard and landing page to the information a first glance actually needs, and make the entire product legible in Thai as well as English. No authentication, database, payment, or product-mutation work — every constraint from Phase 01 still holds.

## Why together, not sequentially

Simplifying a component and localizing it both require rewriting the component's JSX. Doing the simplification pass first and the localization pass second would mean touching every marketing and dashboard file twice, with the second pass re-deriving context the first pass already had. The message catalog was designed against the _simplified_ shape of each screen, not the Phase 01 shape, so there is only one version of each string to write.

## What shipped

### Dashboard simplification

The dashboard now answers "what is happening right now"; `/app/analytics` answers "why". Concretely, `DemoDashboard` (rendered identically on `/demo` and `/app`, unchanged from Phase 01) changed from eight top-level KPI cards and four comparison rows to:

- **Exactly four headline KPI cards**: Net P&L, Actual Win Rate, Actual Average R, Discipline Score.
- **A single "System vs trader" module** showing only Win Rate, Average R and Expectancy comparisons, with Execution Gap folded into one insight sentence rather than its own card, and a "View detailed analytics" link to `/app/analytics`.
- **Exactly one chart** — Cumulative R. No second, competing chart.
- **Common mistakes reduced to the top three by cost**, each showing name, frequency and R-impact, with its own link to the full breakdown.
- **Recent trades unchanged** — the dual table/card presentation from Phase 01 was already correct for this.

System Expectancy, Actual Expectancy, Profit Factor, Max Drawdown and System Edge Captured did not disappear — they moved to `/app/analytics`, which keeps the full metric set Phase 01 already built, now under section headings (`System against actual`, `Cumulative R`, `Mistake cost`) rather than a single undifferentiated grid.

Enforced directly by `src/components/dashboard/demo-dashboard.test.tsx`: exactly 4 `[data-kpi]` cards, exactly 1 `<figure>`, the moved metrics do not appear as `data-kpi` cards, the mistakes list renders exactly 3 items, and both the analytics-detail links resolve to `/app/analytics`.

### Landing page simplification

One idea per section, in argument order: problem → why system/trader separation matters → how manual journaling works → four primary capabilities → pricing → FAQ. Concretely:

- **Hero**: unchanged shape (one badge, one headline, one description, two CTAs, one trial note, one product preview) — Phase 01 had already reduced it to this; Phase 1.1 confirmed no regression and translated it.
- **Product preview**: the three-stat grid above the chart (system total R / actual total R / edge leakage) is gone. One chart plus one summary sentence carries the message.
- **Attribution section**: four mini KPI cards and four comparison rows reduced to two KPI cards (Execution Gap, Discipline Score) and the three comparison rows the phase brief names (Win Rate, Average R, Expectancy) — the same trim applied to the dashboard, applied here for the same reason.
- **Features**: six features reduced to four (fast manual journal, strategy playbooks, system-vs-trader analytics, discipline/mistake tracking), with responsiveness and TradingView links demoted to one supporting sentence rather than their own cards.
- **Pricing**: unchanged structurally from Phase 01 (three plans, provisional limits, no live payment) — copy simplified and translated.

### Thai/English localization

Full architecture, URL strategy, and rationale in [ADR 0007](../decisions/0007-i18n-architecture.md). Summary:

- **`next-intl` 4.13.4**, message catalogs at `messages/en.json` / `messages/th.json`, 370 matching leaf keys, parity enforced by `src/i18n/messages.test.ts`.
- **Every route lives under a locale prefix** — `/en/...` or `/th/...`, no unprefixed route (`localePrefix: 'always'`). `routing.defaultLocale` is `'en'`.
- **Detection precedence**: explicit selection (persisted in the `NEXT_LOCALE` cookie) → cookie → `Accept-Language` → `en` fallback. No `localStorage` involvement — the cookie is readable on the very first server render, so there is no post-hydration locale flash.
- **`LanguageSwitcher`** (`src/components/shell/language-switcher.tsx`) in the public header, public mobile drawer, app-shell sidebar, app-shell mobile drawer, and now also in `/app/settings` under a new Language section. Text labels only ("English" / "ไทย"), never flags. Preserves the current route and query string across a switch.
- **Localized metadata**: every page emits a locale-prefixed, route-specific canonical URL, matching English/Thai hreflang alternatives, and valid `en_US`/`th_TH` Open Graph locale values through `src/i18n/metadata.ts`.
- **Typography**: `Noto Sans Thai` replaces the Phase 01 "no web font" system stack, and Thai heading/label roles use script-appropriate line heights with no Latin-style tracking — see ADR 0007 Decision 4.
- **Number/date/currency**: money formatting is unchanged and deliberately locale-independent (ADR 0007 Decision 5); date formatting reads the active locale and pins the Gregorian calendar explicitly, because `th` defaults to the Buddhist calendar under ICU otherwise.
- **Terminology**: governed by the [localization glossary](../localization-glossary.md) — which technical terms stay in English inside Thai copy (Average R, Expectancy, Execution Gap, System Edge Captured, TradingView, R, symbol names, currency codes, plan names) and which translate cleanly (System, Trader, Win Rate, Discipline Score).
- **Translation coverage**: every visible string on every public route and every mock app route, including nav, footer, empty states, table headers, filters, a11y labels, and the `not-found`/error/loading boundaries for the `(app)` group. `global-error.tsx` is the sole deliberate exception — see its inline comment; it stays hardcoded English because it is the fallback for when the locale layout itself fails to render, and a translation lookup inside that boundary could compound the original failure.
- **User-authored-like demo fixture content stays untranslated** — trade symbols, strategy names, demo account nicknames, and the standalone `STRATEGIES` fixture on `/app/strategies` are treated like real user content. Fixed product taxonomy such as mistake labels is localized.

## Decisions worth recording

**`localePrefix: 'always'`, not `'as-needed'`.** The more common choice (default locale unprefixed) was rejected specifically because it makes `/` resolve to a locale via detection alone, with no URL signal — exactly the redirect-loop and hydration-mismatch surface the phase brief warns against. See ADR 0007 Decision 2.

**No account-level locale persistence yet.** The cookie is the only store. Phase 2 will sync it to the authenticated user's stored preference once an account exists to store it on — inventing that column now would be schema built ahead of the phase that needs it.

**Money formatting was audited and left unchanged.** Every locale-sensitive display primitive was checked against `src/lib/money/` and `src/lib/time/`; only date formatting needed a change. See ADR 0007 Decision 5 for the full reasoning — this was a deliberate non-change, not an oversight.

**Independent hardening found further coverage gaps.** In addition to the original `ThemeToggle` and `SheetContent` gaps, `/th/app` still had an English page title, description, and metadata, while fixed mistake taxonomy rendered in English throughout Thai dashboard, trade, chart, and accessible-table views. Those product-owned labels now use shared catalog keys, with unknown/user-authored labels deliberately passed through unchanged.

**The hardening review also corrected claims and hierarchy.** The hero preview no longer repeats advanced discipline/execution metrics, pricing no longer advertises account-level attribution or export before those phases exist, and the dashboard chart no longer places a fully styled card inside another card.

## Verification

All executed on 2026-08-01, exit codes checked individually.

| Command                                          | Result                                          |
| ------------------------------------------------ | ----------------------------------------------- |
| `pnpm format:check`                              | pass                                            |
| `pnpm lint`                                      | pass                                            |
| `pnpm typecheck`                                 | pass                                            |
| `pnpm test`                                      | **289 passed**                                  |
| `pnpm build`                                     | pass, with no `DATABASE_URL` in the environment |
| `pnpm scan:client`                               | pass                                            |
| `pnpm test:e2e`                                  | **260 passed**                                  |
| `git diff --check`                               | clean                                           |
| Production server, required routes, both locales | pass                                            |

## Deliberately deferred

| Item                                               | Phase | Why                                                                            |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| Syncing locale preference to an authenticated user | 02    | No user row exists yet to store it on                                          |
| Real per-user timezone display                     | 07+   | Unrelated to locale; still `DEMO_TIME_ZONE` everywhere                         |
| A third locale                                     | —     | Not requested; ADR 0007 records what adding one requires                       |
| Localized Open Graph images                        | 09    | Carried forward from Phase 01 — needs a real screenshot to be worth generating |

## Open risks

- **The system counterfactual for translation quality is self-reported, the same way the product's own core metric is** — Thai copy has not been reviewed by a native-speaking trader for tone, only checked for structural coverage and terminology-policy consistency. Revisit once real Thai-speaking users are onboarding.
- **`/app` is still unauthenticated**, carried forward from Phase 01 and Phase 00b — locale switching does not change this risk's shape.
- **Strategy fixture content (`/app/strategies`) is in English only.** Treated as demo fixture data per the glossary, consistent with trade symbols and account nicknames, but worth revisiting if a future phase turns this fixture into seed data a Thai-speaking demo audience actually reads closely.
- **`src/middleware.ts` triggers a Next.js 16 deprecation warning** at build time ("the middleware file convention is deprecated, use proxy instead"). `next-intl`'s own middleware helper (`createMiddleware`) is written against the `middleware.ts` convention; migrating to `proxy.ts` is a `next-intl`-side dependency upgrade, not something to hand-roll around it. Deferred until `next-intl` ships proxy-convention support.
- **Every `[locale]` route builds as dynamic (`ƒ`), not static (`○`).** Confirmed in the `pnpm build` output. The middleware conditionally sets the `NEXT_LOCALE` cookie on a response (`next-intl`'s cookie-sync behavior), and Next.js's build-time static analysis cannot prove that write will not happen for a given request, so it conservatively renders the whole route dynamically rather than prerendering it. Every page still calls `setRequestLocale`, which is the correct opt-in on the application side; the remaining dynamism is a property of the middleware, not a missed opt-in. Functionally invisible — every route still returns 200 and every page is fully static in content — but worth revisiting if server load from these routes becomes a real cost, since a cache-control or matcher adjustment may recover static rendering.
