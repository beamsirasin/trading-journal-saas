# Dashboard D1 Analytics Baseline

Measured 2026-08-26 against the explicitly configured disposable
`TEST_DATABASE_URL` with `node --env-file=.env.local scripts/benchmark-analytics.mjs`.
This is a regression baseline, not a production latency SLA.

- Fixture: 5,000 current-schema Trades across three Accounts, three Strategies,
  three Setups, current Actual/System resolution fields, final Exit legs, Rule
  checks, and Mistakes.
- Scenarios: 8 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` queries.
- Runtime service query count was not instrumented by this benchmark; the
  reported count is the eight explicit benchmark scenarios.
- No index or migration was added in D1.

| Scenario                         |  Rows | Execution | Plan observations                        |
| -------------------------------- | ----: | --------: | ---------------------------------------- |
| Active-account 90D Trader        |   227 |  0.347 ms | Index Scan, Incremental Sort             |
| Active-account 90D System        |   193 |  3.567 ms | Index Scan, Sort                         |
| Paired 90D, Actual-exit anchored |   140 |  0.323 ms | Index Scan, Incremental Sort             |
| All-accounts all-time System     | 2,750 |  4.610 ms | Index Scan, Sort                         |
| Strategy + Setup Trader          | 1,083 |  3.912 ms | Index Scan, Sort                         |
| Strategy Version System          |   916 |  3.837 ms | Index Scan, Sort                         |
| Rule analytics join              |   683 |  5.656 ms | Nested Loop, Index Scan, Sort            |
| Mistake analytics join           |   229 |  6.649 ms | Nested Loop, Index/Index Only Scan, Sort |

Every plan reported zero shared-read blocks in this warm local run. The System,
framework, and join scenarios touched roughly 5,013–7,750 shared-hit blocks;
that observation should be remeasured under representative production data
before any index decision. D1 deliberately does not optimize these queries.
