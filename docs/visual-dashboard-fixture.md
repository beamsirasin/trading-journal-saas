# Visual Dashboard fixture

This fixture is development-only data for deterministic Dashboard UAT. It reconciles only the
marker-owned `Visual — Empty` and `Visual — Populated` Trading Accounts under the existing target
user; it never creates an authentication identity or changes an existing Strategy.

From PowerShell, run:

```powershell
$env:ALLOW_VISUAL_FIXTURE_SEED='true'; pnpm seed:visual-dashboard
```

The command explicitly loads `.env.local`, refuses production-like or unclassified database names,
and requires `ALLOW_VISUAL_FIXTURE_SEED=true` on every run. It uses
`beamkattiyot12345@gmail.com` by default; `VISUAL_TEST_EMAIL` may select another existing development
user. No password is required or read.

An existing same-name or deterministic-ID Account is rebuilt only when it carries the exact fixture
ownership marker. Otherwise the command stops. Reconciliation is one transaction: it upserts the two
fixture Accounts, deletes Trades only under those marker-owned Accounts, rebuilds deterministic child
records, verifies unrelated Account fingerprints and the migration journal, and prints canonical KPI,
money-completeness, lifecycle-population, attention, and recent-Trade results.

Deterministic IDs use a hierarchical v2 namespace:

```text
visual-dashboard
  -> normalized owner identity
  -> workspace identity
  -> fixture Account kind
  -> persisted Account ID
  -> fixture Trade index
  -> child type (Exit or rule check)
  -> stable child sequence/key
```

The persisted Account ID is the parent namespace for every Trade, and the Trade ID is the parent
namespace for its child rows. Rerunning one owner/workspace/Account therefore produces exactly the
same IDs, while another owner, workspace, or fixture Account cannot reuse them. Existing v1 Account
markers are accepted only for a one-time reconciliation to v2; descendant rows are rebuilt naturally
with v2 IDs. No Exit-ID remapping is required.

Run the read-only database isolation proof after seeding:

```powershell
$env:ALLOW_VISUAL_FIXTURE_SEED='true'; pnpm validate:visual-dashboard-ids
```

It generates the complete fixture under a distinct synthetic owner namespace, checks Account, Trade,
Exit, rule-check, mistake, and emotion identities against the persisted fixture and live database, and
verifies the original fixture fingerprint is unchanged inside an explicitly read-only transaction.
