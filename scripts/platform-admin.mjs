#!/usr/bin/env node
/**
 * Operational platform-admin grant/revoke script — Phase 11B. No web route,
 * no Server Action, no UI: this is the ONLY way a user is ever granted or
 * revoked platform-admin authority (`docs/phases/PHASE-11-admin.md`'s "no UI
 * to promote an admin, no self-service escalation path"). Run manually by an
 * operator who already has direct database access.
 *
 * Usage:
 *   node scripts/platform-admin.mjs grant --email=owner@example.com --reason-code=bootstrap --yes
 *   node scripts/platform-admin.mjs grant --user-id=<uuid> --reason-code=access_grant --note="..." --yes
 *   node scripts/platform-admin.mjs revoke --email=owner@example.com --reason-code=access_revoke --yes
 *
 * Omitting `--yes` performs a dry run: resolves the user and reports exactly
 * what WOULD happen, without writing anything. This is the confirmation gate
 * (an interactive prompt is normal for a human operator's own terminal, but
 * this environment's tooling has no attached stdin to prompt against, so an
 * explicit opt-in flag serves the same "deliberate, not accidental" purpose).
 *
 * Talks to PostgreSQL directly via the `postgres` package rather than
 * importing the Drizzle schema/service layer: plain Node ESM has no
 * TypeScript/path-alias resolution, the same constraint every other
 * real-database script in this directory already works under (see
 * `prepare-test-db.mjs`, `benchmark-analytics.mjs`). This script mirrors —
 * does not call — the exact invariants implemented and integration-tested in
 * `src/server/services/platform-admin-provisioning.ts`:
 *   - exact lookup only (verified email or user id), never prefix/fuzzy;
 *   - a NEW grant requires an already-verified user account;
 *   - granting an already-active admin is an idempotent no-op (no new row,
 *     no new audit entry);
 *   - revoking a user with no active grant is a safe, idempotent no-op;
 *   - revocation UPDATEs the existing row (`revoked_at`) — it never deletes
 *     grant history, so a later re-grant always inserts a brand-new row;
 *   - the mutation and its `admin_audit_log` entry happen in ONE transaction.
 *
 * Actor is always `system` (`actor_kind = 'system'`, `actor_admin_id = NULL`)
 * — running this script implies operator-with-database-access authority, not
 * an authenticated platform-admin session (Phase 11's own instruction).
 *
 * Never prints credentials. Prints only the resolved host (never the full
 * connection string) and stable IDs (never email/name) in confirmation
 * output, matching `admin_audit_log`'s own "stable IDs only" redaction
 * policy — this script's terminal output is operator-facing, not persisted,
 * but keeping it minimal costs nothing and avoids setting a bad precedent.
 */
import nextEnv from '@next/env';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const REASON_CODES = [
  'bootstrap',
  'access_grant',
  'access_revoke',
  'trial_extension_goodwill',
  'complimentary_access',
  'support_adjustment',
  'configuration_change',
  'other',
];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { yes: false };
  for (const arg of rest) {
    if (arg === '--yes') {
      options.yes = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match === null) {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
    options[match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = match[2];
  }
  return { command, options };
}

function usageError(message) {
  console.error(`[platform-admin] ${message}`);
  console.error(
    '[platform-admin] usage: node scripts/platform-admin.mjs <grant|revoke> (--email=<verified-email>|--user-id=<uuid>) --reason-code=<code> [--note=<text>] [--yes]',
  );
  process.exit(1);
}

const { command, options } = parseArgs(process.argv.slice(2));

if (command !== 'grant' && command !== 'revoke') {
  usageError(`Unknown command: ${String(command)}`);
}
if ((options.email === undefined) === (options.userId === undefined)) {
  usageError('Provide exactly one of --email or --user-id.');
}
if (options.reasonCode === undefined) {
  usageError('--reason-code is required.');
}
if (!REASON_CODES.includes(options.reasonCode)) {
  usageError(`--reason-code must be one of: ${REASON_CODES.join(', ')}`);
}
if (options.note !== undefined && options.note.length > 500) {
  usageError('--note must be 500 characters or fewer.');
}

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  usageError('DATABASE_URL is not set.');
}

