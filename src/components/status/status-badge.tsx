import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  History,
  MinusCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { STATUS_BADGE_VARIANT, STATUS_ICON_NAME, type StatusKind } from '@/lib/status/status-kind';
import { Badge } from '@/components/ui/badge';

const ICON_COMPONENT = {
  CheckCircle2,
  CircleDot,
  AlertCircle,
  CircleDashed,
  Circle,
  History,
  MinusCircle,
  AlertTriangle,
} as const;

const STATUS_MESSAGE_KEY: Record<StatusKind, string> = {
  complete: 'complete',
  active: 'active',
  needs_attention: 'needsAttention',
  partial: 'partial',
  not_recorded: 'notRecorded',
  not_recorded_at_entry: 'notRecordedAtEntry',
  not_configured: 'notConfigured',
  error: 'error',
};

/**
 * The one shared status indicator — Phase 15B. Renders the vocabulary from
 * `lib/status/status-kind.ts` as icon + coloured badge + text, so no future
 * call site (Trade Detail's section nav today; Analytics/Trade Log in later
 * slices) reinvents its own status colours.
 *
 * `label` overrides the default vocabulary text for a more specific reading
 * (e.g. "Open" instead of the generic "Active" for a Trade's Actual step) —
 * the colour/icon/status meaning never changes, only the words.
 */
export function StatusBadge({
  kind,
  label,
  className,
}: {
  kind: StatusKind;
  /** Overrides the default vocabulary label; the underlying `kind` still drives colour/icon/a11y semantics. */
  label?: string;
  className?: string;
}) {
  const t = useTranslations('status');
  const Icon = ICON_COMPONENT[STATUS_ICON_NAME[kind]];
  const text = label ?? t(STATUS_MESSAGE_KEY[kind]);

  return (
    <Badge variant={STATUS_BADGE_VARIANT[kind]} className={className}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </Badge>
  );
}
