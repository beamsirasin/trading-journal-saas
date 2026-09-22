import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { isContractRow } from '@/lib/trades/add-trade-contract';
import { TradeIdSchema } from '@/lib/trades/schemas';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import { getWorkspaceTradeDetail } from '@/server/dal/trades';
import type { CloseScope } from '@/components/trades/close-trade-draft';
import { TradeCloseForm } from '@/components/trades/trade-close-form';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type SearchValue = string | string[] | undefined;
type PageSearchParams = { trade?: SearchValue; scope?: SearchValue };

function single(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?scope=part` or `?scope=all`: the entry action's choice. Anything else is not a close. */
function parseScope(value: SearchValue): CloseScope | null {
  const raw = single(value);
  if (raw === 'part') return 'part';
  if (raw === 'all') return 'all_remaining';
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as AppLocale, namespace: 'trades.stage5' });
  return { title: t('page.closeTitle'), robots: { index: false } };
}

/**
 * CANONICAL STAGE 5 — EXIT & RESULT, as its own page (Close Existing Open
 * Trade; Add Trade contract §10–§12, UX Rules §20).
 *
 * WHY A PAGE, NOT A DIALOG. Trade Details is already a sheet; a close dialog
 * over it would be two overlays deep, and the time editor inside would be a
 * third (DESIGN.md §3, L4). As a page it is a recording surface in its own
 * right — the frame the other recording flows use — and the exit time's
 * focused sheet is the only overlay on it. Success, and the way back, both
 * return to the Trade.
 *
 * WHICH TRADES. An Open contract Trade only: a legacy Trade keeps its legacy
 * close on the Trade page (contract §28), and anything not Open has nothing
 * left to close. The server path enforces the same rules; this page only
 * explains them instead of showing a form that would be refused.
 */
export default async function CloseTradePage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades.stage5');

  const scope = parseScope(query.scope);
  const tradeParam = single(query.trade);
  const parsedTradeId = tradeParam === undefined ? null : TradeIdSchema.safeParse(tradeParam);
  const tradeId = parsedTradeId !== null && parsedTradeId.success ? parsedTradeId.data : null;

  const [detail, entitlement, preferences] = await Promise.all([
    tradeId === null ? Promise.resolve(null) : getWorkspaceTradeDetail(tradeId),
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
  ]);
  const trade = detail !== null && detail.ok ? detail.trade : null;
  const canWrite = authorizeWorkspaceMutation(entitlement, 'ordinary_write').allowed;
  const tradeHref =
    trade === null ? '/app/trades' : `/app/trades?trade=${trade.tradeId}&tab=execution`;

  const blocked =
    trade === null || scope === null
      ? t('page.notFound')
      : !isContractRow(trade)
        ? t('page.legacy')
        : trade.status !== 'open'
          ? t('page.notOpen')
          : !canWrite
            ? t('page.readOnly')
            : null;

  const title = scope === 'part' ? t('page.partTitle') : t('page.closeTitle');
  const description = scope === 'part' ? t('page.partDescription') : t('page.closeDescription');

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--shell-header-height))] w-full max-w-[46rem] min-w-0 flex-col px-4 pt-3 sm:px-6 lg:min-h-0 lg:pt-8 lg:pb-16">
      <header className="flex min-w-0 flex-col items-start gap-1">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-3 shrink-0">
          <Link href={tradeHref}>
            <ArrowLeft aria-hidden="true" />
            {t('page.backToTrade')}
          </Link>
        </Button>
        <h1 className="text-foreground min-w-0 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          {trade === null ? title : `${title} · ${trade.symbol}`}
        </h1>
        {blocked === null ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </header>
      <div className="mt-4 flex min-w-0 flex-1 flex-col">
        {blocked !== null || trade === null || scope === null ? (
          <div
            data-close-blocked=""
            className="border-border flex min-w-0 flex-col items-start gap-3 rounded-lg border p-5"
          >
            <p className="text-foreground text-sm">{blocked}</p>
            <Button asChild variant="outline">
              <Link href={tradeHref}>{t('page.backToTrade')}</Link>
            </Button>
          </div>
        ) : (
          <TradeCloseForm trade={trade} scope={scope} timezone={preferences.timezone} />
        )}
      </div>
    </div>
  );
}
