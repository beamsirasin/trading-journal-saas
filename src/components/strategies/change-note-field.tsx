'use client';

import { useTranslations } from 'next-intl';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Explains, before submission, what saving will do to the current Version —
 * never exposes database mechanics (`current_version_id`, `locked_at`),
 * only the user-facing consequence (Phase 06E brief §6).
 */
export function VersionEditNotice({ isLocked }: { isLocked: boolean }) {
  const t = useTranslations('strategies');
  return (
    <p className="text-muted-foreground border-border bg-muted/30 rounded-md border p-3 text-sm leading-relaxed">
      {isLocked ? t('versionNotice.locked') : t('versionNotice.unlocked')}
    </p>
  );
}

/**
 * Rendered only while the current Version is locked — `strategy-management.ts`
 * rejects a blank Change note in that case (`change_note_required`), so the
 * field simply does not exist in the unlocked case rather than being present
 * but optional; the server remains the authority, this is a UX affordance.
 */
export function ChangeNoteField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations('strategies');
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('changeNoteLabel')}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        required
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
      />
      <p id={hintId} className="text-muted-foreground text-xs leading-relaxed">
        {t('changeNoteHint')}
      </p>
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