const sql = postgres(databaseUrl, { max: 1 });
const connectionHost = new URL(databaseUrl).hostname;

try {
  const [user] =
    options.email !== undefined
      ? await sql`SELECT id, email_verified FROM users WHERE email = ${options.email} LIMIT 1`
      : await sql`SELECT id, email_verified FROM users WHERE id = ${options.userId} LIMIT 1`;

  if (user === undefined) {
    console.error(
      `[platform-admin] no user found for ${options.email !== undefined ? 'that email' : 'that user id'}. Refusing to proceed.`,
    );
    process.exitCode = 1;
  } else if (command === 'grant' && !user.email_verified) {
    console.error(
      `[platform-admin] user ${user.id} has not verified their email. A new platform-admin grant requires a verified account. Refusing to proceed.`,
    );
    process.exitCode = 1;
  } else {
    const [activeGrant] = await sql`
      SELECT id FROM platform_admins WHERE user_id = ${user.id} AND revoked_at IS NULL LIMIT 1
    `;

    if (command === 'grant') {
      if (activeGrant !== undefined) {
        console.log(
          `[platform-admin] user ${user.id} already has an active grant (${activeGrant.id}) — idempotent no-op, nothing to do.`,
        );
      } else if (!options.yes) {
        console.log(
          `[platform-admin] DRY RUN (pass --yes to apply): would grant platform-admin authority to user ${user.id} on ${connectionHost}, reason "${options.reasonCode}".`,
        );
      } else {
        const grantId = uuidv7();
        const auditId = uuidv7();
        await sql.begin(async (tx) => {
          await tx`
            INSERT INTO platform_admins (id, user_id, granted_at, granted_by_admin_id, revoked_at, revoked_by_admin_id)
            VALUES (${grantId}, ${user.id}, now(), NULL, NULL, NULL)
          `;
          await tx`
            INSERT INTO admin_audit_log
              (id, actor_kind, actor_admin_id, action, subject_user_id, subject_workspace_id, reason_code, reason_note, before_state, after_state, created_at)
            VALUES
              (${auditId}, 'system', NULL, 'platform_admin.granted', ${user.id}, NULL, ${options.reasonCode}, ${options.note ?? null}, NULL, NULL, now())
          `;
        });
        console.log(
          `[platform-admin] granted. grant id: ${grantId}, audit id: ${auditId}, user id: ${user.id}`,
        );
      }
    } else {
      if (activeGrant === undefined) {
        console.log(
          `[platform-admin] user ${user.id} has no active grant — idempotent no-op, nothing to do.`,
        );
      } else if (!options.yes) {
        console.log(
          `[platform-admin] DRY RUN (pass --yes to apply): would revoke platform-admin grant ${activeGrant.id} for user ${user.id} on ${connectionHost}, reason "${options.reasonCode}".`,
        );
      } else {
        const auditId = uuidv7();
        await sql.begin(async (tx) => {
          await tx`
            UPDATE platform_admins SET revoked_at = now(), revoked_by_admin_id = NULL WHERE id = ${activeGrant.id}
          `;
          await tx`
            INSERT INTO admin_audit_log
              (id, actor_kind, actor_admin_id, action, subject_user_id, subject_workspace_id, reason_code, reason_note, before_state, after_state, created_at)
            VALUES
              (${auditId}, 'system', NULL, 'platform_admin.revoked', ${user.id}, NULL, ${options.reasonCode}, ${options.note ?? null}, NULL, NULL, now())
          `;
        });
        console.log(
          `[platform-admin] revoked. grant id: ${activeGrant.id}, audit id: ${auditId}, user id: ${user.id}`,
        );
      }
    }
  }
} finally {
  await sql.end();
}
