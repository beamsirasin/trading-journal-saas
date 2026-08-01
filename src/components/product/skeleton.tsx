import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * A loading placeholder.
 *
 * `animate-pulse` passes through the global reduced-motion guard in
 * globals.css, which collapses its duration — so the shape still communicates
 * "content is coming" without anything moving.
 *
 * Skeletons are `aria-hidden`: a screen reader should hear one "Loading"
 * status, not a dozen meaningless boxes. Callers pair a block of these with a
 * single `role="status"` region — see `SkeletonSurface`.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('bg-muted animate-pulse rounded-md', className)} />;
}

/**
 * Wraps a group of skeletons with the one announcement they should make
 * between them.
 */
export function SkeletonSurface({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('loading');

  return (
    <div className={className}>
      <span className="sr-only" role="status">
        {label ?? t('label')}
      </span>
      {children}
    </div>
  );
}

/** The dashboard's loading shape — mirrors the real layout so nothing shifts. */
export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
