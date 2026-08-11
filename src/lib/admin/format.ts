/**
 * Shared UTC-explicit date formatting for the new Phase 11D Admin surfaces —
 * every operator-facing date across `/admin` is UTC (Phase 11's locked
 * "operator timezone is UTC" contract), never the server's or browser's
 * local zone. `src/components/admin/admin-overview-page.tsx` (Phase 11C)
 * keeps its own private equivalent rather than importing this one, to avoid
 * touching already-verified code for a cosmetic consolidation.
 */

export function formatUtcDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

export function formatUtcDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(iso));
}
