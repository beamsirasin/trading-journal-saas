'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The Trade Details panels' shared anatomy.
 *
 * SMALL LOGICAL GROUPS, NOT ONE GIANT STATS TABLE. A single 30-row list of
 * every field a Trade carries is technically complete and practically
 * unreadable; grouping the same facts under Result / Trade / Price / Cost is
 * what lets a reader find one of them in a glance. These primitives exist so
 * every panel groups them the same way rather than each inventing its own
 * spacing and label treatment.
 *
 * They are deliberately separate from `trade-detail-primitives.tsx`, which
 * serves the wider Trade Detail sections. Those are sized for a full page
 * column; these are sized for a sheet that is roughly half that width, where
 * a two-column label/value grid would leave neither half enough room.
 */
export function PanelSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-2', className)}>
      <h3 className="text-label text-muted-foreground uppercase">{title}</h3>
      {description === undefined ? null : (
        <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
      )}
      {children}
    </section>
  );
}

/** A two-column fact grid — one column on the narrowest sheets. */
export function FactGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2', className)}>
      {children}
    </dl>
  );
}

/**
 * One labelled fact.
 *
 * A `null` value renders this product's existing unavailable convention — an
 * em dash with an accessible "Not available" reading — and NEVER a zero, an
 * empty string, or a fabricated placeholder. That distinction is the whole
 * point of a journal: "no stop was recorded" and "the stop was 0" are
 * different facts about a trader's process.
 *
 * `omitWhenEmpty` lets a panel drop a row entirely rather than print a dash,
 * for facts that are genuinely inapplicable rather than merely missing — a
 * money-mode Trade has no exit PRICE, and a dash there would imply someone
 * forgot to record one.
 */
export function Fact({
  label,
  value,
  hint,
  omitWhenEmpty = false,
  tone,
}: {
  label: string;
  value: ReactNode | null;
  /** A short clarifying line beneath the value, for terms a beginner may not know. */
  hint?: string;
  omitWhenEmpty?: boolean;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const t = useTranslations('trades');
  if (omitWhenEmpty && (value === null || value === undefined || value === '')) return null;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-sm break-words',
          tone === 'positive' && 'text-positive numeric',
          tone === 'negative' && 'text-negative numeric',
          tone === 'neutral' && 'numeric',
        )}
      >
        {value === null || value === undefined || value === '' ? (
          <span className="text-subtle-foreground" aria-label={t('common.notAvailable')}>
            —
          </span>
        ) : (
          value
        )}
      </dd>
      {hint === undefined ? null : (
        <p className="text-subtle-foreground text-xs leading-snug">{hint}</p>
      )}
    </div>
  );
}

/**
 * A panel with nothing to show yet.
 *
 * Says what the panel WOULD hold and how it gets there — never just "No data"
 * (docs/design-system.md section 8). It carries no action button of its own
 * because the actions that fill these panels live in the panels themselves,
 * beside the data they change.
 */
export function PanelEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-border flex flex-col items-start gap-1.5 rounded-lg border border-dashed p-4">
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
    </div>
  );
}
