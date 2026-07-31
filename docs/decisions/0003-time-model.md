# ADR 0003 — Time and timezone model

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 00b — Core primitives

## Context

`CLAUDE.md` §7 requires UTC storage with display and date bucketing in the user's IANA timezone. Every date-grouped analytic in Phase 08 — equity curves, calendar views, day-of-week performance — depends on one function being correct: which calendar day does this instant belong to, in this zone?

Getting it wrong shifts trades between days invisibly. Nothing errors; the numbers are just quietly wrong.

## Decision

### Three distinct types

The model refuses to conflate what JavaScript's `Date` conflates:

| Type             | Meaning                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **Instant**      | An absolute moment, stored UTC. `Date` carries it, but it is never treated as local.               |
| **CalendarDate** | `"2026-07-31"` — no time, no zone. What "my trades on Friday" means.                               |
| **WallClock**    | What a clock reads: `2026-07-31 23:30`, no offset. Becomes an Instant only when a zone is applied. |

### Native `Intl`, no date library

Offsets and DST rules come from the runtime's ICU data via `Intl.DateTimeFormat`. No timezone database is bundled.

The trade-off: bundled tz data (Luxon, date-fns-tz) goes stale and needs dependency updates when a government changes its DST rules — which happens several times a year somewhere. ICU ships with the runtime and is updated with it.

Requires a full-ICU runtime. Node 14+ and every current browser qualify.

### Storage and parsing

- `parseInstant` requires an **explicit offset** — `Z` or `+07:00`. A bare `"2026-07-31T10:00:00"` is rejected.

  This is the single most important rejection in the module. `new Date("2026-07-31T10:00:00")` interprets the string as **local time on whatever machine runs it**, so the same input produces different instants on a developer laptop, in CI, and in production. A timestamp without a zone is not an instant, and guessing one is the bug.

- `toIsoUtc` is the only storage form. Locale-formatted strings are never persisted — they are lossy and unparseable.

- `parseCalendarDate` rejects impossible dates. `new Date(2026, 1, 30)` silently becomes 2 March; this refuses it.

### DST resolution

Two edge cases, each with a documented default:

| Case                                                              | Example                         | Default                        | Option                      |
| ----------------------------------------------------------------- | ------------------------------- | ------------------------------ | --------------------------- |
| **Ambiguous** — clocks go back, the wall clock happens twice      | 01:30 on 2026-11-01 in New York | `'earlier'` (first occurrence) | `ambiguous: 'later'`        |
| **Nonexistent** — clocks go forward, the wall clock never happens | 02:30 on 2026-03-08 in New York | `'after-gap'` (skip forward)   | `nonexistent: 'before-gap'` |

Both defaults are arbitrary. What matters is that they are consistent, documented, and tested — an unstated choice silently shifts an hour of trades.

### The algorithm, and the bug it fixes

Converting a wall clock to an instant is circular: the offset depends on the instant, but the instant is what you are solving for.

The **first implementation used two passes** — guess with the offset at the naive timestamp, then re-measure at the candidate. It passed every test except one, and that test caught a real defect: when the naive timestamp and its candidate both fall on the same side of a transition, both passes return the same offset and the second valid instant is never discovered. An ambiguous time therefore looked unique, and `ambiguous: 'later'` was silently ignored.

The fix is to **bracket the transition**: sample the offset one day either side of the naive timestamp, which is guaranteed to straddle any nearby DST change, then test both resulting candidates.

```
survivors = candidates.filter(roundTripsToTheSameWallClock)

2 survivors -> ambiguous    (fall back)
1 survivor  -> unique       (the ordinary case)
0 survivors -> nonexistent  (spring forward)
```

This is recorded because the two-pass version looks obviously correct and is not.

### Day boundaries are half-open

`dayRangeIn` returns `[start, end)` — the start of the next day, not `23:59:59`.

An inclusive end silently drops anything in the final second, and `>= start AND < end` is the form every database range query wants. DST days are correctly 23 or 25 hours long, which is asserted by test.

## Consequences

**Positive**

- No dependency; tz rules stay current with the runtime.
- 77 unit tests, covering UTC, Asia/Bangkok (no DST), America/New_York (both transitions), Australia/Sydney (inverted DST), half-hour and 45-minute offsets, leap days, and year boundaries.
- The type distinction makes "instant vs calendar date" a compile-time concern.

**Negative / accepted**

- `Intl.DateTimeFormat` and `formatToParts` are slower than integer arithmetic against bundled tz data. Formatters are cached per zone; if Phase 08 measures this as a bottleneck, offsets can be memoised per zone-day.
- Sub-second precision is lost when computing offsets, because `formatToParts` has none. No real zone has a sub-second offset.
- Depends on runtime ICU. A Node build with small-icu would break this — worth checking if the deployment target ever changes.

## Alternatives considered

| Alternative                       | Why not                                                                                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Luxon                             | Mature and pleasant, but bundles tz data that needs updating, and adds weight for functionality ICU already provides.                                                                                                                                                                  |
| date-fns + date-fns-tz            | Same staleness concern; the tz package has historically lagged on edge cases.                                                                                                                                                                                                          |
| `@js-temporal/polyfill`           | Temporal is the right long-term answer and models exactly these distinctions. The polyfill is heavy and Temporal is not yet stable in Node 24. **Revisit when it ships natively** — this module's surface is deliberately close to Temporal's shape to make that migration mechanical. |
| Storing local time plus an offset | Loses the zone identity, so future DST rule changes cannot be reapplied. UTC plus an IANA id is the only lossless pair.                                                                                                                                                                |
