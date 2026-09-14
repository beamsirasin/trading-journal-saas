# Product Contracts

A Product Contract records **approved intended product behaviour and semantics** for one product
domain. It describes product intent rather than implementation detail, and it may describe behaviour
the code does not implement yet.

| Contract                  | Domain                                                                                                                            | Status                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [Add Trade](add-trade.md) | At Entry, After Trade, Partial / Final Close, Review, System Assessment, and related Strategy / Psychology / Discipline semantics | Approved v1 (2026-09-14) |

## Documentation precedence

When documents disagree, resolve them in this order:

1. **Approved Product Contract** — intended product behaviour and semantics for its domain.
2. **[`CLAUDE.md`](../../CLAUDE.md)** — current engineering and AI operating instructions. It must
   not contradict an approved Product Contract; where it still does, the contract wins and the
   conflict is a documentation defect to fix.
3. **Canonical technical documentation** — for example
   [`calculation-spec.md`](../calculation-spec.md), [`data-dictionary.md`](../data-dictionary.md)
   and [`product-spec.md`](../product-spec.md). These describe the approved target semantics where a
   contract applies, and clearly label current implementation that has not caught up.
4. **Historical Phase documents** ([`docs/phases/`](../phases/)) — records of what was decided and
   built at the time. They remain intact as history and never silently override a newer approved
   Product Contract.

## Target versus current implementation

An approved contract is a target. Until its migration lands, parts of the running code still behave
the old way. Documents that describe both must label them — for example "Approved target semantics"
versus "Current implementation until migration" — so no reader mistakes current behaviour for
approved behaviour, or approved behaviour for shipped code.
