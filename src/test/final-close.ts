import { eq } from 'drizzle-orm';

import { trades } from '@/server/db/schema';
import type { RecordContractExitInput } from '@/server/services/trade-exit-contract';

import { getTestDb } from './integration-db';

type FinalClose = Extract<RecordContractExitInput, { scope: 'all_remaining' }>;

/**
 * A FINAL CLOSE THAT MEETS THE COMPLETION RULE (contract decision 59), for
 * fixtures whose subject is something else. It fills only what the rule
 * requires and the Trade does not hold — never an answer a test states:
 *
 *   - an unanswered risk decision → No Defined Risk (no R is invented);
 *   - an unanswered Target → No Fixed Target, with No exit rule where the
 *     Trade has no Exit Plan (the Exit Plan is Required then);
 *   - a No Fixed Target Trade without an Exit Plan → No exit rule;
 *   - no outcome → Break-even; no Final Net P&L → zero.
 *
 * Tests about the rule itself call the service directly, without this.
 */
export async function withRequiredCloseAnswers(
  tradeId: string,
  input: Omit<FinalClose, 'scope'> & { readonly scope?: 'all_remaining' },
): Promise<FinalClose> {
  const row = await getTestDb().query.trades.findFirst({ where: eq(trades.id, tradeId) });
  if (row === undefined) throw new Error(`withRequiredCloseAnswers: trade ${tradeId} missing`);
  const plan: Record<string, unknown> = { ...(input.plan ?? {}) };
  const riskAnswered = row.plannedRiskState === 'no_defined' || row.plannedRiskMinor !== null;
  if (!riskAnswered && plan.plannedRiskState === undefined) plan.plannedRiskState = 'no_defined';
  const target = row.targetState ?? (plan.targetState as string | undefined) ?? null;
  if (target === null) plan.targetState = 'no_fixed';
  if (
    (row.targetState ?? plan.targetState) === 'no_fixed' &&
    row.exitPlanState === null &&
    plan.exitPlan === undefined
  ) {
    plan.exitPlan = { state: 'no_rule' };
  }
  return {
    ...input,
    scope: 'all_remaining',
    traderOutcome: input.traderOutcome ?? 'break_even',
    finalPnlMinor: input.finalPnlMinor ?? 0n,
    ...(Object.keys(plan).length === 0 ? {} : { plan: plan as FinalClose['plan'] }),
  } as FinalClose;
}
