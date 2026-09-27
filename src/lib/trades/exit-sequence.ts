/**
 * READ-ONLY EXIT LABELS FOR AN ORDERED EXIT HISTORY (Add Trade contract,
 * decision 60).
 *
 * Record Closed records a close in parts as an ordered list of exit results:
 * the last one is the Final exit, and nobody states a share or a scope. It is
 * saved with the earlier exits carrying no scope, the last carrying
 * `all_remaining` — the stored meaning of "closed whatever was left" — and no
 * share on any. That scope is a compatibility detail, not an answer the
 * trader gave, so a history in that shape reads by its order: Exit 1, Exit 2,
 * Final exit.
 *
 * THE RULE IS THE SHAPE, AND IT IS LOSSLESS. No stored field says which flow
 * saved an exit, so the history's own shape decides: no exit states a share,
 * only the last states a scope, and that scope is All remaining. Such a
 * history carries nothing beyond "the last exit closed the rest", which is
 * exactly what "Final exit" says — whatever flow saved it, a single closing
 * exit of any flow included. Any Part, Don't know or share is allocation the
 * trader actually recorded, so that history keeps its scope-and-share
 * presentation. Nothing stored is read differently or rewritten.
 */
export interface SequencedExit {
  readonly exitScope: string | null;
  readonly closedBps: number | null;
}

export function isOrderedExitHistory(exits: readonly SequencedExit[]): boolean {
  if (exits.length === 0) return false;
  return exits.every((exit, index) =>
    exit.closedBps !== null
      ? false
      : index === exits.length - 1
        ? exit.exitScope === 'all_remaining'
        : exit.exitScope === null,
  );
}

/** Where an exit sits in an ordered history: the Final exit, or its number. */
export function orderedExitLabel(
  index: number,
  count: number,
): { readonly kind: 'final' } | { readonly kind: 'number'; readonly number: number } {
  return index === count - 1 ? { kind: 'final' } : { kind: 'number', number: index + 1 };
}
