#!/usr/bin/env node
/**
 * Phase 11D guarded benchmark — seeds a representative-scale dataset
 * (~5,000 users, ~5,000 personal Workspaces/entitlements/owner memberships,
 * ~5,000 auth-provider rows, ~300 Workspaces with a full trading framework
 * plus Trades and billing history) into the disposable TEST database only,
 * runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against every material
 * User/Workspace oversight query (list, search, filter, detail composite),
 * prints a structural summary (no PII, no secrets), and cleans up every row
 * it inserted before exiting.
 *
 * Modeled directly on `scripts/benchmark-admin-metrics.mjs`'s own pattern —
 * same safety posture, same reporting shape, same "no migration unless
 * measured evidence" policy this repeats for Phase 11D's own new queries.
 */
import crypto from 'node:crypto';

import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

const { testUrl } = validateTestDatabaseEnvironment();
const sql = postgres(testUrl, { max: 5 });

const USER_COUNT = 5000;
const FRAMEWORK_WORKSPACE_COUNT = 300;
const TRADES_PER_FRAMEWORK_WORKSPACE = 60;
const BENCHMARK_TAG = `admin-oversight-bench-${crypto.randomUUID()}`;

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
  `[benchmark-admin-oversight] seeding against disposable test database (tag ${BENCHMARK_TAG})`,
);

const userIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('user', i + 1));
const workspaceIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('workspace', i + 1));
const entitlementIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('entitlement', i + 1));
const membershipIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('membership', i + 1));
const accountRowIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('authaccount', i + 1));

