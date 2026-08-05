export { getPlanDefinition, isPlanKey, PLAN_DEFINITIONS, PLAN_KEYS } from './plan-catalog';
export type { PlanDefinition, PlanKey } from './plan-catalog';

export const TRIAL_DAYS = 7;

/**
 * The trial allowance is explicit and independent from every paid plan.
 * Changing a paid-plan allowance must never silently change the trial.
 */
export const TRIAL_ACCOUNT_LIMIT = 1;
