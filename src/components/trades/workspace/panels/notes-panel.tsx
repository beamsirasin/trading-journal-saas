'use client';

import { useTranslations } from 'next-intl';

import type { TradeDetail } from '@/server/dal/trades';
import { PanelEmpty } from '@/components/trades/workspace/panel-primitives';

/**
 * NOTES — the trader's own words, organised around when they were written.
 *
 * THREE PROMPTS, THREE FIELDS THAT ALREADY EXIST. The beginner-friendly
 * framing this page wants — why am I taking this, what happened, what will I
 * change — maps onto columns the domain already has, so it is presented as
 * that framing WITHOUT a migration:
 *
 *   Before the trade   `confirmation_notes`  the entry reason, captured at entry
 *   The trade itself   `notes`               the free journal note
 *   The lesson         `review_notes`        the post-trade review
 *
 * NO SCHEMA CHANGE IS MADE FOR THIS TAB. If the three prompts later deserve
 * genuinely separate fields — a distinct "lesson" column, say, rather than
 * reusing the post-trade review note — that is a product decision with a
 * migration behind it, not something a presentation pass should invent. The
 * grouping here is honest about what it is: existing fields, given the
 * headings that describe when they were written.
 *
 * THE LESSON IS READ-ONLY HERE, ON PURPOSE. `review_notes` is EDITED in the
 * Review tab, beside the rules and mistakes it summarises, and it is the field
 * the Review column's "Needs review" state tests. Two editors for one column,
 * two tabs apart, is how a trader loses a note to a stale form — so this tab
 * shows it and says where to change it.
 */
export function TradeNotesPanel({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades.workspace.details');

  const blocks = [
    { key: 'before', value: trade.confirmationNotes },
    { key: 'during', value: trade.notes },
    { key: 'lesson', value: trade.reviewNotes },
  ] as const;

  if (blocks.every((block) => block.value === null)) {
    return <PanelEmpty title={t('empty.notes.title')} description={t('empty.notes.description')} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {blocks.map((block) =>
        block.value === null ? null : (
          <section key={block.key} data-trade-note={block.key} className="min-w-0">
            <h3 className="text-label text-muted-foreground uppercase">
              {t(`notes.${block.key}.label`)}
            </h3>
            <p className="text-subtle-foreground mt-0.5 text-xs">
              {t(`notes.${block.key}.prompt`)}
            </p>
            <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
              {block.value}
            </p>
          </section>
        ),
      )}
      <p className="text-subtle-foreground border-border border-t pt-3 text-xs leading-relaxed">
        {t('notes.editHint')}
      </p>
    </div>
  );
}
