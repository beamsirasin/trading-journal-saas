import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

/** A label/value row inside a `<dl>` — shared across every Trade Detail section. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[minmax(130px,0.7fr)_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

/** One conceptual Trade Detail section's own heading — one level below Trade Overview's `<h2>` Symbol. */
export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 {...(id === undefined ? {} : { id })} className="text-card-title mb-3">
      {children}
    </h3>
  );
}

/**
 * A named sub-grouping within one section (e.g. Trade Management vs.
 * Post-Trade Review inside Review; Plan inside Entry Snapshot). An optional
 * `id` wires `aria-labelledby` so the group is independently addressable by
 * accessible name — e.g. `getByLabel('Plan')` — the same contract
 * `SectionTitle`'s top-level sections already offer.
 */
export function SubSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3" {...(id === undefined ? {} : { 'aria-labelledby': id })}>
      <h4 {...(id === undefined ? {} : { id })} className="font-semibold">
        {title}
      </h4>
      {children}
    </div>
  );
}

/** Truthful "archived" disclosure for a LIVE Strategy/Setup/Account — never hides a historical pinned label, only annotates it (Phase 13G §3/§14). */
export function ArchivedBadge({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return <Badge>{label}</Badge>;
}
