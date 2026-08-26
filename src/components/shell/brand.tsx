import type { MouseEventHandler } from 'react';

import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';

const MARK_SIZE = {
  default: 'size-7 rounded-lg text-xs',
  lg: 'size-8 rounded-lg text-sm',
} as const;

const WORDMARK_SIZE = {
  default: 'text-base',
  lg: 'text-lg',
} as const;

/**
 * Wordmark. Deliberately typographic rather than a logo asset, so replacing
 * it later is a design decision rather than an asset migration.
 *
 * This component is the ONE place the customer-facing product name is drawn —
 * the application shell, the mobile drawer, and the marketing header/footer
 * all read it from here, which is why changing the displayed brand is a
 * single edit.
 *
 * Everything a CUSTOMER reads now says "TradeChemist": this wordmark, the
 * browser title template (`metadata.brandName`), the marketing disclaimer and
 * feature copy, and the appearance-settings description.
 *
 * INTERNAL identifiers deliberately still say "Trading OS" — the repository,
 * the database, environment variables (`EMAIL_FROM_NAME`), the admin console's
 * own label, and the transactional email templates. That is not an oversight:
 * renaming those touches schema, infrastructure and deliverability, whereas
 * renaming what a customer reads is presentation. Do not "finish the job"
 * here by find-and-replacing the rest — that needs its own decision and its
 * own change.
 *
 * `shrink-0` plus `whitespace-nowrap` on the text: without them, the header's
 * flex row can run out of room near the desktop-navigation breakpoint, and
 * flexbox assigns the
 * entire shrink deficit to whichever item can still compress — normally that
 * is this text node, since nav links and buttons are already at their
 * minimum content width. The visible result was "OS" wrapping onto its own
 * line to recover a fraction of a pixel. Protecting the wordmark forces any
 * future shrinkage to land somewhere it is actually safe to absorb.
 *
 * `compact`: both sticky headers — the application shell's and the marketing
 * site's — pack this alongside fixed-size 44px touch targets with nothing
 * left that is safe to shrink. At the very smallest viewport their combined
 * minimum width still exceeds the screen with the wordmark included, and no
 * touch target may drop below 44px to make room — so `compact` hides the
 * wordmark TEXT (keeping the mark, so identity is not lost, only the label)
 * and restores it once there is room.
 *
 * The threshold is 360px, MEASURED rather than guessed: with the wordmark
 * shown the row needs 313px, and 360px is the narrowest common viewport
 * whose 24px-gutter content box (336px) clears it — 320px offers 296px and
 * does not. It was 390px until the mobile header stopped carrying the
 * language and theme controls; removing those two 44px buttons is exactly
 * what bought the wordmark two more breakpoints. RE-MEASURE if a control is
 * ever added back to this row; do not nudge this number by eye. Callers with
 * their own width (the desktop sidebar, the mobile drawer, the marketing
 * header/footer) leave this at its default and always show the full wordmark.
 *
 * `compact` is the ONLY circumstance in which the wordmark is ever hidden.
 * There is deliberately no "mark-only" mode, even though the desktop sidebar
 * collapses to an icon rail again: the brand does not live in that panel. It
 * lives in the global header, which spans the full viewport at every width
 * and never changes with the sidebar's state — so cropping navigation to a
 * rail costs the product nothing of its name, and this component never needs
 * to reduce itself to a bare "T".
 */
export function Brand({
  href = '/',
  className,
  onClick,
  compact = false,
  size = 'default',
}: {
  href?: string;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  compact?: boolean;
  size?: 'default' | 'lg';
}) {
  return (
    <Link
      href={href}
      {...(onClick === undefined ? {} : { onClick })}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-2.5 rounded-md font-semibold tracking-tight',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'from-primary to-brand text-primary-foreground shadow-control inline-flex shrink-0 items-center justify-center bg-gradient-to-br font-bold',
          MARK_SIZE[size],
        )}
      >
        T
      </span>
      <span
        className={cn(
          'shrink-0 whitespace-nowrap',
          WORDMARK_SIZE[size],
          compact && 'hidden min-[360px]:inline',
        )}
      >
        TradeChemist
      </span>
    </Link>
  );
}
