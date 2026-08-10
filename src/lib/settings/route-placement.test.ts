import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const settingsPage = path.join(root, 'src/app/[locale]/(app)/app/settings/page.tsx');
const oldGuardedSettingsPage = path.join(
  root,
  'src/app/[locale]/(app)/app/(main)/settings/page.tsx',
);

describe('Phase 10D Settings route placement and source cleanup', () => {
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
    expect(source).toContain('<WorkspaceForm');
    expect(source).toContain('<DataExportSection');
    expect(source).toContain('getWorkspaceSettingsState');
    expect(source).toContain("status: 'unavailable'");
    expect(source).toContain('<WorkspaceUnavailable');
    expect(source).toContain('getActiveTradingAccount');
    expect(source).toContain('getSubscriptionManagementPresentation');
    expect(source).toContain("'/app/accounts'");
    expect(source).toContain('href="/app/plan"');
    expect(source).toContain("'/app/billing'");
    expect(source).not.toMatch(
      /DEMO_ACCOUNTS|DemoBadge|Reporting currency|Danger Zone|Security section|VAT rate|team members|workspace slug/i,
    );
  });

  it('keeps export server-scoped with format-only direct download routes', () => {
    const jsonRoute = path.join(root, 'src/app/api/settings/export/workspace/[format]/route.ts');
    const source = readFileSync(jsonRoute, 'utf8');
    expect(source).toContain('prepareCurrentWorkspaceExport(format)');
    expect(source).not.toMatch(/searchParams|workspaceId.*params|request\.json|request\.formData/);
    expect(source).toContain("'Cache-Control': 'no-store'");
    expect(source).toContain("'Content-Disposition': `attachment;");
  });
});
