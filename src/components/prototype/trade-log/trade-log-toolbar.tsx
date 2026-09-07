'use client';

import {
  ArrowUpDown,
  CalendarRange,
  Plus,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { ToolbarDisclosure } from '@/components/dashboard/toolbar/toolbar-disclosure';
import { ToolbarTrigger } from '@/components/dashboard/toolbar/toolbar-trigger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';

import { sortLabel, type PrototypeCopy } from '../copy';
import { PROTOTYPE_ACCOUNTS, PROTOTYPE_STRATEGIES, type ActualOutcome } from '../fixtures';
import {
  FOLLOW_UP_FILTER_LABEL,
  OUTCOME_FILTER_LABEL,
  SORT_KEYS,
  type FollowUpFilter,
  type JournalQuery,
  type JournalState,
  type SortKey,
} from '../query';

/**
 * THE TRADES WORKSPACE CONTROLS.
 *
 * TWO ROWS, AND THE SPLIT IS THE POINT. The first row is SCOPE — which account,
 * which dates, and the one action that adds to the journal. The second is
 * REFINEMENT within that scope — state, search, filters, sort. Mixing the two,
 * as a single row of six equal pills does, leaves a reader unable to tell which
 * controls change what the journal is ABOUT and which only change what it
 * currently shows. Clear filters honours the same split: it removes every
 * refinement and never touches the scope.
 *
 * THE CONTROLS THEMSELVES ARE THE DASHBOARD'S OWN. `ToolbarTrigger` and
 * `ToolbarDisclosure` are imported from `components/dashboard/toolbar` rather
 * than reimplemented, so every pill here is the same height, the same border,
 * the same chevron and the same press feedback as the Dashboard's — and so the
 * filter panel is a popover on a desktop and a near-full-height sheet on a
 * phone without this file deciding that again.
 *
 * WHAT WAS REMOVED FROM THIS AREA. The second "Trade Log" heading, the
 * descriptive sentence under it, and the four metric cards. The page had four
 * bands of preamble before the first trade; it now has two, and the trades
 * start roughly 200px higher on a 1440 desktop.
 */

export function TradeLogHeader({
  copy,
  query,
  onQueryChange,
  onLogTrade,
}: {
  copy: PrototypeCopy;
  query: JournalQuery;
  onQueryChange: (next: JournalQuery) => void;
  onLogTrade: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const accountLabel = query.account === 'all' ? copy.allAccounts : query.account;

  /*
    ONE ROW ON DESKTOP, TWO ON A PHONE — reordered rather than restacked.

    The mobile order is "Trades + Log a trade", then ONE compact scope line
    carrying Account and Date together, with the account name free to truncate
    rather than force a third row. `order` puts the action beside the title
    below `md` and back at the end of the row above it, with one instance of
    each control rather than two copies holding two copies of the same state.

    MOBILE SPENDS LESS BEFORE THE FIRST TRADE. Vertical padding drops from 16px
    to 12px and the title from 24px to 20px below `md`. No touch target shrank:
    every control on this row is still 44px tall.
  */
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-3 md:min-h-16 md:flex-nowrap md:gap-4 md:py-4">
      <h1 className="text-foreground min-w-0 flex-1 text-xl leading-7 font-semibold tracking-tight md:flex-none md:text-2xl md:leading-8">
        {copy.pageTitle}
      </h1>

      <div className="order-2 flex w-full min-w-0 items-center gap-2 md:order-none md:ml-auto md:w-auto">
        <ToolbarDisclosure
          open={accountOpen}
          onOpenChange={setAccountOpen}
          title={copy.allAccounts}
          trigger={
            <ToolbarTrigger
              icon={<Wallet className="size-4" />}
              className="min-w-0 flex-1 md:max-w-[15rem] md:flex-none"
            >
              {accountLabel}
            </ToolbarTrigger>
          }
        >
          <RadioList
            name="prototype-account"
            legend={copy.allAccounts}
            value={query.account}
            options={[
              { value: 'all', label: copy.allAccounts, hint: 'USD and THB' },
              ...PROTOTYPE_ACCOUNTS.map((account) => ({
                value: account.name,
                label: account.name,
                hint: account.currency,
              })),
            ]}
            onChange={(value) => {
              onQueryChange({ ...query, account: value, page: 1 });
              setAccountOpen(false);
            }}
          />
        </ToolbarDisclosure>

        <ToolbarDisclosure
          open={dateOpen}
          onOpenChange={setDateOpen}
          title="Activity date"
          trigger={
            <ToolbarTrigger icon={<CalendarRange className="size-4" />} className="min-w-0 shrink">
              {copy.dateRange}
            </ToolbarTrigger>
          }
        >
          <div className="min-w-[16rem]">
            <RadioList
              name="prototype-date"
              legend="Activity date"
              value="all"
              options={[
                { value: 'all', label: copy.allTime },
                { value: '7', label: 'Last 7 days' },
                { value: '30', label: 'Last 30 days' },
                { value: '90', label: 'Last 90 days' },
                { value: 'custom', label: 'Custom range…' },
              ]}
              onChange={() => setDateOpen(false)}
            />
            <p className="text-muted-foreground border-border mt-2 border-t pt-2 text-xs leading-relaxed">
              Activity date is the exit time for a closed trade and the entry time for an open one.
            </p>
            {/* Said plainly rather than faked: a preset that changed the label
                without changing the rows would be a lie a screenshot could not
                catch. Composition only in this prototype. */}
            <p className="text-subtle-foreground mt-2 text-xs leading-relaxed">
              Prototype: presets are shown for composition and do not scope the fixture journal.
            </p>
          </div>
        </ToolbarDisclosure>
      </div>

      <Button
        onClick={onLogTrade}
        // Free to wrap and shrink. `Button` is `shrink-0` with a nowrap label by
        // default, and at 200% text zoom on a 390px screen that pushed the
        // title row 16px past the viewport edge.
        className="order-1 h-auto min-h-11 min-w-0 shrink py-2 text-left whitespace-normal md:order-none"
      >
        <Plus className="size-4" aria-hidden="true" />
        {copy.logTrade}
      </Button>
    </div>
  );
}

export function TradeLogToolbar({
  copy,
  query,
  onQueryChange,
}: {
  copy: PrototypeCopy;
  query: JournalQuery;
  onQueryChange: (next: JournalQuery) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchText, setSearchText] = useState(query.search);

  // 300ms idle, exactly as specified — and the field itself never waits for it,
  // so typing is never held up by the list.
  useEffect(() => {
    if (searchText === query.search) return;
    const timer = window.setTimeout(() => {
      onQueryChange({ ...query, search: searchText, page: 1 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText, query, onQueryChange]);

  const activeFilterCount =
    query.directions.length +
    query.outcomes.length +
    query.followUps.length +
    (query.strategy === null ? 0 : 1) +
    (query.setup === null ? 0 : 1);

  // Declared once and placed once. It sits beside the state control on a phone
  // and at the end of the row on a desktop — one instance either way, so the
  // open/closed state cannot diverge between two copies of the same control.
  const sortControl = (
    <ToolbarDisclosure
      open={sortOpen}
      onOpenChange={setSortOpen}
      title="Sort"
      trigger={
        <ToolbarTrigger
          icon={<ArrowUpDown className="size-4" />}
          className="max-w-[13rem] min-w-0 shrink"
          aria-label={`${copy.sort}: ${sortLabel(copy, query.sort)}`}
          labelClassName="hidden truncate sm:inline"
        >
          {sortLabel(copy, query.sort)}
        </ToolbarTrigger>
      }
    >
      <RadioList
        name="prototype-sort"
        legend={copy.sort}
        value={query.sort}
        options={SORT_KEYS.map((key) => ({ value: key, label: sortLabel(copy, key) }))}
        onChange={(value) => {
          onQueryChange({ ...query, sort: value as SortKey, page: 1 });
          setSortOpen(false);
        }}
      />
    </ToolbarDisclosure>
  );

  return (
    /*
      THE TOOLBAR WRAPS RATHER THAN OVERFLOWS.

      `lg:flex-row` with no wrap meant the row had exactly one way to fail: at
      200% text zoom on a 1024px screen the segmented control, a 280px search
      field and two pills need more than the line, and the chevrons inside the
      Sort trigger were pushed 76px past the viewport — a sideways-scrolling
      page, which this design system forbids at every width. Allowing the line
      to break costs nothing at ordinary sizes (it never wraps there) and turns
      the zoom case into a second row instead of an overflow.
    */
    <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-3">
      {/*
        TWO PAIRS ON A PHONE, ONE ROW ON A DESKTOP.

        Below `lg` the state control shares its line with Sort, and Search
        shares the next line with Filters. That is the specification's own
        mobile order — "full-width Search with adjacent Filters button", Sort
        "beside the result count" — and it is also what fixes the one measured
        defect here: with Search, Filters AND Sort on one 320px line the field
        was left 128px and visibly clipped its own placeholder. It now gets
        ~208px and does not.

        `lg:contents` dissolves both wrappers at desktop widths so their four
        children rejoin the parent row and take their desktop order directly.
        No control is duplicated, so no control holds two copies of its state.
      */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:contents">
        <SegmentedControl<JournalState>
          legend="Trade state"
          value={query.state}
          onValueChange={(state) => onQueryChange({ ...query, state, page: 1 })}
          options={[
            { value: 'all', label: copy.stateAll },
            { value: 'open', label: copy.stateOpen },
            { value: 'closed', label: copy.stateClosed },
          ]}
          className="min-w-0 shrink lg:order-1"
        />
        {/*
          SORT IS A DESKTOP CONTROL NOW. Below `lg` its trigger was icon-only —
          a bare glyph with no label, offering a choice a reader cannot see the
          current value of. On a phone the row is Search and Filters, and sorting
          lives inside Filters where it has room for its options and its labels.
        */}
        <div className="ml-auto hidden min-w-0 shrink lg:order-4 lg:ml-0 lg:block">
          {sortControl}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:contents">
        {/* 280px preferred, 220px minimum, and free to shrink below that before
            the row is allowed to overflow — the spec's widths are a target for
            ordinary type, not a floor that outranks "no horizontal scrolling". */}
        <div className="relative min-w-0 flex-1 lg:order-2 lg:ml-auto lg:max-w-[280px] lg:basis-[280px]">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <label htmlFor="prototype-search" className="sr-only">
            {copy.searchLabel}
          </label>
          <Input
            id="prototype-search"
            type="search"
            value={searchText}
            placeholder={copy.searchPlaceholder}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onQueryChange({ ...query, search: searchText, page: 1 });
              }
            }}
            className="pl-9 text-sm"
          />
        </div>

        <ToolbarDisclosure
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title={copy.filters}
          popoverClassName="w-[360px]"
          footer={
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onQueryChange({
                    ...query,
                    directions: [],
                    outcomes: [],
                    strategy: null,
                    setup: null,
                    followUps: [],
                    page: 1,
                  });
                }}
              >
                Reset
              </Button>
              <Button size="sm" onClick={() => setFiltersOpen(false)}>
                Apply
              </Button>
            </div>
          }
          trigger={
            <ToolbarTrigger
              icon={<SlidersHorizontal className="size-4" />}
              // Icon-only on the narrowest phones so Search keeps enough room
              // for its placeholder — responsive by LABEL, never by shrinking
              // the 44px target. The accessible name survives the hidden span.
              aria-label={copy.filters}
              className="shrink-0 lg:order-3"
              labelClassName="hidden min-[430px]:inline"
              badge={
                activeFilterCount === 0 ? undefined : (
                  <span className="bg-primary text-primary-foreground numeric flex size-5 shrink-0 items-center justify-center rounded-full text-xs">
                    {activeFilterCount}
                  </span>
                )
              }
            >
              {copy.filters}
            </ToolbarTrigger>
          }
        >
          <FiltersPanel copy={copy} query={query} onQueryChange={onQueryChange} />
        </ToolbarDisclosure>
      </div>
    </div>
  );
}

function FiltersPanel({
  copy,
  query,
  onQueryChange,
}: {
  copy: PrototypeCopy;
  query: JournalQuery;
  onQueryChange: (next: JournalQuery) => void;
}) {
  const strategy = PROTOTYPE_STRATEGIES.find((candidate) => candidate.name === query.strategy);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FilterGroup label="Direction">
        {(['long', 'short'] as const).map((direction) => (
          <CheckRow
            key={direction}
            label={direction === 'long' ? 'Long' : 'Short'}
            checked={query.directions.includes(direction)}
            onChange={(checked) =>
              onQueryChange({
                ...query,
                directions: checked
                  ? [...query.directions, direction]
                  : query.directions.filter((value) => value !== direction),
                page: 1,
              })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Actual result">
        {(Object.keys(OUTCOME_FILTER_LABEL) as ActualOutcome[]).map((outcome) => (
          <CheckRow
            key={outcome}
            label={OUTCOME_FILTER_LABEL[outcome]}
            checked={query.outcomes.includes(outcome)}
            onChange={(checked) =>
              onQueryChange({
                ...query,
                outcomes: checked
                  ? [...query.outcomes, outcome]
                  : query.outcomes.filter((value) => value !== outcome),
                page: 1,
              })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Strategy">
        <select
          value={query.strategy ?? ''}
          onChange={(event) =>
            onQueryChange({
              ...query,
              strategy: event.target.value === '' ? null : event.target.value,
              // Setup depends on Strategy; changing the parent cannot leave a
              // child selection behind that no longer belongs to it.
              setup: null,
              page: 1,
            })
          }
          className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
        >
          <option value="">Any strategy</option>
          {PROTOTYPE_STRATEGIES.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </FilterGroup>

      {strategy === undefined ? null : (
        <FilterGroup label="Setup">
          <select
            value={query.setup ?? ''}
            onChange={(event) =>
              onQueryChange({
                ...query,
                setup: event.target.value === '' ? null : event.target.value,
                page: 1,
              })
            }
            className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
          >
            <option value="">Any setup</option>
            {strategy.setups.map((setup) => (
              <option key={setup} value={setup}>
                {setup}
              </option>
            ))}
          </select>
        </FilterGroup>
      )}

      {/* The phone's sort control. `lg:hidden` rather than a second component:
          one `query.sort`, one writer, no chance of two copies disagreeing. */}
      <div className="lg:hidden">
        <FilterGroup label="Sort">
          <RadioList
            name="prototype-sort-mobile"
            legend="Sort"
            value={query.sort}
            options={SORT_KEYS.map((key) => ({ value: key, label: sortLabel(copy, key) }))}
            onChange={(value) => onQueryChange({ ...query, sort: value as SortKey, page: 1 })}
          />
        </FilterGroup>
      </div>

      <FilterGroup label="Missing information">
        {(Object.keys(FOLLOW_UP_FILTER_LABEL) as FollowUpFilter[]).map((key) => (
          <CheckRow
            key={key}
            label={FOLLOW_UP_FILTER_LABEL[key]}
            checked={query.followUps.includes(key)}
            onChange={(checked) =>
              onQueryChange({
                ...query,
                followUps: checked
                  ? [...query.followUps, key]
                  : query.followUps.filter((value) => value !== key),
                page: 1,
              })
            }
          />
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-label text-muted-foreground mb-1.5 uppercase">{label}</legend>
      <div className="flex min-w-0 flex-col">{children}</div>
    </fieldset>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary size-4 shrink-0"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

function RadioList({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  /** Names the group for assistive tech. The panel's own title, reused. */
  legend: string;
  value: string;
  options: readonly { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    /*
      A REAL `<fieldset>`, not `role="radiogroup"` on a div.

      Same-named native radios already form a group; adding the ARIA role on
      top of them was redundant, and the div carried no accessible name, so the
      group announced as an unlabelled radiogroup. `fieldset`/`legend` is the
      native mechanism and needs no ARIA at all.
    */
    <fieldset className="flex min-w-0 flex-col">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className="hover:bg-accent flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-primary size-4 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.hint === undefined ? null : (
            <span className="text-muted-foreground shrink-0 text-xs">{option.hint}</span>
          )}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Applied refinements, as removable chips.
 *
 * SCOPE IS NOT A CHIP. Account and Date range never appear here, because a chip
 * carries an implicit promise that removing it returns you to "everything" —
 * and there is no everything to return to for the account whose journal this
 * is. Only refinements the reader added to a scope are removable this way.
 */
export function AppliedFilterChips({
  copy,
  query,
  onQueryChange,
}: {
  copy: PrototypeCopy;
  query: JournalQuery;
  onQueryChange: (next: JournalQuery) => void;
}) {
  const chips: { key: string; label: string; remove: () => void }[] = [];

  if (query.search.trim() !== '') {
    chips.push({
      key: 'search',
      label: `Search: ${query.search.trim()}`,
      remove: () => onQueryChange({ ...query, search: '', page: 1 }),
    });
  }
  for (const direction of query.directions) {
    chips.push({
      key: `direction-${direction}`,
      label: direction === 'long' ? 'Long' : 'Short',
      remove: () =>
        onQueryChange({
          ...query,
          directions: query.directions.filter((value) => value !== direction),
          page: 1,
        }),
    });
  }
  for (const outcome of query.outcomes) {
    chips.push({
      key: `outcome-${outcome}`,
      label: OUTCOME_FILTER_LABEL[outcome],
      remove: () =>
        onQueryChange({
          ...query,
          outcomes: query.outcomes.filter((value) => value !== outcome),
          page: 1,
        }),
    });
  }
  if (query.strategy !== null) {
    chips.push({
      key: 'strategy',
      label: `Strategy: ${query.strategy}`,
      remove: () => onQueryChange({ ...query, strategy: null, setup: null, page: 1 }),
    });
  }
  if (query.setup !== null) {
    chips.push({
      key: 'setup',
      label: `Setup: ${query.setup}`,
      remove: () => onQueryChange({ ...query, setup: null, page: 1 }),
    });
  }
  for (const followUp of query.followUps) {
    chips.push({
      key: `follow-${followUp}`,
      label: FOLLOW_UP_FILTER_LABEL[followUp],
      remove: () =>
        onQueryChange({
          ...query,
          followUps: query.followUps.filter((value) => value !== followUp),
          page: 1,
        }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="border-border bg-card text-foreground inline-flex items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-xs"
        >
          <span className="max-w-[16rem] min-w-0 truncate">{chip.label}</span>
          <button
            type="button"
            onClick={chip.remove}
            aria-label={`Remove ${chip.label}`}
            className="hover:bg-accent focus-visible:ring-ring flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() =>
          onQueryChange({
            ...query,
            search: '',
            directions: [],
            outcomes: [],
            strategy: null,
            setup: null,
            followUps: [],
            page: 1,
          })
        }
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring',
          'rounded-sm px-1 text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-2',
        )}
      >
        {copy.clearFilters}
      </button>
    </div>
  );
}
