import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { CALC_VERSION } from '@/config/trade-calc';
import { generateId } from '@/lib/identifiers';

import { exitPlans } from './exit-plans';
import { setups } from './setups';
import { strategies, strategyVersions } from './strategies';
import { strategySetupVersions } from './strategy-setup-versions';
import { tradingAccounts } from './trading-accounts';
import { workspaces } from './workspaces';

/**
 * One Trade = one complete trading idea/position — not one execution, not a
 * multi-leg composite. Phase 07B does not support partial entries, partial
 * exits, scale-in/scale-out, or a `trade_executions` child table; the shape
 * below deliberately keeps that door open for a later phase (summary columns
 * like `actual_entry`/`actual_position_size` would become derived
 * weighted-average snapshots over execution rows without changing any
 * existing column's meaning), but no such table exists now.
 *
 * Trading Account is required at creation; Strategy/Setup classification is
 * NOT (Phase 14B — Independent Trade Lifecycle, superseding Phase 07B's
 * original "all four non-nullable" decision recorded in
 * `docs/phases/PHASE-07-calc-engine.md`). A Trade may be captured with no
 * Strategy, with a Strategy but no Setup, or with both — never a Setup
 * without a Strategy (`trades_setup_requires_strategy_check` below). This
 * exists because Actual Execution and System Outcome are independent
 * measurement axes that genuinely do not require Strategy/Setup to compute
 * (CLAUDE.md §1/§6; `docs/phases/PHASE-13-journal-v2.md` §14–15) — requiring
 * classification up front was a historical implementation assumption, not a
 * financial necessity (Phase 14A audit).
 *
 * `strategy_id`/`strategy_version_id` and `setup_id`/`setup_version_id` are
 * each all-or-nothing PAIRS — a Trade never has an identity reference without
 * its exact pinned Version, or vice versa
 * (`trades_strategy_identity_version_pairing_check`/
 * `trades_setup_identity_version_pairing_check`). `strategy_assigned_at`/
 * `setup_assigned_at` record the FIRST moment each pair became non-null
 * (never "last changed at" — a later reclassification does not move this
 * timestamp), letting the UI truthfully distinguish "captured at/before
 * entry" from "added after entry" by comparing against `entered_at`. Every
 * historical Trade through Phase 13 was classified at creation under the old
 * mandatory path — migration 0015 backfills both timestamps to `created_at`
 * for those rows, never inventing a "late classification."
 *
 * `strategy_version_id`/`setup_version_id` are immutable from a future
 * service's perspective once a Trade references them — Phase 08's
 * `lockStrategyVersionForReferenceInTx` (already built in
 * `src/server/services/strategy-versioning.ts`) is what performs that lock,
 * in the same transaction as a Trade's first reference to a Version, whether
 * that happens at creation or via a later classification-assignment mutation
 * (`assignTradeClassification`, Phase 14B). The schema only makes the
 * reference itself impossible to point at a mismatched Strategy/Setup
 * pairing (see the composite foreign keys below) — it does not itself lock
 * anything.
 *
 * Trades use `deleted_at` soft-deletion, not `is_archived` — the one
 * deliberate exception to this codebase's usual archive-only convention
 * (CLAUDE.md assumption A7). A Trade is a personal record a trader may
 * remove entirely from their own numbers, not a reversible business-lifecycle
 * entity like a Strategy or Trading Account; "why derived values are
 * persisted" reasoning (calc_version + explicit backfill) is what protects
 * historical analytics stability instead, matching the same job
 * `is_archived` does for every other table.
 *
 * Trades remain editable after `status = 'closed'` — unlike a locked
 * Strategy Version, a Trade is the measurement record itself, and a trader
 * must be able to correct a data-entry mistake (`PHASE-08-journal.md`'s own
 * Definition of Done requires "editing a closed trade must recompute derived
 * values and never leave stale R"). Historical integrity here is protected
 * by `calc_version` plus an explicit backfill migration being the only
 * sanctioned way engine output changes retroactively, and by an audit-log
 * entry on every edit (Phase 08's job) — never by row-level immutability.
 */
