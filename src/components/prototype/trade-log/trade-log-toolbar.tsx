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

    The mobile order the spec asks for is "Trades + Log a trade", then the scope
    line. A plain `flex-col` gave three stacked rows with the action alone on
    the second, which spent 60px of a 780px screen on one button. `order` puts
    the action beside the title below `md` and back at the end of the row above
    it, with ONE instance of each control rather than two copies holding two
    copies of the same open state.
  */
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-4 md:min-h-16 md:flex-nowrap md:gap-4">
      <h1 className="text-foreground min-w-0 flex-1 text-2xl leading-8 font-semibold tracking-tight md:flex-none">
        {copy.pageTitle}
      </h1>

      <div className="order-2 flex w-full min-w-0 flex-wrap items-center gap-2 md:order-none md:ml-auto md:w-auto">
        <ToolbarDisclosure
          open={accountOpen}
          onOpenChange={setAccountOpen}
          title={copy.allAccounts}
          trigger={
            <ToolbarTrigger icon={<Wallet className="size-4" />} className="max-w-[15rem]">
              {accountLabel}
            </ToolbarTrigger>
          }
        >
          <RadioList
            name="prototype-account"
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
            <ToolbarTrigger icon={<CalendarRange className="size-4" />}>
              {copy.dateRange}
            </ToolbarTrigger>
          }
        >
          <div className="min-w-[16rem]">
            <RadioList
              name="prototype-date"
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

      <Button onClick={onLogTrade} className="order-1 shrink-0 md:order-none">
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

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <SegmentedControl<JournalState>
        legend="Trade state"
        value={query.state}
        onValueChange={(state) => onQueryChange({ ...query, state, page: 1 })}
        options={[
          { value: 'all', label: copy.stateAll },
          { value: 'open', label: copy.stateOpen },
          { value: 'closed', label: copy.stateClosed },
        ]}
        className="shrink-0"
      />

      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1 lg:w-[280px] lg:min-w-[220px] lg:flex-none">
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
          <FiltersPanel query={query} onQueryChange={onQueryChange} />
        </ToolbarDisclosure>

        <ToolbarDisclosure
          open={sortOpen}
          onOpenChange={setSortOpen}
          title="Sort"
          trigger={
            <ToolbarTrigger
              icon={<ArrowUpDown className="size-4" />}
              className="max-w-[13rem]"
              aria-label={`${copy.sort}: ${sortLabel(copy, query.sort)}`}
              labelClassName="hidden truncate sm:inline"
            >
              {sortLabel(copy, query.sort)}
            </ToolbarTrigger>
          }
        >
          <RadioList
            name="prototype-sort"
            value={query.sort}
            options={SORT_KEYS.map((key) => ({
              value: key,
              label: sortLabel(copy, key),
            }))}
            onChange={(value) => {
              onQueryChange({ ...query, sort: value as SortKey, page: 1 });
              setSortOpen(false);
            }}
          />
        </ToolbarDisclosure>
      </div>
    </div>
  );
}

function FiltersPanel({
  query,
  onQueryChange,
}: {
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

      <FilterGroup label="Follow-up">
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
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: readonly { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="radiogroup" className="flex min-w-0 flex-col">
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
    </div>
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
