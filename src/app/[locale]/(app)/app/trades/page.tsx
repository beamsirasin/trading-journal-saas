import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DEMO_TRADES } from '@/lib/demo';
import { TradesTable } from '@/components/dashboard/trades-table';
import { DemoBadge, DemoDataNotice } from '@/components/product/demo-badge';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'trades' });
  return { title: t('title') };
}

/**
 * The journal.
 *
 * A preview of the list surface with real demo rows, so the responsive
 * behaviour — table on desktop, record cards on mobile — can be reviewed now
 * rather than discovered during Phase 08.
 *
 * "Log a trade" is disabled rather than opening an empty form. A form that
 * cannot save is a worse experience than a button that explains itself, and
 * `aria-describedby` makes the explanation reach a screen reader instead of
 * only appearing beside it.
 */
export default async function TradesPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        meta={<DemoBadge />}
        actions={
          <Button className="min-h-11" disabled aria-describedby="log-trade-note">
            <Plus className="size-4" aria-hidden="true" />
            {t('logTrade')}
          </Button>
        }
      />

      <p id="log-trade-note" className="text-muted-foreground -mt-4 text-sm">
        {t('logTradeNote')}
      </p>

      <DemoDataNotice />

      <section aria-labelledby="all-trades" className="flex flex-col gap-4">
        <SectionHeader
          id="all-trades"
          title={t('allTradesTitle', { count: DEMO_TRADES.length })}
          description={t('allTradesDescription')}
        />
        <TradesTable trades={DEMO_TRADES} />
      </section>
    </Container>
  );
}
