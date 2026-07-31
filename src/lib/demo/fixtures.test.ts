import { describe, expect, it } from 'vitest';

import { parseInstant } from '@/lib/time';

import {
  DEMO_ACCOUNTS,
  DEMO_BUNDLES,
  DEMO_RANGES,
  DEMO_TRADES,
  demoTradesForAccount,
} from './fixtures';
import type { DemoBundle } from './types';

/**
 * These are fixtures, not logic — so the tests assert the properties a reader
 * of the demo dashboard would reasonably infer from the numbers. Hand-written
 * data drifts silently when edited, and an inconsistent demo undermines the
 * exact claim the page is making.
 *
 * Comparisons go through a fixed-point integer (tenths of an R) rather than
 * `parseFloat`, because `37.8 - 9.9 === 27.900000000000002` and the product's
 * whole position is that financial values do not get compared as floats.
 */
const tenths = (value: string): number => {
  const scaled = Number(value) * 10;
  const rounded = Math.round(scaled);
  expect(Math.abs(scaled - rounded)).toBeLessThan(1e-6);
  return rounded;
};

const BUNDLES: readonly DemoBundle[] = Object.values(DEMO_BUNDLES);

describe('demo bundles', () => {
  it('covers every advertised range exactly once', () => {
    expect(BUNDLES).toHaveLength(DEMO_RANGES.length);
    expect(new Set(BUNDLES.map((b) => b.range))).toEqual(new Set(DEMO_RANGES.map((r) => r.id)));
  });

  it.each(BUNDLES)('$range — edge leakage equals system total R minus actual total R', (bundle) => {
    const { systemTotalR, actualTotalR, edgeLeakageR } = bundle.attribution;
    expect(tenths(systemTotalR) - tenths(actualTotalR)).toBe(tenths(edgeLeakageR));
  });

  it.each(BUNDLES)('$range — mistake costs account for the whole edge leakage', (bundle) => {
    const totalCost = bundle.mistakes.reduce((sum, m) => sum + tenths(m.costR), 0);
    expect(totalCost).toBe(tenths(bundle.attribution.edgeLeakageR));
  });

  it.each(BUNDLES)('$range — the equity curve ends at the reported totals', (bundle) => {
    const last = bundle.equityCurve.at(-1);
    expect(last).toBeDefined();
    expect(last?.systemR).toBe(bundle.attribution.systemTotalR);
    expect(last?.actualR).toBe(bundle.attribution.actualTotalR);
  });

  it.each(BUNDLES)('$range — the equity curve starts at zero on both series', (bundle) => {
    expect(bundle.equityCurve[0]).toMatchObject({ systemR: '0.0', actualR: '0.0' });
  });

  it.each(BUNDLES)('$range — max drawdown is at least the weekly-sampled trough', (bundle) => {
    // A weekly sample cannot reveal an intra-week trough, so the reported
    // per-trade drawdown must be at least as deep as what the curve shows.
    // A shallower figure would be impossible and would misrepresent risk.
    const worstDip = (pick: (p: (typeof bundle.equityCurve)[number]) => string) => {
      let peak = -Infinity;
      let worst = 0;
      for (const point of bundle.equityCurve) {
        const value = tenths(pick(point));
        peak = Math.max(peak, value);
        worst = Math.max(worst, peak - value);
      }
      return worst;
    };

    expect(tenths(bundle.attribution.systemMaxDrawdownR)).toBeGreaterThanOrEqual(
      worstDip((p) => p.systemR),
    );
    expect(tenths(bundle.attribution.actualMaxDrawdownR)).toBeGreaterThanOrEqual(
      worstDip((p) => p.actualR),
    );
  });

  it.each(BUNDLES)('$range — the trader captured less edge than the system offered', (bundle) => {
    // The scenario the demo exists to show. If a future edit inverted this,
    // every explanatory caption on the dashboard would become wrong.
    expect(tenths(bundle.attribution.actualTotalR)).toBeLessThan(
      tenths(bundle.attribution.systemTotalR),
    );
    expect(tenths(bundle.attribution.edgeLeakageR)).toBeGreaterThan(0);
  });
});

describe('demo trades', () => {
  it('has unique ids', () => {
    expect(new Set(DEMO_TRADES.map((t) => t.id)).size).toBe(DEMO_TRADES.length);
  });

  it('stores timestamps with an explicit offset', () => {
    for (const trade of DEMO_TRADES) {
      // parseInstant rejects a timestamp without an offset — the rejection
      // that stops display depending on the server's local timezone.
      expect(parseInstant(trade.closedAt).ok).toBe(true);
    }
  });

  it('references only known accounts', () => {
    const known = new Set(DEMO_ACCOUNTS.map((a) => a.id));
    for (const trade of DEMO_TRADES) {
      expect(known.has(trade.accountId)).toBe(true);
    }
  });

  it('represents all four cells of the outcome matrix', () => {
    const cells = new Set(
      DEMO_TRADES.filter((t) => t.actualOutcome !== 'break_even').map(
        (t) => `${t.systemOutcome}/${t.actualOutcome}`,
      ),
    );

    // The two asymmetric cells are the reason system and actual outcome are
    // stored independently. A fixture set missing them would fail to
    // demonstrate the one thing the product does that others cannot.
    expect(cells).toContain('win/loss');
    expect(cells).toContain('loss/win');
    expect(cells).toContain('win/win');
    expect(cells).toContain('loss/loss');
  });

  it('uses USD minor units for every net result', () => {
    for (const trade of DEMO_TRADES) {
      expect(trade.net.currency).toBe('USD');
      expect(typeof trade.net.amountMinor).toBe('bigint');
    }
  });

  it('agrees on sign between the actual R and the net result', () => {
    for (const trade of DEMO_TRADES) {
      const r = Number(trade.actualR);
      if (r > 0) expect(trade.net.amountMinor).toBeGreaterThan(0n);
      if (r < 0) expect(trade.net.amountMinor).toBeLessThan(0n);
    }
  });
});

describe('demoTradesForAccount', () => {
  it('returns everything for the combined view', () => {
    expect(demoTradesForAccount('all')).toEqual(DEMO_TRADES);
  });

  it('returns only that account for a specific account', () => {
    const trades = demoTradesForAccount('acc-prop');
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.accountId === 'acc-prop')).toBe(true);
  });

  it('returns an empty list for an unknown account rather than everything', () => {
    expect(demoTradesForAccount('nope')).toEqual([]);
  });

  it('gives every selectable account at least one trade', () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(demoTradesForAccount(account.id).length).toBeGreaterThan(0);
    }
  });
});
