'use client';

import { ArchiveRestore, Lock, LockOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { StrategyListItem } from '@/server/dal/strategies';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';

/**
 * The left/master column of `/app/strategies` — every Strategy in the
 * workspace (active and archived), each a link to
 * `/app/strategies?strategy=<uuid>` rather than a client-side fetch: Strategy
 * detail data comes from a `server-only` DAL read, so selection is a real
 * navigation the Server Component re-renders for (CLAUDE.md §3's "business
 * logic never lives in a React component" extended to "reads stay server-side
 * too").
 */
export function StrategyList({
  strategies,
  selectedStrategyId,
}: {
  strategies: readonly StrategyListItem[];
  selectedStrategyId: string | null;
}) {
  const t = useTranslations('strategies');

  return (
    <ul aria-label={t('listLabel')} className="flex flex-col gap-3">
      {strategies.map((strategy) => {
        const isSelected = strategy.strategyId === selectedStrategyId;
        return (
          <li key={strategy.strategyId}>
            <Link
              href={`/app/strategies?strategy=${strategy.strategyId}`}
              aria-current={isSelected ? 'true' : undefined}
              className={cn(
                'border-border bg-card block rounded-lg border p-4 transition-colors',
                'hover:border-ring focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                isSelected && 'border-brand ring-brand/30 ring-2',
                strategy.isStrategyArchived && 'bg-muted/30',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-foreground min-w-0 font-medium break-words">
                  {strategy.currentVersion.name}
                </h3>
                {strategy.isStrategyArchived ? (
                  <Badge variant="neutral">
                    <ArchiveRestore className="size-3.5" aria-hidden="true" />
                    {t('archived')}
                  </Badge>
                ) : null}
              </div>
              {strategy.currentVersion.description === null ? null : (
                <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed">
                  {strategy.currentVersion.description}
                </p>
              )}
              <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <span className="inline-flex items-center gap-1">
                  {strategy.currentVersion.isCurrentVersionLocked ? (
                    <Lock className="size-3.5" aria-hidden="true" />
                  ) : (
                    <LockOpen className="size-3.5" aria-hidden="true" />
                  )}
                  {t('currentVersionBadge', { number: strategy.currentVersion.versionNumber })}
                </span>
                <span>
                  {t('setupCountLabel', { count: strategy.setupCounts.effectiveAvailable })}
                </span>
                <span>{t('ruleCountLabel', { count: strategy.ruleCount })}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
