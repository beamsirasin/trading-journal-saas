'use client';

import { Check, Plus, Search, Star } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * THE SYMBOL PICKER — a list of the trader's own instruments, not a catalogue.
 *
 * WHY THERE ARE NO CATEGORY TABS. This product has no instrument catalogue and
 * deliberately does not want one: `trades.symbol` is free text because
 * `US30.cash`, `XAUUSD.m` and `BTCUSDT` are the names a particular broker and a
 * particular trader use, and no list shipped in this repository would stay
 * right for long. Grouping by Forex / Metals / Indices / Crypto would therefore
 * mean either inventing that catalogue or guessing a category from the string —
 * and the guess breaks on exactly the symbols that need it most. The sections
 * below are the ones the data can actually stand behind: what this trader
 * marked, what this browser has seen them use, and what this workspace has
 * already recorded trades against.
 *
 * TYPING IS STILL THE ANSWER. The search box is the same free-text field it
 * always was — it filters the list as you go, and whatever is in it can be
 * recorded whether or not anything matched. A search with no exact match
 * offers itself as a new symbol, which is how a first trade on a new
 * instrument gets recorded without ever leaving the list.
 */
export interface TradeSymbolPickerLabels {
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly favorites: string;
  readonly recent: string;
  readonly workspace: string;
  readonly addCustom: string;
  /*
    THESE THREE NAME A SYMBOL, so they are formatters rather than strings with
    a placeholder left in them. The message catalogue fills its own
    placeholders; asking it for a message with an unfilled one back hands the
    caller the raw key, which is what this rendered before it took functions.
  */
  readonly addTyped: (symbol: string) => string;
  readonly noMatches: string;
  readonly empty: string;
  readonly favoriteOn: (symbol: string) => string;
  readonly favoriteOff: (symbol: string) => string;
  readonly selected: string;
}

interface SymbolRow {
  readonly symbol: string;
  readonly section: 'favorites' | 'recent' | 'workspace';
}

/** Case-insensitive match on the symbol as written; no normalisation is assumed. */
function matches(symbol: string, query: string): boolean {
  return query === '' || symbol.toUpperCase().includes(query.toUpperCase());
}

