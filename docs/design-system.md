# Design System

**Status:** Phase 01.1. Tokens, typography, spacing, motion, charts and the component set used by the marketing site and application shell are implemented. Later phases add components when a phase needs them, not before.

## 1. Principles

Modern professional SaaS for financial analytics — not an admin template, not a trading terminal, not a crypto product.

Restrained gradients, clean layered surfaces, generous spacing, clear hierarchy, consistent radii. Density only where the data earns it: a KPI row breathes, a trade table does not.

Dark is the primary experience; light is complete rather than an afterthought.

**What this explicitly is not.** No glassmorphism beyond a single translucent sticky header. No glow. No animated background particles. No candlestick decoration, coin imagery, or ticker tape. No aggressive red-on-green. Nothing under 12px. Restraint is the identity.

## 2. Tokens

Call sites use **semantic** tokens only. Never a raw hex value, never a palette number. Raw colour and RGBA values belong only in the token declarations (plus browser metadata and static asset source files). That indirection is what allows a re-theme and what stops light mode rotting.

```
❌ text-[#93a4c0]   ❌ bg-blue-600
✅ text-muted-foreground   ✅ bg-primary
```

The vocabulary follows shadcn/ui's contract so vendored components work untouched, extended with the tokens the trading domain needs. See [ADR 0005](decisions/0005-theme-and-tokens.md).

### shadcn contract

| Token                | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `background`         | Page canvas                                        |
| `foreground`         | Primary text                                       |
| `card`               | Cards and panels                                   |
| `card-foreground`    | Text on cards                                      |
| `popover`            | Menus, dropdowns, sheets                           |
| `primary`            | Brand blue — primary actions                       |
| `primary-foreground` | Text on `primary`                                  |
| `secondary`          | Secondary surfaces                                 |
| `muted`              | Muted **surface**                                  |
| `muted-foreground`   | Secondary **text** and labels                      |
| `subtle-foreground`  | Low-priority metadata and decorative labels        |
| `accent`             | Subtle hover surface — **not** the identity accent |
| `destructive`        | Destructive actions                                |
| `border` / `input`   | Dividers, card borders, input borders              |
| `ring`               | Focus ring                                         |

### Product tokens

| Token               | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `brand`             | Restrained identity accent                         |
| `surface`           | Section band, one step off the canvas              |
| `surface-raised`    | Elevated elements, inline code, chips              |
| `positive`          | Gains, wins                                        |
| `negative`          | Losses                                             |
| `break-even`        | Break-even outcomes                                |
| `warning`           | Caution, trial expiry, demo markers                |
| `info`              | Neutral notices                                    |
| `overlay`           | Dialog and drawer scrim                            |
| `shadow-*`          | Semantic control, card, elevated and popover depth |
| `chart-1`…`chart-4` | Categorical chart series, fixed order — see §9     |
| `system` / `trader` | Semantic aliases of `chart-1` / `chart-2`          |

> **Trap.** `accent` is shadcn's neutral hover surface, not the blue identity colour — that is `brand`. Mixing them produces components that look fine in isolation and wrong in context.

`surface` moves away from the canvas in whichever direction reads as a distinct band for the theme: lifted in dark, tinted in light. That asymmetry is deliberate — in light mode "raised" is nearly white, which is already `card`.

Radii derive from `--radius` (0.75rem): `rounded-sm` / `md` / `lg` / `xl`.

### Palette

| Token               | Dark      | Light     |
| ------------------- | --------- | --------- |
| `background`        | `#0d0d0d` | `#f8fafd` |
| `foreground`        | `#f6f6f6` | `#0b1220` |
| `card`              | `#181818` | `#ffffff` |
| `popover`           | `#181818` | `#ffffff` |
| `primary`           | `#2877a2` | `#1d4ed8` |
| `secondary`         | `#262626` | `#e9edf7` |
| `muted`             | `#262626` | `#e9edf7` |
| `muted-foreground`  | `#797979` | `#55657f` |
| `subtle-foreground` | `#4d4d4d` | `#7b879b` |
| `accent`            | `#262626` | `#dfe6f4` |
| `destructive`       | `#ef6362` | `#be123c` |
| `border`            | white 8%  | `#dde4f0` |
| `input`             | white 12% | `#dde4f0` |
| `ring`              | `#2877a2` | `#1d4ed8` |
| `brand`             | `#2877a2` | `#0e7490` |
| `surface`           | `#0d0d0d` | `#e9edf7` |
| `surface-raised`    | `#262626` | `#ffffff` |
| `positive`          | `#2fa97a` | `#047857` |
| `negative`          | `#ef6362` | `#be123c` |
| `break-even`        | `#2853e4` | `#1d4ed8` |
| `warning`           | `#f59e0b` | `#92400e` |
| `info`              | `#56b6f7` | `#0369a1` |
| `chart-1`           | `#0f9e8e` | `#0891b2` |
| `chart-2`           | `#3b82f6` | `#1d4ed8` |
| `chart-3`           | `#c2650f` | `#c2570f` |
| `chart-4`           | `#b06ef0` | `#7c3aed` |

`positive` and `negative` are never the only signal for a value's direction — sign, arrow, or label must carry it too, for red-green colour blindness.

Primary text, positive/negative values, and text on primary actions retain strong contrast. `muted-foreground` is reserved for supporting copy, while `subtle-foreground` and `break-even` are never used as the sole colour of essential body text: subtle is limited to tertiary/decorative metadata, and break-even uses a tint with foreground text. Chart-series colours likewise never carry text on their own (§9).

Interactive shell navigation uses a dedicated rest foreground (`#818181` on
the dark `#181818` chrome, 4.56:1) rather than promoting every secondary label.
The general `muted-foreground` therefore remains the reference `#797979`, while
route names and icons retain AA contrast before hover.

## 3. Theming

Dark is the product default. The only user-selectable modes are **Dark** and
**Light**; OS/System preference is deliberately not a product mode.

