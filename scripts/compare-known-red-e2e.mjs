#!/usr/bin/env node
/**
 * Compares a Playwright run's failures against the known-red list in
 * `docs/roadmap.md`, by test name AND project, and exits non-zero on any
 * difference.
 *
 * Why this exists: that list was once compared by eye, from a run of a single
 * Playwright project, and silently lost three `mobile-chrome` entries — a run
 * of every project then reported "extra" failures that were nothing of the
 * sort. Counting by hand also cannot tell a name that went green (progress)
 * from a name that went red (regression); it only tells you the totals moved.
 * This does both, and never asks anyone to trust a tally.
 *
 * Usage:
 *   pnpm exec playwright test e2e/trades.spec.ts --workers=4 > run.log
 *   node scripts/compare-known-red-e2e.mjs run.log
 *   gh run view <id> --log | node scripts/compare-known-red-e2e.mjs
 *
 * Reads either reporter: the `list` reporter's numbered failure summary (what
 * a local run prints) or the `github` reporter's summary block (what CI
 * prints, playwright.config.ts). A raw `gh run view --log` is accepted as-is —
 * the job/step/timestamp prefix and ANSI colouring are stripped — because a
 * tool that cannot read the log CI actually produces is a tool that gets
 * skipped.
 *
 * Give it a run of the WHOLE spec across every project. A `-g`-filtered or
 * single-project run reports every test it never executed as "documented but
 * green", which is the exact mistake this script exists to catch.
 *
 * The documented list covers ONE spec file, named in its own headline.
 * Failures in other specs are reported separately and do not affect the
 * verdict — see the "Thirty-one e2e failures outside `trades.spec.ts`" entry
 * in docs/roadmap.md for why those are their own, untriaged, debt.
 *
 * Exit codes: 0 exact match · 1 a difference · 2 could not parse the inputs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROADMAP = path.join(repoRoot, 'docs', 'roadmap.md');

/**
 * The known-red block in `docs/roadmap.md`: a headline naming the spec, then
 * one `**`project` (n)**` heading per Playwright project, each followed by
 * backticked test names, ending at the "Repairing them" paragraph. Anchored on
 * prose rather than on the count, so the count changing does not break this.
 */
const LIST_START = /^\*\*\w+ `(e2e\/[\w./-]+)` tests still assert/m;
const LIST_END = 'Repairing them is not a locator swap';
const PROJECT_HEADING = /^\*\*`([a-z][a-z0-9-]*)` \((\d+)\)\*\*/;
const NAME_BULLET = /^- `(.*)`$/;

/**
 * A numbered failure line from the `list` reporter:
 *   `  1) [chromium] › e2e\trades.spec.ts:587:7 › describe › test name`
 * The separator glyph is read off the line itself rather than hard-coded —
 * its encoding does not always survive a pipe or a redirect — and split on
 * with its surrounding spaces, so an em dash inside a test name survives.
 */
const LIST_FAILURE = /^\s*\d+\) \[([a-z][a-z0-9-]*)\] (\S) (e2e[\\/][\w./-]+):\d+:\d+ /;

/**
 * The `github` reporter prints an unnumbered, indented block under a bare
 * `  N failed` heading and ends it at the next `  N flaky|skipped|passed`.
 * Names there are padded to the terminal width with box-drawing dashes.
 */
const GITHUB_FAILED_HEADING = /^\s*\d+ failed\s*$/;
const GITHUB_BLOCK_END = /^\s*\d+ (flaky|skipped|passed)\b/;
const GITHUB_FAILURE = /^\s*\[([a-z][a-z0-9-]*)\] (\S) (e2e[\\/][\w./-]+):\d+:\d+ /;

