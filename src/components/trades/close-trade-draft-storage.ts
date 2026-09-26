import { z } from 'zod';

import { OUTCOME_VALUES } from '@/lib/trades/constants';
import { PLAN_OUTCOMES, type PlanOutcome } from '@/lib/trades/plan-outcome';

import { BLANK_CLOSE_PLAN, type CloseScope, type CloseTradeDraft } from './close-trade-draft';

/**
 * THE CLOSE TRADE DRAFT: the Close Existing Open Trade flow's own unsaved
 * answers, in this browser's `localStorage` (contract §23; UX Rules §5).
 *
 * SEPARATE FROM THE ADD TRADE RECORDING DRAFT. That envelope holds one new
 * Trade being recorded; this one holds the close of one EXISTING Trade, so it
 * is keyed per Trade and shares no schema, key or lifecycle with it.
 *
 * KEY: `tradechemist:close-draft:<ownerKey>:<workspaceKey>:<tradeKey>` — three
 * opaque hashes the server derives from the session's user, the active
 * workspace and the Trade (`src/server/services/recording-draft-scope.ts`), so
 * the key names no raw id and one user's close is never read under another's.
 *
 * ONE ENVELOPE PER TRADE, ONE TASK PER SCOPE. "Record partial exit" and "Close
 * trade" are different tasks on the same Trade; each keeps its own answers
 * (`tasks.part`, `tasks.all_remaining`), so opening one never restores the
 * other's.
 *
 * STAGE 6 LIVES BESIDE THE TASKS (version 2). After-Trade Context comes AFTER
 * the Final Close has succeeded and cleared the All Remaining task, so it is
 * the envelope's own `afterTradeContext` slot, not part of that task: a Final
 * Close can succeed, the page can reload, and Stage 6 resumes with its own
 * answers and its own Save key (never the Final Close's). A version-1 draft is
 * read as version 2 with no Stage 6 answers.
 *
 * WHAT IS NOT KEPT: the visual state — which fold is open, which sheet — is
 * view state and starts fresh on every load.
 *
 * STALE ANSWERS ARE NEVER SUBMITTED SILENTLY. Each task records the Trade state
 * its answers were given against (`basis`: status and the recorded exit ids).
 * When the Trade has changed since — an exit recorded elsewhere, a close — the
 * form restores the answers but holds the Save until the trader confirms them.
 *
 * THE SAVE KEY SURVIVES A RELOAD. A task keeps the key and body of its last
 * attempted Save, so re-sending the same answers after a reload replays safely
 * instead of recording the exit twice.
 *
 * FAILS SAFE, as the Recording Draft does: unavailable storage is "no draft",
 * and a stored value that does not parse is dropped, never guessed at.
 */

const PREFIX = 'tradechemist:close-draft:';
const KIND = 'tradechemist.close-draft';
export const CLOSE_DRAFT_VERSION = 2;
/** The same retention the Recording Draft uses: untouched for 30 days, gone when next read. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CloseDraftScope {
  readonly ownerKey: string;
  readonly workspaceKey: string;
  readonly tradeKey: string;
}

/** The Trade state a task's answers were given against. */
export interface CloseDraftBasis {
  readonly status: string;
  readonly exitIds: readonly string[];
}

export interface CloseDraftSubmission {
  readonly key: string;
  readonly body: string;
}

/** Exit & Result answers — the draft minus its scope, which the task key already says. */
export type ExitResultAnswers = Omit<CloseTradeDraft, 'scope'>;

export interface CloseDraftTask {
  readonly basis: CloseDraftBasis;
  readonly exitResult: ExitResultAnswers;
  readonly submission: CloseDraftSubmission | null;
}

/**
 * Stage 6 answers, as the form holds them. `postTradeEmotionKeys`: `null` is
 * Unanswered, `[]` an explicit None, a list the trader's choice.
 */
export interface AfterTradeContextAnswers {
  readonly note: string;
  readonly tradingviewUrl: string;
  readonly postTradeEmotionKeys: readonly string[] | null;
  /**
   * The System Result as typed (decision 55): `outcome: null` is Unanswered.
   * A draft written before it has none and reads as Unanswered.
   */
  readonly planOutcome: { readonly outcome: PlanOutcome | null; readonly amount: string };
}

export interface AfterTradeContextTask {
  /** Stage 6 is for a Closed Trade; answers given before a status change are held. */
  readonly basis: { readonly status: string };
  readonly answers: AfterTradeContextAnswers;
  /** The last attempted Stage 6 Save — its own key, never the Final Close's. */
  readonly submission: CloseDraftSubmission | null;
}

