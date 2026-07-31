import { FlaskConical } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The demo-data marker.
 *
 * Every surface rendering `src/lib/demo/` fixtures carries one. This is not
 * decoration: the numbers are invented, they describe a trading product, and
 * an unlabelled screenshot of them would be a performance claim the product
 * has not earned. See docs/design-system.md §11.
 *
 * The icon is `aria-hidden` and the text carries the meaning, so the warning
 * survives with images off and in a screen reader.
 */
export function DemoBadge({
  className,
  children = 'Demo data',
}: {
  className?: string;
  children?: string;
}) {
  return (
    <span
      className={cn(
        'border-warning/30 bg-warning/10 text-warning inline-flex items-center gap-1.5 rounded-full border',
        'px-2.5 py-1 text-xs font-medium',
        className,
      )}
    >
      <FlaskConical className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * The fuller statement, for the top of a page built entirely from fixtures.
 * The badge alone says "this is demo data"; this says what that means.
 */
export function DemoDataNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'border-warning/30 bg-warning/5 flex flex-col gap-2 rounded-lg border p-4',
        'sm:flex-row sm:items-start sm:gap-3',
        className,
      )}
    >
      <FlaskConical className="text-warning size-4 shrink-0 sm:mt-0.5" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">
          Every figure on this page is fictional demo data
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          It exists to show what the product measures. It is not a backtest, not a customer account,
          and not an expected result. Trading involves risk of loss.
        </p>
      </div>
    </div>
  );
}
