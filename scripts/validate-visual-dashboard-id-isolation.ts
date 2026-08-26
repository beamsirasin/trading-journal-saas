/**
 * Read-only database proof for visual-fixture deterministic ID isolation.
 *
 * The synthetic namespace is generated beside the persisted target fixture,
 * checked against both the generator output and live primary/replay keys, and
 * never inserted. The transaction is explicitly read-only.
 */
import { createHash } from 'node:crypto';

import postgres, { type TransactionSql } from 'postgres';

import {
  assertVisualSeedSafety,
  buildVisualTradeBlueprints,
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_EMAIL,
  VISUAL_POPULATED_ACCOUNT_NAME,
  visualAccountIdentity,
  visualTradeChildIdentity,
  type VisualFramework,
  type VisualTradeBlueprint,
} from './visual-dashboard-fixture';

const SYNTHETIC_OWNER = 'visual-fixture-isolation-probe@example.invalid';

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, candidate) => (typeof candidate === 'bigint' ? candidate.toString() : candidate),
    2,
  );
}

function digest(value: unknown): string {
  return createHash('sha256').update(safeJson(value)).digest('hex');
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return sorted(left.filter((value) => rightSet.has(value)));
}

function assertUnique(label: string, values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`STOP: ${label} contains duplicate deterministic identities.`);
  }
}

interface IdentityManifest {
  readonly accountIds: readonly string[];
  readonly accountMutationKeys: readonly string[];
  readonly tradeIds: readonly string[];
  readonly tradeMutationKeys: readonly string[];
  readonly exitIds: readonly string[];
  readonly exitMutationKeys: readonly string[];
  readonly ruleCheckIds: readonly string[];
  readonly mistakeCompositeKeys: readonly string[];
  readonly emotionCompositeKeys: readonly string[];
}

function manifest(
  accountIdentity: {
    readonly emptyId: string;
    readonly populatedId: string;
    readonly emptyMutationKey: string;
    readonly populatedMutationKey: string;
  },
  trades: readonly VisualTradeBlueprint[],
  ruleKeys: readonly string[],
): IdentityManifest {
  return {
    accountIds: sorted([accountIdentity.emptyId, accountIdentity.populatedId]),
    accountMutationKeys: sorted([
      accountIdentity.emptyMutationKey,
      accountIdentity.populatedMutationKey,
    ]),
    tradeIds: sorted(trades.map((trade) => trade.id)),
    tradeMutationKeys: sorted(trades.map((trade) => trade.mutationKey)),
    exitIds: sorted(trades.flatMap((trade) => trade.exits.map((exit) => exit.id))),
    exitMutationKeys: sorted(
      trades.flatMap((trade) => trade.exits.map((exit) => exit.mutationKey)),
    ),
    ruleCheckIds: sorted(
      trades.flatMap((trade) =>
        trade.strategyVersionId === null
          ? []
          : ruleKeys.map((ruleKey) => visualTradeChildIdentity(trade.id, 'rule-check', ruleKey)),
      ),
    ),
    mistakeCompositeKeys: sorted(
      trades.flatMap((trade) => trade.mistakeKeys.map((mistakeKey) => `${trade.id}:${mistakeKey}`)),
    ),
    emotionCompositeKeys: sorted(
      trades.flatMap((trade) => trade.emotionKeys.map((emotionKey) => `${trade.id}:${emotionKey}`)),
    ),
  };
}

function assertManifestUnique(label: string, value: IdentityManifest): void {
  for (const [kind, identities] of Object.entries(value)) {
    assertUnique(`${label} ${kind}`, identities);
  }
}

function crossNamespaceCollisions(
  target: IdentityManifest,
  synthetic: IdentityManifest,
): Record<keyof IdentityManifest, readonly string[]> {
  return {
    accountIds: intersection(target.accountIds, synthetic.accountIds),
    accountMutationKeys: intersection(target.accountMutationKeys, synthetic.accountMutationKeys),
    tradeIds: intersection(target.tradeIds, synthetic.tradeIds),
    tradeMutationKeys: intersection(target.tradeMutationKeys, synthetic.tradeMutationKeys),
    exitIds: intersection(target.exitIds, synthetic.exitIds),
    exitMutationKeys: intersection(target.exitMutationKeys, synthetic.exitMutationKeys),
    ruleCheckIds: intersection(target.ruleCheckIds, synthetic.ruleCheckIds),
    mistakeCompositeKeys: intersection(target.mistakeCompositeKeys, synthetic.mistakeCompositeKeys),
    emotionCompositeKeys: intersection(target.emotionCompositeKeys, synthetic.emotionCompositeKeys),
  };
}