try {
  await sql.begin(async (tx) => {
    await tx`
      insert into users (id, name, email, email_verified, created_at, updated_at)
      select
        ${sql.array(userIds)}[n],
        'Admin Oversight Benchmark User ' || n,
        ${BENCHMARK_TAG} || '-user-' || n || '@example.test',
        true,
        now() - (random() * interval '120 days'),
        now()
      from generate_series(1, ${USER_COUNT}) as n
    `;

    await tx`
      insert into workspaces (id, name, slug, kind, personal_owner_user_id, onboarding_completed_at, created_at, updated_at)
      select
        ${sql.array(workspaceIds)}[n]::uuid,
        'Admin Oversight Benchmark Workspace ' || n,
        ${BENCHMARK_TAG} || '-workspace-' || n,
        'personal',
        ${sql.array(userIds)}[n],
        now(),
        now(), now()
      from generate_series(1, ${USER_COUNT}) as n
    `;

    // Every user owns their personal Workspace — the realistic shape
    // `listOwnersForWorkspaces`/`listActiveMembershipsForUsers` scan.
    await tx`
      insert into workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at)
      select
        ${sql.array(membershipIds)}[n]::uuid,
        ${sql.array(workspaceIds)}[n]::uuid,
        ${sql.array(userIds)}[n],
        'owner', 'active', now(), now()
      from generate_series(1, ${USER_COUNT}) as n
    `;

    // A realistic sign-in-method mix for `listProvidersForUsers`.
    await tx`
      insert into accounts (id, user_id, account_id, provider_id, created_at, updated_at)
      select
        ${sql.array(accountRowIds)}[n]::text,
        ${sql.array(userIds)}[n],
        ${BENCHMARK_TAG} || '-account-' || n,
        case n % 3 when 0 then 'credential' when 1 then 'google' else 'credential' end,
        now(), now()
      from generate_series(1, ${USER_COUNT}) as n
    `;

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
          when 0 then 'trialing' when 1 then 'trialing' when 2 then 'trialing'
          when 3 then 'active' when 4 then 'active' when 5 then 'active' when 6 then 'active'
          when 7 then 'active' when 8 then 'active'
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
  console.log(
    `[benchmark-admin-oversight] seeded ${USER_COUNT} users/workspaces/entitlements/memberships/accounts`,
  );

  const frameworkWorkspaceIds = workspaceIds.slice(0, FRAMEWORK_WORKSPACE_COUNT);
  let tradeTotal = 0;
  for (const workspaceId of frameworkWorkspaceIds) {
    const accountId = uuidFrom('tradingaccount', workspaceId);
    const strategyId = uuidFrom('strategy', workspaceId);
    const versionId = uuidFrom('version', workspaceId);
    const setupId = uuidFrom('setup', workspaceId);
    const setupVersionId = uuidFrom('setupversion', workspaceId);
    const billingTxId = uuidFrom('billingtx', workspaceId);

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

      await tx`insert into billing_transactions
        (id, workspace_id, idempotency_key, plan_key, billing_currency, billing_interval,
         subtotal_minor, vat_enabled, applied_vat_rate_basis_points, vat_amount_minor, total_minor,
         tax_mode, status, created_at, updated_at, completed_at)
        values (${billingTxId}::uuid, ${workspaceId}::uuid, ${crypto.randomUUID()}::uuid, 'starter', 'USD', 'monthly',
                500, false, 0, 0, 500, 'disabled', 'succeeded', now(), now(), now())`;
    });
    tradeTotal += TRADES_PER_FRAMEWORK_WORKSPACE;
  }
  console.log(
    `[benchmark-admin-oversight] seeded ${tradeTotal} trades + billing history across ${FRAMEWORK_WORKSPACE_COUNT} workspaces`,
  );

  const sampleUserId = userIds[0];
  const sampleWorkspaceId = workspaceIds[0];
  const searchPattern = `Admin Oversight Benchmark User 12%`;
  const workspaceSearchPattern = `Admin Oversight Benchmark Workspace 12%`;

  const plans = [];

  plans.push(
    summarizePlan(
      'Users: first page (no filter)',
      await sql`explain (analyze, buffers, format json)
        select id as user_id, name, email, email_verified, created_at
        from users
        order by created_at desc, id desc
        limit 26`,
    ),
  );
  plans.push(
    summarizePlan(
      'Users: exact ID lookup',
      await sql`explain (analyze, buffers, format json)
        select id as user_id, name, email, email_verified, created_at
        from users
        where id = ${sampleUserId}
        order by created_at desc, id desc
        limit 26`,
    ),
  );
  plans.push(
    summarizePlan(
      'Users: name/email prefix search',
      await sql`explain (analyze, buffers, format json)
        select id as user_id, name, email, email_verified, created_at
        from users
        where (email ilike ${searchPattern} escape '\\' or name ilike ${searchPattern} escape '\\')
        order by created_at desc, id desc
        limit 26`,
    ),
  );
  plans.push(
    summarizePlan(
      'Workspaces: first page (no filter, left join entitlements)',
      await sql`explain (analyze, buffers, format json)
        select w.id as workspace_id, w.name, w.created_at
        from workspaces w
        left join workspace_entitlements we on we.workspace_id = w.id
        order by w.created_at desc, w.id desc
        limit 26`,
    ),
  );
  plans.push(
    summarizePlan(
      'Workspaces: name prefix search',
      await sql`explain (analyze, buffers, format json)
        select w.id as workspace_id, w.name, w.created_at
        from workspaces w
        left join workspace_entitlements we on we.workspace_id = w.id
        where w.name ilike ${workspaceSearchPattern} escape '\\'
        order by w.created_at desc, w.id desc
        limit 26`,
    ),
  );
  plans.push(
    summarizePlan(
      'Workspaces: combined plan+source filter',
      await sql`explain (analyze, buffers, format json)
        select w.id as workspace_id, w.name, w.created_at
        from workspaces w
        left join workspace_entitlements we on we.workspace_id = w.id
        where we.plan_key = 'professional' and we.source = 'paid'
        order by w.created_at desc, w.id desc
        limit 26`,
    ),
  );
  plans.push(
    summarizePlan(
      'User detail: active memberships for one user',
      await sql`explain (analyze, buffers, format json)
        select workspace_id, user_id, role
        from workspace_members
        where user_id = ${sampleUserId} and status = 'active'`,
    ),
  );
  plans.push(
    summarizePlan(
      'Workspace detail: owners for one workspace',
      await sql`explain (analyze, buffers, format json)
        select wm.workspace_id, u.id as user_id, u.name, u.email
        from workspace_members wm
        join users u on u.id = wm.user_id
        where wm.workspace_id = ${sampleWorkspaceId}::uuid and wm.role = 'owner' and wm.status = 'active'`,
    ),
  );
  plans.push(
    summarizePlan(
      'Workspace detail: trading-account active/archived counts',
      await sql`explain (analyze, buffers, format json)
        select workspace_id,
               count(*) filter (where not is_archived)::int as active,
               count(*) filter (where is_archived)::int as archived
        from trading_accounts
        where workspace_id = ${frameworkWorkspaceIds[0]}::uuid
        group by workspace_id`,
    ),
  );
  plans.push(
    summarizePlan(
      'Workspace detail: latest billing transaction',
      await sql`explain (analyze, buffers, format json)
        select id, plan_key, billing_currency, billing_interval, subtotal_minor,
               vat_enabled, applied_vat_rate_basis_points, vat_amount_minor, total_minor,
               status, created_at, completed_at, failed_at
        from billing_transactions
        where workspace_id = ${frameworkWorkspaceIds[0]}::uuid
        order by created_at desc, id desc
        limit 1`,
    ),
  );

  console.log('\n[benchmark-admin-oversight] EXPLAIN (ANALYZE, BUFFERS) summary:\n');
  for (const plan of plans) {
    console.log(
      `- ${plan.query}\n` +
        `    planning=${plan.planningMs?.toFixed(2)}ms execution=${plan.executionMs?.toFixed(2)}ms ` +
        `rows=${plan.rows} loops=${plan.loops} sortNodes=${plan.sortNodes}\n` +
        `    nodeTypes=[${plan.nodeTypes.join(', ')}] sharedHit=${plan.sharedHitBlocks} sharedRead=${plan.sharedReadBlocks}`,
    );
  }
} finally {
  console.log('\n[benchmark-admin-oversight] cleaning up seeded rows...');
  // `billing_transactions.workspace_id` is RESTRICT (immutable financial
  // history) — must be cleared before the workspace cascade delete.
  await sql`delete from billing_transactions where workspace_id in (
    select id from workspaces where slug like ${BENCHMARK_TAG + '-workspace-%'}
  )`;
  await sql`delete from workspaces where slug like ${BENCHMARK_TAG + '-workspace-%'}`;
  await sql`delete from users where email like ${BENCHMARK_TAG + '-user-%'}`;
  await sql.end();
  console.log('[benchmark-admin-oversight] done — no residual rows.');
}
