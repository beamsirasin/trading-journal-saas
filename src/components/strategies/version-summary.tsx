'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

export interface VersionHistoryEntry {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly isLocked: boolean;
  readonly changeNote: string | null;
  /** Pre-formatted in the user's own timezone (CLAUDE.md §7) — never a raw `Date` crossing into a client component. */
  readonly createdAtDisplay: string;
}

/**
 * Version 10.C — current Version status plus a lightweight history summary.
 * Deliberately not a diff viewer or a restore-old-version control (explicit
 * non-goal); each entry shows only what the DAL's `versionHistory` read
 * already exposes (Version number, locked state, change note, created date).
 */
export function VersionSummary({
  versionNumber,
  isLocked,
  versionCount,
  versionHistory,
}: {
  versionNumber: number;
  isLocked: boolean;
  versionCount: number;
  versionHistory: readonly VersionHistoryEntry[];
}) {
  const t = useTranslations('strategies');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="brand">{t('currentVersionBadge', { number: versionNumber })}</Badge>
        <Badge variant={isLocked ? 'neutral' : 'positive'}>
          {isLocked ? t('lockedVersion') : t('editableVersion')}
        </Badge>
      </div>
      {versionCount > 1 ? (
        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground min-h-11 cursor-pointer text-sm select-none">
            {t('versionHistoryToggle', { count: versionCount })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {versionHistory.map((entry) => (
              <li key={entry.versionId} className="border-border rounded-md border p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-foreground font-medium">
                    {t('versionNumberLabel', { number: entry.versionNumber })}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.isLocked ? t('lockedVersion') : t('editableVersion')}
                  </span>
                </div>
                {entry.changeNote === null ? null : (
                  <p className="text-muted-foreground mt-1.5 leading-relaxed">{entry.changeNote}</p>
                )}
                <p className="text-muted-foreground mt-1.5">{entry.createdAtDisplay}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