const ANSI = /\u001b\[[0-9;]*m/g;
/** `Playwright end-to-end\tPlaywright tests\t2026-09-03T11:28:45.1274942Z ` */
const CI_PREFIX = /^.*?\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z /;
/** The github reporter pads a title out with `─`; `list` leaves trailing space. */
const TRAILING_RULE = /[\s\u2500-\u257f]+$/;

function readInput(argv) {
  const file = argv[2];
  if (file) return readFileSync(file, 'utf8');
  if (process.stdin.isTTY) {
    fail('Pass a Playwright log file, or pipe one in. See the header of this script.');
  }
  return readFileSync(0, 'utf8');
}

function fail(message) {
  console.error(`compare-known-red-e2e: ${message}`);
  process.exit(2);
}

/** One failure row, from whichever reporter wrote the log. */
function toRow(line, match) {
  const [, project, separator, specFile] = match;
  const parts = line.split(` ${separator} `);
  return {
    project,
    specFile: specFile.replace(/\\/g, '/'),
    name: (parts[parts.length - 1] ?? '').replace(TRAILING_RULE, '').trim(),
  };
}

function parseFailures(log) {
  const lines = log
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(ANSI, '').replace(CI_PREFIX, ''));

  // The indented summary block both reporters print is authoritative when
  // present: its `N failed` list excludes flaky tests, whereas the numbered
  // per-failure detail also printed includes a flaky test's failed first
  // attempt. Read the block first so a recovered flake is never a failure.
  const githubRows = [];
  let inFailedBlock = false;
  for (const line of lines) {
    if (GITHUB_FAILED_HEADING.test(line)) {
      inFailedBlock = true;
      continue;
    }
    if (!inFailedBlock) continue;
    if (GITHUB_BLOCK_END.test(line)) break;
    const m = line.match(GITHUB_FAILURE);
    if (m) githubRows.push(toRow(line, m));
  }
  if (githubRows.length > 0) return { rows: githubRows, source: 'failure summary block' };

  // Otherwise fall back to the numbered per-failure headings.
  const listRows = [];
  for (const line of lines) {
    const m = line.match(LIST_FAILURE);
    if (m) listRows.push(toRow(line, m));
  }
  return { rows: listRows, source: 'numbered failure lines' };
}

function parseKnownRed(markdown) {
  const start = markdown.match(LIST_START);
  if (!start)
    fail(`could not find the known-red list headline in ${path.relative(repoRoot, ROADMAP)}`);
  const from = start.index;
  const to = markdown.indexOf(LIST_END, from);
  if (to === -1) fail(`could not find the end of the known-red list ("${LIST_END}")`);

  const known = [];
  let project = null;
  let declared = null;
  let seenInProject = 0;
  const countMismatches = [];
  for (const line of markdown.slice(from, to).split(/\r?\n/)) {
    const heading = line.match(PROJECT_HEADING);
    if (heading) {
      if (project && seenInProject !== declared) {
        countMismatches.push(`${project}: heading says ${declared}, list has ${seenInProject}`);
      }
      project = heading[1];
      declared = Number(heading[2]);
      seenInProject = 0;
      continue;
    }
    const bullet = line.match(NAME_BULLET);
    if (bullet && project) {
      known.push({ project, name: bullet[1] });
      seenInProject += 1;
    }
  }
  if (project && seenInProject !== declared) {
    countMismatches.push(`${project}: heading says ${declared}, list has ${seenInProject}`);
  }
  return { known, specFile: start[1], countMismatches };
}

const key = ({ project, name }) => `${project} :: ${name}`;
const report = (label, rows) => {
  console.log(`${label}: ${rows.length}`);
  for (const row of rows) console.log(`  - ${key(row)}`);
};

const log = readInput(process.argv);
const { rows, source } = parseFailures(log);
const { known, specFile, countMismatches } = parseKnownRed(readFileSync(ROADMAP, 'utf8'));

if (rows.length === 0 && !/\b\d+ failed\b/.test(log)) {
  fail('no failure lines found — was this a `list` or `github` reporter run?');
}

// The documented list covers one spec. Anything else is reported, not judged.
const inScope = rows.filter((row) => row.specFile === specFile);
const outOfScope = rows.filter((row) => row.specFile !== specFile);

const failedKeys = new Set(inScope.map(key));
const knownKeys = new Set(known.map(key));
const unexpected = inScope.filter((row) => !knownKeys.has(key(row)));
const repaired = known.filter((row) => !failedKeys.has(key(row)));

console.log(`read from       : ${source}`);
console.log(`spec documented : ${specFile}`);
console.log(`failed: ${inScope.length}   documented: ${known.length}`);
console.log('');
report(
  'red but NOT documented (regression, or an undocumented member of the same debt)',
  unexpected,
);
report('documented but green (progress — remove it from docs/roadmap.md)', repaired);
for (const mismatch of countMismatches) {
  console.log(`heading count is stale — ${mismatch}`);
}

if (outOfScope.length > 0) {
  const byFile = new Map();
  for (const row of outOfScope) byFile.set(row.specFile, (byFile.get(row.specFile) ?? 0) + 1);
  console.log('');
  console.log(
    `outside the documented spec, not compared: ${outOfScope.length} (see docs/roadmap.md)`,
  );
  for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${file}`);
  }
}

const clean = unexpected.length === 0 && repaired.length === 0 && countMismatches.length === 0;
console.log('');
console.log(`EXACT MATCH: ${clean}`);
process.exit(clean ? 0 : 1);
