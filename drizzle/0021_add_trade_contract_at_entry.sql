CREATE TABLE "exit_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"strategy_id" uuid,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"mutation_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_plans_name_not_blank_check" CHECK (btrim("exit_plans"."name") <> ''),
	CONSTRAINT "exit_plans_instructions_not_blank_check" CHECK (btrim("exit_plans"."instructions") <> '')
);
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_status_consistency_check";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "recording_contract" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "entered_at_source" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "target_state" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "target_price" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "context_entry_price" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "context_stop_price" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "context_position_size" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "actual_risk_answer" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_state" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_provenance" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_name" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_instructions" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_inheritance_declined" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "no_strategy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "no_setup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "strategy_origin" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "setup_origin" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_origin" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "confidence_origin" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "emotions_origin" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "classification_revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_plan_revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "confidence_revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "emotions_revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "exit_plans" ADD CONSTRAINT "exit_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_plans" ADD CONSTRAINT "exit_plans_strategy_workspace_fk" FOREIGN KEY ("strategy_id","workspace_id") REFERENCES "public"."strategies"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exit_plans_workspace_idx" ON "exit_plans" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_plans_workspace_mutation_key_idx" ON "exit_plans" USING btree ("workspace_id","mutation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_plans_id_workspace_idx" ON "exit_plans" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_plans_strategy_default_idx" ON "exit_plans" USING btree ("strategy_id") WHERE "exit_plans"."strategy_id" IS NOT NULL AND "exit_plans"."is_archived" = false;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_id_exit_plans_id_fk" FOREIGN KEY ("exit_plan_id") REFERENCES "public"."exit_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_recording_contract_check" CHECK ("trades"."recording_contract" IS NULL OR "trades"."recording_contract" = 'add_trade_v1');--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_entered_at_source_check" CHECK ("trades"."entered_at_source" IS NULL OR (
        "trades"."entered_at_source" IN ('default_now', 'trader') AND "trades"."entered_at" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_target_state_check" CHECK ("trades"."target_state" IS NULL OR "trades"."target_state" IN ('fixed', 'no_fixed'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_target_check" CHECK ((
        "trades"."recording_contract" IS NULL
        AND "trades"."target_state" IS NULL
        AND "trades"."target_price" IS NULL
      ) OR (
        "trades"."recording_contract" IS NOT NULL
        AND (
          (
            "trades"."target_state" IS NOT DISTINCT FROM 'fixed'
            AND ("trades"."planned_reward_minor" IS NOT NULL OR "trades"."target_price" IS NOT NULL)
            AND ("trades"."planned_reward_minor" IS NULL OR "trades"."planned_reward_minor" > 0)
          ) OR (
            "trades"."target_state" IS DISTINCT FROM 'fixed'
            AND "trades"."planned_reward_minor" IS NULL
            AND "trades"."target_price" IS NULL
          )
        )
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_context_price_check" CHECK (("trades"."target_price" IS NULL OR "trades"."target_price" > 0)
        AND ("trades"."context_entry_price" IS NULL OR "trades"."context_entry_price" > 0)
        AND ("trades"."context_stop_price" IS NULL OR "trades"."context_stop_price" > 0)
        AND ("trades"."context_position_size" IS NULL OR "trades"."context_position_size" > 0)
        AND (
          "trades"."recording_contract" IS NOT NULL OR (
            "trades"."context_entry_price" IS NULL
            AND "trades"."context_stop_price" IS NULL
            AND "trades"."context_position_size" IS NULL
          )
        ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_price_authority_check" CHECK ("trades"."recording_contract" IS NULL OR (
        "trades"."planned_entry" IS NULL
        AND "trades"."planned_stop" IS NULL
        AND "trades"."planned_target" IS NULL
        AND "trades"."planned_position_size" IS NULL
        AND "trades"."actual_entry" IS NULL
        AND "trades"."actual_initial_stop" IS NULL
        AND ("trades"."actual_result_mode" IS NULL OR "trades"."actual_result_mode" = 'money')
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_open_risk_check" CHECK ("trades"."recording_contract" IS NULL OR "trades"."status" <> 'open' OR "trades"."planned_risk_minor" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_actual_risk_answer_check" CHECK ("trades"."actual_risk_answer" IS NULL OR (
        "trades"."recording_contract" IS NOT NULL
        AND (
          (
            "trades"."actual_risk_answer" = 'matched'
            AND "trades"."planned_risk_minor" IS NOT NULL
            AND "trades"."actual_initial_risk_minor" IS NOT DISTINCT FROM "trades"."planned_risk_minor"
          ) OR "trades"."actual_risk_answer" = 'different'
          OR (
            "trades"."actual_risk_answer" = 'unknown'
            AND "trades"."actual_initial_risk_minor" IS NULL
          )
        )
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_state_check" CHECK ("trades"."exit_plan_state" IS NULL OR "trades"."exit_plan_state" IN ('saved', 'customized', 'no_rule'));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_provenance_check" CHECK ("trades"."exit_plan_provenance" IS NULL OR "trades"."exit_plan_provenance" IN ('strategy_default', 'selected'));--> statement-breakpoint
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
ALTER TABLE "trades" ADD CONSTRAINT "trades_exit_plan_contract_check" CHECK ("trades"."recording_contract" IS NOT NULL OR (
        "trades"."exit_plan_state" IS NULL AND "trades"."exit_plan_inheritance_declined" = false
      ));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_no_strategy_check" CHECK (NOT "trades"."no_strategy" OR ("trades"."strategy_id" IS NULL AND "trades"."setup_id" IS NULL));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_no_setup_check" CHECK (NOT "trades"."no_setup" OR ("trades"."strategy_id" IS NOT NULL AND "trades"."setup_id" IS NULL));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_capture_origin_check" CHECK (("trades"."strategy_origin" IS NULL OR "trades"."strategy_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."setup_origin" IS NULL OR "trades"."setup_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."exit_plan_origin" IS NULL OR "trades"."exit_plan_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."confidence_origin" IS NULL OR "trades"."confidence_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'))
        AND ("trades"."emotions_origin" IS NULL OR "trades"."emotions_origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade')));--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_status_consistency_check" CHECK ((
        "trades"."status" = 'planned'
        AND "trades"."actual_result_mode" IS NULL
        AND "trades"."actual_entry" IS NULL
        AND "trades"."actual_initial_stop" IS NULL
        AND "trades"."actual_initial_risk_minor" IS NULL
        AND "trades"."entered_at" IS NULL
        AND "trades"."actual_exit" IS NULL
        AND "trades"."net_pnl_minor" IS NULL
        AND "trades"."exited_at" IS NULL
        AND "trades"."actual_r" IS NULL
        AND "trades"."trader_outcome" IS NULL
      ) OR (
        "trades"."status" = 'open'
        AND "trades"."actual_result_mode" IS NOT NULL
        AND ("trades"."entered_at" IS NOT NULL OR "trades"."recording_contract" IS NOT NULL)
        AND "trades"."actual_exit" IS NULL
        AND "trades"."net_pnl_minor" IS NULL
        AND "trades"."exited_at" IS NULL
        AND "trades"."actual_r" IS NULL
        AND "trades"."trader_outcome" IS NULL
        AND (
          (
            "trades"."actual_result_mode" = 'price'
            AND "trades"."actual_entry" IS NOT NULL
            AND "trades"."actual_initial_stop" IS NOT NULL
            AND "trades"."actual_initial_risk_minor" IS NULL
          ) OR (
            "trades"."actual_result_mode" = 'money'
            AND (
              "trades"."actual_initial_risk_minor" IS NOT NULL
              OR ("trades"."recording_contract" IS NOT NULL AND "trades"."planned_risk_minor" IS NOT NULL)
            )
          )
        )
      ) OR (
        "trades"."status" = 'closed'
        AND (
          (
            "trades"."actual_r" IS NULL
            AND "trades"."trader_outcome" IS NULL
          ) OR (
            "trades"."actual_result_mode" = 'money'
            AND "trades"."actual_initial_risk_minor" IS NULL
            AND "trades"."net_pnl_minor" IS NOT NULL
            AND "trades"."actual_r" IS NULL
            AND (
              ("trades"."net_pnl_minor" > 0 AND "trades"."trader_outcome" = 'win')
              OR ("trades"."net_pnl_minor" < 0 AND "trades"."trader_outcome" = 'loss')
              OR ("trades"."net_pnl_minor" = 0 AND "trades"."trader_outcome" = 'break_even')
            )
          ) OR (
            "trades"."actual_r" IS NOT NULL
            AND "trades"."trader_outcome" IS NOT NULL
            AND (
              ("trades"."actual_r" > 0.0500 AND "trades"."trader_outcome" = 'win')
              OR ("trades"."actual_r" < -0.0500 AND "trades"."trader_outcome" = 'loss')
              OR (
                "trades"."actual_r" BETWEEN -0.0500 AND 0.0500
                AND "trades"."trader_outcome" = 'break_even'
              )
            )
            AND (
              (
                "trades"."actual_result_mode" = 'price'
                AND "trades"."actual_entry" IS NOT NULL
                AND "trades"."actual_initial_stop" IS NOT NULL
                AND "trades"."actual_initial_risk_minor" IS NULL
                AND "trades"."net_pnl_minor" IS NULL
                AND "trades"."actual_exit" IS NOT NULL
              ) OR (
                "trades"."actual_result_mode" = 'money'
                AND (
                  "trades"."actual_initial_risk_minor" IS NOT NULL
                  OR ("trades"."recording_contract" IS NOT NULL AND "trades"."planned_risk_minor" IS NOT NULL)
                )
                AND "trades"."net_pnl_minor" IS NOT NULL
              )
            )
          )
        )
      ) OR (
        "trades"."status" = 'canceled'
      ));--> statement-breakpoint
ALTER TABLE "trade_setup_condition_checks" ADD CONSTRAINT "trade_setup_condition_checks_origin_check" CHECK ("trade_setup_condition_checks"."origin" IS NULL OR "trade_setup_condition_checks"."origin" IN ('recorded_at_entry', 'recorded_during_trade', 'recalled_after_trade'));