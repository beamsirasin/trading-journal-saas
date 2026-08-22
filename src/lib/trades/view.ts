export const DEFAULT_TRADES_VIEW = 'log' as const;

export type TradesView = 'calendar' | 'log';

/** URL input is untrusted; unknown and repeated values return to the operational Log. */
export function parseTradesView(value: string | string[] | undefined): TradesView {
  return value === 'calendar' || value === 'log' ? value : DEFAULT_TRADES_VIEW;
}
