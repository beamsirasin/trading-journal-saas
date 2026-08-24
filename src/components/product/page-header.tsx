import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The heading block every application page opens with.
 *
 * Owns the single `<h1>`. Centralising it is what keeps "one meaningful
 * primary heading per page" true as pages are added — a rule that is easy to
 * state and easy to break when each route hand-rolls its own header.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: string;
  description?: string;
  /** Buttons and controls, right-aligned on desktop, stacked on mobile. */
  actions?: ReactNode;
  /** Badges and status markers rendered beside the title. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between', className)}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-page-title text-balance">{title}</h1>
          {meta}
        </div>
        {description === undefined ? null : (
          <p className="text-muted-foreground max-w-2xl text-sm leading-normal text-pretty">
            {description}
          </p>
        )}
      </div>

      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div>
      )}
    </div>
  );
}

/**
 * A heading for a region within a page. Renders `<h2>` by default so heading
 * order stays sensible under the page's single `<h1>`.
 */
export function SectionHeader({
  title,
  description,
  actions,
  id,
  as: Heading = 'h2',
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Set when a landmark uses `aria-labelledby` to point at this heading. */
  id?: string;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading
          {...(id === undefined ? {} : { id })}
          className={Heading === 'h2' ? 'text-card-title' : 'text-sm font-semibold'}
        >
          {title}
        </Heading>
        {description === undefined ? null : (
          <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