async function persistedFixtureFingerprint(
  tx: TransactionSql,
  workspaceId: string,
  accountIds: readonly string[],
): Promise<string> {
  const accounts = await tx`
    select id, mutation_key, name
    from trading_accounts
    where workspace_id = ${workspaceId} and id in ${tx(accountIds)}
    order by id
  `;
  const trades = await tx`
    select id, mutation_key, trading_account_id
    from trades
    where workspace_id = ${workspaceId} and trading_account_id in ${tx(accountIds)}
    order by id
  `;
  const exits = await tx`
    select te.id, te.mutation_key, te.trade_id
    from trade_exits te
    join trades t on t.id = te.trade_id
    where t.workspace_id = ${workspaceId} and t.trading_account_id in ${tx(accountIds)}
    order by te.id
  `;
  const ruleChecks = await tx`
    select trc.id, trc.trade_id, trc.rule_key
    from trade_rule_checks trc
    join trades t on t.id = trc.trade_id
    where t.workspace_id = ${workspaceId} and t.trading_account_id in ${tx(accountIds)}
    order by trc.id
  `;
  const mistakes = await tx`
    select tm.trade_id, mt.key
    from trade_mistakes tm
    join trades t on t.id = tm.trade_id
    join mistake_types mt on mt.id = tm.mistake_type_id
    where t.workspace_id = ${workspaceId} and t.trading_account_id in ${tx(accountIds)}
    order by tm.trade_id, mt.key
  `;
  const emotions = await tx`
    select te.trade_id, et.key
    from trade_emotions te
    join trades t on t.id = te.trade_id
    join emotion_types et on et.id = te.emotion_type_id
    where t.workspace_id = ${workspaceId} and t.trading_account_id in ${tx(accountIds)}
    order by te.trade_id, et.key
  `;
  return digest({ accounts, trades, exits, ruleChecks, mistakes, emotions });
}

