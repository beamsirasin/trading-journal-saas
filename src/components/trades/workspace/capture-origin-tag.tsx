'use client';

import { useTranslations } from 'next-intl';

import type { CaptureOriginLabel } from '@/lib/trades/capture-origin';

/**
 * WHEN THIS ANSWER WAS CAPTURED, in plain words beside the value (UX Rules
 * §2.8). Neutral, never a warning: recalling an answer after close is
 * legitimate, it is only never the same evidence as one recorded at entry.
 * Renders nothing when nothing can honestly be said.
 */
export function CaptureOriginTag({ origin }: { origin: CaptureOriginLabel | null }) {
  const t = useTranslations('trades.workspace.details.origin');
  if (origin === null) return null;
  return (
    <span
      data-capture-origin={origin}
      className="text-muted-foreground border-control-border inline-flex w-fit items-center rounded-full border border-dashed px-2 py-0.5 text-xs"
    >
      {t(origin)}
    </span>
  );
}
