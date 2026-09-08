'use client';

import { useSyncExternalStore } from 'react';

import { PROTOTYPE_STRATEGIES } from '../fixtures';

/**
 * SAVED EXIT PLANS — a small reusable library, not a rule engine.
 *
 * WHAT THIS REPLACES. A textarea. Every trade managed the same way had its exit
 * plan retyped, so the identical rule existed as twenty slightly different
 * sentences and nothing could ever be counted across them. Typing is not the
 * expensive part of that; the divergence is.
 *
 * A PLAN IS A NAME AND SOME INSTRUCTIONS. Nothing else. No conditions, no
 * IF/THEN, no priority between plans, no composition of one plan out of others.
 * A trader can already say the true thing in a sentence — "trail beneath
 * structure, but close any remainder at the New York session end" — and a
 * builder that could express that formally would take longer to operate than
 * the trade takes to run. One plan is in effect on a trade at a time.
 *
 * THE STRATEGY ASSOCIATION IS A DEFAULT, NOT A LOCK. A plan may name the
 * strategy it belongs to, which is what lets a trade inherit something sensible
 * before the trader has said anything. It never prevents choosing another plan,
 * and choosing another plan never edits the strategy's own.
 *
 * PROTOTYPE LIMITATION, STATED PLAINLY. This library lives in module memory for
 * the life of the tab. A plan created here survives navigation inside the
 * prototype and is lost on reload; there is no persistence, no per-workspace
 * scope, and no versioning — editing a plan later would silently change what
 * every trade that adopted it appears to say, which is exactly why the trade
 * draft SNAPSHOTS the wording instead of pointing at it (see `ExitPlanDraft`).
 * Real versioning is a schema decision, not a prototype one.
 */
export interface SavedExitPlan {
  readonly id: string;
  /** How the trader refers to it — short, and the thing shown in a list. */
  readonly name: string;
  /** What to actually do. The sentence that gets adopted onto a trade. */
  readonly instructions: string;
  /** The strategy this is the default exit plan for, when it is one. */
  readonly strategyName: string | null;
}

/*
  THE SEEDED LIBRARY COMES FROM THE STRATEGIES THAT ACTUALLY STATE A PLAN.

  Three of the five prototype strategies deliberately record no exit plan, and
  they contribute nothing here. A strategy having a name is not evidence that
  its author ever wrote down how to get out of a trade, and manufacturing a
  default from the name would be the product inventing a rule on the trader's
  behalf.
*/
const STRATEGY_DEFAULTS: readonly SavedExitPlan[] = PROTOTYPE_STRATEGIES.flatMap((strategy) =>
  'exitPlan' in strategy
    ? [
        {
          id: `xp-strategy-${strategy.name.toLowerCase().replaceAll(' ', '-')}`,
          name: `${strategy.name} exit`,
          instructions: strategy.exitPlan,
          strategyName: strategy.name,
        },
      ]
    : [],
);

/** Plans a trader keeps for their own sake, tied to no strategy. */
const STANDALONE_PLANS: readonly SavedExitPlan[] = [
  {
    id: 'xp-session-close',
    name: 'Session close',
    instructions:
      'Close anything still open at the New York session close, whatever it is showing.',
    strategyName: null,
  },
  {
    id: 'xp-half-at-target',
    name: 'Half at first target',
    instructions:
      'Take half off at the first target, move the stop to entry, and let the remainder run to the next structure high.',
    strategyName: null,
  },
];

let plans: readonly SavedExitPlan[] = [...STRATEGY_DEFAULTS, ...STANDALONE_PLANS];
let created = 0;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly SavedExitPlan[] {
  return plans;
}

/** Every saved plan, newest last. Re-renders every reader when one is added. */
export function useExitPlanLibrary(): readonly SavedExitPlan[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Adds a plan and returns it.
 *
 * IT NEVER TOUCHES A STRATEGY DEFAULT. Creating a plan while a strategy's own
 * plan is on screen is not editing that plan — the new one is the trader's,
 * standalone, and the strategy still says exactly what it said before.
 */
export function saveExitPlan(name: string, instructions: string): SavedExitPlan {
  created += 1;
  const plan: SavedExitPlan = {
    id: `xp-new-${created}`,
    name: name.trim(),
    instructions: instructions.trim(),
    strategyName: null,
  };
  plans = [...plans, plan];
  for (const listener of listeners) listener();
  return plan;
}

/** The plan a strategy nominates as its default, or `null` when it names none. */
export function strategyDefaultPlan(strategyName: string | null): SavedExitPlan | null {
  if (strategyName === null) return null;
  return plans.find((plan) => plan.strategyName === strategyName) ?? null;
}

export function findExitPlan(id: string | null): SavedExitPlan | null {
  if (id === null) return null;
  return plans.find((plan) => plan.id === id) ?? null;
}
