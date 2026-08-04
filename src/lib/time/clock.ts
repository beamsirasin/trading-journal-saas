/**
 * The one indirection point between time-sensitive business logic (trial
 * expiry, entitlement resolution) and the system clock. Production code
 * always uses `systemClock`; tests inject a `Clock` that returns a fixed or
 * manually-advanced instant so trial-expiry behavior never depends on
 * actually waiting seven real days (CLAUDE.md §7's "never trust the browser
 * clock" extended here to "tests never sleep either").
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test-only fixed clock. Advance it with `set()` to simulate time passing. */
export function createFixedClock(initial: Date): Clock & { set(next: Date): void } {
  let current = initial;
  return {
    now: () => current,
    set(next: Date) {
      current = next;
    },
  };
}
