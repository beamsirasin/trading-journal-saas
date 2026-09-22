import { beforeEach, describe, expect, it } from 'vitest';

import {
  closeBasisMatches,
  closeDraftStorageKey,
  loadCloseTask,
  ownerCloseDrafts,
  removeCloseDraft,
  removeCloseTask,
  saveCloseTask,
  type CloseDraftTask,
} from './close-trade-draft-storage';
import { clearOwnerRecordingDrafts, ownerRecordingDrafts } from './recording-draft-storage';

const SCOPE = { ownerKey: 'owner-a', workspaceKey: 'ws-1', tradeKey: 'trade-1' };
const NOW = new Date('2026-09-22T10:00:00.000Z');
const CONTEXT = { symbol: 'XAUUSD', now: NOW };

function task(overrides: Partial<CloseDraftTask> = {}): CloseDraftTask {
  return {
    basis: { status: 'open', exitIds: [] },
    exitResult: {
      leg: { pnl: '50', closedPercent: '', exitedAt: '', price: '', reason: '' },
      finalExitedAt: '',
      finalPnl: '',
      finalPnlAdopted: false,
      outcome: null,
      completeness: 'unanswered',
    },
    submission: null,
    ...overrides,
  };
}

beforeEach(() => window.localStorage.clear());

describe('the Close Trade draft', () => {
  it('lives under its own key, never inside the Add Trade Recording Draft', () => {
    saveCloseTask(SCOPE, 'part', task(), CONTEXT);
    expect(Object.keys(window.localStorage)).toEqual([
      'tradechemist:close-draft:owner-a:ws-1:trade-1',
    ]);
    expect(closeDraftStorageKey(SCOPE)).not.toContain('recording-draft');
  });

  it('keeps each task separately: a Part and a Final Close never restore each other', () => {
    saveCloseTask(SCOPE, 'part', task(), CONTEXT);
    const final = task({
      exitResult: { ...task().exitResult, finalPnl: '-30', outcome: 'loss' },
    });
    saveCloseTask(SCOPE, 'all_remaining', final, CONTEXT);
    expect(loadCloseTask(SCOPE, 'part', NOW)?.exitResult.leg.pnl).toBe('50');
    expect(loadCloseTask(SCOPE, 'all_remaining', NOW)?.exitResult).toMatchObject({
      finalPnl: '-30',
      outcome: 'loss',
    });
    removeCloseTask(SCOPE, 'part', NOW);
    expect(loadCloseTask(SCOPE, 'part', NOW)).toBeNull();
    expect(loadCloseTask(SCOPE, 'all_remaining', NOW)).not.toBeNull();
    removeCloseTask(SCOPE, 'all_remaining', NOW);
    expect(window.localStorage.length).toBe(0);
  });

  it('is scoped per Trade, workspace and user', () => {
    saveCloseTask(SCOPE, 'part', task(), CONTEXT);
    expect(loadCloseTask({ ...SCOPE, tradeKey: 'trade-2' }, 'part', NOW)).toBeNull();
    expect(loadCloseTask({ ...SCOPE, workspaceKey: 'ws-2' }, 'part', NOW)).toBeNull();
    expect(loadCloseTask({ ...SCOPE, ownerKey: 'owner-b' }, 'part', NOW)).toBeNull();
  });

  it('keeps the last Save key and body, so a reload replays instead of duplicating', () => {
    const submission = { key: '018f0000-0000-7000-8000-0000000000aa', body: '{"scope":"part"}' };
    saveCloseTask(SCOPE, 'part', task({ submission }), CONTEXT);
    expect(loadCloseTask(SCOPE, 'part', NOW)?.submission).toEqual(submission);
  });

  it('drops an unreadable, incompatible or expired draft rather than guessing at it', () => {
    const key = closeDraftStorageKey(SCOPE);
    window.localStorage.setItem(key, '{not json');
    expect(loadCloseTask(SCOPE, 'part', NOW)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    window.localStorage.setItem(
      key,
      JSON.stringify({ kind: 'tradechemist.close-draft', version: 99, tasks: {} }),
    );
    expect(loadCloseTask(SCOPE, 'part', NOW)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    saveCloseTask(SCOPE, 'part', task(), { ...CONTEXT, now: new Date('2026-08-01T00:00:00Z') });
    expect(loadCloseTask(SCOPE, 'part', NOW)).toBeNull();
  });

  it('knows when its answers were given against a Trade that has since changed', () => {
    const basis = { status: 'open', exitIds: ['a'] };
    expect(closeBasisMatches(basis, { status: 'open', exitIds: ['a'] })).toBe(true);
    expect(closeBasisMatches(basis, { status: 'open', exitIds: ['a', 'b'] })).toBe(false);
    expect(closeBasisMatches(basis, { status: 'closed', exitIds: ['a'] })).toBe(false);
  });

  it('is named by sign-out and cleared with the user’s other drafts, and nobody else’s', () => {
    saveCloseTask(SCOPE, 'part', task(), CONTEXT);
    saveCloseTask({ ...SCOPE, ownerKey: 'owner-b' }, 'part', task(), CONTEXT);
    expect(ownerCloseDrafts('owner-a', NOW)).toEqual([{ symbol: 'XAUUSD' }]);
    expect(ownerRecordingDrafts('owner-a', NOW)).toEqual([{ symbol: 'XAUUSD' }]);
    clearOwnerRecordingDrafts('owner-a');
    expect(loadCloseTask(SCOPE, 'part', NOW)).toBeNull();
    expect(loadCloseTask({ ...SCOPE, ownerKey: 'owner-b' }, 'part', NOW)).not.toBeNull();
  });

  it('removes every task for a Trade that can no longer be closed', () => {
    saveCloseTask(SCOPE, 'part', task(), CONTEXT);
    saveCloseTask(SCOPE, 'all_remaining', task(), CONTEXT);
    removeCloseDraft(SCOPE);
    expect(window.localStorage.length).toBe(0);
  });
});
