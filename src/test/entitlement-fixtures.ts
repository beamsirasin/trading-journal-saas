/**
 * Entitlement period fixtures, expressed relative to now.
 *
 * Why this exists: five integration fixtures seeded an `active` paid
 * subscription with the literal period `2026-08-01 → 2026-09-01`. Entitlement
 * resolution compares the stored period against the clock the service is
 * given, and these particular tests reach it through entry points that take
 * no clock — `getSettingsWorkspaceSummary()` (a `cache()`-wrapped accessor)
 * and `updateWorkspaceNameAction()` (a server action) — so the real clock is
 * what they were measured against. On 2026-09-01 those workspaces silently
 * became `subscription_expired`, every gated call started returning
 * `read_only_workspace`, and four tests went red without a line of product
 * code changing. See docs/roadmap.md.
 *
 * A literal period is perfectly correct in a test that injects its own clock
 * (`createFixedClock`), and twelve fixtures do exactly that — they are not
 * changed, and they must not be. The deciding question is never "is this date
 * in the past?" but "does this test control the clock it is measured
 * against?". Use this helper only for the case where the answer is no.
 *
 * `Date.now() ± N` is the idiom the suite already uses for this
 * (`checkout.integration.test.ts`, `trades.integration.test.ts`,
 * `entitlement.integration.test.ts` and others); this only gives the shape a
 * name, so a reader can see the intent — "a live paid period" — rather than
 * having to date-check two literals.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActivePaidPeriod {
  readonly currentPeriodStartedAt: Date;
  readonly currentPeriodEndsAt: Date;
}

/**
 * A paid billing period that is live right now: started thirty days ago, ends
 * thirty days from now. Thirty days each way is arbitrary but generous — it
 * only has to be wider than a test run, and wide enough that no reader
 * mistakes it for a boundary case.
 *
 * There is deliberately no `expiredPeriod()` or `trialPeriod()` alongside it.
 * Every fixture that means "expired" already says so with
 * `status: 'expired'` and a null period, which is the truthful shape and does
 * not rot; a second helper would exist only to be symmetrical.
 */
export function activePaidPeriod(): ActivePaidPeriod {
  const now = Date.now();
  return {
    currentPeriodStartedAt: new Date(now - 30 * DAY_MS),
    currentPeriodEndsAt: new Date(now + 30 * DAY_MS),
  };
}
