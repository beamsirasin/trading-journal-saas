/**
 * Tests for the tool that adjudicates every e2e run.
 *
 * This script decides, on every run, whether the known-red list still matches
 * reality — so a defect in it is a defect in every verdict this repository has
 * reached about its own test suite. It had one: it read only the failure
 * summary, and Playwright's `did not run` tests appear nowhere in that summary.
 * A documented test that never executed therefore looked exactly like a
 * documented test that had started passing, and the script said so, in those
 * words, with an instruction to delete it from the roadmap.
 *
 * The fixtures use their own roadmap rather than the real one, via
 * `KNOWN_RED_ROADMAP`. Pinning them to `docs/roadmap.md` would break them every
 * time the debt changes, which is the one thing that list must stay free to do.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'compare-known-red-e2e.mjs');
const FIXTURES = path.join(here, '__fixtures__');

function run(logFixture) {
  const result = spawnSync(process.execPath, [SCRIPT, path.join(FIXTURES, logFixture)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KNOWN_RED_ROADMAP: path.join(FIXTURES, 'known-red-roadmap.md'),
    },
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

describe('compare-known-red-e2e', () => {
  describe('a documented test that never ran', () => {
    const fixture = 'documented-test-did-not-run.log';

    it('is never reported as progress', () => {
      const { stdout } = run(fixture);
      // The exact failure this file exists for: `beta` did not run, and the
      // script called it repaired and advised deleting the debt it documents.
      const progressSection = stdout.slice(stdout.indexOf('documented but green'));
      const nextSection = progressSection.indexOf('\n\n');
      const progressBody =
        nextSection === -1 ? progressSection : progressSection.slice(0, nextSection);
      expect(progressBody).not.toContain('beta stays red for a documented reason');
    });

    it('is reported as not having run, by name and project', () => {
      const { stdout } = run(fixture);
      expect(stdout).toMatch(/documented but NEVER RAN/i);
      expect(stdout).toContain('chromium :: beta stays red for a documented reason');
    });

    it('fails the comparison rather than passing it', () => {
      const { stdout, status } = run(fixture);
      expect(stdout).toContain('EXACT MATCH: false');
      expect(status).toBe(1);
    });
  });

  describe('the did-not-run count', () => {
    it('is reported even when no documented test is affected', () => {
      // A truncated serial group in another spec is still worth saying out
      // loud: it means some tests were never attempted, and which spec that
      // happens in is not fixed — it is whichever serial group failed first.
      const { stdout, status } = run('did-not-run-outside-documented-spec.log');
      expect(stdout).toMatch(/did not run: 1\b/);
      expect(stdout).toContain('EXACT MATCH: true');
      expect(status).toBe(0);
    });

    it('is reported as zero when every test was attempted', () => {
      const { stdout, status } = run('documented-tests-all-red.log');
      expect(stdout).toMatch(/did not run: 0\b/);
      expect(stdout).toContain('EXACT MATCH: true');
      expect(status).toBe(0);
    });
  });

  describe('the comparison it already did correctly', () => {
    it('still reports an exact match when every documented test failed', () => {
      const { stdout, status } = run('documented-tests-all-red.log');
      expect(stdout).toContain('failed: 3   documented: 3');
      expect(stdout).toContain('EXACT MATCH: true');
      expect(status).toBe(0);
    });

    it('still separates failures outside the documented spec', () => {
      const { stdout } = run('did-not-run-outside-documented-spec.log');
      expect(stdout).toContain('outside the documented spec, not compared: 1');
      expect(stdout).toContain('e2e/serial-elsewhere.spec.ts');
    });
  });
});
