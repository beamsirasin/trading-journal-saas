import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type {
  BillingHistoryItem,
  BillingHistoryStatus,
} from '@/lib/billing/subscription-management-types';
import { formatInstant } from '@/lib/time';
import { getCurrentUserPreferences } from '@/server/auth/dal';
import { getBillingHistoryPresentation } from '@/server/billing/billing-history';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'billingHistory' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/billing'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/billing'),
    },
  };
}

const STATUS_VARIANT: Record<BillingHistoryStatus, BadgeVariant> = {
  created: 'neutral',
  pending: 'warning',
  processing: 'warning',
  succeeded: 'positive',
  failed: 'negative',
  canceled: 'neutral',
};

export default async function BillingHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const t = await getTranslations('billingHistory');
  const preferences = await getCurrentUserPreferences();
  const requestedPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const history = await getBillingHistoryPresentation(requestedPage);

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />

      {history.items.length === 0 ? (
        <section className="border-border bg-card rounded-xl border p-6 text-center">
          <h2 className="text-card-title">{t('emptyTitle')}</h2>
          <p className="text-muted-foreground mt-2 text-sm">{t('emptyBody')}</p>
        </section>
      ) : (
        <ol className="grid min-w-0 gap-4" aria-label={t('title')}>
          {history.items.map((item) => (
            <li key={item.transactionId}>
              <BillingHistoryCard item={item} timezone={preferences.timezone} locale={appLocale} />
            </li>
          ))}
        </ol>
      )}

      <nav aria-label={t('title')} className="flex flex-wrap items-center justify-between gap-4">
        {history.hasPreviousPage ? (
          <Button asChild variant="outline">
            <Link href={`/app/billing?page=${history.page - 1}`}>{t('previous')}</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t('previous')}
          </Button>
        )}
        <p className="text-muted-foreground text-sm">
          {t('page', { page: history.page, totalPages: history.totalPages })}
        </p>
        {history.hasNextPage ? (
          <Button asChild variant="outline">
            <Link href={`/app/billing?page=${history.page + 1}`}>{t('next')}</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t('next')}
          </Button>
        )}
      </nav>

      <Button asChild variant="link" className="self-start">
        <Link href="/app/plan">{t('backToPlan')}</Link>
      </Button>
    </Container>
  );
}

async function BillingHistoryCard({
  item,
  timezone,
  locale,
}: {
  item: BillingHistoryItem;
  timezone: string;
  locale: AppLocale;
}) {
  const t = await getTranslations('billingHistory');
  return (
    <article className="border-border bg-card min-w-0 rounded-xl border p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase">{t('mockPayment')}</p>
          <h2 className="mt-1 font-semibold">{item.planName}</h2>
        </div>
        <Badge variant={STATUS_VARIANT[item.status]}>{t(`status.${item.status}`)}</Badge>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('createdAt')} value={displayInstant(item.createdAt, timezone, locale)} />
        <Fact label={t('plan')} value={item.planName} />
        <Fact label={t('interval')} value={t('monthly')} />
        <Fact label={t('statusLabel')} value={t(`status.${item.status}`)} />
        <Fact label={t('subtotal')} value={item.subtotal.formatted} numeric />
        {item.vat !== null ? (
          <Fact
            label={t('vat', { rate: item.vat.ratePercent })}
            value={item.vat.amount.formatted}
            numeric
          />
        ) : null}
        <Fact label={t('total')} value={item.total.formatted} numeric />
        {item.completedOrFailedAt !== null ? (
          <Fact
            label={t('finishedAt')}
            value={displayInstant(item.completedOrFailedAt, timezone, locale)}
          />
        ) : null}
      </dl>
      {item.failureMessageKey !== null ? (
        <p className="text-destructive mt-4 text-sm">{t(`failure.${item.failureMessageKey}`)}</p>
      ) : null}
      {item.canResumeProcessing ? (
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/app/checkout?plan=${item.planKey}&currency=${item.currency}`}>
            {t('resume')}
          </Link>
        </Button>
      ) : null}
    </article>
  );
}

function Fact({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className={`mt-1 text-sm font-semibold break-words${numeric ? 'numeric' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function displayInstant(value: string, timezone: string, locale: AppLocale): string {
  const date = new Date(value);
  const formatted = formatInstant(date, timezone, {
    style: 'datetime',
    locale: locale === 'th' ? 'th-TH' : 'en-GB',
  });
  return formatted.ok ? formatted.value : value;
}
