-- Plan Outcome — what the trader's original plan would have produced
-- (Add Trade contract decision 55; src/lib/trades/plan-outcome.ts).
--
-- Additive only. Nothing is read, rewritten or backfilled: every existing
-- Trade has NULL, which is Unanswered.
--
-- A FACTUAL STAGE 6 OBSERVATION, NOT A SYSTEM ASSESSMENT. The canonical
-- System Assessment stays `trade_system_assessments`, written only by
-- Review's Confirm with its own Net / Gross, provenance and staleness rules.
-- This records capture evidence Review may read, and claims none of that.
--
--   plan_outcome              NULL (Unanswered) | planned_target_first |
--                             planned_risk_first | exit_plan_result |
--                             cannot_determine
--   plan_outcome_minor        an amount the trader STATED, in account minor
--                             units: always for exit_plan_result; for
--                             planned_target_first only when the Fixed Target
--                             had no Target Profit (a TP price alone — Price
--                             never calculates a result). Target first and
--                             risk first otherwise derive their amount from
--                             the plan when read.
--   plan_outcome_recorded_at  when the current answer was recorded.
--
-- Like the rest of Stage 6, only a Closed contract Trade may carry it.
ALTER TABLE "trades" ADD COLUMN "plan_outcome" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "plan_outcome_minor" bigint;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "plan_outcome_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_plan_outcome_check" CHECK ((
        "trades"."plan_outcome" IS NULL
        AND "trades"."plan_outcome_minor" IS NULL
        AND "trades"."plan_outcome_recorded_at" IS NULL
      ) OR (
        "trades"."recording_contract" IS NOT NULL
        AND "trades"."status" = 'closed'
        AND "trades"."plan_outcome_recorded_at" IS NOT NULL
        AND (
          ("trades"."plan_outcome" = 'planned_target_first' AND ("trades"."plan_outcome_minor" IS NULL OR "trades"."plan_outcome_minor" > 0))
          OR ("trades"."plan_outcome" = 'planned_risk_first' AND "trades"."plan_outcome_minor" IS NULL)
          OR ("trades"."plan_outcome" = 'exit_plan_result' AND "trades"."plan_outcome_minor" IS NOT NULL)
          OR ("trades"."plan_outcome" = 'cannot_determine' AND "trades"."plan_outcome_minor" IS NULL)
        )
      ));
