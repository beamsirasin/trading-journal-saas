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
 *   ... | node scripts/compare-known-red-e2e.mjs      # or read stdin
 *
 * Reads the `list` reporter's numbered failure summary, which is what a local
 * run prints by default (playwright.config.ts uses `github` + `html` in CI,
 * so pass `--reporter=list` there).
 *
 * Give it a run of the WHOLE spec across every project. A `-g`-filtered or
 * single-project run reports every test it never executed as "documented but
 * green", which is the exact mistake this script exists to catch.
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
const FAILURE_HEAD = /^\s*\d+\) \[([a-z][a-z0-9-]*)\] (\S) (e2e[\\/][\w./-]+):\d+:\d+ /;

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

function parseFailures(log) {
  const failures = [];
  const specFiles = new Set();
  for (const line of log.split(/\r?\n/)) {
    const head = line.match(FAILURE_HEAD);
    if (!head) continue;
    const [, project, separator, specFile] = head;
    const parts = line.split(` ${separator} `);
    specFiles.add(specFile.replace(/\\/g, '/'));
    failures.push({ project, name: parts[parts.length - 1].trim() });
  }
  return { failures, specFiles };
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
const { failures, specFiles } = parseFailures(log);
const { known, specFile, countMismatches } = parseKnownRed(readFileSync(ROADMAP, 'utf8'));

if (failures.length === 0 && !/\b\d+ failed\b/.test(log)) {
  fail('no numbered failure lines found — was this a `list` reporter run?');
}

const failedKeys = new Set(failures.map(key));
const knownKeys = new Set(known.map(key));
const unexpected = failures.filter((f) => !knownKeys.has(key(f)));
const repaired = known.filter((k) => !failedKeys.has(key(k)));

console.log(`spec documented : ${specFile}`);
console.log(`spec in the run : ${[...specFiles].join(', ') || '(none)'}`);
console.log(`failed: ${failures.length}   documented: ${known.length}`);
console.log('');
report(
  'red but NOT documented (regression, or an undocumented member of the same debt)',
  unexpected,
);
report('documented but green (progress — remove it from docs/roadmap.md)', repaired);
for (const mismatch of countMismatches) {
  console.log(`heading count is stale — ${mismatch}`);
}

const clean = unexpected.length === 0 && repaired.length === 0 && countMismatches.length === 0;
console.log('');
console.log(`EXACT MATCH: ${clean}`);
process.exit(clean ? 0 : 1);
