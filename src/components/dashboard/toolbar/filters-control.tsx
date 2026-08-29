'use client';

import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { buildDashboardHref, type DashboardFilterState } from '@/lib/dashboard/filters';
import { cn } from '@/lib/utils';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';
import { useDashboardStateNavigation } from '@/components/dashboard/dashboard-state-link';
import { Button } from '@/components/ui/button';

import { ToolbarDisclosure } from './toolbar-disclosure';
import { ToolbarTrigger } from './toolbar-trigger';

/**
 * The dimensions this control owns. Deliberately three, not a catalogue.
 *
 * Strategy and Setup are the frozen first-release pair. Strategy Version is
 * carried but never edited here: it is an advanced analytical override that
 * arrives by URL, and the only thing this control must do about it is honour
 * its DEPENDENCY — a version belonging to a strategy the reader just changed
 * away from is incompatible, so it is cleared rather than silently kept.
 */
interface DashboardFiltersDraft {
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

function draftFromApplied(filters: DashboardFilterState): DashboardFiltersDraft {
  return {
    strategyId: filters.strategyId,
    setupId: filters.setupId,
    strategyVersionId: filters.strategyVersionId,
  };
}

function activeFilterCount(draft: DashboardFiltersDraft): number {
  return [draft.strategyId, draft.setupId, draft.strategyVersionId].filter(
    (value) => value !== null,
  ).length;
}

/**
 * Toolbar Filters — Strategy and Setup, on the same Draft/Apply terms as the
 * Date Range beside it.
 *
 * WHY DRAFT/APPLY RATHER THAN NAVIGATE-ON-CHANGE. The Analytics filter bar
 * navigates on every `change`, which is affordable there because it uses soft
 * routing. The Dashboard's applied transition is currently a full document
 * navigation, so choosing a Strategy and then a Setup would cost two whole
 * page loads and the second would be issued against a page the reader was
 * still reading. One Apply, one transition — and the shape stays correct when
 * the transport becomes soft again.
 *
 * DEPENDENCY IS ENFORCED IN THE DRAFT, NOT ONLY IN THE OPTION LIST. Changing
 * Strategy clears Setup and Version outright: filtering the visible options
 * alone would leave a stale, now-incompatible id in state and ship it in the
 * URL. The authenticated DAL still verifies every identifier against the
 * active workspace — this is a usability rule layered on top of that
 * enforcement, never a replacement for it.
 */
export function DashboardFiltersControl({
  filters,
  options,
  className,
  labelClassName,
}: {
  filters: DashboardFilterState;
  options: AnalyticsFilterOptions;
  className?: string;
  labelClassName?: string;
}) {
  const t = useTranslations('dashboard.toolbar.filters');
  const navigate = useDashboardStateNavigation();
  const fieldId = useId();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardFiltersDraft>(() => draftFromApplied(filters));

  function handleOpenChange(next: boolean) {
    if (next) setDraft(draftFromApplied(filters));
    setOpen(next);
  }

  function handleApply() {
    setOpen(false);
    navigate(
      buildDashboardHref({
        ...filters,
        strategyId: draft.strategyId,
        setupId: draft.setupId,
        strategyVersionId: draft.strategyVersionId,
      }),
    );
  }

  const appliedCount = activeFilterCount(draftFromApplied(filters));

  /*
    THE SETUP LIST IS CONSTRAINED BY THE VERSION TOO, NOT ONLY BY THE STRATEGY.

    The frozen dependency rules require Setup and Version to resolve to the
    SAME Strategy even when Strategy itself is omitted. A link can legitimately
    carry a Version with no Strategy; picking a Setup belonging to some other
    Strategy would then build a combination the DAL correctly rejects, and the
    reader would meet an error state they had no way to see coming. Narrowing
    the offered Setups to the Version's own Strategy makes that combination
    unreachable from this control rather than merely invalid.
  */
  const draftVersionStrategyId =
    options.strategyVersions.find(
      (version) => version.strategyVersionId === draft.strategyVersionId,
    )?.strategyId ?? null;
  const setupStrategyId = draft.strategyId ?? draftVersionStrategyId;
  const visibleSetups =
    setupStrategyId === null
      ? options.setups
      : options.setups.filter((setup) => setup.strategyId === setupStrategyId);

  const selectedStrategy = options.strategies.find(
    (strategy) => strategy.strategyId === filters.strategyId,
  );

  return (
    <ToolbarDisclosure
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      popoverClassName="w-80"
      trigger={
        <ToolbarTrigger
          data-dashboard-toolbar-control="filters"
          data-filter-count={appliedCount}
          aria-label={
            appliedCount === 0
              ? t('triggerLabelEmpty')
              : t('triggerLabelActive', { count: appliedCount })
          }
          className={className}
          labelClassName={labelClassName}
          icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
          badge={
            appliedCount === 0 ? null : (
              <span
                aria-hidden="true"
                className="bg-primary text-primary-foreground numeric flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              >
                {appliedCount}
              </span>
            )
          }
        >
          {t('title')}
        </ToolbarTrigger>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-dashboard-toolbar-clear="filters"
            onClick={() => setDraft({ strategyId: null, setupId: null, strategyVersionId: null })}
          >
            {t('clear')}
          </Button>
          <Button
            type="button"
            size="sm"
            data-dashboard-toolbar-apply="filters"
            onClick={handleApply}
          >
            {t('apply')}
          </Button>
        </div>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <FilterField id={`${fieldId}-strategy`} label={t('strategy')}>
          <FilterSelect
            id={`${fieldId}-strategy`}
            data-dashboard-filter="strategy"
            value={draft.strategyId ?? ''}
            onChange={(event) =>
              setDraft({
                strategyId: event.target.value === '' ? null : event.target.value,
                // Both dependants go, every time. See the note above.
                setupId: null,
                strategyVersionId: null,
              })
            }
          >
            <option value="">{t('allStrategies')}</option>
            {options.strategies.map((strategy) => (
              <option key={strategy.strategyId} value={strategy.strategyId}>
                {strategy.label}
                {strategy.isArchived ? ` · ${t('archived')}` : ''}
              </option>
            ))}
          </FilterSelect>
        </FilterField>

        <FilterField
          id={`${fieldId}-setup`}
          label={t('setup')}
          hint={draft.strategyId === null ? t('setupHint') : undefined}
        >
          <FilterSelect
            id={`${fieldId}-setup`}
            data-dashboard-filter="setup"
            value={draft.setupId ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                setupId: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">{t('allSetups')}</option>
            {visibleSetups.map((setup) => (
              <option key={setup.setupId} value={setup.setupId}>
                {setup.label}
                {setup.isArchived ? ` · ${t('archived')}` : ''}
              </option>
            ))}
          </FilterSelect>
        </FilterField>

        {/*
          The advanced override is REPORTED, never edited. It only appears when
          a URL actually carries one, so the common case is a two-field panel
          and the reader of a shared analytical link can still see why their
          numbers are narrower than they expected.
        */}
        {filters.strategyVersionId === null ? null : (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('versionPinned', {
              strategy: selectedStrategy?.label ?? t('allStrategies'),
            })}
          </p>
        )}
      </div>
    </ToolbarDisclosure>
  );
}

function FilterField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-muted-foreground text-label uppercase">
        {label}
      </label>
      {children}
      {hint === undefined ? null : (
        <p className="text-subtle-foreground text-xs leading-snug">{hint}</p>
      )}
    </div>
  );
}

/**
 * A native `<select>`, for the reason `dashboard-filters.tsx` already states:
 * on a phone it opens the platform's own picker, which is easier to operate
 * one-handed than any custom menu and is keyboard- and screen-reader-correct
 * with no code of ours.
 */
function FilterSelect({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { id: string }) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cn(
          'border-input bg-background text-foreground h-11 w-full min-w-0 appearance-none rounded-md border py-2 pr-9 pl-3 text-sm',
          'focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
          className,
        )}
      />
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </div>
  );
}
