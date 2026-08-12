#!/usr/bin/env node
/**
 * Phase 11E guarded benchmark — seeds a representative-scale
 * `admin_audit_log` dataset into the disposable TEST database, runs
 * `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against every material Admin
 * Audit list query plus the two in-transaction mutation lock queries, and
 * prints a structural summary (no PII, no secrets).
 *
 * ZERO PERMANENT RESIDUE, by construction: `admin_audit_log` is append-only
 * at the DATABASE level (migration 0009's `admin_audit_log_protect_delete_
 * trigger` unconditionally rejects every DELETE, with no bypass) — an
 * earlier version of this script accepted its seeded audit rows, admin
 * grants, and their owning users as a small permanent addition to the TEST
 * database for exactly that reason. That is no longer necessary: every
 * insert this script performs — background users/workspaces AND the
 * admin_audit_log/platform_admins/admin-user rows — happens inside a single
 * database transaction that is deliberately ROLLED BACK once every EXPLAIN
 * has run, never committed. A rollback undoes inserts without ever issuing
 * a DELETE, so the append-only trigger is never exercised and never needs a
 * bypass. `EXPLAIN (ANALYZE, ...)` still genuinely EXECUTES each query
 * against the real seeded rows and reports real timings — that execution is
 * valid mid-transaction; only the query PLANNER's row-count estimates
 * depend on catalog statistics, which is why this script explicitly runs
 * `ANALYZE` on the affected tables (itself transactional and visible only
 * within this same transaction) before generating any plan, rather than
 * relying on autovacuum's asynchronous, uncoordinated timing.
 */
import crypto from 'node:crypto';

import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

const { testUrl } = validateTestDatabaseEnvironment();
const sql = postgres(testUrl, { max: 5 });

const USER_COUNT = 5000;
const ADMIN_COUNT = 10;
const AUDIT_ROW_COUNT = 2000;
const BENCHMARK_TAG = `admin-audit-bench-${crypto.randomUUID()}`;

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

/** Thrown deliberately at the end of the seeded transaction to force a rollback that is NOT an error. */
class BenchmarkComplete extends Error {
  constructor(plans) {
    super('benchmark measurements complete — forcing rollback, not a real failure');
    this.plans = plans;
  }
}

console.log(
  `[benchmark-admin-audit] seeding inside a disposable transaction (tag ${BENCHMARK_TAG})`,
);

const userIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('user', i + 1));
const workspaceIds = Array.from({ length: USER_COUNT }, (_, i) => uuidFrom('workspace', i + 1));
const adminUserIds = Array.from({ length: ADMIN_COUNT }, (_, i) => uuidFrom('adminuser', i + 1));
const adminGrantIds = Array.from({ length: ADMIN_COUNT }, (_, i) => uuidFrom('admingrant', i + 1));
const auditIds = Array.from({ length: AUDIT_ROW_COUNT }, (_, i) => uuidFrom('audit', i + 1));

const ACTIONS = [
  'subscription.trial_extended',
  'subscription.complimentary_granted',
  'subscription.complimentary_revoked',
  'platform_admin.granted',
  'platform_admin.revoked',
];
const REASONS = [
  'trial_extension_goodwill',
  'complimentary_access',
  'access_revoke',
  'support_adjustment',
  'other',
];

