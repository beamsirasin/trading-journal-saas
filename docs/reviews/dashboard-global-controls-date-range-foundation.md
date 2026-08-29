# Dashboard Global Controls & Date Range Foundation

**Status:** Contract implemented; final toolbar and picker visuals deferred to R2B/R3.  
**Baseline:** Next.js `16.2.12`; native document navigation remains the accepted temporary
Dashboard transport.

## State ownership

| State             | Owner                          | Applied persistence                                    | Effect                                  |
| ----------------- | ------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| Account           | Global Dashboard analytics     | URL override, or persisted active Account when omitted | Population                              |
| Date Range        | Global Dashboard analytics     | URL                                                    | Population                              |
| Strategy          | Global Dashboard analytics     | URL                                                    | Population                              |
| Setup             | Global Dashboard analytics     | URL                                                    | Population                              |
| Strategy Version  | Global advanced analytics      | URL                                                    | Population                              |
| Display/unit mode | Global presentation preference | URL                                                    | Presentation only; never eligibility    |
| Calendar mode     | Calendar investigation         | URL                                                    | Local Calendar population/date axis     |
| Calendar month    | Calendar investigation         | URL                                                    | Local Calendar viewport                 |
| selected Day      | Calendar investigation         | URL                                                    | Opens local Day Review                  |
| selected Trade    | Calendar investigation         | URL                                                    | Opens local Quick Preview; requires Day |

There is one canonical applied Dashboard state. Calendar state shares the query string so links,
refresh, Back, and Forward preserve context, but its parser owns only `month`, `mode`, `day`, and
`trade`. The Dashboard parser owns `range`, `from`, `to`, `account`, `strategy`, `setup`,
`version`, and `unit`. Both parsers remain fail-closed and tolerate only the other's exact,
reviewed key set.

## Date Range contract

Applied range is represented by the shared `AnalyticsDatePreset` plus an optional complete custom
range. Every bounded range is defined first as local calendar dates in the user's persisted
analytics IANA timezone, then converted to a half-open instant interval `[start, endExclusive)`.
No browser-local timezone and no fixed `N * 24 hours` subtraction participates.

| URL preset | Label              | Inclusive local dates                              |
| ---------- | ------------------ | -------------------------------------------------- |
| `today`    | Today              | local today                                        |
| `week`     | This week          | Monday through local today                         |
| `month`    | This month         | first of the month through local today             |
| `30d`      | Last 30 days / 30D | local today plus preceding 29 dates                |
| `90d`      | Last 90 days / 90D | local today plus preceding 89 dates                |
| `quarter`  | This quarter       | first date of calendar quarter through local today |
| `ytd`      | YTD                | January 1 through local today                      |
| `all`      | All                | unbounded                                          |
| `custom`   | Custom             | explicit inclusive `from` through `to`             |

The existing `30d`, `90d`, and `all` values and meanings are unchanged. Period presets are
period-to-date, not future-inclusive. Monday is the canonical first day of week; this is a product
contract and does not vary by browser locale.

Custom uses stable, locale-independent local-date parameters:

```text
range=custom&from=2026-07-10&to=2026-08-12
```

Both dates must be real `YYYY-MM-DD` values and `from <= to`. Missing, partial, impossible,
reversed, or custom dates attached to a non-custom preset fail closed. Both endpoints are
inclusive as local dates; the query end is the instant at which the day after `to` begins in the
persisted timezone. Serializers alone emit applied links, including Dashboard-to-Analytics insight
links and Calendar navigation links.

## Draft, selection, and Apply

The picker consumes two deliberately different models:

- **Applied Dashboard Range:** canonical URL-backed range driving server data.
- **Draft Picker Range:** temporary preset/from/to values owned by the open picker.

Opening copies Applied into Draft. Editing Draft never navigates or queries. Closing/cancelling
discards Draft. Apply validates Draft, produces one applied range, and calls the existing
Dashboard-state navigation abstraction exactly once.

Custom calendar behavior is frozen as follows:

1. First click sets `start` and leaves `end` empty.
2. Second click on/after start sets `end`.
3. Second click before start orders the two dates: clicked date becomes start and the original
   start becomes end.
4. A click after a complete range starts a new selection with that date as start.
5. A quick preset replaces Draft only; it does not Apply.
6. **Clear sets Draft to All.** It does not change the Dashboard until Apply. This gives Clear one
   useful, predictable meaning and preserves cancel behavior.

