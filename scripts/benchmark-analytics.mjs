import crypto from 'node:crypto';

import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

const { testUrl } = validateTestDatabaseEnvironment(process.env);
const sql = postgres(testUrl, { max: 1, prepare: false });
const id = () => crypto.randomUUID();

const workspaceId = id();
const userId = id();
const accountIds = [id(), id(), id()];
const strategyIds = [id(), id(), id()];
const versionIds = [id(), id(), id()];
const setupIds = [id(), id(), id()];
const setupVersionIds = [id(), id(), id()];
const ruleIds = [id(), id(), id()];
const ruleKeys = [id(), id(), id()];

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

try {
  await sql.begin(async (tx) => {
    await tx`insert into users (id, name, email, email_verified, created_at, updated_at)
      values (${userId}, 'Analytics benchmark', ${`analytics-benchmark-${userId}@example.test`}, true, now(), now())`;
    await tx`insert into workspaces (id, name, slug, kind, created_at, updated_at)
      values (${workspaceId}, 'Analytics benchmark', ${`analytics-benchmark-${workspaceId}`}, 'personal', now(), now())`;
    await tx`insert into workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at)
      values (${id()}, ${workspaceId}, ${userId}, 'owner', 'active', now(), now())`;
    for (let index = 0; index < accountIds.length; index += 1) {
      await tx`insert into trading_accounts
        (id, workspace_id, name, account_mode, base_currency, starting_balance, timezone, is_archived, mutation_key, created_at, updated_at)
        values (${accountIds[index]}, ${workspaceId}, ${`Benchmark Account ${index + 1}`}, 'demo', 'USD', '10000', 'America/New_York', ${index === 2}, ${id()}, now(), now())`;
    }
    await tx`insert into user_preferences
      (user_id, active_workspace_id, active_trading_account_id, locale, theme, timezone, created_at, updated_at)
      values (${userId}, ${workspaceId}, ${accountIds[0]}, 'en', 'system', 'America/New_York', now(), now())`;

    for (let index = 0; index < strategyIds.length; index += 1) {
      await tx`insert into strategies
        (id, workspace_id, current_version_id, is_archived, mutation_key, created_at, updated_at)
        values (${strategyIds[index]}, ${workspaceId}, null, ${index === 2}, ${id()}, now(), now())`;
      await tx`insert into strategy_versions
        (id, workspace_id, strategy_id, version_number, name, created_at, updated_at)
        values (${versionIds[index]}, ${workspaceId}, ${strategyIds[index]}, ${index + 1}, ${`Benchmark Strategy ${index + 1}`}, now(), now())`;
      await tx`update strategies set current_version_id = ${versionIds[index]} where id = ${strategyIds[index]}`;
      await tx`insert into setups
        (id, workspace_id, strategy_id, is_archived, mutation_key, created_at, updated_at)
        values (${setupIds[index]}, ${workspaceId}, ${strategyIds[index]}, ${index === 2}, ${id()}, now(), now())`;
      await tx`insert into strategy_setup_versions
        (id, workspace_id, strategy_id, strategy_version_id, setup_id, name, sort_order, created_at, updated_at)
        values (${setupVersionIds[index]}, ${workspaceId}, ${strategyIds[index]}, ${versionIds[index]}, ${setupIds[index]}, ${`Benchmark Setup ${index + 1}`}, 0, now(), now())`;
      await tx`insert into strategy_rules
        (id, workspace_id, strategy_version_id, setup_version_id, rule_key, category, title, is_required, is_pre_trade_check, sort_order, created_at, updated_at)
        values (${ruleIds[index]}, ${workspaceId}, ${versionIds[index]}, null, ${ruleKeys[index]}, 'entry', ${`Benchmark Rule ${index + 1}`}, true, true, 0, now(), now())`;
    }

    await tx`
      insert into trades (
        id, workspace_id, mutation_key, trading_account_id, strategy_id,
        strategy_version_id, setup_id, setup_version_id, symbol, direction,
        planned_entry, planned_stop, planned_target, planned_r,
        actual_entry, actual_initial_stop, actual_exit, actual_initial_risk_minor,
        net_pnl_minor, entered_at, exited_at, actual_r, trader_outcome,
        system_status, system_exit_price, system_exited_at, system_exit_reason,
        system_resolved_at, system_r, system_outcome, status, deleted_at,
        created_at, updated_at
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
        case n % 3 when 0 then ${accountIds[0]}::uuid when 1 then ${accountIds[1]}::uuid else ${accountIds[2]}::uuid end,
        case n % 3 when 0 then ${strategyIds[0]}::uuid when 1 then ${strategyIds[1]}::uuid else ${strategyIds[2]}::uuid end,
        case n % 3 when 0 then ${versionIds[0]}::uuid when 1 then ${versionIds[1]}::uuid else ${versionIds[2]}::uuid end,
        case n % 3 when 0 then ${setupIds[0]}::uuid when 1 then ${setupIds[1]}::uuid else ${setupIds[2]}::uuid end,
        case n % 3 when 0 then ${setupVersionIds[0]}::uuid when 1 then ${setupVersionIds[1]}::uuid else ${setupVersionIds[2]}::uuid end,
        case n % 5 when 0 then 'EURUSD' when 1 then 'XAUUSD' when 2 then 'USDJPY' when 3 then 'NAS100' else 'BTCUSD' end,
        case n % 2 when 0 then 'long' else 'short' end,
        '100',
        case n % 2 when 0 then '99'::numeric else '101'::numeric end,
        case n % 2 when 0 then '102'::numeric else '98'::numeric end,
        '2.0000',
        case when n % 10 < 8 then '100'::numeric else null end,
        case when n % 10 < 8 then case n % 2 when 0 then '99'::numeric else '101'::numeric end else null end,
        case when n % 10 < 7 then case n % 2 when 0 then '101'::numeric else '99'::numeric end else null end,
        case when n % 10 < 8 then 100::bigint else null end,
        case when n % 10 < 7 then (case n % 3 when 0 then 150 when 1 then -100 else 0 end)::bigint else null end,
        case when n % 10 < 8 then ('2025-08-01T12:00:00Z'::timestamptz + (n % 365) * interval '1 day') else null end,
        case when n % 10 < 7 then ('2025-08-01T14:00:00Z'::timestamptz + (n % 365) * interval '1 day') else null end,
        case when n % 10 < 7 then case n % 3 when 0 then '1.5000' when 1 then '-1.0000' else '0.0000' end::numeric else null end,
        case when n % 10 < 7 then case n % 3 when 0 then 'win' when 1 then 'loss' else 'break_even' end else null end,
        case when n % 20 < 12 then 'resolved' when n % 20 < 17 then 'pending' else 'no_trade' end,
        case when n % 20 < 12 then case n % 2 when 0 then '102'::numeric else '98'::numeric end else null end,
        case when n % 20 < 12 then ('2025-08-01T16:00:00Z'::timestamptz + (n % 365) * interval '1 day') else null end,
        case when n % 20 < 12 then 'target_hit' when n % 20 >= 17 then 'setup_invalidated' else null end,
        case when n % 20 < 12 or n % 20 >= 17 then ('2025-08-02T00:00:00Z'::timestamptz + (n % 365) * interval '1 day') else null end,
        case when n % 20 < 12 then case n % 3 when 0 then '2.0000' when 1 then '-1.0000' else '0.0300' end::numeric else null end,
        case when n % 20 < 12 then case n % 3 when 0 then 'win' when 1 then 'loss' else 'break_even' end else null end,
        case when n % 10 < 7 then 'closed' when n % 10 = 7 then 'open' when n % 10 = 8 then 'planned' else 'canceled' end,
        case when n % 20 = 0 then now() else null end,
        now() - (5000 - n) * interval '1 minute', now()
      from generate_series(1, 5000) as series(n)
    `;

    await tx`
      insert into trade_rule_checks
        (id, workspace_id, trade_id, strategy_rule_id, strategy_version_id,
         rule_key, check_status, title, category, is_required,
         is_pre_trade_check, sort_order, created_at, updated_at)
      select gen_random_uuid(), t.workspace_id, t.id, r.id, t.strategy_version_id,
        r.rule_key,
        case row_number() over (order by t.id) % 4
          when 0 then 'followed' when 1 then 'violated'
          when 2 then 'not_checked' else 'not_applicable' end,
        r.title, r.category, r.is_required, r.is_pre_trade_check, r.sort_order, now(), now()
      from trades t
      join strategy_rules r on r.strategy_version_id = t.strategy_version_id
      where t.workspace_id = ${workspaceId} and t.status = 'closed'
    `;

    await tx`
      with ranked_trades as (
        select id, workspace_id, row_number() over (order by id) as rn
        from trades
        where workspace_id = ${workspaceId} and status = 'closed' and deleted_at is null
      ), ranked_mistakes as (
        select id, severity, default_weight,
          row_number() over (order by sort_order, key) as rn,
          count(*) over () as total
        from mistake_types where is_system
      )
      insert into trade_mistakes
        (trade_id, mistake_type_id, workspace_id, severity_at_time, weight_at_time, created_at, updated_at)
      select t.id, m.id, t.workspace_id, m.severity, m.default_weight, now(), now()
      from ranked_trades t
      join ranked_mistakes m on m.rn = ((t.rn - 1) % m.total) + 1
      where t.rn % 3 = 0
    `;
  });

  const start = new Date('2026-05-12T04:00:00.000Z');
  const end = new Date('2026-08-10T04:00:00.000Z');
  const plans = [];

  plans.push(
    summarizePlan(
      'active-account 90D Trader',
      await sql`explain (analyze, buffers, format json)
        select id, actual_r, trader_outcome, exited_at
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountIds[0]}
          and deleted_at is null and status = 'closed'
          and actual_r is not null and trader_outcome is not null
          and exited_at >= ${start} and exited_at < ${end}
        order by exited_at, id`,
    ),
  );
  plans.push(
    summarizePlan(
      'active-account 90D System',
      await sql`explain (analyze, buffers, format json)
        select id, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountIds[0]}
          and deleted_at is null and system_status = 'resolved'
          and system_r is not null and system_outcome is not null
          and system_exited_at >= ${start} and system_exited_at < ${end}
        order by system_exited_at, id`,
    ),
  );
  plans.push(
    summarizePlan(
      'paired 90D',
      await sql`explain (analyze, buffers, format json)
        select id, actual_r, system_r, exited_at, system_exited_at
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountIds[0]}
          and deleted_at is null and status = 'closed' and system_status = 'resolved'
          and actual_r is not null and system_r is not null
          and exited_at >= ${start} and exited_at < ${end}
          and system_exited_at >= ${start} and system_exited_at < ${end}
        order by exited_at, id`,
    ),
  );
  plans.push(
    summarizePlan(
      'all-accounts all-time System',
      await sql`explain (analyze, buffers, format json)
        select id, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId} and deleted_at is null
          and system_status = 'resolved' and system_r is not null
          and system_outcome is not null and system_exited_at is not null
        order by system_exited_at, id`,
    ),
  );
  plans.push(
    summarizePlan(
      'Strategy + Setup Trader',
      await sql`explain (analyze, buffers, format json)
        select id, actual_r, trader_outcome, exited_at
        from trades
        where workspace_id = ${workspaceId} and strategy_id = ${strategyIds[0]}
          and setup_id = ${setupIds[0]} and deleted_at is null and status = 'closed'
          and actual_r is not null and trader_outcome is not null
        order by exited_at, id`,
    ),
  );
  plans.push(
    summarizePlan(
      'Strategy Version System',
      await sql`explain (analyze, buffers, format json)
        select id, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId} and strategy_version_id = ${versionIds[0]}
          and deleted_at is null and system_status = 'resolved'
          and system_r is not null and system_outcome is not null
        order by system_exited_at, id`,
    ),
  );
  plans.push(
    summarizePlan(
      'Rule analytics join',
      await sql`explain (analyze, buffers, format json)
        select rc.trade_id, rc.rule_key, rc.check_status, rc.category,
          rc.is_required, rc.is_pre_trade_check
        from trade_rule_checks rc
        join trades t on t.id = rc.trade_id
        where t.workspace_id = ${workspaceId} and t.deleted_at is null
          and t.status = 'closed' and t.exited_at >= ${start} and t.exited_at < ${end}
        order by t.exited_at, t.id, rc.sort_order`,
    ),
  );
  plans.push(
    summarizePlan(
      'Mistake analytics join',
      await sql`explain (analyze, buffers, format json)
        select tm.trade_id, tm.mistake_type_id, mt.key, mt.label
        from trade_mistakes tm
        join trades t on t.id = tm.trade_id
        join mistake_types mt on mt.id = tm.mistake_type_id
        where t.workspace_id = ${workspaceId} and t.deleted_at is null
          and t.status = 'closed' and t.exited_at >= ${start} and t.exited_at < ${end}
          and mt.is_system
        order by t.exited_at, t.id, mt.sort_order`,
    ),
  );

  process.stdout.write(`${JSON.stringify({ fixtureTrades: 5000, plans }, null, 2)}\n`);
} finally {
  try {
    await sql`delete from workspaces where id = ${workspaceId}`;
    await sql`delete from users where id = ${userId}`;
  } finally {
    await sql.end();
  }
}
