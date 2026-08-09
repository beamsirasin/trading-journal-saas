import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const settingsPage = path.join(root, 'src/app/[locale]/(app)/app/settings/page.tsx');
const oldGuardedSettingsPage = path.join(
  root,
  'src/app/[locale]/(app)/app/(main)/settings/page.tsx',
);

describe('Phase 10B Settings route placement and source cleanup', () => {
  it('keeps one Settings route outside only the completed-onboarding route group', () => {
    expect(existsSync(settingsPage)).toBe(true);
    expect(existsSync(oldGuardedSettingsPage)).toBe(false);

    const authLayout = readFileSync(path.join(root, 'src/app/[locale]/(app)/layout.tsx'), 'utf8');
    const mainLayout = readFileSync(
      path.join(root, 'src/app/[locale]/(app)/app/(main)/layout.tsx'),
      'utf8',
    );
    expect(authLayout).toContain('getOptionalSession');
    expect(authLayout).toContain('redirectToLogin');
    expect(mainLayout).toContain('isOnboardingComplete');
    expect(mainLayout).toContain("href: '/app/onboarding'");
  });

  it('uses real forms and canonical links without stale demo or speculative Settings UI', () => {
    const source = readFileSync(settingsPage, 'utf8');
    expect(source).toContain('<ProfileForm');
    expect(source).toContain('<TimezoneForm');
    expect(source).toContain('<ThemeSelector');
    expect(source).toContain('<LanguageSwitcher');
    expect(source).toContain("'/app/accounts'");
    expect(source).toContain('href="/app/plan"');
    expect(source).toContain('href="/app/billing"');
    expect(source).not.toMatch(/DEMO_ACCOUNTS|DemoBadge|Reporting currency|Danger Zone/);
  });
});
