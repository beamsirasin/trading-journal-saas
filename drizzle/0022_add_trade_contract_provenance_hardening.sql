ALTER TABLE "trades" DROP CONSTRAINT "trades_entered_at_source_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_contract_open_risk_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_actual_risk_answer_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_exit_plan_shape_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_capture_origin_check";--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_exit_plan_id_exit_plans_id_fk";
--> statement-breakpoint
-- Hand-edited: drizzle-kit emits a bare `ON DELETE set null`, which on a
-- composite key nulls BOTH columns — including the NOT NULL `workspace_id` — so
-- deleting an Exit Plan would fail. The column list (PostgreSQL 15+) clears
-- only the provenance pointer. The snapshot still records `set null`.
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_workspace_fk" FOREIGN KEY ("exit_plan_id","workspace_id") REFERENCES "public"."exit_plans"("id","workspace_id") ON DELETE SET NULL ("exit_plan_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_entered_at_source_check" CHECK ("trades"."entered_at_source" IS NULL OR (
        "trades"."recording_contract" IS NOT NULL
        AND "trades"."entered_at_source" IN ('default_now', 'trader')
        AND "trades"."entered_at" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_open_risk_check" CHECK ("trades"."recording_contract" IS NULL OR (
        "trades"."status" <> 'planned'
        AND ("trades"."status" <> 'open' OR "trades"."planned_risk_minor" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_actual_risk_answer_check" CHECK ("trades"."actual_risk_answer" IS NULL OR (
        "trades"."recording_contract" IS NOT NULL
        AND (
          (
            "trades"."actual_risk_answer" = 'matched'
            AND "trades"."planned_risk_minor" IS NOT NULL
            AND "trades"."actual_initial_risk_minor" IS NOT DISTINCT FROM "trades"."planned_risk_minor"
          ) OR (
            "trades"."actual_risk_answer" = 'different'
            AND (
              "trades"."actual_initial_risk_minor" IS NULL
              OR "trades"."planned_risk_minor" IS NULL
              OR "trades"."actual_initial_risk_minor" <> "trades"."planned_risk_minor"
            )
          )
          OR (
            "trades"."actual_risk_answer" = 'unknown'
            AND "trades"."actual_initial_risk_minor" IS NULL
          )
        )
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_shape_check" CHECK ((
        "trades"."exit_plan_state" IS NULL
        AND "trades"."exit_plan_provenance" IS NULL
        AND "trades"."exit_plan_id" IS NULL
        AND "trades"."exit_plan_name" IS NULL
        AND "trades"."exit_plan_instructions" IS NULL
      ) OR (
        "trades"."exit_plan_state" = 'no_rule'
        AND "trades"."exit_plan_provenance" IS NULL
        AND "trades"."exit_plan_id" IS NULL
        AND "trades"."exit_plan_name" IS NULL
        AND "trades"."exit_plan_instructions" IS NULL
      ) OR (
        "trades"."exit_plan_state" = 'saved'
        AND "trades"."exit_plan_provenance" IS NOT NULL
        AND (
          "trades"."exit_plan_provenance" <> 'strategy_default'
          OR ("trades"."strategy_id" IS NOT NULL AND NOT "trades"."exit_plan_inheritance_declined")
        )
        AND "trades"."exit_plan_name" IS NOT NULL
        AND btrim("trades"."exit_plan_name") <> ''
        AND "trades"."exit_plan_instructions" IS NOT NULL
        AND btrim("trades"."exit_plan_instructions") <> ''
      ) OR (
        "trades"."exit_plan_state" = 'customized'
        AND "trades"."exit_plan_provenance" IS NOT NULL
        AND "trades"."exit_plan_instructions" IS NOT NULL
        AND btrim("trades"."exit_plan_instructions") <> ''
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_capture_origin_check" CHECK ((
          "trades"."recording_contract" IS NOT NULL OR (
            "trades"."strategy_origin" IS NULL
            AND "trades"."setup_origin" IS NULL
            AND "trades"."exit_plan_origin" IS NULL
            AND "trades"."confidence_origin" IS NULL
            AND "trades"."emotions_origin" IS NULL
            AND "trades"."classification_revised_at" IS NULL
            AND "trades"."exit_plan_revised_at" IS NULL
            AND "trades"."confidence_revised_at" IS NULL
            AND "trades"."emotions_revised_at" IS NULL
          )
        )
        AND ("trades"."strategy_origin" IS NULL OR "trades"."strategy_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."setup_origin" IS NULL OR "trades"."setup_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."exit_plan_origin" IS NULL OR "trades"."exit_plan_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."confidence_origin" IS NULL OR "trades"."confidence_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."emotions_origin" IS NULL OR "trades"."emotions_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade')));