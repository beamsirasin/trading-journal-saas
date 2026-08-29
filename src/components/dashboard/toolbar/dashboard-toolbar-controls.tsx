import type { DashboardFilterState } from '@/lib/dashboard/filters';
import { calendarDateIn } from '@/lib/time';
import {
  getActiveTradingAccount,
  getCurrentUserPreferences,
  listSwitchableTradingAccounts,
} from '@/server/auth/dal';
import { getAnalyticsFilterOptions } from '@/server/dal/analytics';

import { DashboardAccountControl } from './account-control';
import { DashboardDateRangeControl } from './date-range-control';
import { DashboardFiltersControl } from './filters-control';

/**
 * The toolbar's server half: everything the three controls need, resolved
 * once, on its own streamed boundary.
 *
 * SEPARATE FROM THE DASHBOARD PAYLOAD ON PURPOSE. These four reads are small
 * and workspace-shaped — the reader's timezone, their Accounts, and the
 * Strategy/Setup options — while `getDashboardPageData` is five bounded
 * analytical reads over the whole selected range. Binding the controls to the
 * heavier bundle would mean the bar a reader uses to CHANGE the range only
 * appeared once the current range had finished computing.
 *
 * EVERY IDENTIFIER IS WORKSPACE-SCOPED SERVER-SIDE. `getAnalyticsFilterOptions`
 * and `listSwitchableTradingAccounts` both derive the workspace from the
 * session (CLAUDE.md §4); nothing here reads an id from the request. The
 * options this renders are presentation only — the authenticated DAL still
 * re-verifies whatever a submitted URL actually contains.
 *
 * `todayDate` is resolved in the reader's PERSISTED analytics timezone, never
 * the server's local zone and never the browser's, so the calendar highlights
 * the same "today" the date bounds are computed against.
 */
export async function DashboardToolbarControls({
  filters,
  dateLocale,
}: {
  filters: DashboardFilterState;
  dateLocale: string;
}) {
  const [preferences, accounts, activeAccount, filterOptions] = await Promise.all([
    getCurrentUserPreferences(),
    listSwitchableTradingAccounts(),
    getActiveTradingAccount(),
    getAnalyticsFilterOptions(),
  ]);

  const today = calendarDateIn(new Date(), preferences.timezone);

  return (
    <>
      {/*
        Date Range leads and is the one control allowed to grow: it carries a
        variable-length label ("Jul 10 – Aug 12, 2026") and it is the control
        a reader reaches for most.
      */}
      <DashboardDateRangeControl
        filters={filters}
        todayDate={today.ok ? today.value : '1970-01-01'}
        dateLocale={dateLocale}
        className="min-w-0 flex-1 md:w-auto md:min-w-40 md:flex-none"
      />
      {/*
        Below `sm` these two are icon-only — the LABEL is dropped, never the
        target. Both stay 44px square, which is what keeps the mobile row
        three real controls rather than four cramped ones.
      */}
      <DashboardFiltersControl
        filters={filters}
        options={filterOptions}
        labelClassName="sr-only sm:not-sr-only"
      />
      <DashboardAccountControl
        filters={filters}
        accounts={accounts}
        activeAccountId={activeAccount?.id ?? null}
        labelClassName="sr-only sm:not-sr-only"
      />
    </>
  );
}