export interface CloseDraftEnvelope {
  readonly kind: typeof KIND;
  readonly version: typeof CLOSE_DRAFT_VERSION;
  readonly savedAt: string;
  /** For the sign-out warning, which names what would be lost. */
  readonly symbol: string;
  readonly tasks: Partial<Record<CloseScope, CloseDraftTask>>;
  readonly afterTradeContext?: AfterTradeContextTask;
}

const text = z.string().max(2_000);
const TaskSchema = z.object({
  basis: z.object({ status: z.string().max(40), exitIds: z.array(z.string().max(64)).max(100) }),
  exitResult: z.object({
    leg: z.object({
      pnl: text,
      closedPercent: text,
      exitedAt: text,
      price: text,
      reason: text,
    }),
    finalExitedAt: text,
    finalPnl: text,
    finalPnlAdopted: z.boolean(),
    outcome: z.enum(OUTCOME_VALUES).nullable(),
    completeness: z.enum(['unanswered', 'complete', 'incomplete', 'unknown']),
    // Decision 59. Absent from a task saved before it: nothing answered here.
    plan: z
      .object({
        riskState: z.enum(['unanswered', 'defined', 'no_defined']),
        risk: text,
        target: z.object({
          state: z.enum(['unanswered', 'fixed', 'no_fixed']),
          profit: text,
          price: text,
        }),
        exitPlan: z.object({
          choice: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('inherit') }),
            z.object({ kind: z.literal('unanswered') }),
            z.object({ kind: z.literal('saved'), exitPlanId: z.string().max(64) }),
            z.object({ kind: z.literal('customized') }),
            z.object({ kind: z.literal('no_rule') }),
          ]),
          customText: z.string().max(4_000),
          customBaseId: z.string().max(64).nullable(),
        }),
      })
      .default(BLANK_CLOSE_PLAN),
  }),
  submission: z.object({ key: z.string().uuid(), body: z.string().max(20_000) }).nullable(),
});
const submissionSchema = z
  .object({ key: z.string().uuid(), body: z.string().max(20_000) })
  .nullable();
const AfterTradeContextSchema = z.object({
  basis: z.object({ status: z.string().max(40) }),
  answers: z.object({
    note: z.string().max(4_000),
    tradingviewUrl: z.string().max(2_000),
    postTradeEmotionKeys: z.array(z.string().max(64)).max(40).nullable(),
    planOutcome: z
      .object({ outcome: z.enum(PLAN_OUTCOMES).nullable(), amount: z.string().max(64) })
      .default({ outcome: null, amount: '' }),
  }),
  submission: submissionSchema,
});
const envelopeFields = {
  kind: z.literal(KIND),
  savedAt: z.string().datetime(),
  symbol: z.string().max(64),
  tasks: z.object({ part: TaskSchema.optional(), all_remaining: TaskSchema.optional() }),
};
const EnvelopeSchema = z.union([
  z.object({ ...envelopeFields, version: z.literal(CLOSE_DRAFT_VERSION) }).extend({
    afterTradeContext: AfterTradeContextSchema.optional(),
  }),
  // Version 1: Exit & Result only. Read as version 2 with no Stage 6 answers.
  z.object({ ...envelopeFields, version: z.literal(1) }),
]);

