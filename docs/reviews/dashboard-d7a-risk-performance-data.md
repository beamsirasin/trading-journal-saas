# Dashboard D7A Risk Performance Data Contract

Verified 2026-08-28. D7A adds a domain/DTO and one focused server read; it does
not render either reserved D7 widget.

## Definition and limits

`Modeled Account Balance = declared Starting Balance + cumulative authoritative
CLOSED Actual net_pnl_minor`.

It is not broker balance, live balance, equity, or real-time balance. The
current schema has no deposit, withdrawal, transfer, credit, bonus,
broker-adjustment, unrealized-P&L, or open-position mark-to-market ledger. D7A
does not infer or manufacture those events. System Performance and R are not
inputs. Gross P&L, commission, fees, and swap are not recomputed or subtracted
from the already-net parent Trade result.

One position remains one Trade. A fully closed partial position contributes
its parent `trades.net_pnl_minor` once at parent `trades.exited_at`; child
`trade_exits` are not queried.

## Starting-balance evidence

`trading_accounts.starting_balance` is required, non-negative
`NUMERIC(20,10)`, returned as a string. It is converted strictly to integer
minor units with the existing currency registry. Scale-padding zeroes are
removed; a non-zero digit beyond the currency exponent is an integrity error,
not rounded. Unsupported Account currencies fail explicitly.

There is no financial effective/inception timestamp. `created_at` is ordinary
row bookkeeping and is not promoted to one. Starting balance can also be
edited after Trades exist, so an edit is a retroactive change to this modeled
basis. The DTO exposes `basis.effectiveAt: null` and records that limitation.

Base currency is safer: the Account service freezes it once any Trade,
including a soft-deleted Trade, references the Account. Historical Trade money
therefore retains one Account currency. There is no FX conversion.

## Scope and time

Single active/resolved and explicit Accounts are supported. All Accounts
returns `select_single_account`: without per-Account financial inception times,
an aggregate historical capital curve would fabricate when capital entered the
portfolio.

The Account filter and Dashboard 30D/90D/All window apply. Strategy, Setup, and
Strategy Version IDs are authorized/validated but never filter the Account
Balance universe. Future analytical dimensions must follow the same rule.

Actual `exited_at` is the only realization axis. A bounded opening balance is
Starting Balance plus every authoritative closed money result before the range
start. The full balance-basis-through-as-of population is checked for money
completeness, even when the missing result is outside the visible range. An
Account with no closed Trades remains available at Starting Balance.

PostgreSQL stores microseconds while JavaScript `Date` stores milliseconds.
The D7 projection returns `exited_at` as a fixed UTC microsecond string.
Exact-identical instants are grouped and their parent Trade deltas advanced
once; distinct microseconds in one JavaScript millisecond remain distinct.

## Series and drawdown

The series contains typed `opening`, `trade_close`, and `as_of` points.
Opening/as-of anchors have no Trade IDs. A grouped close carries all Trade IDs
at that exact instant, one summed delta, and the resulting balance. Presentation
must not calculate cumulative balance.

The lifetime high-water mark is seeded at Starting Balance and carried into
bounded ranges. Current drawdown is the positive magnitude from the carried
peak to ending balance. Bounded maximum drawdown considers trough states at
the opening and after closes inside the visible range, while retaining the
prior peak. Maximum percentage uses the peak belonging to the selected maximum
money drawdown, not an unrelated overall peak. Percentages are Decimal-based,
four-decimal percentage values; a non-positive reference peak produces a typed
unavailable percentage. Amount arithmetic remains exact for zero/negative
balances and percentages are never clamped to 100%.

## Availability

- `available`
- `unavailable`: `select_single_account`, `missing_starting_balance`,
  `incomplete_money_history`, `currency_mismatch`,
  `unsupported_currency_scale`
- `integrity_error`: `invalid_starting_balance`, `invalid_money_data`,
  `invalid_actual_exit_timestamp`, `invalid_range`

D1's `netPnl` primitive remains the canonical money-completeness validator.
D7A composes it over the longer balance-basis-through-as-of horizon.

## Query and registry architecture

The D2 Dashboard core remains exactly five major projections. D7A adds a
separate boundary with at most one major projection and three columns per row:
parent Trade ID, exact Actual `exited_at`, and parent `net_pnl_minor`. It has no
Analytics snapshot, Exit-leg join, per-point read, or N+1. The existing
`trades_workspace_account_exited_idx (workspace_id, trading_account_id,
exited_at)` supports the query; no cache, index, schema change, or migration is
justified.

The DTO maps both existing reserved IDs, `account.balance` and
`risk.drawdown`, to one shared Risk Performance payload. Their registry entries
remain reserved (`implementation: later`) until D7B.

## Visual fixture reconciliation

Read-only validation against the seeded UTC fixture at
`2026-08-26T12:00:00.000Z` returned:

| Account/range      | Opening |  Ending | Period P&L |    Peak |     Current DD |         Max DD | Trades | Points |
| ------------------ | ------: | ------: | ---------: | ------: | -------------: | -------------: | -----: | -----: |
| Visual — Empty All | $10,000 | $10,000 |         $0 | $10,000 |   $0 / 0.0000% |   $0 / 0.0000% |      0 |      2 |
| Populated All      | $10,000 | $12,310 |    +$2,310 | $12,420 | $110 / 0.8857% | $790 / 6.8666% |     66 |     68 |
| Populated 90D      | $10,110 | $12,310 |    +$2,200 | $12,420 | $110 / 0.8857% | $790 / 6.8666% |     64 |     66 |
| Populated 30D      | $11,270 | $12,310 |    +$1,040 | $12,420 | $110 / 0.8857% | $455 / 3.9548% |     17 |     19 |

All-range reconciliation is exact: `$10,000 + $2,310 = $12,310`. The 10
partial-close Trades have 24 Exit legs but contribute 10 parent-Trade balance
realizations inside the 66-Trade All result.
