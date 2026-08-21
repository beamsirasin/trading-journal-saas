import { describe, expect, it } from 'vitest';

import {
  deriveTradeSectionStatuses,
  parseTradeDetailSection,
  TRADE_DETAIL_SECTIONS,
  TRADE_SECTION_DOM_ID,
  type TradeSectionStatusInput,
} from './section';

const base: TradeSectionStatusInput = {
  status: 'planned',
  systemStatus: 'pending',
  strategyId: null,
  setupId: null,
  setupConditionState: 'not_recorded',
  confidence: null,
  emotionsRecordedAt: null,
  confirmationNotes: null,
  reviewNotes: null,
  ruleChecks: [],
};

describe('parseTradeDetailSection', () => {
  it.each(TRADE_DETAIL_SECTIONS)('accepts the valid section "%s"', (section) => {
    expect(parseTradeDetailSection(section)).toBe(section);
  });

  it('returns null for an invalid section value, never throwing', () => {
    expect(parseTradeDetailSection('bogus')).toBeNull();
  });

  it('returns null for an absent value', () => {
    expect(parseTradeDetailSection(undefined)).toBeNull();
  });

  it('is case-sensitive and rejects a near-miss casing rather than guessing', () => {
    expect(parseTradeDetailSection('Actual')).toBeNull();
  });
});

describe('TRADE_SECTION_DOM_ID', () => {
  it('maps every section to a distinct existing Trade Detail section id', () => {
    const ids = TRADE_DETAIL_SECTIONS.map((section) => TRADE_SECTION_DOM_ID[section]);
    expect(new Set(ids).size).toBe(TRADE_DETAIL_SECTIONS.length);
  });
});

describe('deriveTradeSectionStatuses — actual', () => {
  it('is complete when closed', () => {
    expect(deriveTradeSectionStatuses({ ...base, status: 'closed' }).actual).toBe('complete');
  });
  it('is active when open', () => {
    expect(deriveTradeSectionStatuses({ ...base, status: 'open' }).actual).toBe('active');
  });
  it('needs attention when planned (legacy, actionable)', () => {
    expect(deriveTradeSectionStatuses({ ...base, status: 'planned' }).actual).toBe(
      'needs_attention',
    );
  });
  it('is not_recorded (never error) when canceled', () => {
    expect(deriveTradeSectionStatuses({ ...base, status: 'canceled' }).actual).toBe('not_recorded');
  });
});

describe('deriveTradeSectionStatuses — system', () => {
  it('is complete when resolved', () => {
    expect(deriveTradeSectionStatuses({ ...base, systemStatus: 'resolved' }).system).toBe(
      'complete',
    );
  });
  it('needs attention when pending', () => {
    expect(deriveTradeSectionStatuses({ ...base, systemStatus: 'pending' }).system).toBe(
      'needs_attention',
    );
  });
  it('is not_recorded (never error) for no_trade', () => {
    expect(deriveTradeSectionStatuses({ ...base, systemStatus: 'no_trade' }).system).toBe(
      'not_recorded',
    );
  });
});

describe('deriveTradeSectionStatuses — strategy & setup', () => {
  it('is not_recorded when neither is assigned', () => {
    expect(deriveTradeSectionStatuses(base).strategy).toBe('not_recorded');
  });
  it('is partial when only Strategy is assigned', () => {
    expect(deriveTradeSectionStatuses({ ...base, strategyId: 's1' }).strategy).toBe('partial');
  });
  it('is complete when both Strategy and Setup are assigned', () => {
    expect(deriveTradeSectionStatuses({ ...base, strategyId: 's1', setupId: 'p1' }).strategy).toBe(
      'complete',
    );
  });
});

describe('deriveTradeSectionStatuses — entry snapshot', () => {
  it('is not_recorded when nothing is recorded', () => {
    expect(deriveTradeSectionStatuses(base).entry).toBe('not_recorded');
  });
  it('is partial when some fields are recorded', () => {
    expect(deriveTradeSectionStatuses({ ...base, confidence: 75 }).entry).toBe('partial');
  });
  it('is complete when all four signals are present', () => {
    expect(
      deriveTradeSectionStatuses({
        ...base,
        setupConditionState: 'recorded',
        confidence: 75,
        emotionsRecordedAt: '2026-08-08T00:00:00.000Z',
        confirmationNotes: 'Waited for confirmation',
      }).entry,
    ).toBe('complete');
  });
  it('treats "not_configured" Setup Conditions as addressed, not missing', () => {
    expect(
      deriveTradeSectionStatuses({
        ...base,
        setupConditionState: 'not_configured',
        confidence: 75,
        emotionsRecordedAt: '2026-08-08T00:00:00.000Z',
        confirmationNotes: 'Waited for confirmation',
      }).entry,
    ).toBe('complete');
  });
});

describe('deriveTradeSectionStatuses — review', () => {
  it('is not_recorded when there are no Rule snapshots and no review notes', () => {
    expect(deriveTradeSectionStatuses(base).review).toBe('not_recorded');
  });
  it('is complete when Rules were never applicable (empty snapshot) and review notes exist', () => {
    expect(deriveTradeSectionStatuses({ ...base, reviewNotes: 'Managed as planned' }).review).toBe(
      'complete',
    );
  });
  it('is partial when Rules are all still not_checked and review notes exist', () => {
    expect(
      deriveTradeSectionStatuses({
        ...base,
        ruleChecks: [{ checkStatus: 'not_checked' }],
        reviewNotes: 'Managed as planned',
      }).review,
    ).toBe('partial');
  });
  it('is complete once at least one Rule has been checked and review notes exist', () => {
    expect(
      deriveTradeSectionStatuses({
        ...base,
        ruleChecks: [{ checkStatus: 'followed' }],
        reviewNotes: 'Managed as planned',
      }).review,
    ).toBe('complete');
  });
});