An explicit choice is persisted in `localStorage` and applied as `.dark` or
`.light`. A legacy persisted `system` value is migrated to Dark before paint,
so older preferences cannot restore OS-driven behavior or cause a theme flash.
`color-scheme` follows the resolved class so native controls and scrollbars
match.

The header `ThemeToggle` and settings `ThemeSelector` write the same two-value
contract. Neither control offers System.

## 4. Typography

**`Noto Sans Thai`** (self-hosted via `next/font/google`), covering both Latin and Thai in one family, plus a monospace stack for numbers. This reverses the Phase 01 "no web font" default: the system font stack has no guaranteed Thai-covering face in the same family as its Latin face, and where the OS substitutes a different typeface for Thai glyphs mid-string, line-height and vertical metrics stop matching exactly at the script boundary this product's copy constantly crosses (a Thai sentence naming an untranslated English metric). `next/font` subsets and self-hosts at build time, so the reversal costs no runtime request to Google and no layout shift — the two properties that justified the original system-stack choice are preserved. **`Noto Sans Thai`, not `Noto Sans`** — Google ships Thai coverage as a separate family; `Noto Sans` alone has no `thai` subset. Full reasoning in [ADR 0007](decisions/0007-i18n-architecture.md) Decision 4.

Roles, not sizes. A call site asks for `text-display`, so changing what a role looks like is one edit in `globals.css`.

| Role           | Token                 | Value                           | Used for                    |
| -------------- | --------------------- | ------------------------------- | --------------------------- |
| Display        | `text-display`        | clamp 2.125→3.5rem, 600         | Hero headline only          |
| Page title     | `text-page-title`     | clamp 1.625→2rem, 600           | The single `<h1>` on a page |
| Section title  | `text-section-title`  | clamp 1.5→1.875rem, 600         | Landing-section `<h2>`      |
| Card title     | `text-card-title`     | 1rem, 600                       | Card and panel headings     |
| Body           | `text-base`           | 1rem                            | Prose                       |
| Muted body     | `text-sm` + token     | 0.875rem, `muted-foreground`    | Supporting copy             |
| Label          | `text-label`          | 0.75rem, 500, 0.06em, uppercase | Metric names, field groups  |
| Dense label    | `MetricLabel` `plain` | 0.75rem, 500, normal case       | Metric grids, count strips  |
| Table text     | `text-sm`             | 0.875rem                        | Table cells                 |
| Numeric metric | `text-metric`         | clamp 1.5→1.875rem, 600         | Figures outside the KPI row |
| KPI figure     | `text-kpi`            | clamp 1.25→1.625rem, 600, `cqi` | Four Basic KPI figures      |
| KPI lead       | `text-kpi-hero`       | clamp 1.25→1.75rem, 600, `cqi`  | Net P&L, the row's lead     |
| Tabular number | `numeric` utility     | mono + `tabular-nums`           | Any figure in a column      |

The three largest roles are **fluid** (`clamp`), so headings scale continuously between 320px and desktop instead of jumping at breakpoints. The lower bound is chosen to fit 320px without overflow.

Thai pages retain the same sizes and hierarchy but override the display, title, card-title, and label rhythm in `globals.css`: line heights are at least `1.22` for display text and Latin-style tracking is removed. This prevents Thai combining marks from clipping or separating visually at narrow widths.

**`MetricLabel` has two casings and the difference is density.** `caps` (the default) is the `text-label` role above: it reads as a heading, and on a surface carrying ONE label — a KPI tile, a form section — that is right. `plain` is the same size, colour and weight without the uppercase and tracking, for surfaces carrying six or twelve at once: a performance card's metric grid, an operational count strip, a table's column heads. Uppercase plus 0.06em costs roughly 15% extra width per label, and repeated a dozen times in one viewport it stops reading as hierarchy and starts reading as noise. The caps variant keeps its meaning precisely because it is no longer everywhere.

**`cn()` must be told about every custom `text-*` size role, and this is load-bearing.** `cn()` is tailwind-merge, which resolves conflicts from its own default class map and cannot discover a Tailwind v4 theme. Left to itself it classifies any unrecognised `text-<name>` as a text COLOUR — so `cn('text-metric', 'text-positive')` reads as a conflict, keeps only the later class, and silently drops the font size, leaving the figure at its inherited 16px. That was live for the whole KPI row until it was found by measuring the rendered font size rather than by reading the markup, which is the only way it shows up: the class simply never reaches the DOM.

`src/lib/utils.ts` therefore extends the merge config with an explicit `font-size` group (`extendTailwindMerge`) naming `text-metric`, `text-kpi` and `text-kpi-hero`. Normal last-size-wins behaviour is preserved — `cn('text-kpi', 'text-sm')` still yields `text-sm`. **Any new `--text-*` role must be added to that list**, or it will be dropped wherever a tone class follows it.

**Both KPI roles scale with the CARD (`cqi`), never with the viewport.** The row is five columns at `lg`, three at `md` and two below, so card width is not monotonic in viewport width: 1024px gives each card ~132px of content while 768px gives ~195px. A `vw`-based clamp is therefore largest exactly where the card is narrowest. The lower bounds and `cqi` slopes are fixed by the widest real figure in the tabular mono stack (~0.52em advance): a ten-character money total needs ~5.2× its font size in width, which is what the lead role's `18cqi` encodes.

**The ceilings came DOWN, and that is the finding.** They were `2rem`/`2.25rem` — 32px and 36px at 1440. A measured competitive benchmark (TradeZella Dashboard, observed August 2026) sets its KPI value at **26px/600** with a 14px/400 label inside a card 60% wider than ours, and reads as more authoritative rather than less. A KPI band's weight does not come from the size of the numeral; it comes from the air around it. `text-kpi` now lands on that same 26px ceiling and `text-kpi-hero` on 28px — Net P&L stays the row's lead by one legible step, which is an existing product contract the benchmark's five-equal-cards treatment does not override. The height freed went into the card's vertical padding (10px → 16px a side), taking the card from 105.8px to **120px**, which is the benchmark's row height exactly. Do not grow these roles again without a measurement that says the current pair is too small.

**Every financial figure uses `numeric`.** Tabular numerals keep digits on a fixed advance width, so a column of R-multiples aligns on the decimal point and an animating KPI does not jitter as digits change. Prose numerals stay proportional, which is why this is a utility and not a base rule.

## 5. Spacing and layout

| Concern         | Convention                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| Page width      | `Container` — `default` 72rem, `wide` 100rem, `canvas` 120rem, `prose` 48rem |
| Page gutters    | `px-4` → `sm:px-6` → `lg:px-8`                                               |
| Section spacing | `py-16` → `sm:py-20` → `lg:py-24`                                            |
| Card padding    | `p-4` → `sm:p-5`; `p-5` → `sm:p-6` for prominent panels                      |
| Grid gaps       | `gap-4` for cards, `gap-6`–`gap-8` for major regions                         |
| Sidebar width   | `--shell-sidebar-width` (15rem), desktop only                                |
| Header height   | `--shell-header-height` (3.5rem), sticky on both shells                      |
| Safe area       | `pb-safe` / `px-safe` utilities where content meets a device edge            |

The shell's geometry lives in CSS variables rather than repeated `top-14` / `w-60` utilities, so the sticky offset and the sidebar width are each one decision.

`canvas` is the Dashboard's width and only the Dashboard's. `wide` leaves a 1728/1920-class monitor with roughly 128px of dead margin on each side of the workspace; the higher ceiling hands those pixels back without changing the gutters, and starts doing any clipping at all only on a genuine ultrawide. Widening the other analytics surfaces is a separate decision, taken separately.

**Dense data surfaces set their own vertical rhythm.** A `gap-6`–`gap-8` between every region reads as generous on a marketing page and as wasteful on a page whose job is figures. The Dashboard uses exactly **two** boundaries: `mt-4` (16px) inside the opening context block — account strip, KPI band, Needs Attention, which are read as one continuous operational unit — and `mt-6` (24px) between analytical sections, which is also the `gap-4`+ rhythm those sections use between their own cards. An earlier pass ramped this 20/24/28/32; four margins nobody can perceive apart are not a hierarchy, they are four ways of being loose, so the ramp was collapsed to the two boundaries that genuinely exist.

**The Dashboard opens on All time.** A Dashboard URL that names no `range` resolves to `all` (`DASHBOARD_DEFAULT_DATE_PRESET`, `src/lib/dashboard/filters.ts`), not to Analytics' `90d`. The Dashboard is where a trader looks to see where they stand; a silent 90-day window means an account whose history is older opens on an empty or partial page with nothing on screen saying a window was applied. Analytics is the surface for bounded interrogation and keeps its own default — `parseAnalyticsFilters` is untouched, and any explicit `?range=` on either surface still resolves to exactly itself.

**The answer sits on a raised surface.** One rule builds the Dashboard's card hierarchy, and it is a step in PLANE rather than a new colour, a heavier border or a nested box: wherever a figure is _the answer_ rather than a supporting reading, it sits on `--muted` (`bg-muted/50`) inside its card. That is the Execution Gap's four summary cells, each insight pillar's primary statement, the System/Trader Total R, and Risk Performance's Modeled Balance + Period P&L. Everything else stays on the card plane. Before this every Dashboard card was one flat `#181818` field and a reader had to read every figure on a card to discover which one mattered.

**A wide card is laid out wide.** The System/Trader cards keep a full-width identity row and then split along their long axis — the hero Total R on the left, its two qualifying metrics on the right — rather than stacking everything. The split is a **container query** (`@container/perf`, engaging at 34rem of card width), not a breakpoint: two such cards sit inside a two-column section, so the viewport says nothing useful about how wide either one actually is. Measured, a purely stacked card is 231px at every width — 38px _taller_ at 1440 than the version it replaced — while the split lands at 165px. The identity row is deliberately outside the split: inside a 13rem hero column, "System Performance" truncated to "System Perfor…", and a clipped side name in a comparison of exactly two sides is the one label that can never be allowed to break.

**Each section owns its own grid.** The Dashboard is a stack of sections, not one page-wide grid: the KPI band is five columns, the System/Trader pair is two, and Recent Trades + Calendar is twelve, split **5 + 7** — the Calendar takes the wider share, because width is the only thing that makes a day cell legible while the Trade list reaches its natural width at about 500px and spends everything past that on padding. A widget's recorded `desktopSpan` is read against **its own section's** column count and nothing else. This is a record of what the components spell, not a layout engine — there is no persistence, editor, drag/drop or resize behind it.

### Dashboard density rules

Four rules, each traced to a measurement rather than to taste. They apply to the **Dashboard only** — Trades, Analytics, Settings and Admin are unaffected.

**Dashboard cards carry no visible outline.** `[data-dashboard-panel]`, `[data-dashboard-region='account-context']` and `[data-kpi-status]` set `border-color: transparent` in `globals.css`. Cards separate from the page on surface contrast alone: `--background` `#0d0d0d` against `--card` `#181818`, which is the same pair the benchmark uses (page `rgb(13,13,13)`, card `rgb(24,24,24)`, no border, no shadow, 12px radius). Eleven outlined rectangles down one page, several containing further outlined rectangles, was noise the contrast already did without. Two deliberate details: the rule sets the border's **colour**, not its width, so every measured height and every skeleton block stays valid to the pixel; and `--shadow-card` is **kept**, unlike the benchmark, because that reference is dark-only and light mode's `#f8fafd`/`#ffffff` pair is far too close to carry a card edge on contrast alone. Internal separators stay wherever they do structural work — table rows, Calendar cells, the System/Trader hairline.

**The Dashboard carries no explanatory paragraphs.** The benchmark's Dashboard has exactly zero, and every definition on it lives behind an ⓘ. Every Dashboard header is therefore **title + optional ⓘ + optional action**, and methodology moved into `MetricInfo` popovers rather than being deleted: the section heading's population note, Needs Attention's scope sentence, the Execution Gap description, the three insight-pillar descriptions, the Calendar's per-mode axis line, and Risk Performance's description, peak hint and chart caption. What stays visible is data or a truthfulness guard, never a definition — the non-additive cohort caveat and Risk's carried-opening line are both load-bearing and stay on the card. Measured on the populated fixture at 1440 this took the visible paragraph count from 27 to 11, all 11 of them data or caveat.

**A Dashboard record list is a preview, not a table.** Recent Trades shows **three fields** — day, symbol, Actual R — over seven ~45px rows with a "View all Trades" escape hatch, against the benchmark's three columns and seven ~45px rows. Strategy, Setup, direction, status, System R and the per-Trade Execution Gap left the row; each is still reachable, on the Trade the row links to or in the Execution Gap section above it. The Calendar cell follows the same rule: **date + one primary value + a semantic surface**, with the W/BE/L breakdown living in the cell's accessible name and in Day Review. Adding a fourth field to either is a product decision, not a styling one.

**System vs Trader shows three metrics a side, and the list is closed.** Total R (the hero), Win Rate, and Avg Win / Loss — nothing else. The section carried seven values a side before (a hero, a W/BE/L composition line and six cells): fourteen figures in the one surface that exists to answer "did the System produce more than the execution did?" at a glance. Total R says how much; Win Rate and Avg Win / Loss are the two independent factors that produced it, and neither is interpretable alone — a 40% win rate is excellent at 3x and ruinous at 0.5x. Any fourth metric here is a recombination of the same three, so **Avg R, Expectancy, Profit Factor, Max Drawdown and the Trade count do not render on the Dashboard**; they remain canonical on `PerformanceAnalyticsModel` and on `DashboardPerformanceData`, and reading them is Analytics' job. Both sides render through one component, so their metric set and geometry cannot diverge.

**Avg Win / Loss is `payoffRatio`, and the name is deliberate.** It is `lib/calc`'s `payoffRatio` — `averageWinR / abs(averageLossR)` with break-even excluded from both averages — computed for both axes by the same `composePerformanceAxis`, so the Basic KPI row's card and the Trader side of this section can never disagree. Each side reads only its own frozen population (B for System, A for Trader), so the two ratios legitimately differ. The label is never "Average RR", "Risk:Reward" or "Avg R": risk-reward describes _planned_ SL/TP geometry and Avg R is the mean R per Trade, while this is realized average winner magnitude against realized average loser magnitude. An absent denominator is stated in words (`no_wins` / `no_losses`) — never `0x`, never `∞`, never a misleading `100%`.

**Execution Gap answers two questions and draws one chart.** The section shows **Execution Gap** (the summed paired `executionGapR`, the section's answer) and **System Edge Captured** (the ratio that qualifies it), then one cumulative System-vs-Trader plot over Population C. It carried four figures and three visualisations before — a daily gap strip and a distribution bar as well as the cumulative chart — which is day-by-day diagnosis on the detection surface. The Gap is set a full type step above the ratio so the pair never reads as a second KPI row, and both cells are content-sized rather than stretched across the card. **System Edge Captured never gets a meter**: it is unclamped (137% and −22% are both canonical), and any bar or gauge would have to clamp it, making "captured more than the System offered" indistinguishable from exactly 100%. The paired Trade count is not a third headline; it stays in the chart's tooltip and its screen-reader table. `daily-gap-chart.tsx` and `gap-distribution.tsx` remain in the tree, typed and translated, for the eventual Analytics execution-gap view — removed from the Dashboard is not deleted.

**One finding per insight card, and the three cards are not clones.** Strategy, Psychology and Discipline each render exactly one statement with one hero figure and at most one supporting figure. Each used to render its runner-up as a full second finding — its own subject, hero and comparisons — which is two independent analyses in a card meant to say one thing; 19/21/15 visible lines became 8/9/7. The runner-ups are not deleted: D8A still selects and publishes `secondaryInsight` for all three pillars, and each card's Analytics destination (`edge`, `behavior`, `results`) already renders that material. What each card keeps is fixed by whether removing it would make the finding harder to read — **Strategy** keeps Avg Execution Gap (it ranks on System expectancy, so the Gap is the only figure saying how much of that offer was taken), **Psychology** keeps the Scoped baseline (the claim is inherently comparative — "−0.13R" is meaningless alone), **Discipline** keeps Rule Checks Followed (a lone percentage is unattributable between two live rate definitions).

**The three visual roles differ on purpose.** Strategy is _ranked-item-first_ (the subject is the answer), Psychology is _finding-first_ (the associative sentence carries the epistemics and the number is its evidence), Discipline is _status-first_ — a rate with its role label beside it and **no eyebrow at all**, because it has no observation to name and a sentence above the number could only repeat that label. `InsightStatementView.presentation` (`'finding' | 'status'`) encodes that distinction rather than leaving it to per-card markup. All three share surface, spacing, typography and action placement.

**Discipline's Dashboard headline is a presentation override, not a domain change.** D8A's precedence lets `required_checks_incomplete`, `adherence_performance_difference` or `issue_associated_execution_gap` become the primary statement, and that precedence is untouched — Analytics still reads it. But a card whose hero changes identity between visits (a percentage one day, a signed R the next) cannot be scanned, and a data-completeness warning is a caveat on the answer rather than the answer. So **Trade Rule Adherence leads in every branch**, with incompleteness demoted to a compact scope caveat carrying a real count. The two rates are never merged: Rule Checks Followed is check-level (`followed / (followed + violated)`); Trade Rule Adherence is Trade-level (fully compliant evaluated Trades / all fully evaluated Trades, with any Trade holding an unresolved required check excluded from the denominator, never counted as compliant).

**A caveat that is always on screen stops being read.** The limited-sample line appears only below the policy's supported floor; at or above it the count moves into the card's ⓘ. Coverage and the overlapping-cohort note live there too — the latter could not before, because with two cohorts on the face a reader could read them as shares of a whole, and with one there is no visible partition to misread. The one caveat that cannot move is Discipline's incomplete-checks line: Trade Rule Adherence describes a subset whenever unresolved required checks exist, and saying so is the difference between a rate and a misleading rate.

**Risk Performance answers one question with two figures and one chart.** **Modeled Balance** (where the capital stands) and **Current Drawdown** (how far below its high-water mark), then the existing balance chart with its dashed peak reference. It carried five figures before. The drawdown leads with its **percentage**, not its money amount — a percentage is scale-independent, while `$110.00` alone means nothing without the balance it came off — and the amount stays beneath it, named as `$110.00 below peak`. **Zero drawdown is a stated status, not a bare zero**: `0.00%` over "At high-water mark", never "no risk" or "safe", because standing at the peak says nothing about the risk of the next Trade. `Max Drawdown`, `Peak Balance` and the closed-Trade count moved into the ⓘ **with their values**, since there is no money-Risk Analytics view to send them to.

**Period P&L left the Risk face because it is an invisible near-duplicate.** It sums the _same_ authoritative `net_pnl_minor` over the same closed, non-deleted, date-bounded population as the KPI row's Net P&L — the populated fixture renders `+$2,310.00` in both. They are genuinely different metrics: the KPI additionally requires `actual_r`/`trader_outcome` and **does** follow Strategy/Setup/Version filters, while Risk requires neither and deliberately ignores those filters (`analyticalFilters.effect: 'not_applied_to_account_balance'`). So they diverge silently the moment a framework filter is applied, and nothing short of a sentence can tell a reader when that happened. A figure that is usually a duplicate and occasionally a different thing, with no visible cue for which, is worse than no figure. `periodNetPnlMinor` is untouched on the payload.

**The carried-opening line is conditional, and that condition is the whole point.** On a bounded range (`opening.kind === 'carried'`) it stays visible: history is carried in, and the high-water mark the drawdown is measured against may predate the window, so `$12,310` must not be read as a period that began at the Starting Balance. On All time (`kind: 'all'`) nothing is carried, the opening _is_ the declared Starting Balance, and the sentence moved to the ⓘ — a permanent line whose only message is "this is the normal case" trains readers to skip the line that matters.

**Comparable charts share one plot ramp.** The Dashboard's two major charts — the Execution Gap's cumulative comparison and Risk Performance's modeled balance — are both `h-52 sm:h-56 lg:h-64`, where they were `h-44/48/56` and `h-56/64/72`. The benchmark's uniform 679×392 (1.73:1) card cannot be copied directly: TradeChemist has no one-of-three-column chart cards, its charts sit inside full-width analytical sections, and 1.73:1 there would mean a ~730px-tall plot. What transfers is the discipline — one height, so the eye reads the two as one system. Two documented exceptions: the Execution Gap's 64px daily strip, which is a companion to the chart above it and deliberately shares its x-axis, and the distribution bar, which is not a plot.

## 6. Responsive

Desktop-first for analytics, fully usable on tablet, quick-entry on mobile.

| Breakpoint     | Target                               |
| -------------- | ------------------------------------ |
| 320px          | Minimum supported; must not overflow |
| 640px (`sm`)   | Large phone                          |
| 768px (`md`)   | Tablet — tables appear here          |
| 1024px (`lg`)  | Small laptop — sidebar appears here  |
| 1280px+ (`xl`) | Full analytics                       |

**No horizontal page overflow at any width.** Wide content — tables, charts — scrolls inside its own container. Enforced for both English and Thai by e2e across five viewports (320 / 375 / 768 / 1280 / 1920) on every public and application route.

**Wide tables get two presentations, not one squeezed one.** A real `<table>` from `md` up, record cards below it. Both are in the DOM; the inactive one is `display:none`, which removes it from the accessibility tree so a screen reader is offered the trades once. Each carries `data-trades-view` so tests scope to the active one.

Touch targets ≥ 44px, including inputs — `Input` is `h-11` rather than shadcn's `h-9` for exactly this reason. Numeric inputs use numeric keyboards. Native `<select>` is preferred over a custom listbox on forms, because it opens the platform picker on a phone.

**A widget inside a partial-width column asks its own width, not the viewport's.** The Dashboard Calendar is seven of twelve columns, so a 1280px page and a 1920px page give it very different room while reporting the same breakpoint. It declares `@container` and reduces itself against that: below 22rem the R value sheds its trailing unit, so the date and the figure itself never shrink into an ellipsis. (The per-day W/BE/L line that used to be the first thing dropped here is gone from the cell entirely — see the Dashboard density rules above.) Prefer a container query wherever a component's usable width is decided by its column rather than by the window.

**Mobile navigation is a drawer, not a bottom bar.** The Phase 00b drawer is focus-trapping, Escape-handling and tested; five sections fit it comfortably. Replacing hardened, tested behaviour needs a better reason than fashion.

## 7. Motion

Animation must aid comprehension. No motion for decoration.

Sanctioned and in use: hero entrance, sidebar and segmented-control active indicators, drawer and dialog entrance, skeleton loading, subtle card hover, settled KPI opacity feedback, chart entrance.

Avoided: heavy glass, glow, parallax, permanent looping decoration, long stagger sequences, and anything that gates access to content.

**`prefers-reduced-motion` is honoured twice.** A global rule in `globals.css` collapses every animation and transition duration — a guard a component cannot forget. Motion components additionally use the SSR-safe `usePrefersReducedMotion()` hook so layout animations are skipped outright rather than merely shortened. Enforced by e2e against the real animated elements, and against both the sidebar and segmented-control branches.

The `animate-rise` utility is the standard entrance: 12px upward, fading in, on a decelerating curve. Entrance stagger never exceeds 120ms.

### Conventions

Durations and easings live in [`src/lib/motion.ts`](../src/lib/motion.ts) so "how long does a thing take" is one decision, not fifty.

| Token     | Seconds | Use                                    |
| --------- | ------- | -------------------------------------- |
| `instant` | 0.12    | Hover and press feedback               |
| `fast`    | 0.18    | Small state changes, active indicators |
| `base`    | 0.24    | Panels, drawers, dialogs               |
| `slow`    | 0.36    | Large surfaces entering                |

Easing: `standard` `cubic-bezier(0.16, 1, 0.3, 1)` decelerates — fast out of the gate, gentle on arrival, so an element looks like it settled rather than stopped. `LAYOUT_SPRING` is the shared spring for layout transitions.

### Where Motion (the library) is used

Three places, each a shared `layoutId` or restrained feedback that communicates something a hard cut cannot:

1. The sidebar's active-section indicator, travelling between items.
2. The segmented control's indicator, same pattern.
3. `AnimatedNumber`, fading an already-settled KPI value into its changed state.

`AnimatedNumber` always renders characters identical to its already-rounded input and animates opacity only. A count-up temporarily presents invented financial values and delays access to the selected result; opacity changes neither the value nor layout. Under reduced motion it renders a plain span with no animation scheduled.

Everything else is CSS.

## 8. Data surfaces

Every surface that displays data ships four states: **loading, empty, error, success.**

Empty states teach the next action. "No data" is not an empty state — the `EmptyState` component makes `action` a required prop so the next step cannot be forgotten.

**Semantic colour is spent on signs that are the finding, not on every good number.** `--positive` / `--negative` mean "this figure's direction is the point". A hero P&L or Total R earns them; a level does not. So a card's hero keeps its tone while its supporting cells stay `--foreground` — an expectancy, a baseline, a win rate and a profit factor are readings, not verdicts, and colouring all of them made green mean nothing more specific than "a number". The two Execution Gap comparison roles are the deliberate exception: a negative gap says execution captured less than the System offered, which is the attribution this product exists to surface.

Numbers that cannot be computed render their reason, never `0` — a `0%` win rate for a user with no trades is a false statement. See [calculation-spec.md](calculation-spec.md) §6.

Skeletons are `aria-hidden` and grouped under a single `role="status"`, so a screen reader hears one "Loading" rather than a dozen meaningless boxes.

**A skeleton reserves the geometry it actually stands in for.** Block heights are set from the measured height of the real section, not from a convenient `h-96`; a skeleton that is 200px short of its content pushes the whole page down the moment the payload arrives, which is the exact jump a skeleton exists to prevent.

### The Dashboard's loading transition

Every Dashboard state change — Date Range, Filters, Account, Calendar month/day — performs a **native document navigation** (`DashboardStateLink`; Next 16.2.12 cannot be trusted to commit search-param-only soft navigations on this route). A document navigation cannot keep anything mounted, so a "persistent shell with only the content swapping" is not available on this transport and nothing here pretends otherwise. What is true is shown in two honest halves, each carrying the same mark so the seam between two documents reads as one continuous state:

| Half          | Component                    | Copy                  | What it actually is                                                                                                                     |
| ------------- | ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Departure** | `DashboardTransitionOverlay` | "Updating dashboard…" | The outgoing document, still live and painted: header, sidebar and sticky toolbar stay at full contrast; only the analytical area dims. |
| **Arrival**   | `DashboardSkeleton`          | "Loading dashboard…"  | The incoming document's server-rendered Suspense fallback — geometry blocks plus the mark.                                              |

Rules this treatment holds to: it invents **no progress** (nothing in a document navigation knows how far along it is); it adds **no delay** and no minimum display time; it **hides no error** (errors are server-rendered on arrival); and it **never blocks input** — `pointer-events-none` throughout, cleared on `Escape` and on bfcache `pageshow`, because a native navigation fires no "cancelled" event and a veil that captured clicks could strand the reader under it. Exactly one `role="status"` exists per view, so three independently suspending boundaries never announce one user action three times.

The mark itself is a five-bar equalizer in the accent — never the `positive`/`negative` outcome palette, which means "this trade made or lost money" everywhere else in the product. Under `prefers-reduced-motion` the bars stop scaling and the group breathes on one slow opacity cycle: alive, because a frozen loader reads as a hung page, but with nothing travelling.

### KPI indicators

A Basic KPI card may carry **one visual indicator beside its figure** — but only where canonical data already publishes what it draws, and never as a second analytic. The four that qualify, and what each encodes:

| Card           | Shape              | Encodes                                                               |
| -------------- | ------------------ | --------------------------------------------------------------------- |
| Trade Win %    | ring (donut)       | W / BE / L Trade counts — three counts that partition the population  |
| Profit Factor  | split track        | `PF / (PF + 1)`, the published ratio restated as a proportion         |
| Day Win %      | semicircular gauge | winning / break-even / losing LOCAL DAYS, from the day-level summary  |
| Avg Win / Loss | two magnitude bars | the two canonical averages, each scaled against the LARGER of the two |

**Net P&L gets none.** It is a single signed money total and no per-Trade or per-day money series is published for that population; a sparkline would have to be invented or borrowed from the paired Execution-Gap population, which is a different Trade universe. That card is carried by typography, which is the right answer when the data is not there.

**Profit Factor's bar is the one that needs justifying.** Gross positive R and absolute gross negative R are computed inside `lib/calc`'s `profitFactor` and never reach the Dashboard payload, so the bar cannot claim them — and does not. What it draws is `grossWin / (grossWin + grossLoss) = PF / (PF + 1)`, an algebraic restatement of the figure already on the card's face. No absolute gross-R amount is printed anywhere, because none is known.

**The shapes differ on purpose.** Trade Win % and Day Win % frequently land within a point of each other, and on a data set holding one Trade per day they coincide exactly; two identical rings would invite a reader to treat them as one figure duplicated. A ring and a gauge keep "per Trade" and "per day" legible as different questions.

**The indicator is a button, and the breakdown lives behind it.** Everything the cards stopped printing permanently — `27W · 5BE · 34L`, `+2.27R / -1.12R`, "Calculated from R" — opens from a click, a tap, or Enter, in plain words ("Wins 27", never `27W`). A hover-only tooltip would have made that data unreachable on touch and by keyboard. The drawing itself is `aria-hidden`; the button carries the name, the popover carries the figures, so a reader who sees no colour loses nothing.

**Layout is a correctness rule, not a preference.** The indicator shares a row with the figure, so both size themselves against the CARD (`@container/kpi`), and the row wraps rather than hides when the card is too narrow — at 320px the indicator falls to its own line instead of disappearing. Losing the visual on the smallest screens made mobile the one place the row said least; a few pixels of height is the cheaper trade.

**The indicator must read as data, not as decoration.** The benchmark's KPI cards carry donuts, a partial ring and a ratio bar with real mass against their 120px card; an indicator small enough to be mistaken for an icon is worse than none, because it implies a reading it is too small to give. Sized against our own 120px card: ring 40px, gauge 28×48, split track 12px tall over 56/80px, magnitude bars 8px each over 56/80px. These moved up with the card's padding and should move with it again if the card's height ever changes.

## 9. Charts

Full reasoning in [ADR 0006](decisions/0006-design-system-and-demo-data.md).

**Chart chrome is one module, not a per-chart opinion.** [`chart-theme.ts`](../src/components/dashboard/charts/chart-theme.ts) owns the axes, grid, zero line, cursor and margins every Dashboard chart uses, and [`chart-tooltip.tsx`](../src/components/dashboard/charts/chart-tooltip.tsx) owns the one tooltip shell they all render into. Three charts had grown three near-identical copies of each, which looked alike only until someone edited one. The values there are chosen rather than inherited: a 2/6 dotted grid at 60% border (a gridline carries the eye to the axis; it must not compete with the series), 10.5px medium ticks, a 64px minimum tick gap (at 1792px the old 40px permitted ~40 date labels along one axis), and a zero line at `--subtle-foreground` because it is a datum, not a series.

**Two stacked charts share one axis.** Where a strip sits directly beneath a plot over the same categories — the Execution Gap's daily bars under the cumulative lines — the strip hides its own X axis (`CHART_X_AXIS_HIDDEN`) and the pair share `CHART_MARGIN` and the fixed `CHART_Y_AXIS` width so their plot areas align column-for-column. Printing the dates twice spent height on a duplicate and made one figure read as two unrelated charts.

**Lines are not equally loud, and which one is louder is a decision.** The counterfactual System line is the thinner, dashed, accent-coloured one; the Actual line — what execution did — is the solid, heavier, brightest mark. `dot={false}` everywhere: identity arrives on hover, so a 60-point series stays calm.

**Series colours are computed and validated, never chosen.** The shipped four-slot palette passes all six checks in both themes — lightness band, chroma floor, CVD separation, normal-vision floor, contrast, documented provenance. Worst adjacent pair: ΔE 18.8 CVD / 19.6 normal (dark), 17.0 / 19.6 (light).

This is not ceremony. The first candidate palette put blue next to violet, which measures **ΔE 0.3 under deuteranopia** — one line, not two — and looks perfectly fine to a reviewer with typical colour vision.

Rules that follow from it:

- **Slots are assigned in fixed order and never cycled.** A fifth series folds into "Other" or becomes small multiples; it is never a newly invented hue.
- **`system` and `trader` are semantic aliases** of slots 1 and 2, so reordering the generic ramp cannot repaint the product's central comparison.
- **Series colours never carry text.** Light-mode `chart-1` is 3.68:1 — legal for a mark, illegal for small text. Labels use text tokens beside a coloured swatch.
- **Colour is never the only encoding.** The system series is dashed because it is hypothetical; the actual series is solid because it happened. That survives greyscale, print and any colour vision.
- **One axis.** Never two y-scales. Both series are already normalised to R, which is what makes them comparable.
- **No truncated axes.** Zero is drawn as an explicit reference line on cumulative R.
- **Magnitude on one nominal dimension takes one hue.** Mistake-cost bars are all `chart-3`; colouring each differently would spend the identity channel re-encoding what bar length already shows.

Every chart renders inside `ChartContainer`, which supplies three things structurally so they cannot be forgotten per-chart: a real `<figure>` with a `<figcaption>` stating what to take from it, a **visually-hidden data table** carrying the same numbers, and a legend pairing each swatch with its name and line style. An SVG decorated with ARIA is announced but not explorable; a table is.

Charts are theme-aware for free — both the server-rendered marketing SVG and interactive Recharts charts receive `var(--chart-1)` etc. as SVG attributes, so a theme switch repaints without re-rendering. Recharts is restricted to demo and application routes; the static landing route neither imports nor prefetches it. Interactive chart animation is disabled under reduced motion via `isAnimationActive`.

Chart data conversion (fixture strings → JS numbers) happens once, at the plotting boundary, on values already rounded for display. It never feeds back into a calculation.

## 10. Vendored and project-authored components

`src/components/ui/` is **project-owned code**, not a dependency.

- **Vendored** by `shadcn add`: `button`, `dropdown-menu`, `sheet`, `card`, `badge`. Every deviation from upstream carries a `PROJECT CUSTOMISATION` comment.
- **Project-authored**, marked as such in their header: `input`, `label`, `table`, `segmented-control`.

Current vendored deviations:

- `dropdown-menu.tsx` — `checked` is spread conditionally instead of passed directly, because this project enables `exactOptionalPropertyTypes` and upstream passes an explicit `undefined`.
- `dropdown-menu.tsx` and `sheet.tsx` — state animations live in `globals.css`, avoiding an otherwise unused animation-plugin dependency while keeping the global reduced-motion guard authoritative.
- `button.tsx`, `card.tsx`, `dropdown-menu.tsx` and `sheet.tsx` — the shared 44px target minimum and semantic elevation tokens replace upstream size and raw shadow defaults.

Only components actually used are installed. Where a native element does the job — `<details>` for the FAQ, `<select>` for the account picker, `<label htmlFor>` for form labels — the native element wins: it is keyboard correct, screen-reader correct, and works with JavaScript disabled, none of which a reimplementation gets for free.

**`exactOptionalPropertyTypes` note.** A component whose optional props are forwarded from another component's optional props must declare them `?: T | undefined`, not `?: T`. Otherwise the caller passing an explicit `undefined` fails to typecheck.

## 11. Demo-data policy

Everything in `src/lib/demo/` is static, fictional presentation data.

**Two rules, both enforced by tests:**

1. **No formulas.** Every metric is a literal. The real formulas arrive with the calculation engine; one written here to make a demo move would be a second, untested implementation of the product's defining logic.
2. **Every surface rendering a fixture carries a visible marker.** `DemoBadge` for a component, `DemoDataNotice` for a page. These are trading figures, and an unlabelled screenshot of a rising equity curve functions as a performance claim regardless of intent.

Fixture internal consistency is asserted in `fixtures.test.ts` — edge leakage equals system minus actual total R, mistake costs sum exactly to it, curves end at the reported totals, and all four outcome-matrix cells appear. Comparisons use fixed-point integers, not `parseFloat`.

Nothing may imply a capability that does not exist: no fake OAuth, no submit that appears to succeed, no purchase path, no invented price.

## 12. Accessibility

- WCAG AA contrast minimum, in both themes, including chart colours.
- Visible focus everywhere — a 2px `ring` outline with 2px offset, never removed.
- Full keyboard operation, including charts, dialogs and filters.
- Semantic landmarks and correct heading order; exactly one `<h1>` per page, owned by `PageHeader`.
- Form controls labelled; errors programmatically associated; status messages in an `aria-live` region that is always present in the DOM (a region inserted at the same moment its text appears is frequently missed).
- Icon-only buttons carry `aria-label`; decorative elements are `aria-hidden`.
- Charts ship a caption and a hidden data table.
- Tables use real table semantics; scroll regions are labelled, `tabIndex={0}`, and named distinctly from their enclosing section so two landmarks do not share a name.
- A skip-to-content link is the first focusable element on every page, targeting a shared `MAIN_CONTENT_ID` constant.

**Known and accepted:** below `lg` the sidebar is `display:none`, which removes it from the accessibility tree — so on mobile there is no `navigation` landmark until the drawer is opened. The trigger sits in the banner, which is the standard discoverable path for a drawer pattern. This is asserted by e2e so it stays deliberate.

## 13. Internationalization

Full architecture in [ADR 0007](decisions/0007-i18n-architecture.md); terminology and formatting standard in the [localization glossary](localization-glossary.md).

- **`LanguageSwitcher` is text, never a flag.** "English" / "ไทย", not country icons — a flag names a country, and English and Thai are each spoken well beyond one. Present in the public header, public mobile drawer, app-shell sidebar, app-shell mobile drawer, and `/app/settings`.
- **Same touch-target and keyboard rules as any other control.** ≥44px, reachable by Tab, operable with Enter/Space, and its trigger has an accessible name that states both the action and the current language (`"Language: English"` / `"ภาษา: ไทย"`) — never an unlabelled icon.

## 14. Authentication states

Phase 02 introduced the first real (non-demo) form flows. Same visual system as everything else — no separate "auth theme" — but a few states are specific to this surface.

- **Google sign-in truthfully reflects configuration.** `isGoogleSignInConfigured()` (`src/lib/auth/server.ts`) is the single source of truth for whether the button renders active. Unconfigured: the button is visibly `disabled`, with a localized note directly below it (`auth.googleNotConnected`) — never a button that looks clickable but silently fails, and never hidden entirely (a visitor should be able to see the option exists, just not yet usable).
- **Loading state.** `AuthForm` tracks `'idle' | 'pending' | 'error'`; the submit button disables during `pending` (never a second submission racing the first) with no separate spinner component — the disabled state itself is the affordance.
- **Error state.** A single `aria-live="polite"` `role="status"` region, present in the DOM unconditionally (not inserted only once an error exists — an error appearing at the same moment its container mounts is frequently missed by screen readers). Errors are always the generic, localized `auth.loginError`/`auth.registerError`/`auth.rateLimitedError` text — never a raw Better Auth error code, never a message that reveals whether a specific email is registered.
- **Success state has no "success" visual** for login/register — a successful submission navigates away (to `/app`, or to `/verify-email`), and the destination page's own loaded state is the confirmation. A toast or checkmark that then immediately gets replaced by navigation would be motion for its own sake.
- **Password-manager compatibility is a correctness requirement, not a nice-to-have:** correct `autoComplete` values (`email`, `current-password` for login, `new-password` for register), no silent trimming of pasted values, paste never blocked.
- **The demo-data banner and the auth boundary are independent signals.** `appNav.demoNote` ("Your account and sign-in are real. Trading data shown here is still a fixture preview.") exists specifically so a real, authenticated user is never confused into thinking the trading data behind their real login is real too — see [ADR 0006](decisions/0006-design-system-and-demo-data.md) for the demo-data policy this extends.
- **Switching preserves the route and query.** A switch on `/en/app/trades?range=30d` lands on `/th/app/trades?range=30d`, not the Thai home page and not a reset view — a locale switch only changes locale.
- **No hydration mismatch.** The active locale comes from the URL segment next-intl already resolved server-side, not from `localStorage` or a media query, so it is identical on the server render and the first client render.
- **Money stays locale-independent; dates read the locale.** Currency symbol and decimal scale follow the trading account's configured currency, never the UI language — Thai and English share the same digit-grouping convention for every currency in scope. Dates pin the Gregorian calendar explicitly, because `th` defaults to the Buddhist calendar under ICU otherwise. See ADR 0007 Decision 5.
- **Demo fixture content is never translated** — trade symbols, strategy names, account nicknames — the same category as any other proper-noun-like content. See the glossary §2.
