# Product Contracts

A Product Contract records **approved intended product behaviour and semantics** for one product
domain. It describes product intent rather than implementation detail, and it may describe behaviour
the code does not implement yet.

| Contract                  | Domain                                                                                                                            | Status                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [Add Trade](add-trade.md) | At Entry, After Trade, Partial / Final Close, Review, System Assessment, and related Strategy / Psychology / Discipline semantics | Approved v1 (2026-09-14) |

## Documentation precedence

Each level controls its own domain. When documents disagree, resolve them in this order. A lower
level never overrides a higher level's semantic or behavioural decision; where one still does, the
higher level wins and the conflict is a documentation defect to fix.

1. **Approved Product Contract** — **product semantics** for its domain: what a state, value or
   result means, what is required, and what is never inferred.
2. **[`UX_RULES.md`](../UX_RULES.md)** — **interaction and behaviour**: information hierarchy,
   progressive disclosure, state representation, drafts and navigation, validation, feedback, and
   redesign guardrails. It applies the contracts and never changes their semantics.
3. **[`CLAUDE.md`](../../CLAUDE.md) and canonical technical documentation** — **engineering and
   technical constraints** as applicable, for example [`calculation-spec.md`](../calculation-spec.md),
   [`data-dictionary.md`](../data-dictionary.md) and [`product-spec.md`](../product-spec.md).
   Engineering constraints such as authorization, tenancy, money precision and UTC time still bind
   how the levels above are implemented, but these documents must not contradict a contract's
   semantics or the UX Rules' behaviour. Where a contract applies, they describe the approved
   target and clearly label current implementation that has not caught up.
4. **`DESIGN.md` / visual system** — **visual expression**: [`DESIGN.md`](../../DESIGN.md) at the
   repository root owns visual philosophy, hierarchy, composition and visual rules;
   [`design-system.md`](../design-system.md) is its implementation reference for tokens, components
   and measured decisions. Visual simplification may never delete an approved semantic or
   behaviour.
5. **Historical documents** — Phase documents ([`docs/phases/`](../phases/)), reviews and the frozen
   prototype record. They remain intact as history and never silently override any level above.

For design or implementation of a user-facing flow, read in the same order: Product Contract → UX
Rules → `CLAUDE.md` and technical docs → visual system → current code.

## Target versus current implementation

An approved contract is a target. Until its migration lands, parts of the running code still behave
the old way. Documents that describe both must label them — for example "Approved target semantics"
versus "Current implementation until migration" — so no reader mistakes current behaviour for
approved behaviour, or approved behaviour for shipped code.
