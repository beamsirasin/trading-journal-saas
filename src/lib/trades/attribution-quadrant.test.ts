import { describe, expect, it } from 'vitest';

import { deriveTradeAttributionQuadrant } from './attribution-quadrant';
import { OUTCOME_VALUES } from './constants';

describe('deriveTradeAttributionQuadrant', () => {
  it('names all nine combinations of two independently stored outcomes', () => {
    const produced = new Set<string>();
    for (const systemOutcome of OUTCOME_VALUES) {
      for (const traderOutcome of OUTCOME_VALUES) {
        const quadrant = deriveTradeAttributionQuadrant({ systemOutcome, traderOutcome });
        expect(quadrant).toBe(`${systemOutcome}_${traderOutcome}`);
        produced.add(quadrant as string);
      }
    }
    expect(produced.size).toBe(9);
  });

  it("represents the product's most valuable cell: a good system, a poor execution", () => {
    expect(deriveTradeAttributionQuadrant({ systemOutcome: 'win', traderOutcome: 'loss' })).toBe(
      'win_loss',
    );
  });

  it('represents money made by deviating from a system that did not work', () => {
    expect(deriveTradeAttributionQuadrant({ systemOutcome: 'loss', traderOutcome: 'win' })).toBe(
      'loss_win',
    );
  });

  it('has no reading at all while either axis is unresolved', () => {
    // Inferring the system side from the trader side is exactly the confusion
    // this product exists to remove.
    expect(
      deriveTradeAttributionQuadrant({ systemOutcome: null, traderOutcome: 'win' }),
    ).toBeNull();
    expect(
      deriveTradeAttributionQuadrant({ systemOutcome: 'win', traderOutcome: null }),
    ).toBeNull();
    expect(deriveTradeAttributionQuadrant({ systemOutcome: null, traderOutcome: null })).toBeNull();
  });
});
