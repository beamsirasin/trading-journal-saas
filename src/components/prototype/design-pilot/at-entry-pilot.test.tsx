import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AtEntryPilot } from './at-entry-pilot';
import {
  EMPTY_DRAFT,
  exitPlanActions,
  exitPlanStatus,
  priceNotice,
  saveRequirements,
  seedDraft,
  validateDraft,
  type PilotDraft,
} from './at-entry-pilot-model';

const withStrategy: PilotDraft = {
  ...EMPTY_DRAFT,
  strategy: { kind: 'selected', name: 'Elliott Wave' },
};

describe('At Entry visual pilot — semantics the look must not collapse', () => {
  it('inherits a Strategy default visibly, and never as an explicit choice', () => {
    const status = exitPlanStatus(withStrategy);
    expect(status.kind).toBe('inherited');
    expect(withStrategy.exitPlan.source).toBe('none');
    expect(exitPlanStatus(exitPlanActions.confirmInherited(withStrategy)).kind).toBe('saved');
  });

  it('keeps a declined inheritance declined until an explicit restore', () => {
    const declined = exitPlanActions.decline(withStrategy);
    expect(exitPlanStatus(declined).kind).toBe('not_recorded');
    const changedStrategy: PilotDraft = {
      ...declined,
      strategy: { kind: 'selected', name: 'Mean Reversion' },
    };
    expect(exitPlanStatus(changedStrategy).kind).toBe('not_recorded');
    expect(exitPlanStatus(exitPlanActions.restoreStrategyDefault(changedStrategy)).kind).toBe(
      'inherited',
    );
  });

  it('never inherits without a Strategy that states a plan', () => {
    expect(exitPlanStatus(EMPTY_DRAFT).kind).toBe('not_recorded');
    expect(
      exitPlanStatus({ ...EMPTY_DRAFT, strategy: { kind: 'selected', name: 'Price Action' } }).kind,
    ).toBe('not_recorded');
  });

  it('requires only Account, Symbol, Direction and a positive Risk at Entry to save', () => {
    expect(Object.keys(validateDraft(EMPTY_DRAFT)).sort()).toEqual(['direction', 'risk', 'symbol']);
    expect(validateDraft({ ...EMPTY_DRAFT, risk: '0' }).risk).toMatch(/more than zero/);
    const ready: PilotDraft = { ...EMPTY_DRAFT, symbol: 'XAUUSD', direction: 'long', risk: '250' };
    expect(validateDraft({ ...ready, entryTime: null })).toEqual({});
    expect(saveRequirements(ready).every((item) => item.done)).toBe(true);
  });

  it('blocks an explicit Fixed Target with neither representation, and nothing else', () => {
    const ready: PilotDraft = { ...EMPTY_DRAFT, symbol: 'XAUUSD', direction: 'long', risk: '250' };
    expect(validateDraft({ ...ready, target: 'fixed' }).target).toBeDefined();
    expect(validateDraft({ ...ready, target: 'fixed', tpPrice: '2410.50' })).toEqual({});
    expect(validateDraft({ ...ready, target: 'none' })).toEqual({});
    expect(validateDraft({ ...ready, target: null })).toEqual({});
  });

  it('keeps Actual Risk "different, amount unknown" as a valid answer', () => {
    const different: PilotDraft = {
      ...EMPTY_DRAFT,
      symbol: 'XAUUSD',
      direction: 'long',
      risk: '250',
      actualRisk: { kind: 'different', amount: '' },
    };
    expect(validateDraft(different)).toEqual({});
    expect(different.actualRisk.kind).toBe('different');
  });

  it('reports a wrong-side stop as a notice, never as a save-blocking issue', () => {
    const seed = seedDraft('validation').draft;
    expect(priceNotice(seed)).toMatch(/will not stop you saving/);
    expect(validateDraft(seed).stopPrice).toBeUndefined();
    expect(validateDraft(seed).entryPrice).toBeUndefined();
  });

  it('renders untouched answers as unanswered and the entry time as an automatic default', () => {
    render(<AtEntryPilot initialState="untouched" figures="tabular" />);

    for (const group of ['Direction', 'Target']) {
      const fieldset = screen.getByRole('group', { name: group });
      for (const radio of within(fieldset).getAllByRole('radio')) {
        expect(radio).not.toBeChecked();
      }
    }
    expect(screen.getByText('Set automatically to now')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Confidence' })).toBeInTheDocument();
    expect(screen.getAllByText('Not answered').length).toBeGreaterThan(0);
    expect(screen.queryByText(/price levels instead/i)).toBeNull();
  });

  it('confirms the automatic entry time only through an explicit action', () => {
    render(<AtEntryPilot initialState="untouched" figures="tabular" />);
    fireEvent.click(screen.getByRole('button', { name: 'This time is right' }));
    expect(screen.queryByText('Set automatically to now')).toBeNull();
  });

  it('renders each journal field once, so labels keep a single target', () => {
    render(<AtEntryPilot initialState="analytical" figures="tabular" />);
    expect(screen.getAllByLabelText('Strategy')).toHaveLength(1);
    expect(screen.getByText('From Strategy: Elliott Wave')).toBeInTheDocument();
    expect(screen.getByText('Different, amount not known')).toBeInTheDocument();
  });
});
