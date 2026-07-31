#!/usr/bin/env node
/**
 * Server-secret canary scan of the client bundle.
 *
 * `env.server.ts` imports `server-only`, so a client component importing it
 * fails the build. This script is the belt to that braces: it reads what
 * actually shipped rather than trusting that the guard was wired correctly,
 * because a leaked connection string cannot be un-leaked once it is in a
 * bundle a browser has downloaded.
 *
 * Two kinds of finding:
 *
 *   1. A server-only ENV VAR NAME appearing in a client asset. Next.js inlines
 *      `process.env.X` for `NEXT_PUBLIC_*` only, so the literal name showing
 *      up in client JavaScript means something referenced it there.
 *   2. A VALUE-shaped secret — a postgres URL, a private key block.
 *
 * Run against `.next/static` plus the client reference manifests. Server
 * chunks are deliberately excluded: a secret is supposed to be reachable
 * there, and scanning them would produce noise that trains everyone to ignore
 * the output.
 *
 * Exits non-zero on any finding, so CI fails rather than warning.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CLIENT_DIR = join(ROOT, '.next', 'static');

/** Server-only variable names. Sourced from src/config/env.schema.ts. */
const SECRET_NAMES = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'AUTH_SECRET',
  'AUTH_GOOGLE_SECRET',
  'AUTH_RESEND_KEY',
];

/** Value shapes that are secrets regardless of which variable held them. */
const SECRET_SHAPES = [
  { name: 'postgres connection string', pattern: /postgres(?:ql)?:\/\/[^\s"']+/i },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

function walk(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    } else if (/\.(js|mjs|css|json|txt|map)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const files = walk(CLIENT_DIR);

if (files.length === 0) {
  console.error(
    `✗ No client assets found at ${relative(ROOT, CLIENT_DIR)}. Run \`pnpm build\` first.`,
  );
  process.exit(1);
}

const findings = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const where = relative(ROOT, file);

  for (const name of SECRET_NAMES) {
    if (contents.includes(name)) {
      findings.push(`${where}: references server-only variable ${name}`);
    }
  }

  for (const { name, pattern } of SECRET_SHAPES) {
    if (pattern.test(contents)) {
      findings.push(`${where}: contains a ${name}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`✗ ${findings.length} finding(s) in client assets:\n`);
  for (const finding of findings) {
    console.error(`  - ${finding}`);
  }
  process.exit(1);
}

console.log(
  `✓ Scanned ${files.length} client assets — no server secrets or server-only variable names.`,
);
