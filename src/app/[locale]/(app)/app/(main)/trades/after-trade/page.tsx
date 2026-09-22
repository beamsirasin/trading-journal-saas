import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { isContractRow } from '@/lib/trades/add-trade-contract';
import { TradeIdSchema } from '@/lib/trades/schemas';
import { getActiveWorkspaceContext, getWorkspaceEntitlement } from '@/server/auth/dal';
import { getWorkspaceTradeDetail } from '@/server/dal/trades';
import { closeDraftScopeKeys } from '@/server/services/recording-draft-scope';
import { TradeAfterTradeContextForm } from '@/components/trades/trade-after-trade-context-form';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type SearchValue = string | string[] | undefined;
type PageSearchParams = { trade?: SearchValue; from?: SearchValue };

function single(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as AppLocale, namespace: 'trades.stage6' });
  return { title: t('page.title'), robots: { index: false } };
}

/**
 * CANONICAL STAGE 6 — AFTER-TRADE CONTEXT, for a Closed contract Trade (UX
 * Rules §20.5). Reached two ways: straight after a Final Close
 * (`?from=close`, which says first that the Trade is closed), and later from
 * the Trade's own "Add / Edit after-trade context" action. A page rather than
 * a dialog for the same reason Stage 5 is one: Trade Details is already a
 * sheet, and the Post-Trade Emotion editor is the one overlay here.
 *
 * WHICH TRADES. A Closed contract Trade — including one closed through the
 * legacy close before it was retired. A legacy Trade and a Trade not yet
 * Closed are explained, not offered a form the server would refuse.
 */
export default async function AfterTradeContextPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades.stage6');

  const tradeParam = single(query.trade);
  const parsed = tradeParam === undefined ? null : TradeIdSchema.safeParse(tradeParam);
  const tradeId = parsed !== null && parsed.success ? parsed.data : null;
  const [detail, entitlement, workspaceContext] = await Promise.all([
    tradeId === null ? Promise.resolve(null) : getWorkspaceTradeDetail(tradeId),
    getWorkspaceEntitlement(),
    getActiveWorkspaceContext(),
  ]);
  const trade = detail !== null && detail.ok ? detail.trade : null;
  const canWrite = authorizeWorkspaceMutation(entitlement, 'ordinary_write').allowed;
  const tradeHref = trade === null ? '/app/trades' : `/app/trades?trade=${trade.tradeId}`;
  const blocked =
    trade === null
      ? t('page.notFound')
      : !isContractRow(trade)
        ? t('page.legacy')
        : trade.status !== 'closed'
          ? t('page.notClosed')
          : !canWrite
            ? t('page.readOnly')
            : null;
  const draftScope =
    trade === null
      ? null
      : closeDraftScopeKeys(workspaceContext.userId, workspaceContext.workspaceId, trade.tradeId);

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
          {trade === null ? t('page.title') : `${t('page.title')} · ${trade.symbol}`}
        </h1>
      </header>
      <div className="mt-4 flex min-w-0 flex-1 flex-col">
        {blocked !== null || trade === null ? (
          <div
            data-after-trade-blocked=""
            className="border-border flex min-w-0 flex-col items-start gap-3 rounded-lg border p-5"
          >
            <p className="text-foreground text-sm">{blocked}</p>
            <Button asChild variant="outline">
              <Link href={tradeHref}>{t('page.backToTrade')}</Link>
            </Button>
          </div>
        ) : (
          <TradeAfterTradeContextForm
            trade={trade}
            draftScope={draftScope}
            fromClose={single(query.from) === 'close'}
          />
        )}
      </div>
    </div>
  );
}
