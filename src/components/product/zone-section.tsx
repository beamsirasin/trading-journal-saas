import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/product/page-header';

/**
 * The three Analytics zones (Phase 15A §8) — Results / Edge / Behavior.
 * Colour is chrome only (header accent, icon, subtle tint, selected state),
 * never the only signal and never a saturated full-card fill (brief §4).
 */
export const ZONE_KEYS = ['results', 'edge', 'behavior'] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

const ZONE_ACCENT_CLASS: Record<ZoneKey, string> = {
  results: 'text-zone-results border-zone-results',
  edge: 'text-zone-edge border-zone-edge',
  behavior: 'text-zone-behavior border-zone-behavior',
};

const ZONE_TINT_CLASS: Record<ZoneKey, string> = {
  results: 'bg-zone-results/5',
  edge: 'bg-zone-edge/5',
  behavior: 'bg-zone-behavior/5',
};

/**
 * A zone-accented section heading — thin reuse of `SectionHeader`, not a
 * parallel heading component. Adds exactly the chrome the brief asks for: a
 * coloured icon, a coloured left rule, and (optionally) a very subtle tint on
 * the section band beneath it. No content composition happens here yet — the
 * Analytics Overview/Explore layout itself is Phase 15C/15D's job.
 */
export function ZoneSection({
  zone,
  icon: Icon,
  title,
  description,
  actions,
  id,
  tinted = false,
  className,
  children,
}: {
  zone: ZoneKey;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  title: string;
  description?: string;
  actions?: ReactNode;
  id?: string;
  /** A very light background tint on the whole band — used sparingly, never a saturated fill. */
  tinted?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        'border-border bg-card flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5',
        ZONE_ACCENT_CLASS[zone].split(' ')[0],
        tinted && ZONE_TINT_CLASS[zone],
        className,
      )}
      {...(id === undefined ? {} : { 'aria-labelledby': id })}
    >
      <SectionHeader
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(id === undefined ? {} : { id })}
        actions={
          <div className="flex items-center gap-2">
            {Icon === undefined ? null : (
              <Icon className={cn('size-5 shrink-0', ZONE_ACCENT_CLASS[zone])} aria-hidden="true" />
            )}
            {actions}
          </div>
        }
      />
      {children}
    </section>
  );
}