let plans;
try {
  await sql.begin(async (tx) => {
    await tx`
      insert into users (id, name, email, email_verified, created_at, updated_at)
      select
        ${sql.array(userIds)}[n],
        'Admin Audit Benchmark User ' || n,
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
        'Admin Audit Benchmark Workspace ' || n,
        ${BENCHMARK_TAG} || '-workspace-' || n,
        'personal',
        ${sql.array(userIds)}[n],
        now(), now(), now()
      from generate_series(1, ${USER_COUNT}) as n
    `;
    await tx`
      insert into users (id, name, email, email_verified, created_at, updated_at)
      select
        ${sql.array(adminUserIds)}[n],
        'Admin Audit Benchmark Admin ' || n,
        ${BENCHMARK_TAG} || '-admin-' || n || '@example.test',
        true, now(), now()
      from generate_series(1, ${ADMIN_COUNT}) as n
    `;
    await tx`
      insert into platform_admins (id, user_id, granted_at)
      select
        ${sql.array(adminGrantIds)}[n]::uuid,
        ${sql.array(adminUserIds)}[n],
        now()
      from generate_series(1, ${ADMIN_COUNT}) as n
    `;
    console.log(
      `[benchmark-admin-audit] seeded ${USER_COUNT} users/workspaces and ${ADMIN_COUNT} platform admins (uncommitted)`,
    );

    const BATCH_SIZE = 1000;
    let inserted = 0;
    for (let start = 0; start < AUDIT_ROW_COUNT; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE, AUDIT_ROW_COUNT);
      const batchIds = auditIds.slice(start, end);
      const batchWorkspaceIds = workspaceIds.slice(start, end);
      const batchUserIds = userIds.slice(start, end);
      const batchAdminGrantIds = Array.from(
        { length: end - start },
        (_, i) => adminGrantIds[(start + i) % ADMIN_COUNT],
      );
      const batchActions = Array.from(
        { length: end - start },
        (_, i) => ACTIONS[(start + i) % ACTIONS.length],
      );
      const batchReasons = Array.from(
        { length: end - start },
        (_, i) => REASONS[(start + i) % REASONS.length],
      );
      await tx`
        insert into admin_audit_log (
          id, actor_kind, actor_admin_id, action, subject_user_id, subject_workspace_id,
          reason_code, before_state, after_state, created_at
        )
        select
          ${sql.array(batchIds)}[n]::uuid,
          'platform_admin',
          ${sql.array(batchAdminGrantIds)}[n]::uuid,
          ${sql.array(batchActions)}[n],
          ${sql.array(batchUserIds)}[n],
          ${sql.array(batchWorkspaceIds)}[n]::uuid,
          ${sql.array(batchReasons)}[n],
          '{"status":"trialing","source":"trial"}'::jsonb,
          '{"status":"active","source":"complimentary","planKey":"starter"}'::jsonb,
          now() - (random() * interval '90 days')
        from generate_series(1, ${end - start}) as n
      `;
      inserted += end - start;
    }
    console.log(`[benchmark-admin-audit] seeded ${inserted} admin_audit_log rows (uncommitted)`);

    // Refresh planner statistics for the freshly (uncommitted) seeded rows —
    // ANALYZE is itself transactional, so this is visible only within this
    // same transaction and never persists past the rollback below.
    await tx`analyze admin_audit_log`;
    await tx`analyze platform_admins`;
    await tx`analyze users`;
    await tx`analyze workspaces`;

    const sampleWorkspaceId = workspaceIds[0];
    const sampleUserId = userIds[0];
    const sampleAdminUserId = adminUserIds[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const localPlans = [];

    localPlans.push(
      summarizePlan(
        'Audit: first page (no filter, newest first)',
        await tx`explain (analyze, buffers, format json)
          select id, actor_kind, actor_admin_id, action, subject_user_id, subject_workspace_id,
                 reason_code, reason_note, before_state, after_state, created_at
          from admin_audit_log
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Audit: filter by action',
        await tx`explain (analyze, buffers, format json)
          select id, action, created_at from admin_audit_log
          where action = 'subscription.trial_extended'
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Audit: filter by reason_code',
        await tx`explain (analyze, buffers, format json)
          select id, reason_code, created_at from admin_audit_log
          where reason_code = 'complimentary_access'
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Audit: filter by subject_workspace_id (exact)',
        await tx`explain (analyze, buffers, format json)
          select id, created_at from admin_audit_log
          where subject_workspace_id = ${sampleWorkspaceId}::uuid
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Audit: filter by subject_user_id (exact)',
        await tx`explain (analyze, buffers, format json)
          select id, created_at from admin_audit_log
          where subject_user_id = ${sampleUserId}
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Audit: filter by actor (subquery on platform_admins by user_id)',
        await tx`explain (analyze, buffers, format json)
          select id, created_at from admin_audit_log
          where actor_admin_id in (select id from platform_admins where user_id = ${sampleAdminUserId})
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Audit: combined action + 30d date-preset filter',
        await tx`explain (analyze, buffers, format json)
          select id, created_at from admin_audit_log
          where action = 'subscription.complimentary_granted' and created_at >= ${thirtyDaysAgo}
          order by created_at desc, id desc
          limit 26`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Mutation lock: platform_admins active-grant row lock (FOR UPDATE)',
        await tx`explain (analyze, buffers, format json)
          select id from platform_admins where user_id = ${sampleAdminUserId} and revoked_at is null for update`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Mutation lock: workspace_entitlements row lock (FOR UPDATE)',
        await tx`explain (analyze, buffers, format json)
          select * from workspace_entitlements where workspace_id = ${sampleWorkspaceId}::uuid for update`,
      ),
    );

    // Force a rollback: every insert above (including the append-only
    // admin_audit_log rows) is undone without ever issuing a DELETE.
    throw new BenchmarkComplete(localPlans);
  });
} catch (error) {
  if (!(error instanceof BenchmarkComplete)) throw error;
  plans = error.plans;
}

console.log('\n[benchmark-admin-audit] EXPLAIN (ANALYZE, BUFFERS) summary:\n');
for (const plan of plans) {
  console.log(
    `- ${plan.query}\n` +
      `    planning=${plan.planningMs?.toFixed(2)}ms execution=${plan.executionMs?.toFixed(2)}ms ` +
      `rows=${plan.rows} loops=${plan.loops} sortNodes=${plan.sortNodes}\n` +
      `    nodeTypes=[${plan.nodeTypes.join(', ')}] sharedHit=${plan.sharedHitBlocks} sharedRead=${plan.sharedReadBlocks}`,
  );
}

console.log('\n[benchmark-admin-audit] verifying zero permanent residue after rollback...');
const [{ count: residualUsers }] = await sql`
  select count(*)::int as count from users where email like ${BENCHMARK_TAG + '%'}
`;
const [{ count: residualWorkspaces }] = await sql`
  select count(*)::int as count from workspaces where slug like ${BENCHMARK_TAG + '%'}
`;
const [{ count: residualAdminGrants }] = await sql`
  select count(*)::int as count from platform_admins where id = any(${sql.array(adminGrantIds)}::uuid[])
`;
const [{ count: residualAuditRows }] = await sql`
  select count(*)::int as count from admin_audit_log where id = any(${sql.array(auditIds)}::uuid[])
`;
console.log(
  `[benchmark-admin-audit] residual rows — users=${residualUsers} workspaces=${residualWorkspaces} ` +
    `platform_admins=${residualAdminGrants} admin_audit_log=${residualAuditRows}`,
);
if (
  residualUsers !== 0 ||
  residualWorkspaces !== 0 ||
  residualAdminGrants !== 0 ||
  residualAuditRows !== 0
) {
  await sql.end();
  throw new Error(
    'Benchmark left permanent residue behind — the seeding transaction did not fully roll back.',
  );
}
console.log(
  '[benchmark-admin-audit] confirmed zero permanent residue — the seeded transaction never committed.',
);

await sql.end();
