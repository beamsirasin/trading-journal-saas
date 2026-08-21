import type { BadgeVariant } from '@/components/ui/badge';

/**
 * The shared customer-facing status vocabulary — Phase 15B
 * (docs/phases/PHASE-15-ux-simplification.md §31, and the Phase 15B brief's
 * "STATUS SEMANTICS"/"VISUAL STATUS CONTRACT"). Every surface that shows a
 * Trade-section or data-readiness state (Trade Detail's section nav today;
 * Analytics and Trade Log in later slices) reads from this ONE vocabulary so
 * "amber" and "not recorded" always mean the same thing everywhere.
 *
 * Deliberately eight states, no more — this is NOT a generic completion
 * percentage (CLAUDE.md's "no fake completeness scores", Phase 15A §10) and
 * is not meant to grow ad hoc per feature. `partial` sits between `complete`
 * and the three "nothing to see yet" states (`not_recorded`,
 * `not_recorded_at_entry`, `not_configured`) without inventing a distinct
 * colour for it — those four intentionally share the neutral colour and are
 * told apart by icon + label text, never colour alone, so the product never
 * becomes a "rainbow status UI".
 */
export const STATUS_KINDS = [
  'complete',
  'active',
  'needs_attention',
  'partial',
  'not_recorded',
  'not_recorded_at_entry',
  'not_configured',
  'error',
] as const;

export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * Colour mapping — §3 of the brief: green=complete, blue=active,
 * amber=actionable attention, neutral=optional/missing, red=error only.
 * `error` is reserved for genuine validation/system errors and must never be
 * produced by an ordinary missing/optional Trade field.
 */
export const STATUS_BADGE_VARIANT: Record<StatusKind, BadgeVariant> = {
  complete: 'positive',
  active: 'info',
  needs_attention: 'warning',
  partial: 'neutral',
  not_recorded: 'neutral',
  not_recorded_at_entry: 'neutral',
  not_configured: 'neutral',
  error: 'negative',
};

/**
 * Icon identity — kept distinct per state even where colour is shared (the
 * three neutral "nothing recorded" states use three different glyphs) so
 * status is never carried by colour alone (brief §3, CLAUDE.md §8
 * accessibility baseline). Values are `lucide-react` export names; the
 * mapping to actual components lives in `status-badge.tsx` so this module
 * stays framework-agnostic and independently unit-testable.
 */
export const STATUS_ICON_NAME: Record<
  StatusKind,
  | 'CheckCircle2'
  | 'CircleDot'
  | 'AlertCircle'
  | 'CircleDashed'
  | 'Circle'
  | 'History'
  | 'MinusCircle'
  | 'AlertTriangle'
> = {
  complete: 'CheckCircle2',
  active: 'CircleDot',
  needs_attention: 'AlertCircle',
  partial: 'CircleDashed',
  not_recorded: 'Circle',
  not_recorded_at_entry: 'History',
  not_configured: 'MinusCircle',
  error: 'AlertTriangle',
};