export function TradeSymbolPicker({
  id,
  value,
  onChange,
  favorites,
  recents,
  workspaceSymbols,
  onToggleFavorite,
  labels,
}: {
  id: string;
  /** The recorded symbol, exactly as the trader wrote it. */
  value: string;
  onChange: (symbol: string) => void;
  favorites: readonly string[];
  recents: readonly string[];
  /** Symbols this workspace has already recorded Trades against. */
  workspaceSymbols: readonly string[];
  onToggleFavorite: (symbol: string) => void;
  labels: TradeSymbolPickerLabels;
}) {
  /*
    THE QUERY IS THE VALUE, until a row is picked. Typing edits the draft
    directly — the same free-text field this always was — so a symbol nobody
    has traded before is recorded by typing it and nothing else, and the draft
    survives a reload mid-search exactly as it did before.
  */
  const query = value;
  const trimmed = query.trim();
  const listId = useId();
  const [active, setActive] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  const seen = new Set<string>();
  const rows: SymbolRow[] = [];
  const push = (symbol: string, section: SymbolRow['section']) => {
    const key = symbol.trim().toUpperCase();
    if (key === '' || seen.has(key) || !matches(symbol, trimmed)) return;
    seen.add(key);
    rows.push({ symbol, section });
  };
  for (const symbol of favorites) push(symbol, 'favorites');
  for (const symbol of recents) push(symbol, 'recent');
  for (const symbol of workspaceSymbols) push(symbol, 'workspace');

  /*
    OFFER WHAT WAS TYPED when no row already IS it. An exact match means the
    list already holds it and the row is the thing to press; anything else —
    including a query that matched rows as a substring — is a symbol in its own
    right that the trader may well mean.
  */
  const exact = rows.some((row) => row.symbol.trim().toUpperCase() === trimmed.toUpperCase());
  const offerTyped = trimmed !== '' && !exact;

  const select = (symbol: string) => {
    onChange(symbol);
    setActive(-1);
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = active + step;
      setActive(next < 0 ? rows.length - 1 : next >= rows.length ? 0 : next);
      return;
    }
    if (event.key === 'Enter' && active >= 0) {
      // Enter with a row highlighted takes that row; with none, the text the
      // trader typed is already the answer and Enter must not submit the form.
      event.preventDefault();
      const row = rows[active];
      if (row !== undefined) select(row.symbol);
    }
  }

  const sections = [
    { key: 'favorites' as const, label: labels.favorites },
    { key: 'recent' as const, label: labels.recent },
    { key: 'workspace' as const, label: labels.workspace },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-symbol-picker="">
      <div className="bg-background border-control-border focus-within:border-ring focus-within:ring-ring/40 flex min-w-0 items-center gap-2 rounded-lg border px-3 focus-within:ring-[3px]">
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <input
          id={id}
          ref={searchRef}
          type="text"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={labels.searchLabel}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          placeholder={labels.searchPlaceholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="text-foreground placeholder:text-subtle-foreground min-h-12 w-full min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </div>

      {/*
        THE WAY ON WHEN THE LIST CANNOT HELP. Typing a symbol nobody has traded
        is the normal path for a new instrument, not an edge case, so it is a
        full-width action at the top of the list rather than a note under it.
      */}
      {offerTyped ? (
        <button
          type="button"
          data-symbol-add-typed=""
          onClick={() => select(trimmed)}
          className="border-control-border bg-background hover:bg-accent focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-dashed px-4 text-left outline-none focus-visible:ring-2"
        >
          <Plus className="text-primary size-4 shrink-0" aria-hidden="true" />
          <span className="text-foreground min-w-0 truncate text-base font-medium">
            {labels.addTyped(trimmed)}
          </span>
        </button>
      ) : null}

      {/*
        The list takes its name from the combobox that controls it, rather than
        repeating the field label — two elements called "Symbol" is one name
        too many for anyone navigating by label.
      */}
      <div id={listId} role="listbox" className="flex min-w-0 flex-col gap-1">
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-1 py-3 text-sm">
            {trimmed === '' ? labels.empty : labels.noMatches}
          </p>
        ) : (
          sections.map((section) => {
            const inSection = rows
              .map((row, index) => ({ row, index }))
              .filter((entry) => entry.row.section === section.key);
            if (inSection.length === 0) return null;
            return (
              <div key={section.key} className="flex min-w-0 flex-col gap-1" role="presentation">
                <p className="text-subtle-foreground px-1 pt-2 text-xs font-medium">
                  {section.label}
                </p>
                {inSection.map(({ row, index }) => {
                  const chosen = row.symbol.trim().toUpperCase() === trimmed.toUpperCase();
                  const starred = favorites.includes(row.symbol);
                  return (
                    <div
                      key={`${section.key}-${row.symbol}`}
                      className="flex min-w-0 items-center gap-1"
                    >
                      <div
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={chosen}
                        data-symbol-option={row.symbol}
                        onClick={() => select(row.symbol)}
                        className={cn(
                          'hover:bg-accent flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 transition-colors motion-reduce:transition-none',
                          index === active && 'bg-accent',
                          chosen && 'bg-muted/60',
                        )}
                      >
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-base',
                            chosen ? 'text-foreground font-semibold' : 'text-foreground',
                          )}
                        >
                          {row.symbol}
                        </span>
                        {chosen ? (
                          <>
                            <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                            <span className="sr-only">{labels.selected}</span>
                          </>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        aria-pressed={starred}
                        aria-label={
                          starred ? labels.favoriteOff(row.symbol) : labels.favoriteOn(row.symbol)
                        }
                        onClick={() => onToggleFavorite(row.symbol)}
                        className="hover:bg-accent focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
                      >
                        <Star
                          aria-hidden="true"
                          className={cn(
                            'size-4',
                            starred ? 'fill-primary text-primary' : 'text-subtle-foreground',
                          )}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* With nothing typed there is nothing to offer yet, so this says where to start. */}
      {offerTyped || trimmed !== '' ? null : (
        <button
          type="button"
          data-symbol-add-custom=""
          onClick={() => searchRef.current?.focus()}
          className="text-primary focus-visible:ring-ring flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm font-medium outline-none focus-visible:ring-2"
        >
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          {labels.addCustom}
        </button>
      )}
    </div>
  );
}
