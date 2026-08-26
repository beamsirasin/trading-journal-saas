import { isCurrencyCode, type CurrencyCode } from '@/lib/money';

export interface EligibleMoneyResult {
  /** Authoritative stored Actual result. Costs are already reflected when the recording model produced it. */
  readonly netPnlMinor: bigint | string | null;
  readonly baseCurrency: string;
  /** Informational for completeness diagnostics; null money remains decisive regardless of mode. */
  readonly actualResultMode?: 'price' | 'money' | string;
}

export type NetPnlAvailability =
  | { readonly status: 'available'; readonly currency: CurrencyCode; readonly totalMinor: string }
  | { readonly status: 'empty' }
  | {
      readonly status: 'unavailable';
      readonly reason: 'incomplete' | 'mixed_currency' | 'unsupported_currency_scale';
    };

/**
 * Sums authoritative `net_pnl_minor` only when an eligible Actual population
 * is complete, single-currency, and backed by the known minor-unit registry.
 * Gross P&L, commission, fees, and swap are intentionally not inputs: this
 * function must never subtract costs from an already-net stored result.
 */
export function netPnl(results: readonly EligibleMoneyResult[]): NetPnlAvailability {
  if (results.length === 0) return { status: 'empty' };

  const currencies = new Set(results.map((result) => result.baseCurrency));
  if (currencies.size > 1) return { status: 'unavailable', reason: 'mixed_currency' };

  const currency = currencies.values().next().value as string;
  if (!isCurrencyCode(currency)) {
    return { status: 'unavailable', reason: 'unsupported_currency_scale' };
  }
  if (results.some((result) => result.netPnlMinor === null)) {
    return { status: 'unavailable', reason: 'incomplete' };
  }

  let total = 0n;
  for (const result of results) {
    try {
      total += BigInt(result.netPnlMinor as bigint | string);
    } catch {
      return { status: 'unavailable', reason: 'incomplete' };
    }
  }
  return { status: 'available', currency, totalMinor: total.toString() };
}
