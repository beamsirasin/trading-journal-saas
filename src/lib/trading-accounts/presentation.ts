import { formatMoney, isCurrencyCode, parseMoney } from '@/lib/money';

/**
 * Display formatting for a Trading Account's stored `starting_balance`.
 *
 * The column is `NUMERIC(20, 10)` and Drizzle hands it back as a string
 * (CLAUDE.md §5), so the raw value is `"10000.0000000000"` — correct storage,
 * unreadable presentation. This turns it into `$10,000.00` at the
 * presentation boundary and nowhere else: the stored value is never mutated,
 * never re-parsed for arithmetic, and never rounded before it is stored.
 *
 * NOT A SECOND MONEY FORMATTER. The decimal string goes through the canonical
 * `parseMoney` -> `formatMoney` pair, so the currency's own ISO-4217 exponent
 * decides the decimal places — `¥10,000` for JPY, `$10,000.00` for USD — and
 * no `2` is hardcoded here. Excess decimals from the column's ten-place scale
 * are rounded once, here, which is exactly the "round once at the
 * presentation boundary" rule; the trailing zeros a stored balance actually
 * carries make that rounding a no-op in practice.
 *
 * DELIBERATELY LOCALE-INDEPENDENT, for the reason `formatNet` already records
 * in `src/components/dashboard/format.ts`: the symbol follows the ACCOUNT's
 * configured currency, not the UI language, so a Thai-locale trader with a USD
 * account still sees `$` rather than having it silently become `฿`. EN and TH
 * also share the comma-thousands/period-decimal convention for Arabic
 * numerals, so there is no per-locale difference to make — and reaching for
 * `Intl.NumberFormat` here would introduce the second formatter this
 * codebase does not want.
 *
 * NON-REGISTRY TICKERS STAY TRUTHFUL. `trading_accounts.base_currency` is a
 * shape-validated ticker, not the closed fiat `CurrencyCode` registry
 * (CLAUDE.md assumption A12) — BTC, ETH, USDT and USDC are all legitimate
 * values with no ISO exponent and no symbol. Those cannot go through `Money`
 * at all, so they keep the existing `<amount> <TICKER>` rendering; only the
 * NUMERIC scale's trailing zeros are dropped, which is a pure string
 * operation and exactly value-preserving.
 */
export function formatStartingBalance(startingBalance: string, baseCurrency: string): string {
  if (isCurrencyCode(baseCurrency)) {
    const parsed = parseMoney(startingBalance, baseCurrency, {
      onExcessDecimals: 'round-half-up',
    });
    if (parsed.ok) {
      return formatMoney(parsed.value, { style: 'symbol' });
    }
  }
  return `${trimStoredDecimalScale(startingBalance)} ${baseCurrency}`;
}

/**
 * `"10000.0000000000"` -> `"10000"`, `"0.5000000000"` -> `"0.5"`.
 *
 * Only ever removes zeros that the column's fixed ten-place scale added, so
 * the value it returns is the same number it was handed. The fractional-digit
 * guard is what makes that true: without it, `"1000"` would lose its own
 * trailing zeros and become `"1"`.
 */
function trimStoredDecimalScale(value: string): string {
  const trimmed = value.trim();
  if (!/^[+-]?\d+\.\d+$/.test(trimmed)) return trimmed;
  return trimmed.replace(/\.?0+$/, '');
}
