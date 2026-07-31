import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PLANS, TRIAL_DAYS } from '@/config/plans';
import { DEMO_ACCOUNTS } from '@/lib/demo';
import { DEMO_TIME_ZONE } from '@/components/dashboard/format';
import { DemoBadge } from '@/components/product/demo-badge';
import { MetricLabel } from '@/components/product/metric';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { ThemeSelector } from '@/components/theme/theme-selector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const metadata: Metadata = {
  title: 'Settings',
};

/**
 * Settings preview.
 *
 * Appearance is REAL and fully working — theme selection needs no account, no
 * database and no server, so shipping it disabled would be pretending
 * something is hard that is not.
 *
 * Everything else is a disabled preview. Profile and account fields are
 * `readOnly` rather than `disabled`: a read-only input stays focusable and
 * readable by a screen reader, whereas a disabled one is skipped entirely,
 * which hides the layout being previewed from exactly the users most likely
 * to be reviewing it.
 */
export default function SettingsPage() {
  const tradingAccounts = DEMO_ACCOUNTS.filter((account) => account.id !== 'all');
  const currentPlan = PLANS.find((plan) => plan.featured) ?? PLANS[0];

  return (
    <Container className="flex flex-col gap-10 py-8">
      <PageHeader
        title="Settings"
        description="Appearance works today. Everything else is a preview of the surface."
        meta={<DemoBadge />}
      />

      <section aria-labelledby="appearance-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="appearance-heading"
          title="Appearance"
          description="This setting is live and persists in this browser."
        />
        <div className="bg-card border-border rounded-lg border p-5 sm:p-6">
          <ThemeSelector />
        </div>
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="profile-heading"
          title="Profile"
          description="Preview only — there is no account behind these fields."
        />
        <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-name">Name</Label>
              <Input id="settings-name" defaultValue="Demo trader" readOnly />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-email">Email</Label>
              <Input id="settings-email" type="email" defaultValue="demo@example.com" readOnly />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-timezone">Timezone</Label>
              <Input id="settings-timezone" defaultValue={DEMO_TIME_ZONE} readOnly />
              <p className="text-muted-foreground text-xs leading-relaxed">
                Timestamps are stored in UTC and displayed here. Daily analytics bucket by this
                zone, so a trade closed at 23:30 belongs to that local day.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-currency">Reporting currency</Label>
              <Input id="settings-currency" defaultValue="USD" readOnly />
            </div>
          </div>

          <div>
            <Button disabled aria-describedby="profile-note">
              Save changes
            </Button>
            <p id="profile-note" className="text-muted-foreground mt-2 text-sm">
              Saving requires an account, which arrives with authentication in Phase 2.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="accounts-heading"
          title="Trading accounts"
          description="Plans are gated primarily on how many of these you can keep."
          actions={
            <Button
              variant="outline"
              className="min-h-11"
              disabled
              aria-describedby="accounts-note"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add account
            </Button>
          }
        />

        <ul className="flex flex-col gap-3">
          {tradingAccounts.map((account) => (
            <li
              key={account.id}
              className="bg-card border-border flex flex-wrap items-center gap-4 rounded-lg border p-4"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-foreground text-sm font-medium">{account.name}</span>
                <span className="text-muted-foreground text-xs">{account.broker}</span>
              </div>
              <span className="numeric text-muted-foreground ml-auto text-xs">
                {account.currency}
              </span>
            </li>
          ))}
        </ul>

        <p id="accounts-note" className="text-muted-foreground text-sm">
          Account management arrives with onboarding. These three are demo fixtures.
        </p>
      </section>

      <section aria-labelledby="subscription-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="subscription-heading"
          title="Subscription"
          description="No payment provider is connected to this product."
        />
        <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <MetricLabel>Plan shown</MetricLabel>
              <span className="text-foreground text-sm font-semibold">{currentPlan?.name}</span>
            </div>
            <div className="flex flex-col gap-1">
              <MetricLabel>Trading accounts</MetricLabel>
              <span className="numeric text-foreground text-sm font-semibold">
                {currentPlan?.tradingAccounts}
              </span>
            </div>
            <Badge variant="warning" className="ml-auto">
              {TRIAL_DAYS}-day trial · not started
            </Badge>
          </div>

          <p className="text-muted-foreground text-sm leading-relaxed">
            Prices have not been set and nothing can be purchased. Billing, entitlement checks and
            trial tracking arrive in a later release.{' '}
            <Link
              href="/pricing"
              className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
            >
              See the plans
            </Link>
            .
          </p>
        </div>
      </section>
    </Container>
  );
}
