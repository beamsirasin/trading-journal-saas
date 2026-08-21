import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import { getTradeCreateOptions } from '@/server/dal/trades';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { TradeCreateGate } from '@/components/trades/trade-create-gate';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'trades' });
  return {
    title: t('create.pageTitle'),
    description: t('create.pageDescription'),
    alternates: localizedAlternates(appLocale, '/app/trades/new'),
    openGraph: {
      title: t('create.pageTitle'),
      description: t('create.pageDescription'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/trades/new'),
    },
  };
}

export default async function NewTradePage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');
  const [options, entitlement, preferences] = await Promise.all([
    getTradeCreateOptions(),
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
  ]);
  const authorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');

  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader
        title={t('create.pageTitle')}
        description={t('create.pageDescription')}
        actions={
          <Button asChild variant="outline">
            <Link href="/app/trades">
              <ArrowLeft aria-hidden="true" />
              {t('detail.back')}
            </Link>
          </Button>
        }
      />
      <TradeCreateGate
        options={options}
        canWrite={authorization.allowed}
        writeBlockReason={authorization.allowed ? null : authorization.code}
        timezone={preferences.timezone}
      />
    </Container>
  );
}
