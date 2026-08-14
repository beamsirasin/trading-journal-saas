import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getWorkspaceTradingAccountById } from '@/server/auth/dal';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { TradingAccountForm } from '@/components/trading-accounts/trading-account-form';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

const accountIdSchema = z.string().uuid();

type PageParams = { locale: string; accountId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'accounts' });

  return {
    title: t('editAccountTitle'),
    description: t('editAccountDescription'),
    alternates: localizedAlternates(appLocale, '/app/accounts'),
    openGraph: {
      title: t('editAccountTitle'),
      description: t('editAccountDescription'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/accounts'),
    },
  };
}

/**
 * `getWorkspaceTradingAccountById` returns `null` both for a genuinely
 * unknown ID and for one that belongs to another workspace — indistinguishable
 * on purpose (Phase 3B brief: "must behave as not found... without
 * revealing cross-tenant existence"). `notFound()` is the standard Next.js
 * response for both, rendering the same not-found page a nonexistent route
 * would. The route param is validated as a UUID FIRST — the `uuid` column
 * comparison would otherwise throw a raw Postgres syntax error for a
 * malformed segment instead of a clean not-found.
 *
 * An archived account is deliberately not editable here (Phase 3B brief:
 * "prefer restore-before-edit") — shown as a safe recovery message with a
 * link back, not a 404 (the account genuinely exists and is the caller's).
 */
export default async function EditTradingAccountPage({ params }: { params: Promise<PageParams> }) {
  const { locale, accountId } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('accounts');

  const parsedAccountId = accountIdSchema.safeParse(accountId);
  if (!parsedAccountId.success) {
    notFound();
  }

  const account = await getWorkspaceTradingAccountById(parsedAccountId.data);
  if (account === null) {
    notFound();
  }

  if (account.isArchived) {
    return (
      <Container width="prose" className="flex flex-col gap-6 py-8">
        <PageHeader title={t('editAccountTitle')} />
        <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6">
          <p className="text-foreground text-sm font-medium">{t('cannotEditArchivedTitle')}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('cannotEditArchivedDescription')}
          </p>
          <Button asChild variant="outline">
            <Link href="/app/accounts">{t('backToAccounts')}</Link>
          </Button>
        </div>
      </Container>
    );
  }

  return (
    <Container width="prose" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('editAccountTitle')} description={t('editAccountDescription')} />
      <TradingAccountForm
        mode="edit"
        accountId={account.id}
        baseCurrencyLocked={account.hasTrades}
        initialValues={{
          name: account.name,
          brokerName: account.brokerName ?? '',
          platformName: account.platformName ?? '',
          accountMode: account.accountMode,
          baseCurrency: account.baseCurrency,
          startingBalance: account.startingBalance,
          timezone: account.timezone,
          riskPerTradePercent: account.riskPerTradePercent ?? '',
          maximumDailyLossPercent: account.maximumDailyLossPercent ?? '',
        }}
      />
    </Container>
  );
}
