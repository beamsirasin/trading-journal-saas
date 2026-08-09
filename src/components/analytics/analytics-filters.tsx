'use client';

import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import type { AnalyticsDatePreset } from '@/lib/analytics/filters';
import type { AnalyticsUrlSelection } from '@/lib/analytics/url-filters';
import { cn } from '@/lib/utils';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';
import { Label } from '@/components/ui/label';
import { Link, useRouter } from '@/i18n/navigation';

const RANGE_ORDER: readonly AnalyticsDatePreset[] = ['30d', '90d', 'all'];
const RANGE_KEY = { '30d': 'range30', '90d': 'range90', all: 'rangeAll' } as const;

function FilterSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full min-w-0 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] disabled:opacity-60',
        props.className,
      )}
    />
  );
}

export function AnalyticsFilters({
  options,
  selection,
}: {
  options: AnalyticsFilterOptions;
  selection: AnalyticsUrlSelection;
}) {
  const t = useTranslations('analytics.real');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const selectedSetup = options.setups.find((item) => item.setupId === selection.setup);
  const selectedVersion = options.strategyVersions.find(
    (item) => item.strategyVersionId === selection.version,
  );
  const dependentStrategy =
    selection.strategy ?? selectedSetup?.strategyId ?? selectedVersion?.strategyId ?? null;
  const setups =
    selection.strategy === null
      ? options.setups
      : options.setups.filter((item) => item.strategyId === selection.strategy);
  const versions =
    dependentStrategy === null
      ? options.strategyVersions
      : options.strategyVersions.filter((item) => item.strategyId === dependentStrategy);

  function currentParams() {
    const params = new URLSearchParams();
    params.set('range', selection.range);
    if (selection.account !== null) params.set('account', selection.account);
    if (selection.strategy !== null) params.set('strategy', selection.strategy);
    if (selection.setup !== null) params.set('setup', selection.setup);
    if (selection.version !== null) params.set('version', selection.version);
    return params;
  }

  function navigate(update: (params: URLSearchParams) => void) {
    const params = currentParams();
    update(params);
    const query = params.toString();
    startTransition(() => router.replace(query ? `/app/analytics?${query}` : '/app/analytics'));
  }

  return (
    <section
      aria-label={t('filters.label')}
      className="border-border bg-card rounded-lg border p-4 sm:p-5"
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-label text-muted-foreground uppercase">
            {t('filters.dateRange')}
          </span>
          <div className="border-border bg-muted/50 inline-flex w-fit max-w-full flex-wrap rounded-lg border p-1">
            {RANGE_ORDER.map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={selection.range === range}
                disabled={isPending}
                onClick={() => navigate((params) => params.set('range', range))}
                className={cn(
                  'focus-visible:ring-ring inline-flex min-h-11 min-w-16 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 disabled:opacity-60',
                  selection.range === range
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`filters.${RANGE_KEY[range]}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="analytics-account">{t('filters.account')}</Label>
            <FilterSelect
              id="analytics-account"
              value={selection.account ?? ''}
              disabled={isPending}
              onChange={(event) =>
                navigate((params) => {
                  if (event.target.value === '') params.delete('account');
                  else params.set('account', event.target.value);
                })
              }
            >
              <option value="">{t('filters.activeAccount')}</option>
              <option value="all">{t('filters.allAccounts')}</option>
              {options.accounts.map((account) => (
                <option key={account.tradingAccountId} value={account.tradingAccountId}>
                  {account.name}
                  {account.isArchived ? ` · ${t('filters.archived')}` : ''}
                </option>
              ))}
            </FilterSelect>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="analytics-strategy">{t('filters.strategy')}</Label>
            <FilterSelect
              id="analytics-strategy"
              value={selection.strategy ?? ''}
              disabled={isPending}
              onChange={(event) =>
                navigate((params) => {
                  if (event.target.value === '') params.delete('strategy');
                  else params.set('strategy', event.target.value);
                  params.delete('setup');
                  params.delete('version');
                })
              }
            >
              <option value="">{t('filters.allStrategies')}</option>
              {options.strategies.map((strategy) => (
                <option key={strategy.strategyId} value={strategy.strategyId}>
                  {strategy.label}
                  {strategy.isArchived ? ` · ${t('filters.archived')}` : ''}
                </option>
              ))}
            </FilterSelect>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="analytics-setup">{t('filters.setup')}</Label>
            <FilterSelect
              id="analytics-setup"
              value={selection.setup ?? ''}
              disabled={isPending}
              onChange={(event) =>
                navigate((params) => {
                  if (event.target.value === '') params.delete('setup');
                  else params.set('setup', event.target.value);
                  params.delete('version');
                })
              }
            >
              <option value="">{t('filters.allSetups')}</option>
              {setups.map((setup) => (
                <option key={setup.setupId} value={setup.setupId}>
                  {setup.label}
                  {setup.isArchived ? ` · ${t('filters.archived')}` : ''}
                </option>
              ))}
            </FilterSelect>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="analytics-version">{t('filters.version')}</Label>
            <FilterSelect
              id="analytics-version"
              value={selection.version ?? ''}
              disabled={isPending}
              onChange={(event) =>
                navigate((params) => {
                  if (event.target.value === '') params.delete('version');
                  else params.set('version', event.target.value);
                })
              }
            >
              <option value="">{t('filters.allVersions')}</option>
              {versions.map((version) => (
                <option key={version.strategyVersionId} value={version.strategyVersionId}>
                  {t('filters.versionOption', {
                    name: version.strategyName,
                    number: version.versionNumber,
                  })}
                </option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <div>
          <Link
            href="/app/analytics"
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> {t('filters.reset')}
          </Link>
        </div>
      </div>
    </section>
  );
}
