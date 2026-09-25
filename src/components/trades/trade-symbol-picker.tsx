'use client';

import { Check, Plus, Search, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * THE SYMBOL PICKER — a library the trader curates, and one pick from it.
 *
 * TWO MEANINGS, KEPT APART. Saved Symbols are the instruments this trader has
 * decided to keep; the Selected Symbol is the one this Trade is recorded
 * against. Adding to the library and choosing for the Trade are separate acts
 * with separate presses, because they answer different questions — "do I trade
 * this?" and "did I trade this?" — and running them together is what made the
 * earlier versions of this confusing.
 *
 * WHY NOT A CATALOGUE. This product has none and deliberately does not want
 * one: `trades.symbol` is free text because `US30.cash`, `XAUUSD.m` and
 * `GER40` are the names a particular broker and a particular trader use, and
 * no list shipped here would stay right. The library is the answer to that,
 * and it is the trader's to build.
 *
 * SEARCHING IS NEITHER OF THOSE ACTS. The field is local state: it filters the
 * library while it is being typed and is thrown away when the sheet closes.
 * Nothing typed ever becomes the recorded Symbol on its own — an earlier
 * version wrote every keystroke into the draft, so looking something up and
 * thinking better of it silently rewrote the Trade.
 */
export interface TradeSymbolPickerLabels {
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly savedHeading: string;
  readonly empty: string;
  readonly noMatches: string;
  /** Takes the exact text typed. */
  readonly addTyped: (symbol: string) => string;
  readonly alreadySaved: (symbol: string) => string;
  readonly remove: (symbol: string) => string;
  readonly selected: string;
}

/** Whitespace is not part of a symbol; nothing else about it is touched. */
const clean = (value: string) => value.trim();
const same = (a: string, b: string) => clean(a).toUpperCase() === clean(b).toUpperCase();

export function TradeSymbolPicker({
  id,
  value,
  saved,
  onSelect,
  onSave,
  onRemove,
  labels,
}: {
  id: string;
  /** The Symbol recorded for this Trade. Never edited by typing. */
  value: string;
  /** The trader's saved library, most recently added first. */
  saved: readonly string[];
  /** Chooses the Symbol for this Trade. The caller closes the sheet. */
  onSelect: (symbol: string) => void;
  /** Adds to the library. Does not choose it. */
  onSave: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  labels: TradeSymbolPickerLabels;
}) {
  const [query, setQuery] = useState('');
  /** The symbol just added, so its row can announce itself once. */
  const [added, setAdded] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  const trimmed = clean(query);
  const rows = saved.filter(
    (symbol) => trimmed === '' || clean(symbol).toUpperCase().includes(trimmed.toUpperCase()),
  );
  const alreadySaved = trimmed !== '' && saved.some((symbol) => same(symbol, trimmed));
  const offerAdd = trimmed !== '' && !alreadySaved;

  /*
    ADDING PUTS IT IN THE LIBRARY AND STOPS THERE. The trader then taps it like
    any other saved symbol — the same one gesture every row takes — rather than
    Add quietly meaning "and record this Trade against it too", which is two
    outcomes behind one press and no way to want only the first.
  */
  function add() {
    if (trimmed === '') return;
    onSave(trimmed);
    setAdded(trimmed);
    setQuery('');
    setActive(-1);
    searchRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Never the form's Enter: this sheet has its own two outcomes.
      event.preventDefault();
      if (active >= 0) {
        const row = rows[active];
        if (row !== undefined) onSelect(row);
        return;
      }
      if (offerAdd) add();
      return;
    }
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = active + (event.key === 'ArrowDown' ? 1 : -1);
      setActive(next < 0 ? rows.length - 1 : next >= rows.length ? 0 : next);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-symbol-picker="">
      {/*
        SEARCH STAYS WITHIN REACH. In a long library the rows scroll and the
        field does not: it pins to the top of the sheet's scrolling body, right
        under the header, so the thing being typed into never scrolls away
        from the keyboard feeding it. The strip is the sheet's own card
        surface — no shadow — and its padding is cancelled by an equal negative
        margin, so at rest the layout is exactly as before while the focus ring
        keeps room and rows pass cleanly beneath.

        THE PHONE SHEET'S BODY HAS 16px OF TOP PADDING, and a sticky box pins
        inside a scroller's padding — which left a 16px slit under the header
        that rows visibly slid up through. So on the phone the strip pins 16px
        higher, to the scroller's very top edge, and carries that 16px itself
        as its own top padding (reaching up into the description's equal
        margin at rest, never over the description). The desktop dialog's body
        has no top padding and keeps the plain offsets; `md` is the same 48rem
        at which the overlay becomes a dialog.
      */}
      <div
        data-symbol-search=""
        className="bg-card sticky -top-4 z-10 -mt-4 -mb-1.5 pt-4 pb-1.5 md:top-0 md:-mt-1.5 md:pt-1.5"
      >
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
              setQuery(event.target.value);
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
      </div>

      {/*
        ONE WAY TO ADD, AND THIS IS IT. It appears only for a symbol the library
        does not already hold; case is not a difference, so typing `btcusd` over
        a saved `BTCUSD` offers nothing and says why instead of silently doing
        nothing or quietly making a second row for the same instrument.
      */}
      {offerAdd ? (
        <button
          type="button"
          data-symbol-add=""
          onClick={add}
          className="border-control-border bg-background hover:bg-accent focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-dashed px-4 text-left outline-none focus-visible:ring-2"
        >
          <Plus className="text-primary-text size-4 shrink-0" aria-hidden="true" />
          <span className="text-foreground min-w-0 truncate text-base font-medium">
            {labels.addTyped(trimmed)}
          </span>
        </button>
      ) : null}
      {alreadySaved ? (
        <p data-symbol-already-saved="" className="text-muted-foreground px-1 text-sm">
          {labels.alreadySaved(trimmed)}
        </p>
      ) : null}

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-subtle-foreground px-1 text-xs font-medium">{labels.savedHeading}</p>
        <div id={listId} role="listbox" className="flex min-w-0 flex-col gap-1">
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-1 py-3 text-sm">
              {saved.length === 0 ? labels.empty : labels.noMatches}
            </p>
          ) : (
            rows.map((symbol, index) => {
              const chosen = same(symbol, value);
              const isNew = added !== null && same(symbol, added);
              return (
                <div key={symbol} className="flex min-w-0 items-center gap-1">
                  {/*
                    A ROW IS THE CHOICE. One tap records the Symbol and the
                    sheet closes; there is no Done afterwards because there is
                    nothing left to decide.

                    `animate-rise` is this system's standard entrance and runs
                    here only on the row just added — the list moving under a
                    trader who added something is the one moment where a short
                    travel says which row is theirs. Reduced motion collapses
                    it globally in `globals.css`, so there is nothing to guard
                    here.
                  */}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={chosen}
                    data-symbol-option={symbol}
                    {...(isNew ? { 'data-symbol-added': '' } : {})}
                    onClick={() => onSelect(symbol)}
                    className={cn(
                      'hover:bg-accent flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 transition-colors motion-reduce:transition-none',
                      index === active && 'bg-accent',
                      chosen && 'bg-muted/60',
                      isNew && 'animate-rise',
                    )}
                  >
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-base',
                        chosen ? 'text-foreground font-semibold' : 'text-foreground',
                      )}
                    >
                      {symbol}
                    </span>
                    {chosen ? (
                      <>
                        <Check className="text-primary-text size-4 shrink-0" aria-hidden="true" />
                        <span className="sr-only">{labels.selected}</span>
                      </>
                    ) : null}
                  </div>
                  {/*
                    The way back out of the library, for a typo or an instrument
                    no longer traded. A sibling of the row rather than part of
                    it, so choosing and removing are never the same 44px.
                  */}
                  <button
                    type="button"
                    aria-label={labels.remove(symbol)}
                    data-symbol-remove={symbol}
                    onClick={() => onRemove(symbol)}
                    className="text-subtle-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
