'use client';

import { CalendarDays, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import type { TradesView } from '@/lib/trades/view';
import { cn } from '@/lib/utils';
import { Link, usePathname } from '@/i18n/navigation';

export function TradesViewNav({ view }: { readonly view: TradesView }) {
  const t = useTranslations('trades.views');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function href(nextView: TradesView): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    params.delete('trade');
    // Both Trade Details tab contracts: the retired five-section `?section=`
    // and the workspace sheet's `?tab=`. Neither means anything without a
    // selected Trade, and leaving one behind would seed the next Trade opened
    // with a tab the reader never chose.
    params.delete('section');
    params.delete('tab');
    if (nextView === 'calendar') {
      params.delete('cursor');
      params.delete('trail');
      params.delete('attention');
    }
    return `${pathname}?${params.toString()}`;
  }

  return (
    <nav aria-label={t('label')} className="border-border inline-flex w-fit rounded-lg border p-1">
      {(['calendar', 'log'] as const).map((item) => {
        const Icon = item === 'calendar' ? CalendarDays : List;
        return (
          <Link
            key={item}
            href={href(item)}
            aria-current={view === item ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2',
              view === item
                ? 'bg-surface-raised text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {t(item)}
          </Link>
        );
      })}
    </nav>
  );
}
