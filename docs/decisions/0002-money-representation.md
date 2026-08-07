# ADR 0002 — Money representation

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 00b — Core primitives

## Context

`CLAUDE.md` §5 bans floating-point arithmetic for financial values. Phase 00b implements the money primitives that Phases 04–08 depend on, so the representation must be settled now — changing it later would mean a data migration plus rewriting every calculation.

Two distinct quantities are involved, and conflating them is the trap:

- **Monetary amounts** — P&L, fees, commission, balances. Exact to a fixed number of decimals.
- **Instrument prices** — `EURUSD @ 1.08532`. Five, eight, or ten decimals depending on the instrument.

## Decision

### Monetary amounts: `bigint` minor units + ISO 4217 code

```ts
interface Money {
  readonly amountMinor: bigint; // 123456n
  readonly currency: CurrencyCode; // 'USD'  -> $1,234.56
}
```

- Decimal places come from a **currency registry lookup**, never a hardcoded `100`. JPY, KRW, VND and IDR have zero decimals, so `amount * 100` is wrong for roughly a fifth of the registry.
- Range is validated against PostgreSQL `BIGINT` (`±9,223,372,036,854,775,807`), because that is where the value will be stored.
- Parsing and formatting use **string arithmetic only**. No intermediate `Number` exists anywhere in the module, so precision cannot be lost above 2^53.

### No decimal library — yet

`decimal.js` is **not** installed in this phase. Integer minor units in `bigint` are exact by construction; a decimal library would add a dependency to do arithmetic that `bigint` already does perfectly.

It becomes justified in **Phase 07C**, when `NUMERIC(20,10)` instrument prices arrive (`src/lib/calc/decimal.ts`). Prices genuinely need arbitrary-precision decimal arithmetic — `1.08532` has no minor-unit representation — and that is the point at which the dependency earns its place. (This ADR's original text named "Phase 06" — a forward reference written before the roadmap's later renumbering moved the calculation engine to Phase 07; corrected here as a narrow factual fix, not a rewrite of the decision's own reasoning.)

### Explicit parsing policy

Strict, and documented in `src/lib/money/parse.ts`:

| Input                                       | Result                                   |
| ------------------------------------------- | ---------------------------------------- |
| `1234.56`, `1,234.56`, `-12.34`, `.5`, `5.` | accepted                                 |
| `1.234,56`                                  | **rejected** — `ambiguous_separators`    |
| `1,23`                                      | **rejected** — `invalid_grouping`        |
| `12.345` in USD                             | **rejected** — `too_many_decimal_places` |
| `$12.34`, `(12.34)`, `1e5`                  | **rejected** — `malformed`               |

Two rejections deserve their reasoning:

**European convention is refused, not guessed.** `1.234` means 1234 in Germany and 1.234 in the US. A parser that guesses is wrong by a factor of 1000 on the input it guesses wrong, and it fails silently. Locale-aware parsing can be added later behind an explicit locale argument.

**Grouping is validated, not stripped.** `1,23` is a typo. Stripping the comma to get `123` accepts input the user visibly got wrong.

### Rounding is always explicit

Excess decimal places are **rejected by default**. `onExcessDecimals: 'round-half-up' | 'truncate'` opts in per call site. Silent rounding of money is how cents disappear, and the disappearance is invisible in review.

### Result types, not exceptions

Every fallible operation returns `{ ok: true; value } | { ok: false; error }`. Parsing user input fails routinely, and a discriminated union makes that failure impossible to ignore by accident.

## Consequences

**Positive**

- Arithmetic is exact. `0.1 + 0.2` cannot happen.
- Zero-decimal currencies work correctly from day one, rather than being discovered as a bug when a JPY account is created.
- No dependency, so nothing to keep current.
- 108 unit tests cover the module, including values beyond 2^53.

**Negative / accepted**

- `bigint` does not serialise to JSON. Conversion is explicit at every boundary — annoying, but the annoyance is what prevents a silent `Number()` coercion.
- Multiplication and division are deliberately absent. Position sizing and R-multiples need a documented rounding rule per formula, and belong in the Phase 07 engine (`src/lib/calc/`).
- Strict parsing will reject input some users consider reasonable, notably European decimal commas. Accepted: a rejected amount is recoverable, a misread one is not.

## Alternatives considered

| Alternative                              | Why not                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `number` with cents                      | Safe only below 2^53 and only if nobody ever divides. Both conditions fail eventually, silently.                                        |
| `decimal.js` for everything              | Real dependency, slower, and still needs a storage decision. Minor units are exact without it.                                          |
| PostgreSQL `NUMERIC` for money           | Works, but returns strings needing parsing anyway, and invites accidental `parseFloat`. `BIGINT` makes the integer nature structural.   |
| A money library (dinero.js, currency.js) | Reasonable, but the needed surface is small and the currency-precision behaviour is the part that must be exactly right — worth owning. |
