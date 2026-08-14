'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

import { PlanField } from './trade-plan-field';

type ChipKind = 'favorite' | 'suggestion' | 'recent';
interface Chip {
  readonly value: string;
  readonly kind: ChipKind;
}

/** Favorites first, then default suggestions, then recents — deduplicated, order-stable. */
function buildChips(
  favorites: readonly string[],
  suggestions: readonly string[],
  recents: readonly string[],
): readonly Chip[] {
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const value of favorites) {
    if (seen.has(value)) continue;
    seen.add(value);
    chips.push({ value, kind: 'favorite' });
  }
  for (const value of suggestions) {
    if (seen.has(value)) continue;
    seen.add(value);
    chips.push({ value, kind: 'suggestion' });
  }
  for (const value of recents) {
    if (seen.has(value)) continue;
    seen.add(value);
    chips.push({ value, kind: 'recent' });
  }
  return chips;
}

/**
 * A plain text Input (a custom value always remains typeable — CLAUDE.md's
 * "no market-data/instrument master system" instruction rules out ever
 * restricting input to a closed list) plus a row of quick-reuse chips
 * sourced from Favorites, optional built-in suggestions (Timeframe/Session
 * only — Symbol intentionally ships with none, per the Founder-UAT slice's
 * "no hard-coded assumptions about what everyone trades"), and Recents.
 * Favorites persist per-Workspace in `localStorage`
 * (`useTradePlanFavorites`) — see that hook's doc comment for why this is
 * browser-local rather than a server preference in this slice.
 */
export function TradeQuickSelectField({
  id,
  label,
  value,
  onChange,
  favorites,
  recents,
  suggestions = [],
  onToggleFavorite,
  error,
  optional,
  transform,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  favorites: readonly string[];
  recents: readonly string[];
  suggestions?: readonly string[] | undefined;
  onToggleFavorite: (value: string) => void;
  error?: string | undefined;
  optional?: boolean | undefined;
  transform?: ((value: string) => string) | undefined;
}) {
  const t = useTranslations('trades');
  const chips = buildChips(favorites, suggestions, recents);
  const trimmedValue = value.trim();
  const isCurrentValueFavorite = trimmedValue !== '' && favorites.includes(trimmedValue);

  return (
    <PlanField id={id} label={label} optional={optional} error={error}>
      <Input
        id={id}
        value={value}
        onChange={(event) =>
          onChange(transform ? transform(event.target.value) : event.target.value)
        }
        autoComplete="off"
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={t('create.quickSelect.groupLabel', { label })}
      >
        {chips.map((chip) => {
          const isFavorite = chip.kind === 'favorite';
          const isActive = trimmedValue !== '' && trimmedValue === chip.value;
          return (
            <span
              key={chip.value}
              className={cn(
                'flex items-stretch overflow-hidden rounded-full border text-xs',
                isActive ? 'border-primary bg-primary/10' : 'border-border bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => onChange(chip.value)}
                className="hover:bg-accent/60 min-h-8 px-2.5 py-1 font-medium"
              >
                {chip.value}
              </button>
              <button
                type="button"
                onClick={() => onToggleFavorite(chip.value)}
                aria-pressed={isFavorite}
                aria-label={
                  isFavorite
                    ? t('create.quickSelect.removeFavorite', { value: chip.value })
                    : t('create.quickSelect.addFavorite', { value: chip.value })
                }
                className="border-border/70 text-muted-foreground hover:text-warning flex min-h-8 min-w-8 items-center justify-center border-l"
              >
                <Star aria-hidden="true" size={13} className={isFavorite ? 'fill-current' : ''} />
              </button>
            </span>
          );
        })}
        {trimmedValue === '' || isCurrentValueFavorite ? null : (
          <button
            type="button"
            onClick={() => onToggleFavorite(trimmedValue)}
            className="text-muted-foreground hover:text-warning inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium"
          >
            <Star aria-hidden="true" size={13} />
            {t('create.quickSelect.addCurrent', { value: trimmedValue })}
          </button>
        )}
      </div>
    </PlanField>
  );
}
