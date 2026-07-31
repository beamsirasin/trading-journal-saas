/**
 * Demo data for the Phase 01 visual prototype.
 *
 * Static, fictional, and clearly labelled at every render site. No formulas
 * live here — see `types.ts` for why that restriction matters.
 */

export {
  DEMO_ACCOUNTS,
  DEMO_BUNDLES,
  DEMO_DEFAULT_ACCOUNT,
  DEMO_DEFAULT_RANGE,
  DEMO_RANGES,
  DEMO_TRADES,
  demoBundle,
  demoTradesForAccount,
} from './fixtures';

export type {
  DemoAccount,
  DemoAttribution,
  DemoBundle,
  DemoDirection,
  DemoEquityPoint,
  DemoMistake,
  DemoOutcome,
  DemoRange,
  DemoRangeId,
  DemoSeverity,
  DemoTrade,
} from './types';
