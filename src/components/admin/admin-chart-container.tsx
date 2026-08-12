import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The admin-scoped equivalent of `src/components/product/chart-container.tsx`
 * — deliberately a SEPARATE component, not a reuse of that one. That
 * component unconditionally calls `useTranslations('common')` (for its
 * optional line-style legend text), which requires a `NextIntlClientProvider`
 * in the tree; `/admin` deliberately has none (Phase 11's EN-only,
 * `next-intl`-free contract), so rendering it here throws immediately. This
 * component keeps the same accessible structure — a real `<figure>` with a
 * `<figcaption>` stating the takeaway in words, and a visually-hidden
 * `tableFallback` data table alternative — without the i18n dependency and
 * without the legend feature this dashboard's single-series charts never use.
 */
export function AdminChartContainer({
  title,
  titleId,
  description,
  caption,
  tableFallback,
  children,
  className,
}: {
  title: string;
  titleId?: string | undefined;
  description?: string | undefined;
  /** Stated below the plot. Says what the reader should take from it. */
  caption: string;
  /** A `<table>` carrying the same numbers. Visually hidden, not removed. */
  tableFallback: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <figure
      className={cn(
        'bg-card border-border flex flex-col gap-4 rounded-lg border p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 {...(titleId === undefined ? {} : { id: titleId })} className="text-card-title">
          {title}
        </h3>
        {description === undefined ? null : (
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        )}
      </div>

      {/* `min-w-0` matters: a flex child defaults to min-width:auto, which lets the SVG refuse to shrink and pushes the page into horizontal overflow on small screens. */}
      <div className="min-w-0">{children}</div>

      <figcaption className="text-muted-foreground text-xs leading-relaxed">{caption}</figcaption>

      <div className="sr-only">{tableFallback}</div>
    </figure>
  );
}
