ALTER TABLE "trades" DROP CONSTRAINT "trades_system_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "system_resolution_kind" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "system_gross_r_input" numeric(12, 4);--> statement-breakpoint
-- Every pre-0014 resolved System result was created by the Price-only
-- service boundary. Refuse ambiguous legacy data instead of guessing, then
-- tag that authority without recalculating any historical value.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "trades"
		WHERE "system_status" = 'resolved'
			AND ("planned_entry" IS NULL OR "planned_stop" IS NULL OR "system_exit_price" IS NULL)
	) THEN
		RAISE EXCEPTION '0014 cannot truthfully classify a legacy resolved System result';
	END IF;
END;
$$;
--> statement-breakpoint
UPDATE "trades"
SET "system_resolution_kind" = 'price_exit'
WHERE "system_status" = 'resolved';
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_resolution_kind_check" CHECK ("trades"."system_resolution_kind" IS NULL OR "trades"."system_resolution_kind" IN (
        'price_exit', 'money_target', 'money_stop', 'money_break_even', 'money_custom'
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_system_status_consistency_check" CHECK ((
        "trades"."system_status" = 'pending'
        AND "trades"."system_cost_r" = 0
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" IS NULL
        AND "trades"."system_resolved_at" IS NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ) OR (
        "trades"."system_status" = 'resolved'
        AND "trades"."system_cost_r" >= 0
        AND "trades"."system_exited_at" IS NOT NULL
        AND "trades"."system_exit_reason" IS NOT NULL
        AND "trades"."system_exit_reason" <> 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_r" IS NOT NULL
        AND "trades"."system_outcome" IS NOT NULL
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
        AND "trades"."system_cost_r" = 0
        AND "trades"."system_resolution_kind" IS NULL
        AND "trades"."system_exit_price" IS NULL
        AND "trades"."system_gross_r_input" IS NULL
        AND "trades"."system_exited_at" IS NULL
        AND "trades"."system_exit_reason" = 'setup_invalidated'
        AND "trades"."system_resolved_at" IS NOT NULL
        AND "trades"."system_r" IS NULL
        AND "trades"."system_outcome" IS NULL
      ));