export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Create-idempotency, identical pattern to `strategies.mutation_key`. */
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),
    /**
     * What the create request that used `mutation_key` actually said — a
     * SHA-256 of the normalized request (`trade-mutation-fingerprint.ts`). A
     * later request with the same key is an honest replay only when this
     * matches; anything else is a replay conflict, never a second success.
     * NULL on a row created before migration 0024.
     */
    mutationFingerprint: text('mutation_fingerprint'),

    // -------------------------------------------------------------------
    // Pinned framework — every field below is required and immutable from a
    // future service's perspective once the Trade exists.
    // -------------------------------------------------------------------
    tradingAccountId: uuid('trading_account_id')
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: 'cascade' }),
    /** Nullable since Phase 14B — see the module doc comment. */
    strategyId: uuid('strategy_id').references(() => strategies.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid('strategy_version_id').references(() => strategyVersions.id, {
      onDelete: 'cascade',
    }),
    /** Nullable since Phase 14B; never non-null while `strategy_id` is null (`trades_setup_requires_strategy_check`). */
    setupId: uuid('setup_id').references(() => setups.id, { onDelete: 'cascade' }),
    setupVersionId: uuid('setup_version_id').references(() => strategySetupVersions.id, {
      onDelete: 'cascade',
    }),
    /** First-assignment timing only — see the module doc comment. Phase 14B. */
    strategyAssignedAt: timestamp('strategy_assigned_at', { withTimezone: true }),
    setupAssignedAt: timestamp('setup_assigned_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Trade context
    // -------------------------------------------------------------------
    symbol: text('symbol').notNull(),
    direction: text('direction').notNull(),
    timeframe: text('timeframe'),
    session: text('session'),
    confirmationNotes: text('confirmation_notes'),
    /**
     * Exactly one of 0/25/50/75/100, or NULL — never a financial value,
     * plain `smallint` is safe (CLAUDE.md §5). Migration 0010 has not been
     * committed/merged yet, so its schema and backfill were updated IN
     * PLACE for this Founder-UAT Confidence redesign rather than
     * superseded by a new migration — see `trades_confidence_check` and
     * that migration's own updated backfill comment. Supersedes BOTH
     * earlier uncommitted drafts: a continuous 0–100 range, and before that
     * a 1–5 rating.
     */
    confidence: smallint('confidence'),
    tradingviewUrl: text('tradingview_url'),
    notes: text('notes'),
    /**
     * Pre-contract review text. Legacy evidence since migration 0025: never
     * converted into the canonical reflection prompts, and never implies Reviewed
     * (`review_status` is the only Review lifecycle).
     */
    reviewNotes: text('review_notes'),
    /** NULL on historical rows; non-NULL means emotion capture occurred, including a zero selection. */
    emotionsRecordedAt: timestamp('emotions_recorded_at', { withTimezone: true }),
    /**
     * Post-Trade Emotion capture (contract §9, migration 0023) — the same
     * NULL-is-Unanswered / zero-rows-is-None convention as `emotions_recorded_at`,
     * for `trade_emotions` rows with `phase = 'post_trade'`. Never overwrites
     * Entry Emotion.
     */
    postTradeEmotionsRecordedAt: timestamp('post_trade_emotions_recorded_at', {
      withTimezone: true,
    }),
    /**
     * Stage 6 After-Trade Context (migration 0028): what the trader noted, and
     * the chart they linked, after the Trade closed. Distinct from the entry
     * notes (`confirmation_notes`, `notes`), the before-entry `tradingview_url`
     * and the legacy `review_notes` — never copied from or into them. NULL is
     * Unanswered. Only a Closed contract Trade may carry either.
     */
    afterTradeNote: text('after_trade_note'),
    afterTradeTradingviewUrl: text('after_trade_tradingview_url'),

    // -------------------------------------------------------------------
    // Chart attachment — Image upload (migration 0010). Distinct from
    // `tradingview_url` above (a Trade may carry a chart LINK, an uploaded
    // IMAGE, both, or neither). Never a blob/base64 column (CLAUDE.md's "no
    // unnecessary Vercel-only features" spirit extends to never storing
    // binary content in Postgres). A Chart screenshot is tenant-private user
    // content (Founder review, private-storage correction) — the object is
    // uploaded to private object storage and NO public URL is ever
    // persisted here; `chart_attachment_storage_key` is the minimum stable
    // private object identity needed to retrieve it, and only the
    // authenticated application delivery route
    // (`src/app/api/trades/[tradeId]/chart-attachment/route.ts`) ever reads
    // it back, after independently re-deriving session + Workspace
    // authorization. Both columns are populated together or not at all
    // (`trades_chart_attachment_check`). The storage key is always
    // server-generated/random (see `src/lib/storage/`), never derived from
    // the user-supplied filename.
    // -------------------------------------------------------------------
    chartAttachmentStorageKey: text('chart_attachment_storage_key'),
    chartAttachmentUploadedAt: timestamp('chart_attachment_uploaded_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Plan — the system's proposal. Since migration 0010 (Founder-UAT Trade
    // Plan UX correction slice) that plan may be expressed as Price
    // (`planned_entry`/`planned_stop`/`planned_target`), Money
    // (`planned_risk_minor`/`planned_reward_minor`, below), or both at once
    // — `planned_entry`/`planned_stop` are nullable so a Money-only plan
    // never has to fabricate placeholder prices. `trades_planned_price_shape_check`
    // still requires entry+stop to be a complete, direction-valid pair
    // whenever EITHER is present. Since migration 0016 (Phase 14C.1 — Quick
    // Capture Persistence Completion) a Trade may also carry NEITHER
    // representation at all: `trades_plan_minimum_check`, which used to
    // require at least one, was dropped. A no-Plan Trade is a genuinely
    // valid captured record, not an invalid one — see
    // `docs/phases/PHASE-14-independent-classification.md` §14C.1.
    // -------------------------------------------------------------------
    plannedEntry: numeric('planned_entry', { precision: 20, scale: 10 }),
    plannedStop: numeric('planned_stop', { precision: 20, scale: 10 }),
    plannedTarget: numeric('planned_target', { precision: 20, scale: 10 }),
    /** Informational only — Planned R (CLAUDE.md §6) is a pure per-unit ratio and never uses position size. */
    plannedPositionSize: numeric('planned_position_size', { precision: 20, scale: 10 }),

    // -------------------------------------------------------------------
    // Plan — Money mode (migration 0010). Truthful monetary risk/reward,
    // account-currency `bigint` minor units — the Trading Account's own
    // `base_currency`, never a second currency field on `trades` itself.
    // Deliberately NOT `actual_initial_risk_minor`/`net_pnl_minor`: those are
    // ACTUAL-execution authoritative inputs (CLAUDE.md §6); reusing them for
    // a PLAN would conflate "what the trader intended" with "what actually
    // happened." `planned_reward_minor` may be exactly zero (a
    // break-even-or-better plan is meaningful); `planned_risk_minor` must be
    // strictly positive whenever present, and a Reward may never be present
    // without a Risk — see `trades_planned_money_check`.
    // -------------------------------------------------------------------
    plannedRiskMinor: bigint('planned_risk_minor', { mode: 'bigint' }),
    plannedRewardMinor: bigint('planned_reward_minor', { mode: 'bigint' }),

    // -------------------------------------------------------------------
    // Actual execution. `actual_initial_stop` is the stop AS FIRST PLACED,
    // never as later moved — moving a stop is a discipline event recorded as
    // a mistake, not a re-baselined denominator (CLAUDE.md §6,
    // `docs/data-dictionary.md`).
    // -------------------------------------------------------------------
    actualResultMode: text('actual_result_mode'),
    actualEntry: numeric('actual_entry', { precision: 20, scale: 10 }),
    actualInitialStop: numeric('actual_initial_stop', { precision: 20, scale: 10 }),
    actualExit: numeric('actual_exit', { precision: 20, scale: 10 }),
    /** Informational only, like `planned_position_size` — never an authoritative monetary input (see below). */
    actualPositionSize: numeric('actual_position_size', { precision: 20, scale: 10 }),

    // -------------------------------------------------------------------
    // Authoritative monetary inputs. Deliberately NOT derived from
    // price x quantity x contract multiplier — that formula is not
    // universally valid across Forex, gold, crypto and indices, especially
    // when account currency differs from quote currency (locked product
    // decision). `actual_initial_risk_minor` and `net_pnl_minor` are the two
    // authoritative bigint account-currency-minor-unit inputs Actual R is
    // computed from; prices/quantity above are informational primitives
    // only.
    // -------------------------------------------------------------------
    actualInitialRiskMinor: bigint('actual_initial_risk_minor', { mode: 'bigint' }),
    /** Optional derived snapshot for transparency; never itself an input to Actual R. */
    grossPnlMinor: bigint('gross_pnl_minor', { mode: 'bigint' }),
    commissionMinor: bigint('commission_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    feesMinor: bigint('fees_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    swapMinor: bigint('swap_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    netPnlMinor: bigint('net_pnl_minor', { mode: 'bigint' }),
    /** Declared historical exit knowledge. NULL preserves legacy-unknown provenance. */
    exitHistoryCompleteness: text('exit_history_completeness'),
    /** Provenance of canonical whole-Trade final P&L. NULL preserves legacy unknown. */
    finalPnlSource: text('final_pnl_source'),
    enteredAt: timestamp('entered_at', { withTimezone: true }),
    exitedAt: timestamp('exited_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // System counterfactual — independent lifecycle from Trade execution
    // status (CLAUDE.md §1). `pending` = not yet recorded; `no_trade` = the
    // approved Strategy/Setup would not have permitted the Trade at all, a
    // real terminal state, never conflated with `pending`.
    // -------------------------------------------------------------------
    systemStatus: text('system_status').notNull().default('pending'),
    systemResolutionKind: text('system_resolution_kind'),
    systemExitPrice: numeric('system_exit_price', { precision: 20, scale: 10 }),
    systemGrossRInput: numeric('system_gross_r_input', { precision: 12, scale: 4 }),
    systemExitedAt: timestamp('system_exited_at', { withTimezone: true }),
    systemExitReason: text('system_exit_reason'),
    /**
     * A user-supplied estimate of costs attributable to the counterfactual
     * System execution, expressed directly in R (locked: `systemR =
     * systemGrossR - systemCostR`) — never automatically copied from Actual
     * `commission_minor`/`fees_minor`/`swap_minor`, and never calculated
     * from a per-account cost constant in MVP. Supplied only when resolving
     * the System result; pinned to exactly `0` while `pending` or
     * `no_trade` (see `trades_system_status_consistency_check`).
     */
    /**
     * NULLABLE SINCE MIGRATION 0017, AND THE NULL IS THE POINT.
     *
     * It was `NOT NULL DEFAULT 0`, so a resolution nobody costed recorded a cost
     * of nothing — and the resolve dialog pre-filled `0`, which means a stored
     * zero could equally be a considered estimate or an untouched default. A
     * zero-cost counterfactual compared against a net Actual R overstates the
     * Execution Gap by roughly the cost of trading, invisibly and always in the
     * trader's disfavour.
     *
     * NULL now means UNKNOWN: `system_gross_r` holds the real gross figure,
     * `system_r` and `system_outcome` stay NULL, and the pair is reported as
     * gross-only rather than compared. A stored `0` written from here on is a
     * genuine "I know it cost nothing".
     */
    systemCostR: numeric('system_cost_r', { precision: 12, scale: 4 }),
    /**
     * The FROZEN confirmed gross result, before cost.
     *
     * Persisted rather than recomputed because it is the half of the
     * counterfactual that survives an unknown cost — and because a later engine
     * fix must not silently rewrite a figure a trader confirmed, the same reason
     * `system_r` and `actual_r` are persisted snapshots.
     */
    systemGrossR: numeric('system_gross_r', { precision: 12, scale: 4 }),
    /**
     * The basis-scoped facts the confirmed assessment rested on — see
     * `src/lib/calc/system-assessment.ts`. Structured rather than hashed so a
     * divergence can name the field that moved.
     */
    systemDependencySnapshot: jsonb('system_dependency_snapshot'),
    /**
     * Whether the rules used as evidence were the rules IN FORCE at entry.
     * Never inferred from when the record was typed, and never inferred from a
     * version timestamp alone — explicit applicability is required before
     * claiming `at_entry`. NULL and `unknown` are both honest.
     */
    systemPlanProvenance: text('system_plan_provenance'),
    systemResolvedAt: timestamp('system_resolved_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Derived snapshots — persisted at compute time, never client-supplied
    // trusted input. "Why derived values are persisted": analytics over
    // thousands of trades must not recompute decimals per row, and a later
    // engine fix must not silently rewrite historical numbers.
    // -------------------------------------------------------------------
    plannedR: numeric('planned_r', { precision: 12, scale: 4 }),
    actualR: numeric('actual_r', { precision: 12, scale: 4 }),
    systemR: numeric('system_r', { precision: 12, scale: 4 }),
    traderOutcome: text('trader_outcome'),
    /**
     * WHEN THE TRADER CHOSE `trader_outcome` (contract §12, migration 0023).
     *
     * Non-NULL only on a contract row whose Win / BE / Loss was selected by the
     * trader. NULL beside a stored `trader_outcome` is the pre-contract
     * derivation (from R or P&L sign) — kept, visible, and never presented or
     * counted as the trader's answer (contract §28). A selected outcome is
     * independent of P&L and R, so it is exempt from the sign and tolerance
     * shapes in `trades_status_consistency_check`.
     */
    traderOutcomeSelectedAt: timestamp('trader_outcome_selected_at', { withTimezone: true }),
    systemOutcome: text('system_outcome'),
    calcVersion: integer('calc_version').notNull().default(CALC_VERSION),

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------
    status: text('status').notNull().default('planned'),
    /**
     * LEGACY, KEPT FOR EXPORT COMPATIBILITY. Superseded by `plan_adherence`,
     * which can express `partly`; a boolean cannot, and `partly` is the honest
     * answer for most real trades. No production path writes this column. It is
     * dropped in a later cleanup migration, never here.
     */
    followedPlan: boolean('followed_plan'),
    /**
     * DID THE TRADER FOLLOW THEIR PLAN — a SEPARATE AXIS from the System result.
     *
     * NULL means not answered. Never inferred from the actual result, the System
     * result, a win/loss, or `no_trade`: a system loss faithfully followed and a
     * system win ignored are both ordinary records, and neither is derivable
     * from the other.
     *
     * Pre-contract since migration 0025: the canonical answer is
     * `exit_plan_adherence`, and this value is never read as it.
     */
    planAdherence: text('plan_adherence'),

    // -------------------------------------------------------------------
    // Add Trade contract v1 (migration 0021). A NULL `recording_contract`
    // is a legacy row: nothing below is written for it and nothing legacy is
    // converted. A contract row carries the approved semantics directly:
    // Risk at Entry (`planned_risk_minor`) is the 1R baseline, price is
    // context only, and every answer keeps Unanswered distinct.
    // -------------------------------------------------------------------
    recordingContract: text('recording_contract'),
    /** `default_now` = the automatic "now" kept as-is; `trader` = edited or confirmed. NULL with a NULL `entered_at`. */
    enteredAtSource: text('entered_at_source'),
    /** NULL = Unanswered. `fixed` needs Target Profit (`planned_reward_minor`) or a TP price. */
    targetState: text('target_state'),
    /** TP price — context only, never a calculation input. */
    targetPrice: numeric('target_price', { precision: 20, scale: 10 }),
    /**
     * How the trader planned to protect the Trade (contract decision 53).
     * NULL = Unanswered, which is never "no defined stop". Never inferred from
     * `context_stop_price`: an SL price says where a stop would sit, not
     * whether one was placed.
     */
    plannedStopMethod: text('planned_stop_method'),
    contextEntryPrice: numeric('context_entry_price', { precision: 20, scale: 10 }),
    contextStopPrice: numeric('context_stop_price', { precision: 20, scale: 10 }),
    contextPositionSize: numeric('context_position_size', { precision: 20, scale: 10 }),
    /** Risk Discipline evidence; never the Actual R denominator on a contract row. */
    actualRiskAnswer: text('actual_risk_answer'),
    /** NULL = Not recorded. `saved` / `customized` carry a snapshot; `no_rule` is an explicit answer. */
    exitPlanState: text('exit_plan_state'),
    /** `strategy_default` = inherited without an explicit choice; `selected` = chosen by the trader. */
    exitPlanProvenance: text('exit_plan_provenance'),
    exitPlanId: uuid('exit_plan_id'),
    exitPlanName: text('exit_plan_name'),
    exitPlanInstructions: text('exit_plan_instructions'),
    /** An explicit rejection of the Strategy default; suppresses inheritance until explicitly restored. */
    exitPlanInheritanceDeclined: boolean('exit_plan_inheritance_declined').notNull().default(false),
    /** Explicit "No Strategy" — distinct from an unanswered, unclassified Trade. */
    noStrategy: boolean('no_strategy').notNull().default(false),
    noSetup: boolean('no_setup').notNull().default(false),
    // Capture origin (contract §7, §9): when each answer was FIRST supplied.
    // Revision timestamps record later edits without rewriting the origin.
    strategyOrigin: text('strategy_origin'),
    setupOrigin: text('setup_origin'),
    exitPlanOrigin: text('exit_plan_origin'),
    confidenceOrigin: text('confidence_origin'),
    emotionsOrigin: text('emotions_origin'),
    classificationRevisedAt: timestamp('classification_revised_at', { withTimezone: true }),
    exitPlanRevisedAt: timestamp('exit_plan_revised_at', { withTimezone: true }),
    confidenceRevisedAt: timestamp('confidence_revised_at', { withTimezone: true }),
    emotionsRevisedAt: timestamp('emotions_revised_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Canonical Review v1 (migration 0025, Review & System Assessment
    // contract §2–§7). Nothing here is read from or written to the legacy
    // `review_notes`, `plan_adherence` or `system_*` columns, and no existing
    // row was backfilled: every Trade starts `not_reviewed`, with its mistakes
    // and Exit Plan Adherence Unanswered. Review Drafts are browser-local and
    // have no column here (contract §3).
    // -------------------------------------------------------------------
    /** `not_reviewed` | `reviewed`. Only Finish Review sets `reviewed`, and a trigger refuses any return. */
    reviewStatus: text('review_status').notNull().default('not_reviewed'),
    reviewFirstFinishedAt: timestamp('review_first_finished_at', { withTimezone: true }),
    reviewLastFinishedAt: timestamp('review_last_finished_at', { withTimezone: true }),
    reviewFinishCount: integer('review_finish_count').notNull().default(0),
    /** "What would you repeat?" — NULL when left blank; a blank Finish is still a complete Review. */
    reviewReflectionRepeat: text('review_reflection_repeat'),
    /** "What would you change?" — NULL when left blank. */
    reviewReflectionChange: text('review_reflection_change'),
    /**
     * The explicit "No mistake identified" answer (contract §6). NULL with no
     * `trade_mistakes` rows is Unanswered; `trade_mistakes` rows are the selected
     * mistakes. The two can never coexist (enforced by triggers in 0025), so an
     * empty selection can never read as "none".
     */
    noMistakeIdentifiedAt: timestamp('no_mistake_identified_at', { withTimezone: true }),
    /**
     * THE ONE canonical Exit Plan Adherence answer (contract §7.2), committed by
     * Finish Review or Confirm / Update System Assessment. NULL = Unanswered.
     * Distinct from legacy `plan_adherence`, which is never read as this.
     */
    exitPlanAdherence: text('exit_plan_adherence'),
    /** Provisional free text (Add Trade §18: no rigid enum before UX validation). */
    exitPlanDeviationType: text('exit_plan_deviation_type'),
    exitPlanDeviationReason: text('exit_plan_deviation_reason'),
    /**
     * Optimistic-concurrency revision for the adherence answer group (answer,
     * Deviation Type, Deviation Reason). A 0025 trigger sets it — +1 whenever
     * the group changes, unchanged otherwise — so no writer can forget or forge
     * it. A commit compares the draft's base revision with this value.
     */
    exitPlanAdherenceRevision: integer('exit_plan_adherence_revision').notNull().default(0),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trades_workspace_idx').on(table.workspaceId),
    index('trades_workspace_account_idx').on(table.workspaceId, table.tradingAccountId),
    index('trades_workspace_account_exited_idx').on(
      table.workspaceId,
      table.tradingAccountId,
      table.exitedAt,
    ),
    index('trades_workspace_status_idx').on(table.workspaceId, table.status),
    index('trades_workspace_strategy_version_idx').on(table.workspaceId, table.strategyVersionId),
    index('trades_workspace_deleted_idx').on(table.workspaceId, table.deletedAt),
    uniqueIndex('trades_workspace_mutation_key_idx').on(table.workspaceId, table.mutationKey),
    // Composite-FK plumbing for `trade_rule_checks`/`trade_mistakes`, which
    // must prove they belong to the same workspace as the Trade they attach
    // to, and (id, strategy_version_id) for `trade_rule_checks`, which must
    // prove a Rule check references the exact Strategy Version its own
    // Trade is pinned to — never a different, mismatched Version.
    uniqueIndex('trades_id_workspace_idx').on(table.id, table.workspaceId),
    uniqueIndex('trades_id_strategy_version_idx').on(table.id, table.strategyVersionId),
    // Composite-FK plumbing for `trade_setup_condition_checks`.
    uniqueIndex('trades_id_setup_version_idx').on(table.id, table.setupVersionId),
    // Composite-FK plumbing for `trade_system_assessments`, which may only
    // reference an Add Trade v1 row (migration 0025).
    uniqueIndex('trades_id_workspace_contract_idx').on(
      table.id,
      table.workspaceId,
      table.recordingContract,
    ),

    // Tenant/parent integrity — every reference chains back to the same
    // workspace and the same Strategy, mirroring Phase 06's own composite-FK
    // pattern exactly (`strategy_versions_strategy_workspace_fk`,
    // `strategy_setup_versions_setup_strategy_fk`, etc).
    /*
      A TRADE NEVER REFERENCES ANOTHER WORKSPACE'S EXIT PLAN. The original
      single-column FK to `exit_plans(id)` accepted one, and only the service
      stopped it; this is the same composite posture every other tenant-scoped
      reference in this table already uses. Migration 0022 writes it with
      `ON DELETE SET NULL (exit_plan_id)` so deleting a plan clears the
      provenance pointer without touching `workspace_id`.
    */
    foreignKey({
      name: 'trades_exit_plan_workspace_fk',
      columns: [table.exitPlanId, table.workspaceId],
      foreignColumns: [exitPlans.id, exitPlans.workspaceId],
    }).onDelete('set null'),
    foreignKey({
      name: 'trades_trading_account_workspace_fk',
      columns: [table.tradingAccountId, table.workspaceId],
      foreignColumns: [tradingAccounts.id, tradingAccounts.workspaceId],
    }),
    foreignKey({
      name: 'trades_strategy_workspace_fk',
      columns: [table.strategyId, table.workspaceId],
      foreignColumns: [strategies.id, strategies.workspaceId],
    }),
    foreignKey({
      name: 'trades_strategy_version_strategy_fk',
      columns: [table.strategyVersionId, table.strategyId],
      foreignColumns: [strategyVersions.id, strategyVersions.strategyId],
    }),
    foreignKey({
      name: 'trades_setup_strategy_fk',
      columns: [table.setupId, table.strategyId],
      foreignColumns: [setups.id, setups.strategyId],
    }),
    foreignKey({
      name: 'trades_setup_version_strategy_version_fk',
      columns: [table.setupVersionId, table.strategyVersionId],
      foreignColumns: [strategySetupVersions.id, strategySetupVersions.strategyVersionId],
    }),
    // Closes a gap the Version-level FK above cannot: without this, a Trade
    // could pair a valid `setup_id` with a `setup_version_id` that is a real
    // snapshot belonging to a *different* Setup within the very same
    // Strategy Version ("Setup Version belonging to another Setup"). This
    // FK proves the referenced snapshot is genuinely a snapshot *of* this
    // Trade's own `setup_id`.
    foreignKey({
      name: 'trades_setup_version_setup_fk',
      columns: [table.setupVersionId, table.setupId],
      foreignColumns: [strategySetupVersions.id, strategySetupVersions.setupId],
    }),

    // Optional-classification pairing/dependency (Phase 14B). An identity
    // reference and its exact pinned Version are all-or-nothing pairs, and a
    // Setup can never exist without a Strategy — see the module doc comment.
    // The Version-level composite FKs above already prevent a MISMATCHED
    // pairing (a real but wrong Version); these three CHECKs are what
    // prevent an INCOMPLETE one (an identity with no Version, or vice versa).
    check(
      'trades_strategy_identity_version_pairing_check',
      sql`(${table.strategyId} IS NULL) = (${table.strategyVersionId} IS NULL)`,
    ),
    check(
      'trades_setup_identity_version_pairing_check',
      sql`(${table.setupId} IS NULL) = (${table.setupVersionId} IS NULL)`,
    ),
    check(
      'trades_setup_requires_strategy_check',
      sql`${table.setupId} IS NULL OR ${table.strategyId} IS NOT NULL`,
    ),
    // `strategy_assigned_at`/`setup_assigned_at` are first-assignment-timing
    // metadata maintained by application code (`createTrade`,
    // `assignTradeClassification`) whenever the corresponding identity
    // reference is set — deliberately NOT a database CHECK pairing them
    // together. A hard pairing check here would also bind every existing
    // and future raw fixture/backfill insert of a classified `trades` row
    // (this codebase's integration tests construct many directly) to always
    // supply a timing value with no product meaning for that fixture,
    // for a field whose only real consumer is the "captured at/before entry
    // vs. added after entry" UI disclosure — not a financial or tenancy
    // invariant CLAUDE.md requires the database to enforce.

    check('trades_direction_check', sql`${table.direction} IN ('long', 'short')`),
    check(
      'trades_actual_result_mode_check',
      sql`${table.actualResultMode} IS NULL OR ${table.actualResultMode} IN ('price', 'money')`,
    ),
    check(
      'trades_exit_history_completeness_check',
      sql`${table.exitHistoryCompleteness} IS NULL OR ${table.exitHistoryCompleteness} IN (
        'unknown', 'incomplete', 'complete'
      )`,
    ),
    check(
      'trades_final_pnl_source_check',
      sql`${table.finalPnlSource} IS NULL OR ${table.finalPnlSource} IN (
        'manual_total', 'exit_history'
      )`,
    ),
    check(
      'trades_historical_execution_metadata_check',
      sql`(
        ${table.exitHistoryCompleteness} IS NULL AND ${table.finalPnlSource} IS NULL
      ) OR (
        ${table.status} = 'closed'
        AND (${table.finalPnlSource} IS NULL OR ${table.netPnlMinor} IS NOT NULL)
      )`,
    ),
    check('trades_status_check', sql`${table.status} IN ('planned', 'open', 'closed', 'canceled')`),
    check(
      'trades_system_status_check',
      sql`${table.systemStatus} IN ('pending', 'resolved', 'no_trade', 'cannot_determine')`,
    ),
    check(
      'trades_system_resolution_kind_check',
      sql`${table.systemResolutionKind} IS NULL OR ${table.systemResolutionKind} IN (
        'price_exit', 'money_target', 'money_stop', 'money_break_even', 'money_custom'
      )`,
    ),
    check(
      'trades_system_exit_reason_check',
      sql`${table.systemExitReason} IS NULL OR ${table.systemExitReason} IN (
        'target_hit', 'stop_hit', 'break_even_rule', 'trailing_exit',
        'time_exit', 'rule_exit', 'manual_system_valid_exit', 'setup_invalidated'
      )`,
    ),
    check(
      'trades_trader_outcome_check',
      sql`${table.traderOutcome} IS NULL OR ${table.traderOutcome} IN ('win', 'loss', 'break_even')`,
    ),
    // A selected Trader Outcome is contract-era evidence and names an outcome.
    check(
      'trades_trader_outcome_selection_check',
      sql`${table.traderOutcomeSelectedAt} IS NULL OR (
        ${table.recordingContract} IS NOT NULL
        AND ${table.traderOutcome} IS NOT NULL
      )`,
    ),
    check(
      'trades_after_trade_note_not_blank_check',
      sql`${table.afterTradeNote} IS NULL OR btrim(${table.afterTradeNote}) <> ''`,
    ),
    check(
      'trades_after_trade_context_check',
      sql`(${table.afterTradeNote} IS NULL AND ${table.afterTradeTradingviewUrl} IS NULL)
        OR (${table.recordingContract} IS NOT NULL AND ${table.status} = 'closed')`,
    ),
    check(
      'trades_post_trade_emotions_check',
      sql`${table.postTradeEmotionsRecordedAt} IS NULL OR ${table.recordingContract} IS NOT NULL`,
    ),
    check(
      'trades_system_outcome_check',
      sql`${table.systemOutcome} IS NULL OR ${table.systemOutcome} IN ('win', 'loss', 'break_even')`,
    ),
    check(
      'trades_confidence_check',
      sql`${table.confidence} IS NULL OR ${table.confidence} IN (0, 25, 50, 75, 100)`,
    ),
    check('trades_calc_version_check', sql`${table.calcVersion} > 0`),
    // NULL is UNKNOWN and always permitted; a supplied cost is still never
    // negative. Migration 0017 relaxed the NOT NULL, not this bound.
    check(
      'trades_system_cost_r_check',
      sql`${table.systemCostR} IS NULL OR ${table.systemCostR} >= 0`,
    ),
    check(
      'trades_system_plan_provenance_check',
      sql`${table.systemPlanProvenance} IS NULL OR ${table.systemPlanProvenance} IN (
        'at_entry', 'reconstructed_later', 'unknown'
      )`,
    ),
    // A separate axis from the System result, and from `followed_plan`, which
    // cannot express `partly`. NULL means not answered.
    check(
      'trades_plan_adherence_check',
      sql`${table.planAdherence} IS NULL OR ${table.planAdherence} IN (
        'followed', 'partly', 'not_followed'
      )`,
    ),
    check(
      'trades_actual_initial_risk_minor_check',
      sql`${table.actualInitialRiskMinor} IS NULL OR ${table.actualInitialRiskMinor} > 0`,
    ),
    check('trades_commission_minor_check', sql`${table.commissionMinor} >= 0`),
    check('trades_fees_minor_check', sql`${table.feesMinor} >= 0`),
    check('trades_swap_minor_check', sql`${table.swapMinor} >= 0`),
    check(
      'trades_exited_after_entered_check',
      sql`${table.exitedAt} IS NULL OR ${table.enteredAt} IS NULL OR ${table.exitedAt} >= ${table.enteredAt}`,
    ),
    check(
      'trades_actual_price_shape_check',
      sql`(
        ${table.actualEntry} IS NULL AND ${table.actualInitialStop} IS NULL
      ) OR (
        ${table.actualEntry} IS NOT NULL AND ${table.actualInitialStop} IS NOT NULL
        AND (
          (${table.direction} = 'long' AND ${table.actualInitialStop} < ${table.actualEntry})
          OR (${table.direction} = 'short' AND ${table.actualInitialStop} > ${table.actualEntry})
        )
      )`,
    ),

    // Direction-aware planned-price integrity — prevents zero/negative
    // planned risk and a Stop or Target on the wrong side of Entry at the
    // database layer, not merely at the Zod/service boundary (CLAUDE.md §6:
    // "riskPerUnit must be strictly positive... reject at validation, never
    // silently proceed"). Migration 0010 (Founder-UAT Trade Plan UX
    // correction slice) widened this from "Entry/Stop always present" to
    // "Entry/Stop present as a complete, valid pair, OR both entirely
    // absent" — a lone Entry, a lone Stop, or a Target with neither is never
    // valid shape, matching `composePlannedR`'s own defensive fragment
    // rejection in `src/lib/calc/trade.ts`.
    check(
      'trades_planned_price_shape_check',
      sql`(
        ${table.plannedEntry} IS NULL AND ${table.plannedStop} IS NULL AND ${table.plannedTarget} IS NULL
      ) OR (
        ${table.plannedEntry} IS NOT NULL AND ${table.plannedStop} IS NOT NULL
        AND (
          (
            ${table.direction} = 'long'
            AND ${table.plannedStop} < ${table.plannedEntry}
            AND (${table.plannedTarget} IS NULL OR ${table.plannedTarget} > ${table.plannedEntry})
          ) OR (
            ${table.direction} = 'short'
            AND ${table.plannedStop} > ${table.plannedEntry}
            AND (${table.plannedTarget} IS NULL OR ${table.plannedTarget} < ${table.plannedEntry})
          )
        )
      )`,
    ),

    // Money-mode plan integrity (migration 0010) — mirrors the Price side's
    // own posture: Risk must be strictly positive whenever present, Reward
    // may be exactly zero but never negative, and a Reward can never appear
    // without a Risk to normalize it against (the Money-mode equivalent of
    // "a Target with neither Entry nor Stop").
    //
    // EXCEPT ON A CONTRACT ROW (migration 0023). There `planned_reward_minor`
    // is a Fixed Target's Target Profit, and a historical Trade may remember
    // its Target without its Risk at Entry (contract §5, §13): both are
    // independently optional, and Planned R is simply unavailable.
    check(
      'trades_planned_money_check',
      sql`(${table.plannedRiskMinor} IS NULL OR ${table.plannedRiskMinor} > 0)
        AND (${table.plannedRewardMinor} IS NULL OR ${table.plannedRewardMinor} >= 0)
        AND (
          ${table.plannedRewardMinor} IS NULL
          OR ${table.plannedRiskMinor} IS NOT NULL
          OR ${table.recordingContract} IS NOT NULL
        )`,
    ),

    // The Founder-UAT "minimum plan validity" floor (migration 0010,
    // `trades_plan_minimum_check`) required at least one complete Plan
    // representation on every row. Migration 0016 (Phase 14C.1) DROPPED that
    // constraint: the frozen Quick Capture contract (`docs/phases/
    // PHASE-14-independent-classification.md` §14C.1) requires a Trade be
    // persistable with Trading Account + Symbol + Direction alone. Removing
    // this constraint changes nothing else — `trades_planned_price_shape_check`
    // and `trades_planned_money_check` above already independently tolerate
    // an absent representation and still reject a malformed partial one;
    // `updateTradePlan`'s own service-level floor (a distinct, narrower
    // business rule — a Trade already under active Plan correction must not
    // be edited down to zero representations) is untouched and enforced only
    // in application code, not here.

    // Add Trade contract v1 (migration 0021) — see the column block above.
    // A CHECK that evaluates to NULL PASSES, so every comparison below that can
    // meet a NULL column is written NULL-safely (IS NOT DISTINCT FROM, or an
    // explicit IS NOT NULL) rather than trusting `=` or `<>` to fail closed.
    check(
      'trades_recording_contract_check',
      sql`${table.recordingContract} IS NULL OR ${table.recordingContract} = 'add_trade_v1'`,
    ),
    check(
      'trades_entered_at_source_check',
      sql`${table.enteredAtSource} IS NULL OR (
        ${table.recordingContract} IS NOT NULL
        AND ${table.enteredAtSource} IN ('default_now', 'trader')
        AND ${table.enteredAt} IS NOT NULL
      )`,
    ),
    check(
      'trades_planned_stop_method_check',
      sql`${table.plannedStopMethod} IS NULL OR (
        ${table.recordingContract} IS NOT NULL
        AND ${table.plannedStopMethod} IN ('broker', 'mental', 'no_stop')
      )`,
    ),
    check(
      'trades_target_state_check',
      sql`${table.targetState} IS NULL OR ${table.targetState} IN ('fixed', 'no_fixed')`,
    ),
    check(
      'trades_contract_target_check',
      sql`(
        ${table.recordingContract} IS NULL
        AND ${table.targetState} IS NULL
        AND ${table.targetPrice} IS NULL
      ) OR (
        ${table.recordingContract} IS NOT NULL
        AND (
          (
            ${table.targetState} IS NOT DISTINCT FROM 'fixed'
            AND (${table.plannedRewardMinor} IS NOT NULL OR ${table.targetPrice} IS NOT NULL)
            AND (${table.plannedRewardMinor} IS NULL OR ${table.plannedRewardMinor} > 0)
          ) OR (
            ${table.targetState} IS DISTINCT FROM 'fixed'
            AND ${table.plannedRewardMinor} IS NULL
            AND ${table.targetPrice} IS NULL
          )
        )
      )`,
    ),
    check(
      'trades_context_price_check',
      sql`(${table.targetPrice} IS NULL OR ${table.targetPrice} > 0)
        AND (${table.contextEntryPrice} IS NULL OR ${table.contextEntryPrice} > 0)
        AND (${table.contextStopPrice} IS NULL OR ${table.contextStopPrice} > 0)
        AND (${table.contextPositionSize} IS NULL OR ${table.contextPositionSize} > 0)
        AND (
          ${table.recordingContract} IS NOT NULL OR (
            ${table.contextEntryPrice} IS NULL
            AND ${table.contextStopPrice} IS NULL
            AND ${table.contextPositionSize} IS NULL
          )
        )`,
    ),
    // Price is never result authority on a contract row: no legacy Price plan,
    // no Price-mode Actual, no price geometry to calculate from.
    check(
      'trades_contract_price_authority_check',
      sql`${table.recordingContract} IS NULL OR (
        ${table.plannedEntry} IS NULL
        AND ${table.plannedStop} IS NULL
        AND ${table.plannedTarget} IS NULL
        AND ${table.plannedPositionSize} IS NULL
        AND ${table.actualEntry} IS NULL
        AND ${table.actualInitialStop} IS NULL
        AND (${table.actualResultMode} IS NULL OR ${table.actualResultMode} = 'money')
      )`,
    ),
    check(
      'trades_contract_open_risk_check',
      sql`${table.recordingContract} IS NULL OR (
        ${table.status} <> 'planned'
        AND (${table.status} <> 'open' OR ${table.plannedRiskMinor} IS NOT NULL)
      )`,
    ),
    check(
      'trades_actual_risk_answer_check',
      sql`${table.actualRiskAnswer} IS NULL OR (
        ${table.recordingContract} IS NOT NULL
        AND (
          (
            ${table.actualRiskAnswer} = 'matched'
            AND ${table.plannedRiskMinor} IS NOT NULL
            AND ${table.actualInitialRiskMinor} IS NOT DISTINCT FROM ${table.plannedRiskMinor}
          ) OR (
            ${table.actualRiskAnswer} = 'different'
            AND (
              ${table.actualInitialRiskMinor} IS NULL
              OR ${table.plannedRiskMinor} IS NULL
              OR ${table.actualInitialRiskMinor} <> ${table.plannedRiskMinor}
            )
          )
          OR (
            ${table.actualRiskAnswer} = 'unknown'
            AND ${table.actualInitialRiskMinor} IS NULL
          )
        )
      )`,
    ),
    check(
      'trades_exit_plan_state_check',
      sql`${table.exitPlanState} IS NULL OR ${table.exitPlanState} IN ('saved', 'customized', 'no_rule')`,
    ),
    check(
      'trades_exit_plan_provenance_check',
      sql`${table.exitPlanProvenance} IS NULL OR ${table.exitPlanProvenance} IN ('strategy_default', 'selected')`,
    ),
    check(
      'trades_exit_plan_shape_check',
      sql`(
        ${table.exitPlanState} IS NULL
        AND ${table.exitPlanProvenance} IS NULL
        AND ${table.exitPlanId} IS NULL
        AND ${table.exitPlanName} IS NULL
        AND ${table.exitPlanInstructions} IS NULL
      ) OR (
        ${table.exitPlanState} = 'no_rule'
        AND ${table.exitPlanProvenance} IS NULL
        AND ${table.exitPlanId} IS NULL
        AND ${table.exitPlanName} IS NULL
        AND ${table.exitPlanInstructions} IS NULL
      ) OR (
        ${table.exitPlanState} = 'saved'
        AND ${table.exitPlanProvenance} IS NOT NULL
        AND (
          ${table.exitPlanProvenance} <> 'strategy_default'
          OR (${table.strategyId} IS NOT NULL AND NOT ${table.exitPlanInheritanceDeclined})
        )
        AND ${table.exitPlanName} IS NOT NULL
        AND btrim(${table.exitPlanName}) <> ''
        AND ${table.exitPlanInstructions} IS NOT NULL
        AND btrim(${table.exitPlanInstructions}) <> ''
      ) OR (
        ${table.exitPlanState} = 'customized'
        AND ${table.exitPlanProvenance} IS NOT NULL
        AND ${table.exitPlanInstructions} IS NOT NULL
        AND btrim(${table.exitPlanInstructions}) <> ''
      )`,
    ),
    check(
      'trades_exit_plan_contract_check',
      sql`${table.recordingContract} IS NOT NULL OR (
        ${table.exitPlanState} IS NULL AND ${table.exitPlanInheritanceDeclined} = false
      )`,
    ),
    check(
      'trades_no_strategy_check',
      sql`NOT ${table.noStrategy} OR (${table.strategyId} IS NULL AND ${table.setupId} IS NULL)`,
    ),
    check(
      'trades_no_setup_check',
      sql`NOT ${table.noSetup} OR (${table.strategyId} IS NOT NULL AND ${table.setupId} IS NULL)`,
    ),
    check(
      'trades_capture_origin_check',
      sql`(
          ${table.recordingContract} IS NOT NULL OR (
            ${table.strategyOrigin} IS NULL
            AND ${table.setupOrigin} IS NULL
            AND ${table.exitPlanOrigin} IS NULL
            AND ${table.confidenceOrigin} IS NULL
            AND ${table.emotionsOrigin} IS NULL
            AND ${table.classificationRevisedAt} IS NULL
            AND ${table.exitPlanRevisedAt} IS NULL
            AND ${table.confidenceRevisedAt} IS NULL
            AND ${table.emotionsRevisedAt} IS NULL
          )
        )
        AND (${table.strategyOrigin} IS NULL OR ${table.strategyOrigin} IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND (${table.setupOrigin} IS NULL OR ${table.setupOrigin} IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND (${table.exitPlanOrigin} IS NULL OR ${table.exitPlanOrigin} IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND (${table.confidenceOrigin} IS NULL OR ${table.confidenceOrigin} IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND (${table.emotionsOrigin} IS NULL OR ${table.emotionsOrigin} IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))`,
    ),

    // Canonical Review v1 (migration 0025). `not_reviewed` carries no Review
    // content; `reviewed` carries its completion metadata. The one-way
    // transition and the immutable first-finish time are trigger-enforced.
    check('trades_review_status_check', sql`${table.reviewStatus} IN ('not_reviewed', 'reviewed')`),
    check(
      'trades_review_lifecycle_check',
      sql`(
        ${table.reviewStatus} = 'not_reviewed'
        AND ${table.reviewFirstFinishedAt} IS NULL
        AND ${table.reviewLastFinishedAt} IS NULL
        AND ${table.reviewFinishCount} = 0
        AND ${table.reviewReflectionRepeat} IS NULL
        AND ${table.reviewReflectionChange} IS NULL
        AND ${table.noMistakeIdentifiedAt} IS NULL
      ) OR (
        ${table.reviewStatus} = 'reviewed'
        AND ${table.reviewFirstFinishedAt} IS NOT NULL
        AND ${table.reviewLastFinishedAt} IS NOT NULL
        AND ${table.reviewLastFinishedAt} >= ${table.reviewFirstFinishedAt}
        AND ${table.reviewFinishCount} >= 1
      )`,
    ),
    check(
      'trades_review_reflection_check',
      sql`(${table.reviewReflectionRepeat} IS NULL OR btrim(${table.reviewReflectionRepeat}) <> '')
        AND (${table.reviewReflectionChange} IS NULL OR btrim(${table.reviewReflectionChange}) <> '')`,
    ),
    // Not Applicable is valid only for an explicit No Defined Exit Rule. That
    // is checked when an answer is committed, not here: a later Capture
    // correction of the Exit Plan must never be blocked by a Review answer.
    check(
      'trades_exit_plan_adherence_check',
      sql`(
        ${table.exitPlanAdherence} IS NULL OR ${table.exitPlanAdherence} IN (
          'followed', 'partly_followed', 'not_followed', 'unknown', 'not_applicable'
        )
      ) AND (
        (${table.exitPlanDeviationType} IS NULL AND ${table.exitPlanDeviationReason} IS NULL)
        OR (
          ${table.exitPlanAdherence} IS NOT NULL
          AND ${table.exitPlanAdherence} IN ('partly_followed', 'not_followed')
        )
      )
        AND (${table.exitPlanDeviationType} IS NULL OR btrim(${table.exitPlanDeviationType}) <> '')
        AND (${table.exitPlanDeviationReason} IS NULL OR btrim(${table.exitPlanDeviationReason}) <> '')
        AND ${table.exitPlanAdherenceRevision} >= 0`,
    ),

    // Chart-attachment terminal fields (migration 0010) — populated together
    // or not at all, the same all-or-nothing posture
    // `trades_system_status_consistency_check` already establishes for a
    // different field group.
    check(
      'trades_chart_attachment_check',
      sql`(
        ${table.chartAttachmentStorageKey} IS NULL
        AND ${table.chartAttachmentUploadedAt} IS NULL
      ) OR (
        ${table.chartAttachmentStorageKey} IS NOT NULL
        AND ${table.chartAttachmentUploadedAt} IS NOT NULL
      )`,
    ),

    /*
      SYSTEM-STATUS CONSISTENCY — organized by SEMANTIC GROUP, not by "every
      System column must be NULL".

      Two groups, and conflating them was the flaw in the previous version:

        RESULT PAYLOAD      resolution kind, exit price, gross R input, exit
                            reason, gross R, cost R, net R, outcome. Only a
                            `resolved` row has one.
        ASSESSMENT METADATA confirmation timestamp, dependency snapshot,
                            provenance, adherence. A COMPLETED assessment has
                            these whatever its conclusion — including `no_trade`
                            and `cannot_determine`, which are findings rather
                            than absences and must be able to record what they
                            rested on and when they were confirmed.

      Requiring every System column to be NULL outside `resolved` would erase
      that metadata and make a considered "the rules would not have taken this"
      indistinguishable from a trade nobody has looked at.

      COST IS NULLABLE AND NULL MEANS UNKNOWN (migration 0017). A resolved row is
      therefore in exactly one of two shapes: NET (cost known, so `system_r` and
      `system_outcome` exist) or GROSS-ONLY (cost unknown, so both are NULL and
      `system_gross_r` carries the figure). `systemR = systemGrossR - systemCostR`
      remains the locked formula; what changed is that its right-hand side may be
      unknown instead of silently zero.

      CONFIRMED RESULTS ARE HISTORICAL. The resolution-specific clauses validate
      the confirmed payload against itself (Money gross input = frozen gross;
      frozen net = gross - cost; outcome classifies that net). They deliberately
      do not require mutable current Plan columns to keep matching. Dependency
      snapshots and `systemAnalyticsEligibility` own that comparison, so a Plan
      edit can make a confirmation stale without rewriting or invalidating it.

      `system_exited_at` IS NO LONGER REQUIRED TO RESOLVE. A counterfactual does
      not need a fabricated closing instant to have a magnitude. It is still
      required where the resolution's own meaning depends on a time — a
      `time_exit` without one describes nothing.

      `plan_adherence` and `system_plan_provenance` are deliberately NOT
      constrained by `system_status`: adherence is an independent axis about the
      trader, and both carry their own value CHECKs above.
    */
    check(
      'trades_system_status_consistency_check',
      sql`(
        ${table.systemStatus} = 'pending'
        AND ${table.systemCostR} IS NULL
        AND ${table.systemResolutionKind} IS NULL
        AND ${table.systemExitPrice} IS NULL
        AND ${table.systemGrossRInput} IS NULL
        AND ${table.systemExitedAt} IS NULL
        AND ${table.systemExitReason} IS NULL
        AND ${table.systemResolvedAt} IS NULL
        AND ${table.systemGrossR} IS NULL
        AND ${table.systemR} IS NULL
        AND ${table.systemOutcome} IS NULL
        AND ${table.systemDependencySnapshot} IS NULL
      ) OR (
        ${table.systemStatus} = 'cannot_determine'
        AND ${table.systemCostR} IS NULL
        AND ${table.systemResolutionKind} IS NULL
        AND ${table.systemExitPrice} IS NULL
        AND ${table.systemGrossRInput} IS NULL
        AND ${table.systemExitedAt} IS NULL
        AND ${table.systemExitReason} IS NULL
        AND ${table.systemResolvedAt} IS NOT NULL
        AND ${table.systemGrossR} IS NULL
        AND ${table.systemR} IS NULL
        AND ${table.systemOutcome} IS NULL
      ) OR (
        ${table.systemStatus} = 'resolved'
        AND ${table.systemExitReason} IS NOT NULL
        AND ${table.systemExitReason} <> 'setup_invalidated'
        AND ${table.systemResolvedAt} IS NOT NULL
        AND ${table.systemResolutionKind} IS NOT NULL
        AND ${table.systemGrossR} IS NOT NULL
        AND (
          ${table.systemExitReason} <> 'time_exit'
          OR ${table.systemExitedAt} IS NOT NULL
        )
        AND (
          (
            ${table.systemCostR} IS NOT NULL
            AND ${table.systemR} IS NOT NULL
            AND ${table.systemOutcome} IS NOT NULL
            AND ${table.systemR} = ${table.systemGrossR} - ${table.systemCostR}
            AND (
              (${table.systemR} > 0.0500 AND ${table.systemOutcome} = 'win')
              OR (${table.systemR} < -0.0500 AND ${table.systemOutcome} = 'loss')
              OR (
                ${table.systemR} BETWEEN -0.0500 AND 0.0500
                AND ${table.systemOutcome} = 'break_even'
              )
            )
          ) OR (
            ${table.systemCostR} IS NULL
            AND ${table.systemR} IS NULL
            AND ${table.systemOutcome} IS NULL
          )
        )
        AND (
          (
            ${table.systemResolutionKind} = 'price_exit'
            AND ${table.systemExitPrice} IS NOT NULL
            AND ${table.systemGrossRInput} IS NULL
          ) OR (
            ${table.systemResolutionKind} = 'money_target'
            AND ${table.systemExitPrice} IS NULL
            AND ${table.systemGrossRInput} IS NOT NULL
            AND ${table.systemGrossRInput} = ${table.systemGrossR}
            AND ${table.systemExitReason} = 'target_hit'
          ) OR (
            ${table.systemResolutionKind} = 'money_stop'
            AND ${table.systemExitPrice} IS NULL
            AND ${table.systemGrossRInput} IS NOT NULL
            AND ${table.systemGrossRInput} = -1
            AND ${table.systemGrossR} = ${table.systemGrossRInput}
            AND ${table.systemExitReason} = 'stop_hit'
          ) OR (
            ${table.systemResolutionKind} = 'money_break_even'
            AND ${table.systemExitPrice} IS NULL
            AND ${table.systemGrossRInput} IS NOT NULL
            AND ${table.systemGrossRInput} = 0
            AND ${table.systemGrossR} = ${table.systemGrossRInput}
            AND ${table.systemExitReason} = 'break_even_rule'
          ) OR (
            ${table.systemResolutionKind} = 'money_custom'
            AND ${table.systemExitPrice} IS NULL
            AND ${table.systemGrossRInput} IS NOT NULL
            AND ${table.systemGrossR} = ${table.systemGrossRInput}
            AND ${table.systemExitReason} = 'manual_system_valid_exit'
          )
        )
      ) OR (
        ${table.systemStatus} = 'no_trade'
        AND ${table.systemCostR} IS NULL
        AND ${table.systemResolutionKind} IS NULL
        AND ${table.systemExitPrice} IS NULL
        AND ${table.systemGrossRInput} IS NULL
        AND ${table.systemExitedAt} IS NULL
        AND ${table.systemExitReason} = 'setup_invalidated'
        AND ${table.systemResolvedAt} IS NOT NULL
        AND ${table.systemGrossR} IS NULL
        AND ${table.systemR} IS NULL
        AND ${table.systemOutcome} IS NULL
      )`,
    ),

    // Trade-execution-status consistency — each status requires/forbids an
    // exact set of actual-execution fields. A historical Money result may
    // know its authoritative final P&L (and therefore its sign outcome) while
    // lacking monetary risk; that one shape keeps Actual R null without
    // discarding the known outcome.
    //
    // THE CONTRACT CLOSED SHAPE (migration 0023, contract §9, §12, §13). On a
    // contract row the Trader Outcome is either Unanswered or the trader's own
    // choice, independent of P&L sign and R — so it is not tied to either.
    // What stays structural: Money is the only result basis, and Actual R
    // exists only when both of its inputs do (Final Net P&L / Risk at Entry).
    // The legacy shapes stay exactly as they were, so a derived
    // outcome (legacy row, or a contract row closed by the pre-contract Final
    // Close) is still held to its sign/tolerance derivation. `canceled` is deliberately
    // unconstrained in shape (a Trade may be canceled from `planned` with
    // nothing filled in, or from `open` with partial data already present);
    // exclusion from Trader metrics is a query-level filter
    // (`status <> 'canceled'`), not a schema shape.
    check(
      'trades_status_consistency_check',
      sql`(
        ${table.status} = 'planned'
        AND ${table.actualResultMode} IS NULL
        AND ${table.actualEntry} IS NULL
        AND ${table.actualInitialStop} IS NULL
        AND ${table.actualInitialRiskMinor} IS NULL
        AND ${table.enteredAt} IS NULL
        AND ${table.actualExit} IS NULL
        AND ${table.netPnlMinor} IS NULL
        AND ${table.exitedAt} IS NULL
        AND ${table.actualR} IS NULL
        AND ${table.traderOutcome} IS NULL
      ) OR (
        ${table.status} = 'open'
        AND ${table.actualResultMode} IS NOT NULL
        AND (${table.enteredAt} IS NOT NULL OR ${table.recordingContract} IS NOT NULL)
        AND ${table.actualExit} IS NULL
        AND ${table.netPnlMinor} IS NULL
        AND ${table.exitedAt} IS NULL
        AND ${table.actualR} IS NULL
        AND ${table.traderOutcome} IS NULL
        AND (
          (
            ${table.actualResultMode} = 'price'
            AND ${table.actualEntry} IS NOT NULL
            AND ${table.actualInitialStop} IS NOT NULL
            AND ${table.actualInitialRiskMinor} IS NULL
          ) OR (
            ${table.actualResultMode} = 'money'
            AND (
              ${table.actualInitialRiskMinor} IS NOT NULL
              OR (${table.recordingContract} IS NOT NULL AND ${table.plannedRiskMinor} IS NOT NULL)
            )
          )
        )
      ) OR (
        ${table.status} = 'closed'
        AND (
          (
            ${table.actualR} IS NULL
            AND ${table.traderOutcome} IS NULL
          ) OR (
            ${table.actualResultMode} = 'money'
            AND ${table.actualInitialRiskMinor} IS NULL
            AND ${table.netPnlMinor} IS NOT NULL
            AND ${table.actualR} IS NULL
            AND (
              (${table.netPnlMinor} > 0 AND ${table.traderOutcome} = 'win')
              OR (${table.netPnlMinor} < 0 AND ${table.traderOutcome} = 'loss')
              OR (${table.netPnlMinor} = 0 AND ${table.traderOutcome} = 'break_even')
            )
          ) OR (
            ${table.actualR} IS NOT NULL
            AND ${table.traderOutcome} IS NOT NULL
            AND (
              (${table.actualR} > 0.0500 AND ${table.traderOutcome} = 'win')
              OR (${table.actualR} < -0.0500 AND ${table.traderOutcome} = 'loss')
              OR (
                ${table.actualR} BETWEEN -0.0500 AND 0.0500
                AND ${table.traderOutcome} = 'break_even'
              )
            )
            AND (
              (
                ${table.actualResultMode} = 'price'
                AND ${table.actualEntry} IS NOT NULL
                AND ${table.actualInitialStop} IS NOT NULL
                AND ${table.actualInitialRiskMinor} IS NULL
                AND ${table.netPnlMinor} IS NULL
                AND ${table.actualExit} IS NOT NULL
              ) OR (
                ${table.actualResultMode} = 'money'
                AND (
                  ${table.actualInitialRiskMinor} IS NOT NULL
                  OR (${table.recordingContract} IS NOT NULL AND ${table.plannedRiskMinor} IS NOT NULL)
                )
                AND ${table.netPnlMinor} IS NOT NULL
              )
            )
          ) OR (
            ${table.recordingContract} IS NOT NULL
            AND (${table.traderOutcome} IS NULL OR ${table.traderOutcomeSelectedAt} IS NOT NULL)
            AND ${table.actualResultMode} IS NOT DISTINCT FROM 'money'
            AND (
              ${table.actualR} IS NULL
              OR (${table.netPnlMinor} IS NOT NULL AND ${table.plannedRiskMinor} IS NOT NULL)
            )
          )
        )
      ) OR (
        ${table.status} = 'canceled'
      )`,
    ),
  ],
);
