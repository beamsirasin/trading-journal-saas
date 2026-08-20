import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { TradeIdSchema } from '@/lib/trades/schemas';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import {
  getTradeCreateOptions,
  getWorkspaceTradeDetail,
  listWorkspaceTrades,
} from '@/server/dal/trades';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { TradesJournal } from '@/components/trades/trades-journal';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { trade?: string; cursor?: string };

const DATE_LOCALE: Record<string, string> = { en: 'en-GB', th: 'th' };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'trades' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/trades'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/trades'),
    },
  };
}

export default async function TradesPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  const { trade: tradeParam, cursor } = await searchParams;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');

  const [page, entitlement, preferences, createOptions] = await Promise.all([
    listWorkspaceTrades({ cursor: cursor ?? null }),
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
    getTradeCreateOptions(),
  ]);
  const parsedTradeId = tradeParam === undefined ? null : TradeIdSchema.safeParse(tradeParam);
  const requestedTradeId =
    parsedTradeId !== null && parsedTradeId.success ? parsedTradeId.data : null;
  const detailResult =
    requestedTradeId === null ? null : await getWorkspaceTradeDetail(requestedTradeId);
  const selectedTrade = detailResult !== null && detailResult.ok ? detailResult.trade : null;
  const writeAuthorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');
  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';
  const trades = page.items.map((trade) => ({
    ...trade,
    occurredAtDisplay:
      formatTradeInstant(trade.occurredAt, preferences.timezone, dateLocale) ?? '—',
  }));

  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          writeAuthorization.allowed && page.items.length > 0 ? (
            <Button asChild>
              <Link href="/app/trades/new">
                <Plus aria-hidden="true" />
                {t('logTrade')}
              </Link>
            </Button>
          ) : null
        }
      />
      <TradesJournal
        trades={trades}
        nextCursor={page.nextCursor}
        hasCursor={cursor !== undefined}
        selectedTrade={selectedTrade}
        selectedTradeId={selectedTrade?.tradeId ?? null}
        canWrite={writeAuthorization.allowed}
        writeBlockReason={writeAuthorization.allowed ? null : writeAuthorization.code}
        timezone={preferences.timezone}
        locale={dateLocale}
        classificationOptions={createOptions.strategies}
      />
    </Container>
  );
}
