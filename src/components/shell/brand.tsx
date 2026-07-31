import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Wordmark. Placeholder identity — final branding is a later phase, so this
 * is deliberately typographic rather than a logo asset that would need
 * replacing.
 *
 * `shrink-0` plus `whitespace-nowrap` on the text: without them, the header's
 * flex row runs out of room by a sub-pixel margin at exactly 768px (the `md`
 * breakpoint where the desktop nav first appears), and flexbox assigns the
 * entire shrink deficit to whichever item can still compress — normally that
 * is this text node, since nav links and buttons are already at their
 * minimum content width. The visible result was "OS" wrapping onto its own
 * line to recover a fraction of a pixel. Protecting the wordmark forces any
 * future shrinkage to land somewhere it is actually safe to absorb.
 */
export function Brand({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="from-primary to-brand inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-[11px] font-bold text-white"
      >
        T
      </span>
      <span className="whitespace-nowrap">Trading OS</span>
    </Link>
  );
}
