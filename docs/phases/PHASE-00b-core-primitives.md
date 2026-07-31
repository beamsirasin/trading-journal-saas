# Phase 00b — Core Technical Primitives

**Depends on:** 00 · **Blocks:** 01–08 · **Completed:** 2026-07-31

## Goal

The technical foundations the design system, authentication, database and calculation phases depend on — with no product features. Phase 00 deferred these; this phase closes the gap.

## What shipped

### Money primitives — `src/lib/money/`

Integer minor units in `bigint` plus an ISO 4217 code. No floating-point arithmetic anywhere, including during parsing and formatting. Currency precision comes from a registry lookup, so JPY/KRW/VND/IDR (zero decimals) are correct rather than being discovered as a bug later.

Parsing is strict and the policy is documented: European decimal commas and malformed grouping are **rejected**, not guessed. Excess decimal places are rejected unless a rounding policy is passed explicitly.

**108 tests** — THB, USD, JPY, negatives, zero, grouping, excess decimals, malformed input, the BIGINT range boundary, values past 2^53, arithmetic, and formatting.

See [ADR 0002](../decisions/0002-money-representation.md).

### Time primitives — `src/lib/time/`

Instant / CalendarDate / WallClock as distinct types. Native `Intl`, no bundled timezone data. `parseInstant` rejects timestamps without an explicit offset — the rejection that stops output depending on the server's local timezone.

DST is resolved explicitly: ambiguous times default to the earlier instant, nonexistent times skip forward past the gap.

**77 tests** — UTC, Asia/Bangkok, America/New_York across both 2026 transitions, Australia/Sydney, half-hour and 45-minute offsets, date-boundary crossing, leap days, invalid zones and timestamps.

See [ADR 0003](../decisions/0003-time-model.md).

### Environment boundary — `src/config/`

Split three ways:

| File            | Role                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `env.schema.ts` | Pure Zod schemas — testable, no side effects                                                   |
| `env.server.ts` | Imports `server-only`; **the build fails** if a client component imports it, even transitively |
| `env.client.ts` | `NEXT_PUBLIC_*` only, referenced literally so Next.js can inline them                          |

Every variable stays optional until its phase lands, so an unconfigured integration never breaks a build or a preview deployment. Error messages name the variable and never echo its value.

### Theme foundation

Precedence: saved choice → OS preference → dark fallback. next-themes with the `.light` / `.dark` class, no flash before paint, three options including System.

See [ADR 0005](../decisions/0005-theme-and-tokens.md).

### Application shell

Route groups `(public)` and `(app)`. Semantic landmarks, skip-to-content, responsive sidebar collapsing to a focus-trapping drawer, loading and error boundaries, 404 handling.

### Database boundary

`drizzle.config.ts`, a lazily-connecting client, and an intentionally empty schema. Pooled versus direct connection responsibilities documented. Optional local PostgreSQL via Docker Compose.

See [ADR 0004](../decisions/0004-database-access.md).

### Health endpoint — `/api/health`

Liveness only. No database check: liveness and readiness are different signals, and failing this on a database blip would make an orchestrator restart a healthy process. Returns exactly `status`, `timestamp`, `uptimeSeconds` — asserted by test, so any new field is deliberate.

### UI and motion

shadcn/ui initialised with `button`, `dropdown-menu`, `sheet` — only what this phase uses. Motion appears in exactly one place: a shared `layoutId` on the sidebar's active indicator, which communicates the relationship between the previous and current section. Reduced motion is honoured globally in CSS and again per component.

## Two bugs worth recording

**The DST conversion was wrong, and a test caught it.** The first `wallClockToInstant` used two passes; when both passes land on the same side of a transition they return the same offset, so the second valid instant is never found. Ambiguous times looked unique and `ambiguous: 'later'` was silently ignored. Fixed by bracketing the transition — sampling a day either side. Recorded because the two-pass version looks obviously correct and is not.

**Mobile had no navigation landmark.** The sidebar is `display:none` below `lg`, which removes it from the accessibility tree entirely — so until the drawer opened, a screen reader user had no navigation landmark at all. This is acceptable for a drawer pattern (the trigger sits in the banner) but was not deliberate, and is now explicit in both the code and the tests.

## Verification

All executed on 2026-07-31, exit codes checked individually.

| Command             | Result                           |
| ------------------- | -------------------------------- |
| `pnpm format:check` | pass                             |
| `pnpm lint`         | pass                             |
| `pnpm typecheck`    | pass                             |
| `pnpm test`         | **229 passed**                   |
| `pnpm build`        | pass                             |
| `pnpm test:e2e`     | **64 passed** (desktop + mobile) |

`.next` was deleted before the final build and e2e run.

## Deliberately deferred

| Item                                                    | Phase        | Why                                                                            |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| `decimal.js`                                            | 06           | Minor units in `bigint` are exact; prices at `NUMERIC(20,10)` are what need it |
| Multiplication, division, percentages                   | 06           | Need a documented rounding rule per formula                                    |
| Product schema tables                                   | 01+          | Each arrives with its own reviewed migration                                   |
| Auth, React Hook Form, Recharts                         | 02 / 04 / 08 | No code uses them yet                                                          |
| Application Dockerfile                                  | 12           | Would require deciding a production architecture that has not been designed    |
| Trading sessions, market hours, business-day arithmetic | later        | Not needed by any current phase                                                |
| `/api/ready` (dependency readiness)                     | 12           | Distinct from liveness                                                         |

## Open risks

- **`docker-compose.yml` is unverified.** Docker is not installed on the machine used for this phase. The file is written from the documented schema but has never been started; validate before relying on it.
- **`numeric`-as-string is asserted only by documentation.** The guarantee is real but untested until a database exists. Phase 01 must add a test proving a `numeric` column round-trips as a string.
- **The app shell is unauthenticated.** `/app` is publicly reachable. Safe only because it holds no data; Phase 02 adds the guard.
- **`Intl` depends on runtime ICU.** A small-icu Node build would break timezone conversion. Worth checking if the deployment target changes.
