ALTER TABLE "trades" DROP CONSTRAINT "trades_system_status_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_system_cost_r_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_system_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "system_cost_r" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "system_cost_r" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "system_gross_r" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "system_dependency_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "system_plan_provenance" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "plan_adherence" text;--> statement-breakpoint
--
-- HAND-ADDED DATA STEPS. drizzle-kit generates DDL only; the rewritten
-- consistency CHECK below cannot be added until existing rows satisfy it, and
-- neither step interprets anything.
--
-- 1. `system_cost_r` was NOT NULL DEFAULT 0, so every non-resolved row carries a
--    zero that never meant anything: the previous constraint's own comment
--    called it "meaningless while pending" and pinned it to 0 purely because the
--    column could not be NULL. Removing schema-mandated filler is not
--    reinterpreting evidence. RESOLVED rows are deliberately untouched — their
--    zero may be a real estimate, and this migration does not decide.
--
UPDATE "trades" SET "system_cost_r" = NULL WHERE "system_status" <> 'resolved';--> statement-breakpoint
--
-- 2. `system_gross_r` is the frozen gross result, and the new constraint
--    requires it on every resolved row. `systemR = systemGrossR - systemCostR`
--    is the locked formula, so gross = net + cost — exact NUMERIC arithmetic
--    over two stored values, not a re-derivation from inputs and not a claim
--    about how the figure was reached. Backfilled rows still carry NO dependency
--    snapshot, which is what keeps them out of trusted new-model comparison.
--
UPDATE "trades"
SET "system_gross_r" = "system_r" + COALESCE("system_cost_r", 0)
WHERE "system_status" = 'resolved'
  AND "system_gross_r" IS NULL
  AND "system_r" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_plan_provenance_check" CHECK ("trades"."system_plan_provenance" IS NULL OR "trades"."system_plan_provenance" IN (
        'at_entry', 'reconstructed_later', 'unknown'
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_plan_adherence_check" CHECK ("trades"."plan_adherence" IS NULL OR "trades"."plan_adherence" IN (
        'followed', 'partly', 'not_followed'
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_status_check" CHECK ("trades"."system_status" IN ('pending', 'resolved', 'no_trade', 'cannot_determine'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_cost_r_check" CHECK ("trades"."system_cost_r" IS NULL OR "trades"."system_cost_r" >= 0);--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_status_consistency_check" CHECK ((
        "trades"."system_status" = 'pending'
        AND "trades"."system_cost_r" IS NULL
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" IS NULL
        AND "trades"."system_resolved_at" IS NULL
        AND "trades"."system_gross_r" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
        AND "trades"."system_dependency_snapshot" IS NULL
      ) OR (
        "trades"."system_status" = 'cannot_determine'
        AND "trades"."system_cost_r" IS NULL
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" IS NULL
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_gross_r" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ) OR (
        "trades"."system_status" = 'resolved'
        AND "trades"."system_exit_reason" IS NOT NULL
        AND "trades"."system_exit_reason" <> 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_gross_r" IS NOT NULL
        AND (
          "trades"."system_exit_reason" <> 'time_exit'
          OR "trades"."system_exited_at" IS NOT NULL
        )
        AND (
          (
            "trades"."system_cost_r" IS NOT NULL
            AND "trades"."system_r" IS NOT NULL
            AND "trades"."system_outcome" IS NOT NULL
          ) OR (
            "trades"."system_cost_r" IS NULL
            AND "trades"."system_r" IS NULL
            AND "trades"."system_outcome" IS NULL
          )
        )
        AND (
          (
            "trades"."system_resolution_kind" = 'price_exit'
            AND "trades"."planned_entry" IS NOT NULL
            AND "trades"."planned_stop" IS NOT NULL
            AND "trades"."system_exit_price" IS NOT NULL
            AND "trades"."system_gross_r_input" IS NULL
          ) OR (
            "trades"."system_resolution_kind" = 'money_target'
            AND "trades"."planned_entry" IS NULL
            AND "trades"."planned_stop" IS NULL
            AND "trades"."planned_risk_minor" IS NOT NULL
            AND "trades"."planned_reward_minor" IS NOT NULL
            AND "trades"."planned_r" IS NOT NULL
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" = "trades"."planned_r"
            AND "trades"."system_exit_reason" = 'target_hit'
          ) OR (
            "trades"."system_resolution_kind" = 'money_stop'
            AND "trades"."planned_entry" IS NULL
            AND "trades"."planned_stop" IS NULL
            AND "trades"."planned_risk_minor" IS NOT NULL
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" = -1
            AND "trades"."system_exit_reason" = 'stop_hit'
          ) OR (
            "trades"."system_resolution_kind" = 'money_break_even'
            AND "trades"."planned_entry" IS NULL
            AND "trades"."planned_stop" IS NULL
            AND "trades"."planned_risk_minor" IS NOT NULL
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" = 0
            AND "trades"."system_exit_reason" = 'break_even_rule'
          ) OR (
            "trades"."system_resolution_kind" = 'money_custom'
            AND "trades"."planned_entry" IS NULL
            AND "trades"."planned_stop" IS NULL
            AND "trades"."planned_risk_minor" IS NOT NULL
            AND "trades"."system_exit_price" IS NULL
            AND "trades"."system_gross_r_input" IS NOT NULL
            AND "trades"."system_exit_reason" = 'manual_system_valid_exit'
          )
        )
      ) OR (
        "trades"."system_status" = 'no_trade'
        AND "trades"."system_cost_r" IS NULL
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" = 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_gross_r" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ));