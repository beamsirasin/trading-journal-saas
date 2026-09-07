# Trade Log & Add Trade — visual prototype

**Status: awaiting visual design approval. Not production. Do not migrate.**

A high-fidelity rendered prototype of the approved TradeChemist UX/UI specification for the Trade
Log and Add Trade surfaces, built on the real frontend stack, the real design tokens and several of
the real components, over fixture data.

It answers exactly one question: _does the redesigned experience look and feel right on desktop and
mobile?_ It is wired to no mutation, no server action and no database, and it 404s under a
production `NODE_ENV`.

---

## 1. Routes

Development only. `src/app/[locale]/(prototype)/layout.tsx` calls `notFound()` when
`NODE_ENV === 'production'` — verified against a real `next start` server, where every route below
returns 404 while `/en/login` returns 200.

| Route                                 | What it shows                                                        |
| ------------------------------------- | -------------------------------------------------------------------- |
| `/en/prototype`                       | Review gallery — every screen framed at its own viewport, in iframes |
| `/en/prototype/trade-log`             | Prototypes 1–4: the journal at three widths, plus Trade details      |
| `/en/prototype/log-trade`             | Prototype 5: the entry choice                                        |
| `/en/prototype/log-trade/at-entry`    | Prototypes 6–7: At Entry, desktop and mobile                         |
| `/en/prototype/log-trade/after-trade` | Prototypes 8–9: After Trade, desktop and mobile                      |
| `/en/prototype/exits`                 | Prototype 10: the exits editor in three completion states            |
| `/en/prototype/context`               | Prototype 11: confidence and emotions across every state             |

`/en/prototype/trade-log` accepts `?trade=<id>`, `?tab=`, `?lang=th`, `?account=all`, `?state=`,
`?strategy=`, `?q=`. `/en/prototype/log-trade/at-entry` accepts `?expand=1`.

The gallery uses **iframes, not narrow divs**: every responsive rule in this codebase is a viewport
media query, so a 390px column inside a 1440px window renders the desktop composition squeezed —
precisely the failure the mobile design exists to prevent, presented as though it were the design.

Screenshots: `docs/prototype/screenshots/` (28 PNGs at 2× DPR).
Regenerate with the dev server running: `node scripts/prototype-screenshots.mjs`.

---

## 2. Files created

Nothing existing was modified. Every file below is new.

**Prototype routes** — `src/app/[locale]/(prototype)/`
`layout.tsx` (the production guard), `prototype/page.tsx`, `prototype/trade-log/page.tsx`,
`prototype/log-trade/page.tsx`, `prototype/log-trade/at-entry/page.tsx`,
`prototype/log-trade/after-trade/page.tsx`, `prototype/exits/page.tsx`,
`prototype/context/page.tsx`

**Prototype components** — `src/components/prototype/`
`fixtures.ts`, `population.ts`, `presentation.ts`, `query.ts`, `copy.ts`, `prototype-shell.tsx`,
`prototype-gallery.tsx`
`trade-log/`: `trade-log-screen.tsx`, `trade-log-toolbar.tsx`, `trade-log-summary.tsx`,
`trade-log-table.tsx`, `trade-log-rows.tsx`, `trade-log-mobile.tsx`, `journal-figures.tsx`,
`follow-up-action.tsx`, `trade-details-panel.tsx`
`add-trade/`: `entry-choice.tsx`, `at-entry-form.tsx`, `after-trade-form.tsx`,
`form-primitives.tsx`, `confidence-control.tsx`, `emotions-control.tsx`, `exits-editor.tsx`,
`specimens.tsx`

**Tooling** — `scripts/prototype-screenshots.mjs`

A route group inside `[locale]` rather than a top-level segment, deliberately: `/admin` sits outside
`[locale]` and needed its own branch in `proxy.ts` to escape next-intl's locale prefixing. This
inherits the existing locale, font and theme providers and required **no change to `proxy.ts` or any
other production routing**.

---

## 3. What is intentionally mocked

- **All data.** 124 fixture trades: 25 hand-authored for the compositions, 99 generated
  deterministically behind them so counts, search and pagination describe a real population rather
  than one page.
- **The application shell.** `PrototypeShell` is an inert replica. The real `ShellFrame` takes plain
  props and fetches nothing, and was tried first — it is not used because its account switcher
  imports `setActiveTradingAccountAction` and its account menu imports `signOut`. Mounting it would
  put two production mutations one stray click away. The replica reproduces the geometry exactly
  (same `--shell-header-height`, `--shell-rail-width`, `data-shell-chrome` scope), which is what
  makes the responsive review trustworthy: the journal's content width is the real one.
- **Retrieval.** Search, filters, sort and pagination run in memory over the fixtures. This is a
  demonstration of the interaction, **not** a head start on the full-history backend the spec calls
  a P0 prerequisite.
- **Every form.** No submit handler, no draft persistence, no validation-on-save pass. Fields hold
  local state so the interactions can be judged.
- **Date range.** Presets are shown for composition and do not scope the fixture journal; the
  popover says so out loud. A preset that changed the label without changing the rows would be a lie
  a screenshot could not catch.
- **Detail actions** (Record exit, Edit result, Add system result, Add review note) render at their
  correct place and lifecycle, and do nothing.

## 4. What is connected to the real product

- **All design tokens** — `globals.css` semantic colours, elevation, radii, typography roles
  (`text-label`, `text-metric`, `numeric`), motion vocabulary, both themes.
- **Real components**: `Container`, `Button`, `Input`, `Label`, `Badge`, `Card`, `Sheet`,
  `Table`/`TableRow`/`TableCell`, `SegmentedControl`, `ToolbarTrigger`, `ToolbarDisclosure`
  (so filter panels are a popover on desktop and a sheet on a phone without this code deciding
  that again), the Trade Details `PanelSection`/`FactGrid`/`Fact`/`PanelEmpty` primitives, and
  `ThemeToggle`.
- **Real formatters**: `formatTradeMoney` and `formatR`, so the prototype prints the same strings the
  production table does rather than a prettier second arithmetic.
- **Real calculation engine**: `totalR` (`lib/calc/aggregate`), `sum` (`lib/money`) and
  `executionGapR` (`lib/calc/attribution`). This matters more than it looks — those functions already
  encode the rules the summary strip has to demonstrate (an empty population is `no_trades`, never a
  fabricated `0.00R`; a mixed-currency population is `currency_mismatch`, never a silent conversion),
  and re-deriving them locally would have produced a summary that looked right and told a different
  truth.
- **Real Thai copy** where the product already has it (column headings, result and lifecycle words),
  copied verbatim from `messages/th.json`.

---

## 5. Where the specification could not be represented faithfully

1. **Thai covers the Trade Log only.** The journal is the densest layout and the one where script
   expansion actually threatens the design, so it is fully translated (`?lang=th`). Trade details and
   both recording forms render English. The prototype copy lives in `src/components/prototype/copy.ts`
   and is deliberately **not** in `messages/*.json` — the brief forbids touching the localization
   architecture. Strings the redesign introduces are layout-stress approximations, not reviewed
   product copy, and must not be lifted into `messages/th.json` as-is.
2. **No 1,000-row retrieval verification** (spec §N.34). The population is 124, which is enough to
   make paging, whole-population counts and cross-page search real, and not enough to test the
   performance claim. That belongs with the real backend.
3. **Draft lifecycle, save reliability and idempotent retry** (spec §H "Drafts and save reliability")
   are not prototyped at all. They are behaviour with almost no visual surface, and the brief
   excludes the persistence architecture.
4. **The timezone disclosure moved.** The spec puts it in the Activity column header; at the header's
   12px that needed either a second line or 10–11px type, both of which the spec forbids elsewhere.
   It is now a quiet line in the journal footer, plus a `title` on the column header.
5. **All three journal compositions are mounted at once** and CSS chooses between them. That is a
   prototype convenience so a browser resize shows the real transition instantly; production would
   render one.
6. **Deep links are read on the server, not from the URL after mount.** Tab changes therefore do not
   yet rewrite the URL as spec §C requires — the URL→state direction is prototyped, the state→URL
   direction is not.

---

## 6. Design decisions taken where the specification left the treatment open

1. **Responsive thresholds were computed, not chosen.** The spec names _content_ widths (1,120 /
   720); Tailwind works in _viewport_ widths. Given the real 64px rail and the real container
   gutters: table at `min-[1248px]`, journal rows at `md` (768), mobile below. `xl` (1280) would have
   left an 80px band where the table technically fits but sits at its minimum everywhere.
2. **Status is 156px, not the 104px minimum.** Measured: "Partially closed" at 14px plus its dot and
   padding needs 149px, and below that the two longest lifecycle words wrapped, growing those rows
   and breaking the column rhythm the table exists to provide.
3. **Follow-up has three tones, not two.** Amber is reserved for a record that is broken _as a
   record_ (Complete details). "Add system result" takes the primary accent instead: as a second
   amber it put four warning-coloured links in one column of a real page, which reads as "four things
   are wrong here" rather than as the product's central action. Adding a strategy or a review note
   stays neutral.
4. **Two kinds of missing money, said differently.** A closed trade with no money reads "Not
   recorded" — a gap in the record, and what the summary's "P&L incomplete" counts. An open or
   canceled position reads an em dash: it has no result _yet_, and "Not recorded" there accuses the
   trader of forgetting something that has not happened.
5. **Confidence is a five-stop connected rail, not five loose radios and not a slider.** The meaning
   is discrete, so a draggable knob (which invites "about 60%" and reads as a probability) was
   rejected — as was a plain radio group, which loses the ordering. Steps below the selection are
   filled so the order is visible without reading all five labels. It is a real radio group
   underneath, so arrow keys and "3 of 5" announcements come from the platform.
6. **"Realized" sits inline and _before_ the number in journal rows**, stacked beneath it in the
   table. Stacked, it pushed the money down and then the R down, and the partially-closed row lost
   alignment with the text beside it; placed after the value it pushed the number off the right edge
   the composition is scanned on.
7. **An em dash for "nothing outstanding" is a table convention only.** A table cell must be filled;
   a journal row has no column to fill, and three stacked dashes (money, R, follow-up) turned an
   ordinary open position into something that looked like an error report.
8. **The summary's unavailable-reason detail moved into the caption**, so the strip is three lines on
   a phone instead of five. The reason ("P&L incomplete") stays at the figure's own place in the row;
   its count joins the subset size, because both qualify the same population.
9. **The mobile header reorders rather than restacks** — title and Log a trade share one line via
   `order`, one instance of each control rather than two copies holding two copies of the same open
   state.
10. **Filters drops to icon-only below 430px** so Search keeps room for its placeholder. Responsive
    by label, never by shrinking: the 44px target holds at every width, and the accessible name is
    preserved with `aria-label`.

---

## 7. Verification actually run

| Check                | Result                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| `prettier --check .` | pass                                                                   |
| `eslint` (repo-wide) | pass, no warnings                                                      |
| `tsc --noEmit`       | pass                                                                   |
| `vitest run`         | 213 files, 3,103 tests, all pass                                       |
| `next build`         | pass                                                                   |
| Production guard     | verified on a real `next start`: prototype routes 404, `/en/login` 200 |

No existing test was changed, and no test was added — this is a visual prototype with no behaviour
to assert.

---

## 8. What happens next

**Nothing, until the visual design is approved.** No production migration, no backend work. The
specification's P0 items — actual-first persistence, unknown checklist observations, full-history
search/sort, draft lifecycle, idempotent submission — are all still ahead, and none of them is
started here.
