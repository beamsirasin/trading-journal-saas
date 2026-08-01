'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { DEMO_ACCOUNTS, DEMO_RANGES, type DemoRangeId } from '@/lib/demo';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * Dashboard filters.
 *
 * The account picker is a native `<select>` rather than a Radix listbox. On a
 * phone that opens the platform's own wheel picker, which is easier to
 * operate one-handed than any custom menu, and it is keyboard and screen
 * reader correct with no code. The design system's rule is mobile-friendly
 * controls, and the mobile-friendly control here is the native one.
 *
 * The date range is a segmented control because there are only three options
 * and seeing them all at once is the point — a select would hide two thirds
 * of a control the user is meant to sweep through.
 *
 * Range labels are translated by mapping each fixture's `id` to a
 * `dashboard.filters.*` key rather than reading `label`/`description` off
 * `DEMO_RANGES` directly — that fixture is pure, locale-independent data.
 * Account *names* ("Prop challenge — 100K") are left as the fixture wrote
 * them: they read as a trader's own nicknames for their accounts, the same
 * category as a symbol or strategy name, not UI chrome. The "All accounts"
 * option is the one exception, since it is chrome the product supplies.
 */
const RANGE_LABEL_KEY: Record<DemoRangeId, 'range30' | 'range90' | 'rangeAll'> = {
  '30d': 'range30',
  '90d': 'range90',
  all: 'rangeAll',
};
const RANGE_DESCRIPTION_KEY: Record<DemoRangeId, 'range30Full' | 'range90Full' | 'rangeAllFull'> = {
  '30d': 'range30Full',
  '90d': 'range90Full',
  all: 'rangeAllFull',
};

export function DashboardFilters({
  range,
  onRangeChange,
  accountId,
  onAccountChange,
}: {
  range: DemoRangeId;
  onRangeChange: (range: DemoRangeId) => void;
  accountId: string;
  onAccountChange: (accountId: string) => void;
}) {
  const t = useTranslations('dashboard.filters');
  const selectId = useId();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={selectId} className="text-muted-foreground text-label uppercase">
          {t('tradingAccount')}
        </label>
        <div className="relative">
          <select
            id={selectId}
            value={accountId}
            onChange={(event) => onAccountChange(event.target.value)}
            className={[
              'border-input bg-card text-foreground h-11 w-full min-w-0 appearance-none rounded-md border',
              'py-2 pr-9 pl-3 text-sm',
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
              'sm:w-64',
            ].join(' ')}
          >
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.id} value={account.id}>
                {account.id === 'all' ? t('allAccounts') : account.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-muted-foreground text-label uppercase" id="range-label">
          {t('dateRange')}
        </span>
        <SegmentedControl
          legend={t('dateRange')}
          value={range}
          onValueChange={onRangeChange}
          options={DEMO_RANGES.map((r) => ({
            value: r.id,
            label: t(RANGE_LABEL_KEY[r.id]),
            description: t(RANGE_DESCRIPTION_KEY[r.id]),
          }))}
        />
      </div>
    </div>
  );
}
