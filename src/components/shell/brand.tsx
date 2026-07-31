import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Wordmark. Placeholder identity — final branding is a later phase, so this
 * is deliberately typographic rather than a logo asset that would need
 * replacing.
 */
export function Brand({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-md font-semibold tracking-tight',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="from-primary to-brand inline-flex size-6 items-center justify-center rounded-md bg-gradient-to-br text-[11px] font-bold text-white"
      >
        T
      </span>
      <span>Trading OS</span>
    </Link>
  );
}
