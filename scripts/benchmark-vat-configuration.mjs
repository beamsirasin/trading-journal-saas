#!/usr/bin/env node
/**
 * Phase 11F guarded benchmark — seeds a representative-scale
 * `platform_vat_configuration` change history into the disposable TEST
 * database, runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` against the
 * effective-configuration lookup (`getEffectivePlatformVatConfiguration`'s
 * own query) and the bounded "recent history" read (`/admin/vat`'s), and
 * prints a structural summary (no PII, no secrets).
 *
 * ZERO PERMANENT RESIDUE, following `scripts/benchmark-admin-audit.mjs`'s
 * own established Phase 11E pattern: every insert happens inside one
 * transaction that is deliberately rolled back once every EXPLAIN has run,
 * never committed — `platform_vat_configuration` is functionally
 * append-only (no application code path ever deletes from it), so this
 * script never issues a DELETE either way.
 */
import crypto from 'node:crypto';

import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from './test-database-safety.mjs';

const { testUrl } = validateTestDatabaseEnvironment();
const sql = postgres(testUrl, { max: 5, onnotice: () => {} });

const HISTORY_ROW_COUNT = 1000;
const BENCHMARK_TAG = `vat-config-bench-${crypto.randomUUID()}`;

function uuidFrom(n) {
  const hash = crypto.createHash('md5').update(`${BENCHMARK_TAG}:${n}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function summarizePlan(label, explainRows) {
  const document = explainRows[0]?.['QUERY PLAN']?.[0];
  if (document === undefined) throw new Error(`Missing JSON EXPLAIN output for ${label}.`);
  const nodeTypes = new Set();
  function visit(node) {
    nodeTypes.add(node['Node Type']);
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
    sharedHitBlocks: document.Plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: document.Plan['Shared Read Blocks'] ?? 0,
  };
}

class BenchmarkComplete extends Error {
  constructor(plans) {
    super('benchmark measurements complete — forcing rollback, not a real failure');
    this.plans = plans;
  }
}

console.log(
  `[benchmark-vat-configuration] seeding inside a disposable transaction (tag ${BENCHMARK_TAG})`,
);

const rowIds = Array.from({ length: HISTORY_ROW_COUNT }, (_, i) => uuidFrom(i + 1));
const BASE = new Date('2020-01-01T00:00:00Z');

let plans;
try {
  await sql.begin(async (tx) => {
    // A history row roughly every 3 days across ~8 years — representative
    // of even an unusually change-heavy operator history; real usage is
    // expected to be orders of magnitude smaller.
    await tx`
      insert into platform_vat_configuration (id, enabled, rate_basis_points, effective_at, reason_code, created_at)
      select
        ${sql.array(rowIds)}[n]::uuid,
        (n % 2 = 0),
        700 + (n % 30) * 10,
        ${BASE}::timestamptz + (n * interval '3 days'),
        'configuration_change',
        now() - ((${HISTORY_ROW_COUNT} - n) * interval '1 hour')
      from generate_series(1, ${HISTORY_ROW_COUNT}) as n
    `;
    console.log(`[benchmark-vat-configuration] seeded ${HISTORY_ROW_COUNT} rows (uncommitted)`);
    await tx`analyze platform_vat_configuration`;

    const probeAt = new Date(BASE.getTime() + (HISTORY_ROW_COUNT / 2) * 3 * 86_400_000);
    const localPlans = [];

    localPlans.push(
      summarizePlan(
        'Effective VAT configuration lookup (getEffectivePlatformVatConfiguration)',
        await tx`explain (analyze, buffers, format json)
          select enabled, rate_basis_points
          from platform_vat_configuration
          where effective_at <= ${probeAt}
          order by effective_at desc, created_at desc, id desc
          limit 1`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'Recent VAT configuration history (bounded, /admin/vat)',
        await tx`explain (analyze, buffers, format json)
          select id, enabled, rate_basis_points, effective_at, created_by_admin_id, reason_code, reason_note
          from platform_vat_configuration
          order by effective_at desc, created_at desc, id desc
          limit 20`,
      ),
    );
    localPlans.push(
      summarizePlan(
        'VAT mutation mutex lock (oldest row, FOR UPDATE)',
        await tx`explain (analyze, buffers, format json)
          select id from platform_vat_configuration
          order by created_at asc, id asc
          limit 1
          for update`,
      ),
    );

    throw new BenchmarkComplete(localPlans);
  });
} catch (error) {
  if (!(error instanceof BenchmarkComplete)) throw error;
  plans = error.plans;
}

console.log('\n[benchmark-vat-configuration] EXPLAIN (ANALYZE, BUFFERS) summary:\n');
for (const plan of plans) {
  console.log(
    `- ${plan.query}\n` +
      `    planning=${plan.planningMs?.toFixed(2)}ms execution=${plan.executionMs?.toFixed(2)}ms ` +
      `rows=${plan.rows} loops=${plan.loops}\n` +
      `    nodeTypes=[${plan.nodeTypes.join(', ')}] sharedHit=${plan.sharedHitBlocks} sharedRead=${plan.sharedReadBlocks}`,
  );
}

console.log('\n[benchmark-vat-configuration] verifying zero permanent residue after rollback...');
const [{ count: residual }] = await sql`
  select count(*)::int as count from platform_vat_configuration where id = any(${sql.array(rowIds)}::uuid[])
`;
console.log(`[benchmark-vat-configuration] residual seeded rows = ${residual}`);
if (residual !== 0) {
  await sql.end();
  throw new Error(
    'Benchmark left permanent residue behind — the seeding transaction did not fully roll back.',
  );
}
console.log('[benchmark-vat-configuration] confirmed zero permanent residue.');

await sql.end();
