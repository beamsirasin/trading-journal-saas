/**
 * D6B read-only validation against the deterministic visual fixture.
 *
 * WRITES NOTHING. It opens the same database the seed script targets, reads
 * the two fixture Accounts, runs the real D6A month composers over the real
 * rows, and prints the Calendar facts D6B is contracted to present —
 * including the specific dates a reviewer should open for the visual UAT.
 * Verification that mutates what it verifies is not verification, so this
 * script contains no INSERT, UPDATE, DELETE or DDL and never opens a write
 * transaction.
 *
 * Run: `pnpm validate:visual-dashboard-d6`
 */
import postgres from 'postgres';

import {
  composeCalendarGapMonth,
  composeCalendarPerformanceMonth,
  type CalendarActualRecord,
  type CalendarMonthModel,
  type CalendarPairedRecord,
  type CalendarSystemRecord,
} from '@/lib/dashboard/calendar';
import { calendarDayTone } from '@/lib/dashboard/calendar-presentation';
import { monthRangeIn } from '@/lib/time';
import type { OutcomeValue } from '@/lib/trades/constants';

import {
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_EMAIL,
  VISUAL_FIXTURE_REFERENCE_INSTANT,
  VISUAL_POPULATED_ACCOUNT_NAME,
} from './visual-dashboard-fixture';

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** The months the fixture's reference instant spans, newest first. */
function fixtureMonths(): readonly { readonly year: number; readonly month: number }[] {
  const reference = VISUAL_FIXTURE_REFERENCE_INSTANT;
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth() + 1;
  return [0, 1, 2, 3].map((back) => {
    const total = year * 12 + (month - 1) - back;
    return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
  });
}