Malformed calendar clicks do not corrupt or broaden Draft. Incomplete custom Draft cannot Apply.

## Dashboard section scope

| Section                                     | Global range behavior                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Trading Performance and KPI band            | Follows range                                                                                                                |
| System                                      | Follows range                                                                                                                |
| Trader                                      | Follows range                                                                                                                |
| Execution Gap                               | Follows range                                                                                                                |
| Strategy / Psychology / Discipline insights | Follow range                                                                                                                 |
| Recent Trades                               | Follows range                                                                                                                |
| Calendar                                    | Requested Calendar month intersected with Dashboard range, preserving D6                                                     |
| Risk                                        | Visible series follows range; lifetime history through `asOf` still supplies opening balance and carried peak, preserving D7 |
| Needs Attention                             | Does **not** follow range; remains the frozen workspace-operational queue                                                    |

No eligibility rule or analytics formula changes. The legacy 30D/90D/All control may remain near
System vs Trader until R2B so the page stays usable, but it writes the same single applied URL
state and owns no independent state.

## Future Filters control

The first Filters popover should expose Strategy and Setup. Strategy Version is an advanced option,
not a reason to add a broad filter catalog. Dependencies are:

- choosing/changing Strategy constrains available Setups and Versions and clears incompatible
  Setup/Version selections;
- Setup must belong to selected Strategy when Strategy is explicit;
- Version must belong to selected Strategy;
- Setup and Version must resolve to the same Strategy even when Strategy is omitted.

The authenticated DAL continues to verify every identifier in the active workspace; invalid,
foreign, or incompatible combinations fail closed.

## Account control finding

The shell Account switcher persists the user's active Account through the existing server action,
then refreshes. That is the primary product Account model and must keep its entitlement/workspace
checks. An omitted `account` URL key means this trusted persisted active Account. Existing explicit
`account=all` and `account=<uuid>` analytics overrides remain available for canonical analytical
links.

The future toolbar should reuse the existing Account selection action for ordinary switching; it
should not force the persisted active Account into every URL. If the UI exposes All Accounts or an
explicit analytical override, it can use the existing URL scope deliberately. No client return URL
or workspace identity becomes trusted input.

## Display/unit finding

`unit=money|r|percentage` is already parsed and serialized as global presentation state, but the
Dashboard intentionally renders many native semantic units and current KPI composition does not
consume this mode as a universal conversion. It does not affect eligibility or stored values.

Recommendation: omit Display from the first toolbar release until a cross-widget conversion and
fallback contract exists. Preserve the URL field for compatibility. Do not invent a Dollar control
or imply FX conversion that TradeChemist does not have.

## Frozen presentation contracts (not implemented)

### Desktop

- Date Range toolbar button opens a floating popover.
- Two calendar months appear side by side, with previous/next month navigation.
- Quick presets, start/end summary, Custom, Clear, and Apply are present.
- Calendar editing is Draft-only; Apply is the sole applied transition.

### Mobile

- Open a near-full-height modal/sheet, not a compressed desktop popover.
- Header contains Date Range title and Close.
- Start-to-end summary precedes vertically stacked month calendars.
- Start/end use circular accent markers; the in-between span uses a restrained selected surface.
- Content may scroll internally; Clear and Apply stay in a sticky footer.
- The composition must remain touch- and keyboard-usable at 320 px.

No sticky toolbar, date picker, mobile sheet, animation, loading visual, or layout polish is part of
this foundation change.

## Navigation and future loading

Applied Dashboard changes continue through `DashboardStateLink` / Dashboard state navigation.
Today that abstraction uses native document navigation because the tested Next stable releases
have an upstream RSC/Gzip reliability issue. Picker code must not introduce raw anchors,
`window.location`, bespoke JSON fetching, or History API state.

When soft navigation is safe, persistent UI is header, sidebar, and sticky Dashboard toolbar;
only analytical content updates. The future accessible status copy is **“Updating dashboard…”**.
No loading transport or animation is implemented now.

## Patched Next migration plan

After a stable Next release contains the upstream RSC/Gzip fixes:

1. Upgrade in a controlled branch without changing picker semantics.
2. Rerun R1 reliability.
3. Pass 300/300 transitions.
4. Pass 20/20 complete flows.
5. Pass all three routing suites.
6. Only then replace the Dashboard-state navigation transport with soft navigation.

The URL model, parsers, serializers, Draft/Apply model, toolbar contract, and picker presentation
contract require no redesign for that transport swap.
