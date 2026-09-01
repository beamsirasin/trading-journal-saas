import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRADE_DETAILS_TAB,
  parseTradeDetailsTab,
  TRADE_DETAILS_TABS,
} from './details-tabs';

describe('the six Trade Details tabs', () => {
  it("is exactly this product's own six, in workflow order", () => {
    expect([...TRADE_DETAILS_TABS]).toEqual([
      'overview',
      'plan',
      'execution',
      'review',
      'chart',
      'notes',
    ]);
  });

  it('opens on Overview when the URL names no tab', () => {
    expect(DEFAULT_TRADE_DETAILS_TAB).toBe('overview');
    expect(parseTradeDetailsTab(undefined)).toBe('overview');
  });
});

describe('parseTradeDetailsTab', () => {
  it('accepts every tab', () => {
    for (const tab of TRADE_DETAILS_TABS) {
      expect(parseTradeDetailsTab(tab)).toBe(tab);
    }
  });

  it('degrades an unrecognised or repeated value rather than blanking the sheet', () => {
    expect(parseTradeDetailsTab('stats')).toBe('overview');
    expect(parseTradeDetailsTab(['plan', 'review'])).toBe('overview');
    expect(parseTradeDetailsTab('')).toBe('overview');
  });
});

describe('the retired ?section= contract still lands somewhere true', () => {
  it('maps each old section to the tab that now holds its content', () => {
    expect(parseTradeDetailsTab(undefined, 'actual')).toBe('execution');
    expect(parseTradeDetailsTab(undefined, 'system')).toBe('plan');
    expect(parseTradeDetailsTab(undefined, 'strategy')).toBe('plan');
    expect(parseTradeDetailsTab(undefined, 'entry')).toBe('plan');
    expect(parseTradeDetailsTab(undefined, 'review')).toBe('review');
  });

  it('lets an explicit tab win over a legacy section', () => {
    expect(parseTradeDetailsTab('chart', 'actual')).toBe('chart');
  });

  it('falls back to the default for an unrecognised section', () => {
    expect(parseTradeDetailsTab(undefined, 'zella')).toBe('overview');
    expect(parseTradeDetailsTab(undefined, ['actual'])).toBe('overview');
  });
});