async function main(): Promise<void> {
  const target = assertVisualSeedSafety(process.env);
  const targetEmail = (process.env.VISUAL_TEST_EMAIL ?? VISUAL_FIXTURE_EMAIL).trim().toLowerCase();
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

  try {
    const report = await sql.begin(async (tx) => {
      await tx`set transaction read only`;
      const users = await tx`select id from users where lower(email) = ${targetEmail}`;
      if (users.length !== 1)
        throw new Error('STOP: target development user is missing or ambiguous.');
      const userId = users[0]!.id as string;
      const memberships = await tx`
        select wm.workspace_id,
               (up.active_trading_account_id is not null
                and ta.workspace_id = wm.workspace_id) as owns_active_account
        from workspace_members wm
        left join user_preferences up on up.user_id = wm.user_id
        left join trading_accounts ta on ta.id = up.active_trading_account_id
        where wm.user_id = ${userId}
        order by owns_active_account desc nulls last, wm.workspace_id
      `;
      const active = memberships.filter((row) => row.owns_active_account === true);
      const membership =
        active.length === 1 ? active[0] : memberships.length === 1 ? memberships[0] : undefined;
      if (!membership) throw new Error('STOP: target workspace is ambiguous.');
      const workspaceId = membership.workspace_id as string;

      const accounts = await tx`
        select id, name
        from trading_accounts
        where workspace_id = ${workspaceId}
          and name in (${VISUAL_EMPTY_ACCOUNT_NAME}, ${VISUAL_POPULATED_ACCOUNT_NAME})
        order by name, id
      `;
      if (accounts.length !== 2)
        throw new Error('STOP: the two target fixture Accounts are not present.');
      const emptyId = accounts.find((row) => row.name === VISUAL_EMPTY_ACCOUNT_NAME)?.id as
        string | undefined;
      const populatedId = accounts.find((row) => row.name === VISUAL_POPULATED_ACCOUNT_NAME)?.id as
        string | undefined;
      if (!emptyId || !populatedId) throw new Error('STOP: fixture Account names are ambiguous.');

      const [strategy] = await tx`
        select s.id as strategy_id, sv.id as strategy_version_id
        from strategies s
        join strategy_versions sv on sv.id = s.current_version_id
        where s.workspace_id = ${workspaceId} and not s.is_archived
          and lower(sv.name) = lower('Elliott Wave')
        order by s.created_at limit 1
      `;
      if (!strategy) throw new Error('STOP: fixture strategy is missing.');
      const setups = await tx`
        select su.id, ssv.id as version_id, ssv.name
        from setups su
        join strategy_setup_versions ssv
          on ssv.setup_id = su.id and ssv.strategy_version_id = ${strategy.strategy_version_id}
        where su.workspace_id = ${workspaceId} and su.strategy_id = ${strategy.strategy_id}
          and not su.is_archived
        order by ssv.sort_order, ssv.name
        limit 3
      `;
      if (setups.length !== 3) throw new Error('STOP: fixture Setup snapshots are missing.');
      const ruleRows = await tx`
        select rule_key
        from strategy_rules
        where workspace_id = ${workspaceId}
          and strategy_version_id = ${strategy.strategy_version_id}
        order by rule_key
      `;
      const ruleKeys = ruleRows.map((row) => row.rule_key as string);
      const framework: VisualFramework = {
        strategyId: strategy.strategy_id as string,
        strategyVersionId: strategy.strategy_version_id as string,
        setups: setups.map((row) => ({
          id: row.id as string,
          versionId: row.version_id as string,
          name: row.name as string,
        })),
      };

      const targetAccountIdentity = {
        ...visualAccountIdentity({ ownerIdentity: targetEmail, workspaceId }),
        emptyId,
        populatedId,
      };
      const targetTrades = buildVisualTradeBlueprints({
        populatedAccountId: populatedId,
        framework,
      });
      const syntheticAccountIdentity = visualAccountIdentity({
        ownerIdentity: SYNTHETIC_OWNER,
        workspaceId,
      });
      const syntheticTrades = buildVisualTradeBlueprints({
        populatedAccountId: syntheticAccountIdentity.populatedId,
        framework,
      });
      const targetManifest = manifest(targetAccountIdentity, targetTrades, ruleKeys);
      const syntheticManifest = manifest(syntheticAccountIdentity, syntheticTrades, ruleKeys);
      assertManifestUnique('target', targetManifest);
      assertManifestUnique('synthetic', syntheticManifest);
      const collisions = crossNamespaceCollisions(targetManifest, syntheticManifest);
      if (Object.values(collisions).some((values) => values.length > 0)) {
        throw new Error('STOP: the synthetic namespace intersects the target fixture namespace.');
      }

      const fingerprintBefore = await persistedFixtureFingerprint(tx, workspaceId, [
        emptyId,
        populatedId,
      ]);
      const accountDbCollisions = await tx`
        select id from trading_accounts
        where id in ${tx(syntheticManifest.accountIds)}
           or (workspace_id = ${workspaceId}
               and mutation_key in ${tx(syntheticManifest.accountMutationKeys)})
      `;
      const tradeDbCollisions = await tx`
        select id from trades
        where id in ${tx(syntheticManifest.tradeIds)}
           or (workspace_id = ${workspaceId}
               and mutation_key in ${tx(syntheticManifest.tradeMutationKeys)})
      `;
      const exitDbCollisions = await tx`
        select id from trade_exits
        where id in ${tx(syntheticManifest.exitIds)}
           or (workspace_id = ${workspaceId}
               and mutation_key in ${tx(syntheticManifest.exitMutationKeys)})
      `;
      const ruleCheckDbCollisions =
        syntheticManifest.ruleCheckIds.length === 0
          ? []
          : await tx`
              select id from trade_rule_checks
              where id in ${tx(syntheticManifest.ruleCheckIds)}
            `;
      const fingerprintAfter = await persistedFixtureFingerprint(tx, workspaceId, [
        emptyId,
        populatedId,
      ]);
      const liveCollisionCounts = {
        accounts: accountDbCollisions.length,
        trades: tradeDbCollisions.length,
        exits: exitDbCollisions.length,
        ruleChecks: ruleCheckDbCollisions.length,
      };
      if (Object.values(liveCollisionCounts).some((count) => count !== 0)) {
        throw new Error(
          'STOP: synthetic identities collide with rows already present in the database.',
        );
      }
      if (fingerprintBefore !== fingerprintAfter) {
        throw new Error('STOP: target fixture fingerprint changed during the read-only proof.');
      }

      return {
        event: 'VISUAL_FIXTURE_ID_ISOLATION_PROOF',
        database: { environment: target.environment, host: target.host, name: target.database },
        transaction: 'read-only',
        target: {
          owner: targetEmail,
          workspaceId,
          identityDigest: digest(targetManifest),
        },
        synthetic: {
          owner: SYNTHETIC_OWNER,
          workspaceId,
          identityDigest: digest(syntheticManifest),
        },
        generatedCounts: Object.fromEntries(
          Object.entries(syntheticManifest).map(([kind, identities]) => [kind, identities.length]),
        ),
        crossNamespaceCollisionCounts: Object.fromEntries(
          Object.entries(collisions).map(([kind, identities]) => [kind, identities.length]),
        ),
        liveDatabaseCollisionCounts: liveCollisionCounts,
        originalFixtureUntouched: fingerprintBefore === fingerprintAfter,
        originalFixtureFingerprint: fingerprintAfter,
      };
    });
    console.log(safeJson(report));
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Visual fixture ID isolation proof failed.',
  );
  process.exitCode = 1;
});
