'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

/**
 * THE WAY BACK TO THE RECORDING-TIMING CHOICE — navigation, never discard.
 *
 * The Add Trade Recording Draft survives leaving this form (contract §23), so
 * changing mode asks nothing and warns about nothing: nothing is lost, and
 * choosing the other mode opens the same draft there. Only "Discard draft"
 * destroys it (UX Rules §5.3, §5.5).
 */
export function TradeRecordingModeChange() {
  const tMode = useTranslations('trades.create.mode');
  return (
    <Link
      href="/app/trades/new"
      data-recording-mode-change=""
      className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
    >
      {tMode('change')}
    </Link>
  );
}
