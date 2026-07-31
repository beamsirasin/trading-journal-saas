import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The empty state for a data surface.
 *
 * `action` is not optional by accident — an empty state that only says "no
 * data" is not finished (docs/design-system.md §8). It has to tell the user
 * what to do next, so the API makes the next action a required part of the
 * shape rather than something a caller can forget.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center gap-4 rounded-lg border border-dashed',
        'px-6 py-12 text-center',
        className,
      )}
    >
      <span className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <div className="flex max-w-sm flex-col gap-1.5">
        <p className="text-foreground font-medium">{title}</p>
        <p className="text-muted-foreground text-sm leading-relaxed text-pretty">{description}</p>
      </div>

      {action}
    </div>
  );
}
