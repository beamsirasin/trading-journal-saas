import { CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { StrategyIdSchema } from '@/lib/strategies/schemas';
import { formatInstant } from '@/lib/time';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import { getWorkspaceStrategyDetail, listWorkspaceStrategies } from '@/server/dal/strategies';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { StrategiesManager } from '@/components/strategies/strategies-manager';
import type { StrategyDetailView } from '@/components/strategies/strategy-detail';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { strategy?: string };

const DATE_LOCALE: Record<string, string> = { en: 'en-GB', th: 'th' };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'strategies' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/strategies'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/strategies'),
    },
  };
}

/**
 * `/app/strategies` — Phase 06E's real Strategy/Setup/Rule management
 * experience, replacing the Phase 01 fixture preview. Selection is the
 * `?strategy=<uuid>` search param (validated with `StrategyIdSchema`, never
 * trusted raw); a missing, malformed, or cross-workspace value is treated
 * identically as "nothing selected" — the DAL's `getWorkspaceStrategyDetail`
 * already collapses "not found" and "not yours" into the same `strategy_not_
 * found` result, and this page does not attempt to distinguish them either.
 *
 * `authorizeWorkspaceMutation(entitlement, 'ordinary_write')` is the same
 * canonical decision `trading-accounts` UI reads for its own Edit gating —
 * reused as-is rather than inventing a Strategy-specific quota check, since
 * this domain has no Strategy/Setup count limit (CLAUDE.md A3): the only
 * reason writes are ever blocked here is workspace access
 * (`read_only_workspace`/`over_limit_workspace`), which is exactly what that
 * helper already resolves.
 */
export default async function StrategiesPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('strategies');
  const { strategy: strategyParam } = await searchParams;

  const [listResult, entitlement, preferences] = await Promise.all([
    listWorkspaceStrategies(),
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
  ]);

  if (!listResult.ok) {
    return (
      <Container width="wide" className="flex flex-col gap-8 py-8">
        <PageHeader title={t('title')} description={t('description')} />
        <div className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-4">
          <CircleAlert className="text-destructive size-5 shrink-0" aria-hidden="true" />
          <p className="text-foreground text-sm leading-relaxed">
            {t(`errors.${listResult.code}` as Parameters<typeof t>[0])}
          </p>
        </div>
      </Container>
    );
  }

  const parsedId = strategyParam === undefined ? null : StrategyIdSchema.safeParse(strategyParam);
  const requestedId = parsedId !== null && parsedId.success ? parsedId.data : null;
  const detailResult = requestedId === null ? null : await getWorkspaceStrategyDetail(requestedId);

  const locOptions = { locale: DATE_LOCALE[locale] ?? 'en-GB' };
  let selectedStrategy: StrategyDetailView | null = null;
  let selectedStrategyId: string | null = null;
  if (detailResult !== null && detailResult.ok) {
    selectedStrategyId = detailResult.strategy.strategyId;
    selectedStrategy = {
      ...detailResult.strategy,
      versionHistory: detailResult.strategy.versionHistory.map((entry) => {
        const formatted = formatInstant(entry.createdAt, preferences.timezone, {
          style: 'datetime',
          ...locOptions,
        });
        return {
          versionId: entry.versionId,
          versionNumber: entry.versionNumber,
          isLocked: entry.isLocked,
          changeNote: entry.changeNote,
          createdAtDisplay: formatted.ok ? formatted.value : '—',
        };
      }),
    };
  }

  const writeAuthorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <StrategiesManager
        strategies={listResult.strategies}
        selectedStrategy={selectedStrategy}
        selectedStrategyId={selectedStrategyId}
        canWrite={writeAuthorization.allowed}
        writeBlockReason={writeAuthorization.allowed ? null : writeAuthorization.code}
      />
    </Container>
  );
}
