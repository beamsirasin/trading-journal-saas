import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `server.ts` imports the `server-only` marker package, which throws unless
 * the `react-server` resolve condition is active (only set for
 * `vitest.integration.config.ts` — see that file's own comment). These
 * source-text assertions let the Phase 2.1 follow-up's structural
 * guarantees run as plain, DB-free unit tests instead of requiring a real
 * database purely to confirm what the config LITERALLY says. The behavioral
 * counterpart (what Better Auth actually resolves these options to) is
 * covered by `registration-hardening.integration.test.ts`, which can afford
 * to import the real module.
 */
const serverSourcePath = join(process.cwd(), 'src/lib/auth/server.ts');
const source = readFileSync(serverSourcePath, 'utf-8');

describe('server.ts — verification-dispatch source guarantees', () => {
  it('disables automatic sendOnSignUp dispatch', () => {
    expect(source).toMatch(/sendOnSignUp:\s*false/);
  });

  it('keeps sendOnSignIn automatic dispatch enabled', () => {
    expect(source).toMatch(/sendOnSignIn:\s*true/);
  });

  it('never calls auth.api.sendVerificationEmail (that path bypasses the router rate limiter)', () => {
    expect(source).not.toMatch(/auth\.api\.sendVerificationEmail/);
  });

  it('does not wire an onExistingUserSignUp callback', () => {
    expect(source).not.toMatch(/onExistingUserSignUp:\s*(async\s*)?\(/);
  });
});