export function closeDraftStorageKey(scope: CloseDraftScope): string {
  return `${PREFIX}${scope.ownerKey}:${scope.workspaceKey}:${scope.tradeKey}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string, now: Date): CloseDraftEnvelope | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) return null;
  if (now.getTime() - Date.parse(parsed.data.savedAt) > TTL_MS) return null;
  return { ...parsed.data, version: CLOSE_DRAFT_VERSION } as CloseDraftEnvelope;
}

export function loadCloseDraft(scope: CloseDraftScope, now: Date): CloseDraftEnvelope | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(closeDraftStorageKey(scope));
    if (raw === null) return null;
    const envelope = parse(raw, now);
    // Unreadable, incompatible or expired: dropped, never guessed at or submitted.
    if (envelope === null) store.removeItem(closeDraftStorageKey(scope));
    return envelope;
  } catch {
    return null;
  }
}

/** The one task this page is working on, or null. */
export function loadCloseTask(
  scope: CloseDraftScope,
  task: CloseScope,
  now: Date,
): CloseDraftTask | null {
  return loadCloseDraft(scope, now)?.tasks[task] ?? null;
}

/** Writes one task, keeping the other scope's task as it was. Returns whether it reached storage. */
export function saveCloseTask(
  scope: CloseDraftScope,
  task: CloseScope,
  value: CloseDraftTask,
  context: { readonly symbol: string; readonly now: Date },
): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    const current = loadCloseDraft(scope, context.now);
    const envelope: CloseDraftEnvelope = {
      kind: KIND,
      version: CLOSE_DRAFT_VERSION,
      savedAt: context.now.toISOString(),
      symbol: context.symbol,
      tasks: { ...(current?.tasks ?? {}), [task]: value },
      ...(current?.afterTradeContext === undefined
        ? {}
        : { afterTradeContext: current.afterTradeContext }),
    };
    store.setItem(closeDraftStorageKey(scope), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Writes the envelope, or removes it once it holds nothing. */
function writeEnvelope(store: Storage, scope: CloseDraftScope, envelope: CloseDraftEnvelope) {
  if (Object.keys(envelope.tasks).length === 0 && envelope.afterTradeContext === undefined) {
    store.removeItem(closeDraftStorageKey(scope));
    return;
  }
  store.setItem(closeDraftStorageKey(scope), JSON.stringify(envelope));
}

/** Removes one Exit & Result task; Stage 6 answers, if any, stay. */
export function removeCloseTask(scope: CloseDraftScope, task: CloseScope, now: Date): void {
  const store = storage();
  if (store === null) return;
  try {
    const current = loadCloseDraft(scope, now);
    if (current === null) return;
    const { [task]: _removed, ...rest } = current.tasks;
    writeEnvelope(store, scope, { ...current, tasks: rest });
  } catch {
    // An unwritable store holds nothing we can clear.
  }
}

/**
 * Every Exit & Result task for this Trade — used once the Trade can no longer
 * be closed. Stage 6 answers stay: a Closed Trade is exactly where they belong.
 */
export function removeCloseDraft(scope: CloseDraftScope, now: Date = new Date()): void {
  const store = storage();
  if (store === null) return;
  try {
    const current = loadCloseDraft(scope, now);
    if (current === null) return;
    writeEnvelope(store, scope, { ...current, tasks: {} });
  } catch {
    // Nothing further to do.
  }
}

/** The Stage 6 answers for this Trade, or null. */
export function loadAfterTradeContextTask(
  scope: CloseDraftScope,
  now: Date,
): AfterTradeContextTask | null {
  return loadCloseDraft(scope, now)?.afterTradeContext ?? null;
}

/** Writes the Stage 6 answers, keeping any Exit & Result task as it was. */
export function saveAfterTradeContextTask(
  scope: CloseDraftScope,
  value: AfterTradeContextTask,
  context: { readonly symbol: string; readonly now: Date },
): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    const current = loadCloseDraft(scope, context.now);
    const envelope: CloseDraftEnvelope = {
      kind: KIND,
      version: CLOSE_DRAFT_VERSION,
      savedAt: context.now.toISOString(),
      symbol: context.symbol,
      tasks: current?.tasks ?? {},
      afterTradeContext: value,
    };
    store.setItem(closeDraftStorageKey(scope), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/** Clears the Stage 6 answers — after a confirmed Save or an explicit discard. */
export function removeAfterTradeContextTask(scope: CloseDraftScope, now: Date): void {
  const store = storage();
  if (store === null) return;
  try {
    const current = loadCloseDraft(scope, now);
    if (current === null) return;
    const { afterTradeContext: _removed, ...rest } = current;
    writeEnvelope(store, scope, rest);
  } catch {
    // An unwritable store holds nothing we can clear.
  }
}

/** Whether a task's answers were given against the Trade as it is now. */
export function closeBasisMatches(basis: CloseDraftBasis, current: CloseDraftBasis): boolean {
  if (basis.status !== current.status) return false;
  if (basis.exitIds.length !== current.exitIds.length) return false;
  const known = new Set(basis.exitIds);
  return current.exitIds.every((id) => known.has(id));
}

function ownerKeys(store: Storage, ownerKey: string): string[] {
  const keys: string[] = [];
  const ownerPrefix = `${PREFIX}${ownerKey}:`;
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null && key.startsWith(ownerPrefix)) keys.push(key);
  }
  return keys;
}

/** What sign-out would destroy: one entry per readable close draft, named by its symbol. */
export function ownerCloseDrafts(
  ownerKey: string,
  now: Date,
): readonly { readonly symbol: string | null }[] {
  const store = storage();
  if (store === null) return [];
  try {
    return ownerKeys(store, ownerKey).flatMap((key) => {
      const raw = store.getItem(key);
      if (raw === null) return [];
      const envelope = parse(raw, now);
      return envelope === null ? [] : [{ symbol: envelope.symbol }];
    });
  } catch {
    return [];
  }
}

/** Explicit sign-out: this user's close drafts in every workspace, and nobody else's. */
export function clearOwnerCloseDrafts(ownerKey: string): void {
  const store = storage();
  if (store === null) return;
  try {
    for (const key of ownerKeys(store, ownerKey)) store.removeItem(key);
  } catch {
    // An unwritable store holds nothing we can clear.
  }
}
