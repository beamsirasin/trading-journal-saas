import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * PROJECT-AUTHORED table primitives.
 *
 * Real table semantics, not a grid of divs: screen readers announce row and
 * column position from `<table>`, and nothing reproduces that with ARIA
 * without getting it subtly wrong.
 *
 * `TableScroller` is mandatory around a wide table. The design system forbids
 * horizontal PAGE overflow (docs/design-system.md §6) but wide financial data
 * is legitimate — so the scroll is contained here instead of escaping to the
 * viewport. `tabIndex={0}` makes the scroll region keyboard-reachable, which
 * a plain `overflow-x-auto` div is not.
 */
export function TableScroller({
  className,
  children,
  label,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div
      className={cn('w-full overflow-x-auto', 'focus-visible:outline-ring rounded-md', className)}
      tabIndex={0}
      role="region"
      aria-label={label}
      {...props}
    >
      {children}
    </div>
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-border hover:bg-accent border-b transition-colors', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'text-muted-foreground h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-3 align-middle', className)} {...props} />;
}

export function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn('text-muted-foreground mt-3 text-xs', className)} {...props} />;
}
