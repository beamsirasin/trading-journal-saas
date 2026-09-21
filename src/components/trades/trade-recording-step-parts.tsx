'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Disclosure } from './trade-at-entry-controls';

/**
 * A CONCEPT, NOT A FIELD. One surface per idea the trader thinks in — the
 * account, what was traded, risk, the outcome — so a step reads as two or
 * three things instead of eight rows. Controls inside never add a second
 * border, and `filled` marks the one group a step is really about.
 */
export function GroupCard({
  title,
  aside,
  filled = false,
  children,
  ...rest
}: {
  /** Left out where the step's own heading already names the group. */
  title?: string;
  aside?: ReactNode;
  /** The step's own subject, given a tint rather than a heavier border. */
  filled?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section
      {...rest}
      className={cn(
        'border-border flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5',
        filled && 'bg-muted/30',
      )}
    >
      {title === undefined && aside === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title === undefined ? (
            <span aria-hidden="true" />
          ) : (
            <h3 className="text-foreground text-sm font-semibold">{title}</h3>
          )}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** A group whose contents stay folded behind their own summary. */
export function FoldedGroup({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-border min-w-0 rounded-lg border px-1 py-1 sm:px-1.5">
      <Disclosure id={id} title={title} summary={summary} open={open} onToggle={onToggle}>
        {children}
      </Disclosure>
    </div>
  );
}
