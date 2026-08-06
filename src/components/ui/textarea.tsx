import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * PROJECT-AUTHORED, matching `input.tsx`'s conventions (border/background/
 * focus-ring/invalid treatment) rather than shadcn's default — kept as its
 * own file rather than duplicated per call site now that the Strategy forms
 * need a second multi-line field beyond `ChangeNoteField`'s original inline copy.
 */
export function Textarea({
  className,
  rows = 3,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(
        'border-input bg-background text-foreground flex w-full min-w-0 rounded-md border px-3 py-2 text-base',
        'placeholder:text-muted-foreground',
        'transition-[color,box-shadow] outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}
