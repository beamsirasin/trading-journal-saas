import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { resolveEntitlementGate } from '@/lib/entitlements/resolve';
import {
  getActiveTradingAccount,
  getWorkspaceEntitlement,
  listWorkspaceTradingAccounts,
} from '@/server/auth/dal';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { AccountsManager } from '@/components/trading-accounts/accounts-manager';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { status?: string };

const FEEDBACK_STATUS_VALUES = ['created', 'updated', 'archived', 'restored', 'activated'] as const;
type FeedbackStatus = (typeof FEEDBACK_STATUS_VALUES)[number];

/**
 * Narrows the `?status=` query param the create/edit form's post-success
 * redirect attaches. Anything else (missing, mistyped, tampered-with) is
 * treated as "no feedback" rather than trusted — matching the same posture
 * `verify-email/page.tsx`'s `parseDispatchNotice` already takes for its own
 * query-param hint: a UI nicety only, never an authorization decision.
 */
function parseFeedbackStatus(value: string | undefined): FeedbackStatus | undefined {
  return (FEEDBACK_STATUS_VALUES as readonly string[]).includes(value ?? '')
    ? (value as FeedbackStatus)
    : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'accounts' });

  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/accounts'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/accounts'),
    },
  };
}

/**
 * Phase 3B's account-management page. `(app)/app/(main)/layout.tsx` already
 * guarantees completed onboarding, which itself guarantees at least one
 * trading account exists in the workspace — so unlike the dashboard, there
 * is no "no account yet" recovery state to render here.
 */
export default async function AccountsPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('accounts');
  const { status } = await searchParams;
  const feedbackStatus = parseFeedbackStatus(status);

  const [accounts, activeAccount, entitlement] = await Promise.all([
    listWorkspaceTradingAccounts(),
    getActiveTradingAccount(),
    getWorkspaceEntitlement(),
  ]);
  const activeAccounts = accounts.filter((account) => !account.isArchived);
  const archivedAccounts = accounts.filter((account) => account.isArchived);

  // `resolveEntitlementGate` fails closed on a `null` entitlement (onboarding
  // complete, no entitlement row) — "cannot create right now," never
  // unlimited access. The same helper gates Restore in `AccountsManager`.
  const { allowed: canCreateAccount, blockReason: createBlockReason } =
    resolveEntitlementGate(entitlement);

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreateAccount ? (
            <Button asChild className="gap-1.5">
              <Link href="/app/accounts/new">
                <Plus className="size-4" aria-hidden="true" />
                {t('createAccount')}
              </Link>
            </Button>
          ) : (
            <Button
              disabled
              className="gap-1.5"
              aria-describedby="create-account-unavailable-reason"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('createAccount')}
            </Button>
          )
        }
      />
      {canCreateAccount ? null : (
        <p id="create-account-unavailable-reason" className="text-muted-foreground -mt-4 text-sm">
          {t(`errors.${createBlockReason}` as Parameters<typeof t>[0])}
        </p>
      )}
      <AccountsManager
        activeAccounts={activeAccounts}
        archivedAccounts={archivedAccounts}
        activeAccountId={activeAccount?.id ?? null}
        entitlement={entitlement}
        {...(feedbackStatus === undefined ? {} : { initialFeedback: feedbackStatus })}
      />
    </Container>
  );
}
