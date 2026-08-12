#!/usr/bin/env node
/**
 * Phase 11C guarded benchmark — seeds a representative-scale dataset
 * (~5,000 users, ~5,000 personal Workspaces/entitlements, ~18,000 Trades
 * spread across 90 days) into the disposable TEST database only, runs
 * `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against every material Admin
 * Overview query, prints a structural summary (no PII, no secrets), and
 * cleans up every row it inserted before exiting.
 *
 * Modeled directly on `scripts/benchmark-analytics.mjs`'s own pattern
 * (raw `postgres`, guarded `TEST_DATABASE_URL`, `summarizePlan` helper) —
 * same safety posture, same reporting shape.
 */
import crypto from 'node:crypto';

import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

const { testUrl } = validateTestDatabaseEnvironment();
const sql = postgres(testUrl, { max: 5 });

const USER_COUNT = 5000;
const FRAMEWORK_WORKSPACE_COUNT = 300;
const TRADES_PER_FRAMEWORK_WORKSPACE = 60;
const BENCHMARK_TAG = `admin-bench-${crypto.randomUUID()}`;

function uuidFrom(namespace, n) {
  const hash = crypto.createHash('md5').update(`${BENCHMARK_TAG}:${namespace}:${n}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function summarizePlan(label, explainRows) {
  const document = explainRows[0]?.['QUERY PLAN']?.[0];
  if (document === undefined) throw new Error(`Missing JSON EXPLAIN output for ${label}.`);
  const nodeTypes = new Set();
  let sortNodes = 0;
  function visit(node) {
    nodeTypes.add(node['Node Type']);
    if (node['Node Type'] === 'Sort' || node['Node Type'] === 'Incremental Sort') sortNodes += 1;
    for (const child of node.Plans ?? []) visit(child);
  }
  visit(document.Plan);
  return {
    query: label,
    planningMs: document['Planning Time'],
    executionMs: document['Execution Time'],
    rows: document.Plan['Actual Rows'],
    loops: document.Plan['Actual Loops'],
    nodeTypes: [...nodeTypes],
    sortNodes,
    sharedHitBlocks: document.Plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: document.Plan['Shared Read Blocks'] ?? 0,
  };
}

console.log(
  `[benchmark-admin-metrics] seeding against disposable test database (tag ${BENCHMARK_TAG})`,
);

// `users.id` is `text` (Better-Auth-owned table, ADR 0008) even though the
// value is UUID-shaped, so it is inserted without a `::uuid` cast below —
// `workspaces`/`workspace_entitlements` are native `uuid` columns and do
// need the cast, since `sql.array()` of plain JS strings binds as `text[]`.
const userIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('user', i + 1));
const workspaceIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('workspace', i + 1));
const entitlementIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('entitlement', i + 1));

try {
  await sql.begin(async (tx) => {
    // Users: created_at staggered over the last 120 days so the 30-day
    // activity query has a realistic mix of in-window and out-of-window rows.
    await tx`
      insert into users (id, name, email, email_verified, created_at, updated_at)
      select
        ${sql.array(userIds)}[n],
        'Admin Benchmark User ' || n,
        ${BENCHMARK_TAG} || '-user-' || n || '@example.test',
        true,
        now() - (random() * interval '120 days'),
        now()
      from generate_series(1, ${USER_COUNT}) as n
    `;

    // Workspaces: one personal Workspace per user.
    await tx`
      insert into workspaces (id, name, slug, kind, personal_owner_user_id, onboarding_completed_at, created_at, updated_at)
      select
        ${sql.array(workspaceIds)}[n]::uuid,
        'Admin Benchmark Workspace ' || n,
        ${BENCHMARK_TAG} || '-workspace-' || n,
        'personal',
        ${sql.array(userIds)}[n],
        now(),
        now(), now()
      from generate_series(1, ${USER_COUNT}) as n
    `;

    // Entitlements: a realistic spread across every effective status,
    // every plan key (including "no plan" trials), and every source —
    // see the module comment in src/server/services/admin/metrics.ts for
    // the exact bucket semantics this mirrors.
    await tx`
      insert into workspace_entitlements (
        id, workspace_id, status, plan_key,
        trial_started_at, trial_ends_at,
        current_period_started_at, current_period_ends_at,
        cancel_at_period_end, billing_currency, billing_interval, source,
        created_at, updated_at
      )
      select
        ${sql.array(entitlementIds)}[n]::uuid,
        ${sql.array(workspaceIds)}[n]::uuid,
        case n % 10
          when 0 then 'trialing' when 1 then 'trialing'
          when 2 then 'trialing'
          when 3 then 'active' when 4 then 'active' when 5 then 'active' when 6 then 'active'
          when 7 then 'active'
          when 8 then 'active'
          else 'past_due'
        end,
        case when n % 10 in (3,4,5,6,7,8,9) then
          (case n % 3 when 0 then 'starter' when 1 then 'trader' else 'professional' end)
        else null end,
        case when n % 10 in (0,1,2) then now() - interval '3 days' else null end,
        case when n % 10 in (0,1) then now() + interval '4 days'
             when n % 10 = 2 then now() - interval '1 days'
             else null end,
        case when n % 10 in (3,4,5,6,7,8,9) then now() - interval '10 days' else null end,
        case when n % 10 in (3,4,5,6) then now() + interval '20 days'
             when n % 10 in (7,8) then now() - interval '2 days'
             else null end,
        case when n % 10 = 8 then true else false end,
        case when n % 10 in (3,4,5,6,7,8,9) then 'USD' else null end,
        case when n % 10 in (3,4,5,6,7,8,9) then 'monthly' else null end,
        case when n % 15 = 0 then 'complimentary'
             when n % 10 in (0,1,2) then 'trial'
             else 'paid' end,
        now(), now()
      from generate_series(1, ${USER_COUNT}) as n
    `;
  });
  console.log(`[benchmark-admin-metrics] seeded ${USER_COUNT} users/workspaces/entitlements`);

  // Trades: a subset of workspaces get a full framework (account/strategy/
  // setup) and a batch of Trades spread across the last 90 days — realistic
  // scale for the "trades logged" activity query without requiring a full
  // framework for all 5,000 workspaces.
  const frameworkWorkspaceIds = workspaceIds.slice(0, FRAMEWORK_WORKSPACE_COUNT);
  let tradeTotal = 0;
  for (const workspaceId of frameworkWorkspaceIds) {
    const accountId = uuidFrom('account', workspaceId);
    const strategyId = uuidFrom('strategy', workspaceId);
    const versionId = uuidFrom('version', workspaceId);
    const setupId = uuidFrom('setup', workspaceId);
    const setupVersionId = uuidFrom('setupversion', workspaceId);

    await sql.begin(async (tx) => {
      await tx`insert into trading_accounts
        (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone, is_archived, mutation_key, created_at, updated_at)
        values (${accountId}, ${workspaceId}, 'Benchmark Account', 'demo', 'USD', '10000', 'UTC', false, ${crypto.randomUUID()}, now(), now())`;
      await tx`insert into strategies (id, workspace_id, current_version_id, is_archived, mutation_key, created_at, updated_at)
        values (${strategyId}, ${workspaceId}, null, false, ${crypto.randomUUID()}, now(), now())`;
      await tx`insert into strategy_versions (id, workspace_id, strategy_id, version_number, name, created_at, updated_at)
        values (${versionId}, ${workspaceId}, ${strategyId}, 1, 'Benchmark Strategy', now(), now())`;
      await tx`update strategies set current_version_id = ${versionId} where id = ${strategyId}`;
      await tx`insert into setups (id, workspace_id, strategy_id, is_archived, mutation_key, created_at, updated_at)
        values (${setupId}, ${workspaceId}, ${strategyId}, false, ${crypto.randomUUID()}, now(), now())`;
      await tx`insert into strategy_setup_versions (id, workspace_id, strategy_id, strategy_version_id, setup_id, name, sort_order, created_at, updated_at)
        values (${setupVersionId}, ${workspaceId}, ${strategyId}, ${versionId}, ${setupId}, 'Benchmark Setup', 0, now(), now())`;

      await tx`
        insert into trades (
          id, workspace_id, mutation_key, trading_account_id, strategy_id,
          strategy_version_id, setup_id, setup_version_id, symbol, direction,
          planned_entry, planned_stop, planned_target, planned_r,
          status, created_at, updated_at
        )
        select
          (substr(md5(${workspaceId} || ':trade:' || n), 1, 8) || '-' ||
           substr(md5(${workspaceId} || ':trade:' || n), 9, 4) || '-' ||
           substr(md5(${workspaceId} || ':trade:' || n), 13, 4) || '-' ||
           substr(md5(${workspaceId} || ':trade:' || n), 17, 4) || '-' ||
           substr(md5(${workspaceId} || ':trade:' || n), 21, 12))::uuid,
          ${workspaceId}::uuid,
          (substr(md5(${workspaceId} || ':mutation:' || n), 1, 8) || '-' ||
           substr(md5(${workspaceId} || ':mutation:' || n), 9, 4) || '-' ||
           substr(md5(${workspaceId} || ':mutation:' || n), 13, 4) || '-' ||
           substr(md5(${workspaceId} || ':mutation:' || n), 17, 4) || '-' ||
           substr(md5(${workspaceId} || ':mutation:' || n), 21, 12))::uuid,
          ${accountId}::uuid, ${strategyId}::uuid, ${versionId}::uuid, ${setupId}::uuid, ${setupVersionId}::uuid,
          'EURUSD', 'long', '100', '99', '102', '2.0000',
          'planned',
          now() - (random() * interval '90 days'),
          now()
        from generate_series(1, ${TRADES_PER_FRAMEWORK_WORKSPACE}) as n
      `;
    });
    tradeTotal += TRADES_PER_FRAMEWORK_WORKSPACE;
  }
  console.log(
    `[benchmark-admin-metrics] seeded ${tradeTotal} trades across ${FRAMEWORK_WORKSPACE_COUNT} workspaces`,
  );

  const start = new Date(Date.now() - 29 * 86_400_000);
  const startOfDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const end = new Date(Date.now() + 86_400_000);
  const endOfDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  const plans = [];

  plans.push(
    summarizePlan(
      'total users (count)',
      await sql`explain (analyze, buffers, format json) select count(*) from users`,
    ),
  );
  plans.push(
    summarizePlan(
      'total workspaces (count)',
      await sql`explain (analyze, buffers, format json) select count(*) from workspaces`,
    ),
  );
  plans.push(
    summarizePlan(
      'entitlement population (full scan for effective-state resolution)',
      await sql`explain (analyze, buffers, format json)
        select workspace_id, status, plan_key, trial_started_at, trial_ends_at,
               current_period_started_at, current_period_ends_at, cancel_at_period_end,
               canceled_at, billing_currency, billing_interval, pending_plan_key,
               pending_plan_effective_at, source
        from workspace_entitlements`,
    ),
  );
  plans.push(
    summarizePlan(
      'new users 30D UTC (group by day)',
      await sql`explain (analyze, buffers, format json)
        select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as count
        from users
        where created_at >= ${startOfDay.toISOString()} and created_at < ${endOfDay.toISOString()}
        group by 1
        order by 1`,
    ),
  );
  plans.push(
    summarizePlan(
      'trades logged 30D UTC (group by day)',
      await sql`explain (analyze, buffers, format json)
        select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as count
        from trades
        where created_at >= ${startOfDay.toISOString()} and created_at < ${endOfDay.toISOString()}
        group by 1
        order by 1`,
    ),
  );

  console.log('\n[benchmark-admin-metrics] EXPLAIN (ANALYZE, BUFFERS) summary:\n');
  for (const plan of plans) {
    console.log(
      `- ${plan.query}\n` +
        `    planning=${plan.planningMs?.toFixed(2)}ms execution=${plan.executionMs?.toFixed(2)}ms ` +
        `rows=${plan.rows} loops=${plan.loops} sortNodes=${plan.sortNodes}\n` +
        `    nodeTypes=[${plan.nodeTypes.join(', ')}] sharedHit=${plan.sharedHitBlocks} sharedRead=${plan.sharedReadBlocks}`,
    );
  }
} finally {
  console.log('\n[benchmark-admin-metrics] cleaning up seeded rows...');
  // Cascades: workspaces -> workspace_entitlements/trading_accounts/strategies/
  // setups/strategy_versions/strategy_setup_versions/trades (all workspace_id
  // FKs are ON DELETE CASCADE for these tables per their own migrations).
  await sql`delete from workspaces where slug like ${BENCHMARK_TAG + '-workspace-%'}`;
  await sql`delete from users where email like ${BENCHMARK_TAG + '-user-%'}`;
  await sql.end();
  console.log('[benchmark-admin-metrics] done — no residual rows.');
}