function summarise(model: CalendarMonthModel) {
  if (model.status !== 'available') return { status: model.status, reason: model.reason };
  return {
    status: model.status,
    totals: model.totals,
    days: model.days.map((day) => ({
      date: day.date,
      tone: calendarDayTone(day),
      classification: day.classification,
      ...(day.mode === 'gap'
        ? {
            gapR: day.gapR,
            systemR: day.systemR,
            actualR: day.actualR,
            paired: day.pairedTradeCount,
          }
        : {
            totalR: day.totalR,
            trades: day.eligibleTradeCount,
            wl: `${day.wins}W ${day.breakEvens}BE ${day.losses}L`,
          }),
    })),
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('STOP: DATABASE_URL is not set. Run with --env-file=.env.local.');
  }
  const targetEmail = (process.env.VISUAL_TEST_EMAIL ?? VISUAL_FIXTURE_EMAIL).trim().toLowerCase();
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const [user] = await sql`select id from users where lower(email) = ${targetEmail} limit 2`;
    if (user === undefined) throw new Error(`STOP: no user for ${targetEmail}.`);

    const memberships = await sql`
      select wm.workspace_id, up.timezone,
             (up.active_trading_account_id is not null
              and ta.workspace_id = wm.workspace_id) as owns_active_account
      from workspace_members wm
      left join user_preferences up on up.user_id = wm.user_id
      left join trading_accounts ta on ta.id = up.active_trading_account_id
      where wm.user_id = ${user.id}
      order by owns_active_account desc nulls last, wm.workspace_id
    `;
    const active = memberships.filter((row) => row.owns_active_account === true);
    const membership = active.length === 1 ? active[0] : memberships[0];
    if (membership === undefined) throw new Error('STOP: workspace cannot be resolved.');
    const workspaceId = membership.workspace_id as string;
    const timezone = membership.timezone as string;

    const accounts = await sql`
      select id, name from trading_accounts
      where workspace_id = ${workspaceId}
        and name in (${VISUAL_POPULATED_ACCOUNT_NAME}, ${VISUAL_EMPTY_ACCOUNT_NAME})
    `;
    const byName = new Map(accounts.map((row) => [row.name as string, row.id as string]));
    const populated = byName.get(VISUAL_POPULATED_ACCOUNT_NAME);
    const empty = byName.get(VISUAL_EMPTY_ACCOUNT_NAME);
    if (populated === undefined || empty === undefined) {
      throw new Error(
        'STOP: visual fixture Accounts are not seeded. Run pnpm seed:visual-dashboard.',
      );
    }

    const loadMonth = async (
      accountId: string,
      year: number,
      month: number,
    ): Promise<{
      actual: CalendarMonthModel;
      system: CalendarMonthModel;
      gap: CalendarMonthModel;
    }> => {
      const range = monthRangeIn(year, month, timezone);
      if (!range.ok) throw new Error(`STOP: ${year}-${month} is not a month in ${timezone}.`);
      const { start, end } = range.value;

      const actualRows = await sql`
        select id as trade_id, exited_at, actual_r, trader_outcome
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountId}
          and deleted_at is null and status = 'closed'
          and actual_r is not null and trader_outcome is not null
          and exited_at >= ${start} and exited_at < ${end}
      `;
      const systemRows = await sql`
        select id as trade_id, system_exited_at, system_r, system_outcome
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountId}
          and deleted_at is null and system_status = 'resolved'
          and system_r is not null and system_outcome is not null
          and system_exited_at >= ${start} and system_exited_at < ${end}
      `;
      const pairedRows = await sql`
        select id as trade_id, exited_at, system_exited_at, actual_r, system_r
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountId}
          and deleted_at is null and status = 'closed' and system_status = 'resolved'
          and actual_r is not null and trader_outcome is not null
          and system_r is not null and system_outcome is not null
          and system_exited_at is not null
          and exited_at >= ${start} and exited_at < ${end}
      `;

      const actual: CalendarActualRecord[] = actualRows.map((row) => ({
        tradeId: row.trade_id as string,
        exitedAt: (row.exited_at as Date).toISOString(),
        actualR: row.actual_r as string,
        traderOutcome: row.trader_outcome as OutcomeValue,
      }));
      const system: CalendarSystemRecord[] = systemRows.map((row) => ({
        tradeId: row.trade_id as string,
        systemExitedAt: (row.system_exited_at as Date).toISOString(),
        systemR: row.system_r as string,
        systemOutcome: row.system_outcome as OutcomeValue,
      }));
      const paired: CalendarPairedRecord[] = pairedRows.map((row) => ({
        tradeId: row.trade_id as string,
        exitedAt: (row.exited_at as Date).toISOString(),
        systemExitedAt: (row.system_exited_at as Date).toISOString(),
        actualR: row.actual_r as string,
        systemR: row.system_r as string,
      }));

      const base = { year, month, timezone } as const;
      return {
        actual: composeCalendarPerformanceMonth({ ...base, mode: 'actual' }, actual),
        system: composeCalendarPerformanceMonth({ ...base, mode: 'system' }, system),
        gap: composeCalendarGapMonth({ ...base, mode: 'gap' }, paired),
      };
    };

    const months = fixtureMonths();
    const populatedMonths = [];
    for (const { year, month } of months) {
      const loaded = await loadMonth(populated, year, month);
      populatedMonths.push({
        month: `${year}-${String(month).padStart(2, '0')}`,
        actual: summarise(loaded.actual),
        system: summarise(loaded.system),
        gap: summarise(loaded.gap),
      });
    }

    // The dates a reviewer should actually open, chosen from the real data
    // rather than asserted in advance.
    const uatTargets: Record<string, string | null> = {
      positiveActualDay: null,
      negativeActualDay: null,
      breakEvenActualDay: null,
      positiveGapDay: null,
      negativeGapDay: null,
      matchedGapDay: null,
    };
    for (const entry of populatedMonths) {
      const actualDays = 'days' in entry.actual ? entry.actual.days : [];
      const gapDays = 'days' in entry.gap ? entry.gap.days : [];
      for (const day of actualDays) {
        const key =
          day.tone === 'positive'
            ? 'positiveActualDay'
            : day.tone === 'negative'
              ? 'negativeActualDay'
              : 'breakEvenActualDay';
        uatTargets[key] ??= `${entry.month.slice(0, 7)}|${day.date}`;
      }
      for (const day of gapDays) {
        const key =
          day.tone === 'positive'
            ? 'positiveGapDay'
            : day.tone === 'negative'
              ? 'negativeGapDay'
              : 'matchedGapDay';
        uatTargets[key] ??= `${entry.month.slice(0, 7)}|${day.date}`;
      }
    }

    const emptyMonth = await loadMonth(empty, months[0]!.year, months[0]!.month);

    // Partially closed positions must still count as ONE Calendar row each.
    const [partials] = await sql`
      select count(*)::int as trades
      from (
        select t.id
        from trades t
        join trade_exits e on e.trade_id = t.id
        where t.workspace_id = ${workspaceId} and t.trading_account_id = ${populated}
          and t.deleted_at is null
        group by t.id
        having count(e.id) > 1
      ) multi
    `;

    console.log(
      safeJson({
        fixture: { email: targetEmail, workspaceId, timezone },
        accounts: { populated, empty },
        populatedMonths,
        emptyAccountMonth: {
          month: `${months[0]!.year}-${String(months[0]!.month).padStart(2, '0')}`,
          actual: summarise(emptyMonth.actual),
          system: summarise(emptyMonth.system),
          gap: summarise(emptyMonth.gap),
        },
        uatTargets,
        multiLegPositions: partials?.trades ?? 0,
      }),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
